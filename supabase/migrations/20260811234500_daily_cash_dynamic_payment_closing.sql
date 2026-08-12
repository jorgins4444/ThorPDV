-- ThorPDV 0.8.3: daily cash sessions, overdue closing and dynamic payment reconciliation.

create or replace function private.pdv_business_date(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select (coalesce(p_at, now()) at time zone 'America/Fortaleza')::date
$$;

alter table public.cash_sessions
  add column if not exists business_date date;

update public.cash_sessions
set business_date = private.pdv_business_date(opened_at)
where business_date is null;

alter table public.cash_sessions
  alter column business_date set not null;

alter table public.cash_sessions drop constraint if exists cash_sessions_status_check;
alter table public.cash_sessions
  add constraint cash_sessions_status_check
  check (status in ('open','pending_close','closed','cancelled'));

create index if not exists idx_cash_sessions_business_date
  on public.cash_sessions(tenant_id,pos_register_id,business_date,status,opened_at desc);

create unique index if not exists uq_cash_session_open_business_date
  on public.cash_sessions(tenant_id,pos_register_id,business_date)
  where status='open';

create or replace function private.cash_session_business_date_fill()
returns trigger
language plpgsql
set search_path='public','private','extensions'
as $$
begin
  if new.business_date is null then
    new.business_date := private.pdv_business_date(new.opened_at);
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_session_business_date_fill on public.cash_sessions;
create trigger trg_cash_session_business_date_fill
before insert or update of opened_at,business_date on public.cash_sessions
for each row execute function private.cash_session_business_date_fill();

create or replace function public.pdv_cash_rollover(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_today date:=private.pdv_business_date(now());
  v_count int:=0;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  update public.cash_sessions
     set status='pending_close',
         notes=concat_ws(' | ',nullif(notes,''),'Pendente de fechamento após virada do dia')
   where tenant_id=v.tenant_id
     and pos_register_id=v.pos_register_id
     and status='open'
     and business_date<v_today;
  get diagnostics v_count=row_count;

  return jsonb_build_object('ok',true,'business_date',v_today,'rolled_over',v_count);
end $$;

grant execute on function public.pdv_cash_rollover(text) to anon,authenticated;

create or replace function private.guard_pdv_sale_cash_business_date()
returns trigger
language plpgsql
set search_path='public','private','extensions'
as $$
declare
  v_status text;
  v_business_date date;
  v_sale_date date;
begin
  if new.channel='pdv' and new.cash_session_id is not null then
    select status,business_date into v_status,v_business_date
      from public.cash_sessions where id=new.cash_session_id;
    if v_status is null then raise exception 'cash_not_open'; end if;
    if v_status<>'open' then raise exception 'cash_day_expired'; end if;
    v_sale_date:=private.pdv_business_date(coalesce(new.completed_at,new.created_at,now()));
    if v_business_date<>v_sale_date then raise exception 'cash_day_mismatch'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_pdv_sale_cash_business_date on public.sales;
create trigger trg_guard_pdv_sale_cash_business_date
before insert on public.sales
for each row execute function private.guard_pdv_sale_cash_business_date();

create or replace function public.pdv_cash_preview_v2(
  p_device_token text,
  p_cash_open_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_cash record;
  v_payments jsonb:='[]'::jsonb;
  v_movements jsonb:='[]'::jsonb;
  v_sales_count int:=0;
  v_sales_total numeric:=0;
  v_opening numeric:=0;
  v_cash_payments numeric:=0;
  v_supply numeric:=0;
  v_receivable numeric:=0;
  v_withdrawal numeric:=0;
  v_expense numeric:=0;
  v_refund numeric:=0;
  v_expected numeric:=0;
  v_term_sales numeric:=0;
  v_term_count int:=0;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  if p_cash_open_event_id is not null then
    select cs.* into v_cash
      from public.cash_sessions cs
     where cs.tenant_id=v.tenant_id
       and cs.pos_register_id=v.pos_register_id
       and cs.client_event_id=p_cash_open_event_id
     limit 1;
  else
    select cs.* into v_cash
      from public.cash_sessions cs
     where cs.tenant_id=v.tenant_id
       and cs.pos_register_id=v.pos_register_id
       and cs.status='open'
       and cs.business_date=private.pdv_business_date(now())
     order by cs.opened_at desc limit 1;
  end if;

  if v_cash.id is null then return jsonb_build_object('ok',false,'error','cash_not_found'); end if;

  v_opening:=coalesce(v_cash.opening_amount,0);

  select coalesce(count(*),0)::int,coalesce(sum(s.total),0)::numeric
    into v_sales_count,v_sales_total
    from public.sales s
   where s.cash_session_id=v_cash.id and s.status<>'cancelled';

  select coalesce(sum(coalesce(s.term_principal_amount,
      greatest(s.total-coalesce((select sum(p.amount) from public.payments p where p.sale_id=s.id and p.status in ('paid','authorized')),0),0))),0),
         coalesce(count(*),0)::int
    into v_term_sales,v_term_count
    from public.sales s
   where s.cash_session_id=v_cash.id
     and s.status<>'cancelled'
     and s.payment_condition='term';

  with actual as (
    select p.method,sum(p.amount)::numeric amount,count(*)::int cnt
      from public.payments p
      join public.sales s on s.id=p.sale_id
     where s.cash_session_id=v_cash.id
       and p.status in ('paid','authorized')
       and s.status<>'cancelled'
     group by p.method
  ), configured as (
    select spm.code method,spm.name,spm.category,spm.sort_order
      from public.sales_payment_methods spm
     where spm.tenant_id=v.tenant_id
       and spm.company_id=v.company_id
       and spm.active=true
  ), codes as (
    select method from configured
    union select method from actual
    union select 'term_sale' where v_term_sales>0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'method',c.method,
      'name',coalesce(cfg.name,case c.method
        when 'cash' then 'Dinheiro' when 'pix' then 'PIX' when 'debit_card' then 'Cartão de débito'
        when 'credit_card' then 'Cartão de crédito' when 'voucher' then 'Voucher / Benefício'
        when 'store_credit' then 'Crédito da loja' when 'term_sale' then 'Venda a Prazo' else initcap(replace(c.method,'_',' ')) end),
      'category',coalesce(cfg.category,case when c.method='term_sale' then 'term' else 'other' end),
      'sort_order',coalesce(cfg.sort_order,case when c.method='term_sale' then 70 else 999 end),
      'amount',case when c.method='term_sale' then v_term_sales else coalesce(a.amount,0) end,
      'count',case when c.method='term_sale' then v_term_count else coalesce(a.cnt,0) end
    ) order by coalesce(cfg.sort_order,case when c.method='term_sale' then 70 else 999 end),c.method),'[]'::jsonb)
    into v_payments
    from codes c
    left join configured cfg on cfg.method=c.method
    left join actual a on a.method=c.method;

  select coalesce(sum(case when p.method='cash' then p.amount else 0 end),0)
    into v_cash_payments
    from public.payments p
    join public.sales s on s.id=p.sale_id
   where s.cash_session_id=v_cash.id and p.status in ('paid','authorized') and s.status<>'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('movement_type',x.movement_type,'amount',x.amount,'count',x.cnt) order by x.movement_type),'[]'::jsonb)
    into v_movements
    from (
      select cm.movement_type,sum(cm.amount)::numeric amount,count(*)::int cnt
        from public.cash_movements cm where cm.cash_session_id=v_cash.id group by cm.movement_type
    ) x;

  select coalesce(sum(case when movement_type='supply' then amount else 0 end),0),
         coalesce(sum(case when movement_type='receivable' then amount else 0 end),0),
         coalesce(sum(case when movement_type in ('withdrawal','sangria') then amount else 0 end),0),
         coalesce(sum(case when movement_type='expense' then amount else 0 end),0),
         coalesce(sum(case when movement_type='refund' then amount else 0 end),0)
    into v_supply,v_receivable,v_withdrawal,v_expense,v_refund
    from public.cash_movements where cash_session_id=v_cash.id;

  v_expected:=v_opening+v_cash_payments+v_supply+v_receivable-v_withdrawal-v_expense-v_refund;

  return jsonb_build_object(
    'ok',true,'source','server','cash_session_id',v_cash.id,'client_event_id',v_cash.client_event_id,
    'business_date',v_cash.business_date,'status',v_cash.status,'opened_at',v_cash.opened_at,'closed_at',v_cash.closed_at,
    'operator_user_id',v_cash.staff_user_id,'opening_amount',v_opening,'closing_amount',v_cash.closing_amount,
    'sales_count',v_sales_count,'sales_total',v_sales_total,'payments',coalesce(v_payments,'[]'::jsonb),
    'movements',coalesce(v_movements,'[]'::jsonb),'cash_payments',v_cash_payments,'term_sales_total',v_term_sales,
    'supply',v_supply,'receivable_received',v_receivable,'withdrawal',v_withdrawal,'expense',v_expense,'refund',v_refund,
    'expected_cash',v_expected,'server_time',now()
  );
end $$;

grant execute on function public.pdv_cash_preview_v2(text,uuid) to anon,authenticated;

create or replace function public.pdv_cash_sessions_list(
  p_device_token text,
  p_from date default null,
  p_to date default null,
  p_status text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_rows jsonb;
  v_today date:=private.pdv_business_date(now());
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.business_date desc,x.opened_at desc),'[]'::jsonb)
    into v_rows
    from (
      select cs.client_event_id,cs.id as cash_session_id,cs.business_date,cs.status,cs.opened_at,cs.closed_at,
             cs.opening_amount,cs.closing_amount,coalesce(su.name,'') operator_name,
             coalesce((select count(*) from public.sales s where s.cash_session_id=cs.id and s.status<>'cancelled'),0)::int sales_count,
             coalesce((select sum(s.total) from public.sales s where s.cash_session_id=cs.id and s.status<>'cancelled'),0)::numeric sales_total,
             cs.opening_amount
               +coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status<>'cancelled' and p.status in ('paid','authorized') and p.method='cash'),0)
               +coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('supply','receivable')),0)
               -coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('withdrawal','sangria','expense','refund')),0) expected_cash
        from public.cash_sessions cs
        left join public.staff_users su on su.id=cs.staff_user_id
       where cs.tenant_id=v.tenant_id
         and cs.pos_register_id=v.pos_register_id
         and (p_from is null or cs.business_date>=p_from)
         and (p_to is null or cs.business_date<=p_to)
         and (
           coalesce(p_status,'all')='all'
           or (p_status='open' and cs.status in ('open','pending_close'))
           or (p_status='pending_close' and cs.status='pending_close')
           or (p_status='closed' and cs.status='closed')
           or cs.status=p_status
         )
       order by cs.business_date desc,cs.opened_at desc
       limit 120
    ) x;

  return jsonb_build_object('ok',true,'business_date',v_today,'sessions',v_rows);
end $$;

grant execute on function public.pdv_cash_sessions_list(text,date,date,text) to anon,authenticated;

create or replace function public.pdv_cash_close_session(
  p_device_token text,
  p_cash_open_event_id uuid,
  p_closing_amount numeric,
  p_notes text,
  p_operator_user_id uuid,
  p_reconciliation jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_cash public.cash_sessions%rowtype;
  v_expected numeric:=0;
  v_closing numeric:=greatest(coalesce(p_closing_amount,0),0);
  v_now timestamptz:=now();
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if p_operator_user_id is null or not private.pdv_action_allowed(v.tenant_id,v.branch_id,p_operator_user_id,'cash.close',null) then
    return jsonb_build_object('ok',false,'error','cash_close_not_authorized');
  end if;

  select * into v_cash
    from public.cash_sessions
   where tenant_id=v.tenant_id
     and pos_register_id=v.pos_register_id
     and client_event_id=p_cash_open_event_id
     and status in ('open','pending_close')
   for update;
  if v_cash.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;

  select cs.opening_amount
      +coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status<>'cancelled' and p.method='cash' and p.status in ('paid','authorized')),0)
      +coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('supply','receivable')),0)
      -coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('withdrawal','sangria','expense','refund')),0)
    into v_expected
    from public.cash_sessions cs where cs.id=v_cash.id;

  update public.cash_sessions
     set status='closed',closing_amount=v_closing,closed_at=v_now,
         notes=concat_ws(' | ',nullif(notes,''),nullif(trim(coalesce(p_notes,'')),''))
   where id=v_cash.id;

  insert into public.cash_session_audit(
    tenant_id,cash_session_id,action,previous_status,new_status,previous_closing_amount,new_closing_amount,
    previous_closed_at,new_closed_at,expected_cash,reason,actor_user_id,source
  ) values(
    v.tenant_id,v_cash.id,'management_close',v_cash.status,'closed',v_cash.closing_amount,v_closing,
    v_cash.closed_at,v_now,v_expected,nullif(trim(coalesce(p_notes,'')),''),p_operator_user_id,'pdv_desktop'
  );

  return jsonb_build_object('ok',true,'cash_session_id',v_cash.id,'client_event_id',v_cash.client_event_id,
    'business_date',v_cash.business_date,'expected_cash',v_expected,'closing_amount',v_closing,
    'difference',v_closing-v_expected,'closed_at',v_now,'reconciliation',coalesce(p_reconciliation,'{}'::jsonb));
end $$;

grant execute on function public.pdv_cash_close_session(text,uuid,numeric,text,uuid,jsonb) to anon,authenticated;
