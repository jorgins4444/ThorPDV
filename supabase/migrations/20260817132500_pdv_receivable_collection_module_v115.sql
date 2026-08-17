-- ThorPDV v0.8.51 / Recebimento de crediário no caixa.
-- O recebimento é online e autoritativo: consulta/baixa ocorrem no servidor,
-- com idempotência por dispositivo + evento e reflexo correto no fechamento.

create table if not exists public.receivable_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  device_id uuid references public.pdv_devices(id) on delete set null,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  operator_user_id uuid references public.staff_users(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  number bigint not null,
  client_event_id uuid not null,
  payment_method text not null,
  total_amount numeric(14,2) not null check (total_amount > 0),
  pending_count_after integer not null default 0,
  pending_total_after numeric(14,2) not null default 0,
  notes text,
  status text not null default 'completed' check (status in ('completed','reversed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(tenant_id, number),
  unique(device_id, client_event_id)
);

create table if not exists public.receivable_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null references public.receivable_receipts(id) on delete cascade,
  financial_entry_id uuid not null references public.financial_entries(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  entry_amount numeric(14,2) not null,
  paid_before numeric(14,2) not null default 0,
  remaining_before numeric(14,2) not null,
  amount_applied numeric(14,2) not null check (amount_applied > 0),
  remaining_after numeric(14,2) not null,
  due_date date,
  installment integer,
  installments integer,
  created_at timestamptz not null default now(),
  unique(receipt_id, financial_entry_id)
);

create index if not exists idx_receivable_receipts_customer on public.receivable_receipts(tenant_id,customer_id,created_at desc);
create index if not exists idx_receivable_receipts_cash on public.receivable_receipts(cash_session_id,created_at);
create index if not exists idx_receivable_receipt_items_entry on public.receivable_receipt_items(financial_entry_id);

alter table public.receivable_receipts enable row level security;
alter table public.receivable_receipt_items enable row level security;

create or replace function private.pdv_receivable_receipt_result(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  r public.receivable_receipts%rowtype;
  c public.customers%rowtype;
  v_operator text;
  v_method_name text;
  v_items jsonb;
begin
  select * into r from public.receivable_receipts where id=p_receipt_id limit 1;
  if r.id is null then return jsonb_build_object('ok',false,'error','receivable_receipt_not_found'); end if;
  select * into c from public.customers where id=r.customer_id limit 1;
  select name into v_operator from public.staff_users where id=r.operator_user_id limit 1;
  select name into v_method_name from public.sales_payment_methods where tenant_id=r.tenant_id and company_id=r.company_id and code=r.payment_method limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'financial_entry_id',ri.financial_entry_id,
    'sale_id',ri.sale_id,
    'sale_number',s.number,
    'description',fe.description,
    'due_date',ri.due_date,
    'installment',ri.installment,
    'installments',ri.installments,
    'entry_amount',ri.entry_amount,
    'paid_before',ri.paid_before,
    'remaining_before',ri.remaining_before,
    'amount_applied',ri.amount_applied,
    'remaining_after',ri.remaining_after
  ) order by ri.due_date nulls last,ri.installment,ri.created_at),'[]'::jsonb)
  into v_items
  from public.receivable_receipt_items ri
  left join public.financial_entries fe on fe.id=ri.financial_entry_id
  left join public.sales s on s.id=ri.sale_id
  where ri.receipt_id=r.id;

  return jsonb_build_object(
    'ok',true,
    'receipt',jsonb_build_object(
      'id',r.id,'number',r.number,'client_event_id',r.client_event_id,'created_at',r.created_at,
      'payment_method',r.payment_method,'payment_method_name',coalesce(v_method_name,initcap(replace(r.payment_method,'_',' '))),
      'total_amount',r.total_amount,'pending_count_after',r.pending_count_after,'pending_total_after',r.pending_total_after,
      'notes',r.notes,'cash_session_id',r.cash_session_id,'device_id',r.device_id,
      'operator_user_id',r.operator_user_id,'operator_name',coalesce(v_operator,'Operador'),
      'customer',jsonb_build_object(
        'id',c.id,'name',c.name,'document',c.document,'phone',c.phone,'email',c.email,
        'street',c.street,'number',c.number,'complement',c.complement,'district',c.district,
        'city',c.city,'state',c.state,'postal_code',c.postal_code
      ),
      'items',v_items,
      'metadata',r.metadata
    )
  );
end
$fn$;

create or replace function public.pdv_receivables_search(p_device_token text, p_query text default '', p_customer_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  v record;
  v_q text:=trim(coalesce(p_query,''));
  v_digits text:=regexp_replace(coalesce(p_query,''),'\D','','g');
  v_customers jsonb:='[]'::jsonb;
  v_customer jsonb:=null;
  v_entries jsonb:='[]'::jsonb;
  v_methods jsonb:='[]'::jsonb;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('code',m.code,'name',m.name,'category',m.category,'sort_order',m.sort_order) order by m.sort_order,m.name),'[]'::jsonb)
  into v_methods
  from public.sales_payment_methods m
  where m.tenant_id=v.tenant_id and m.company_id=v.company_id and m.active=true
    and m.code in ('cash','pix','debit_card','credit_card','other');

  if p_customer_id is null then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_customers
    from (
      select c.id,c.name,c.document,c.phone,
        count(*) filter(where fe.status in ('open','partial'))::int open_count,
        coalesce(sum(greatest(fe.amount-fe.paid_amount,0)) filter(where fe.status in ('open','partial')),0)::numeric open_total,
        count(*) filter(where fe.status in ('open','partial') and fe.due_date<current_date)::int overdue_count
      from public.customers c
      join public.financial_entries fe on fe.customer_id=c.id and fe.tenant_id=c.tenant_id
      left join public.sales s on s.id=fe.sale_id and s.tenant_id=fe.tenant_id
      where c.tenant_id=v.tenant_id and c.active=true
        and fe.entry_type='receivable' and fe.status in ('open','partial')
        and coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),'')='crediario'
        and ((fe.metadata->>'origin'='sale_term') or (s.id is not null and s.payment_condition='term'))
        and (
          v_q='' or c.name ilike '%'||v_q||'%'
          or (v_digits<>'' and regexp_replace(coalesce(c.document,''),'\D','','g') like '%'||v_digits||'%')
        )
      group by c.id,c.name,c.document,c.phone
      order by c.name
      limit 30
    ) x;
    return jsonb_build_object('ok',true,'customers',v_customers,'payment_methods',v_methods,'server_time',now());
  end if;

  select jsonb_build_object(
    'id',c.id,'name',c.name,'document',c.document,'phone',c.phone,'email',c.email,
    'street',c.street,'number',c.number,'complement',c.complement,'district',c.district,
    'city',c.city,'state',c.state,'postal_code',c.postal_code
  ) into v_customer
  from public.customers c
  where c.id=p_customer_id and c.tenant_id=v.tenant_id and c.active=true limit 1;
  if v_customer is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date,x.sale_number,x.installment),'[]'::jsonb) into v_entries
  from (
    select fe.id financial_entry_id,fe.sale_id,s.number sale_number,fe.description,
      fe.amount,fe.paid_amount,greatest(fe.amount-fe.paid_amount,0)::numeric remaining,
      fe.due_date,fe.status,
      case when fe.due_date<current_date then true else false end overdue,
      nullif(fe.metadata->>'installment','')::int installment,
      nullif(fe.metadata->>'installments','')::int installments,
      coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),'crediario') term_method
    from public.financial_entries fe
    left join public.sales s on s.id=fe.sale_id and s.tenant_id=fe.tenant_id
    where fe.tenant_id=v.tenant_id and fe.customer_id=p_customer_id
      and fe.entry_type='receivable' and fe.status in ('open','partial')
      and greatest(fe.amount-fe.paid_amount,0)>0.001
      and coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),'')='crediario'
      and ((fe.metadata->>'origin'='sale_term') or (s.id is not null and s.payment_condition='term'))
  ) x;

  return jsonb_build_object(
    'ok',true,'customer',v_customer,'entries',v_entries,'payment_methods',v_methods,
    'open_count',jsonb_array_length(v_entries),
    'open_total',coalesce((select sum((e->>'remaining')::numeric) from jsonb_array_elements(v_entries) e),0),
    'server_time',now()
  );
end
$fn$;

create or replace function public.pdv_receivables_receive(p_device_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  v record;
  v_cash public.cash_sessions%rowtype;
  v_customer public.customers%rowtype;
  v_operator public.staff_users%rowtype;
  fe public.financial_entries%rowtype;
  s public.sales%rowtype;
  e jsonb;
  v_entry_id uuid;
  v_customer_id uuid:=nullif(p_payload->>'customer_id','')::uuid;
  v_operator_id uuid:=nullif(p_payload->>'operator_user_id','')::uuid;
  v_event_id uuid:=nullif(p_payload->>'client_event_id','')::uuid;
  v_method text:=lower(trim(coalesce(p_payload->>'payment_method','')));
  v_amount numeric;
  v_remaining numeric;
  v_total numeric:=0;
  v_receipt_id uuid;
  v_receipt_number bigint;
  v_settlement_id uuid;
  v_bank_tx uuid;
  v_internal uuid;
  v_pending_count int:=0;
  v_pending_total numeric:=0;
  v_existing uuid;
  v_items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if v_event_id is null then return jsonb_build_object('ok',false,'error','client_event_id_required'); end if;

  select id into v_existing from public.receivable_receipts where device_id=v.device_id and client_event_id=v_event_id limit 1;
  if v_existing is not null then return private.pdv_receivable_receipt_result(v_existing); end if;

  if v_customer_id is null then return jsonb_build_object('ok',false,'error','customer_required'); end if;
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then return jsonb_build_object('ok',false,'error','receivable_items_required'); end if;
  if jsonb_array_length(v_items)>100 then return jsonb_build_object('ok',false,'error','too_many_receivable_items'); end if;
  if exists(
    select 1 from jsonb_array_elements(v_items) item
    group by item->>'financial_entry_id'
    having count(*)>1
  ) then return jsonb_build_object('ok',false,'error','duplicate_receivable_item'); end if;

  select * into v_cash from public.cash_sessions cs
  where cs.tenant_id=v.tenant_id and cs.pos_register_id=v.pos_register_id and cs.status='open'
    and cs.business_date=private.pdv_business_date(now())
  order by cs.opened_at desc limit 1 for update;
  if v_cash.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;

  select * into v_customer from public.customers where id=v_customer_id and tenant_id=v.tenant_id and active=true limit 1;
  if v_customer.id is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;
  select * into v_operator from public.staff_users where id=v_operator_id and tenant_id=v.tenant_id and active=true limit 1;
  if v_operator.id is null then return jsonb_build_object('ok',false,'error','operator_required'); end if;

  if v_method not in ('cash','pix','debit_card','credit_card','other') or not exists(
    select 1 from public.sales_payment_methods m where m.tenant_id=v.tenant_id and m.company_id=v.company_id and m.code=v_method and m.active=true
  ) then return jsonb_build_object('ok',false,'error','invalid_payment_method'); end if;

  perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':receivable:'||v_customer_id::text));

  for e in select * from jsonb_array_elements(v_items) loop
    v_entry_id:=nullif(e->>'financial_entry_id','')::uuid;
    v_amount:=round(coalesce(nullif(e->>'amount','')::numeric,0),2);
    if v_entry_id is null or v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_receivable_amount'); end if;
    select * into fe from public.financial_entries where id=v_entry_id and tenant_id=v.tenant_id and customer_id=v_customer_id for update;
    if fe.id is null or fe.status not in ('open','partial') then return jsonb_build_object('ok',false,'error','receivable_not_open','financial_entry_id',v_entry_id); end if;
    if fe.sale_id is not null then select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id limit 1; else s:=null; end if;
    if coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),'')<>'crediario'
       or not ((fe.metadata->>'origin'='sale_term') or (s.id is not null and s.payment_condition='term')) then
      return jsonb_build_object('ok',false,'error','crediario_receivable_only','financial_entry_id',v_entry_id);
    end if;
    v_remaining:=greatest(fe.amount-fe.paid_amount,0);
    if v_amount>v_remaining+0.001 then return jsonb_build_object('ok',false,'error','receivable_amount_exceeds_remaining','financial_entry_id',v_entry_id,'remaining',v_remaining); end if;
    v_total:=v_total+v_amount;
  end loop;

  if v_total<=0 then return jsonb_build_object('ok',false,'error','invalid_receipt_total'); end if;
  perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':receivable_receipt_number'));
  select coalesce(max(number),0)+1 into v_receipt_number from public.receivable_receipts where tenant_id=v.tenant_id;

  insert into public.receivable_receipts(
    tenant_id,company_id,branch_id,device_id,cash_session_id,operator_user_id,customer_id,number,client_event_id,payment_method,total_amount,notes,metadata
  ) values(
    v.tenant_id,v.company_id,v.branch_id,v.device_id,v_cash.id,v_operator.id,v_customer.id,v_receipt_number,v_event_id,v_method,round(v_total,2),nullif(trim(p_payload->>'notes'),''),
    jsonb_build_object('source','thorpdv','business_date',v_cash.business_date,'pos_register_id',v.pos_register_id)
  ) returning id into v_receipt_id;

  if v_method='cash' then v_internal:=private.ensure_internal_cash_account(v.tenant_id,v.company_id,v.branch_id); end if;

  for e in select * from jsonb_array_elements(v_items) loop
    v_entry_id:=(e->>'financial_entry_id')::uuid;
    v_amount:=round((e->>'amount')::numeric,2);
    select * into fe from public.financial_entries where id=v_entry_id for update;
    v_remaining:=greatest(fe.amount-fe.paid_amount,0);
    v_settlement_id:=gen_random_uuid();
    v_bank_tx:=null;

    insert into public.financial_settlements(
      id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,cash_session_id,notes,metadata
    ) values(
      v_settlement_id,v.tenant_id,fe.company_id,fe.branch_id,fe.id,v_amount,now(),v_method,'cash_session',v_cash.id,
      'Recebimento no ThorPDV #'||v_receipt_number,
      jsonb_build_object('source','pdv_receivable_receipt','receipt_id',v_receipt_id,'receipt_number',v_receipt_number,'client_event_id',v_event_id,'device_id',v.device_id)
    );

    if v_method='cash' then
      insert into public.bank_transactions(
        tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes
      ) values(
        v.tenant_id,v_internal,current_date,'Recebimento crediário #'||v_receipt_number||' - '||fe.description,v_amount,'credit',true,fe.id,v_cash.id,'cash','financial_settlement',v_settlement_id,'Recebimento em dinheiro no ThorPDV.'
      ) returning id into v_bank_tx;
      update public.financial_settlements set bank_transaction_id=v_bank_tx where id=v_settlement_id;
    end if;

    insert into public.receivable_receipt_items(
      tenant_id,receipt_id,financial_entry_id,sale_id,entry_amount,paid_before,remaining_before,amount_applied,remaining_after,due_date,installment,installments
    ) values(
      v.tenant_id,v_receipt_id,fe.id,fe.sale_id,fe.amount,fe.paid_amount,v_remaining,v_amount,greatest(v_remaining-v_amount,0),fe.due_date,
      nullif(fe.metadata->>'installment','')::int,nullif(fe.metadata->>'installments','')::int
    );

    update public.financial_entries
    set paid_amount=least(amount,paid_amount+v_amount),
        status=case when paid_amount+v_amount>=amount-0.001 then 'paid' else 'partial' end,
        paid_at=case when paid_amount+v_amount>=amount-0.001 then now() else paid_at end,
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method',v_method,'last_destination_type','cash_session','last_settlement_id',v_settlement_id,'last_pdv_receipt_id',v_receipt_id)
    where id=fe.id;
  end loop;

  if v_method='cash' then
    insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,notes,device_id,client_event_id,payment_method)
    values(v.tenant_id,v_cash.id,'receivable',round(v_total,2),'Recebimento de crediário #'||v_receipt_number,v.device_id,v_event_id,'cash')
    on conflict(device_id,client_event_id) do nothing;
  end if;

  select count(*)::int,coalesce(sum(greatest(fe.amount-fe.paid_amount,0)),0)::numeric
  into v_pending_count,v_pending_total
  from public.financial_entries fe
  left join public.sales sx on sx.id=fe.sale_id and sx.tenant_id=fe.tenant_id
  where fe.tenant_id=v.tenant_id and fe.customer_id=v_customer_id and fe.entry_type='receivable' and fe.status in ('open','partial')
    and greatest(fe.amount-fe.paid_amount,0)>0.001
    and coalesce(nullif(fe.metadata->>'term_method',''),nullif(sx.term_method,''),'')='crediario'
    and ((fe.metadata->>'origin'='sale_term') or (sx.id is not null and sx.payment_condition='term'));

  update public.receivable_receipts set pending_count_after=v_pending_count,pending_total_after=v_pending_total where id=v_receipt_id;
  return private.pdv_receivable_receipt_result(v_receipt_id);
end
$fn$;

create or replace function private.cash_receivable_metrics(p_cash_id uuid, p_cutoff timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  v_total numeric:=0;
  v_cash numeric:=0;
  v_count int:=0;
  v_methods jsonb:='[]'::jsonb;
begin
  select coalesce(sum(r.total_amount),0),coalesce(sum(case when r.payment_method='cash' then r.total_amount else 0 end),0),count(*)::int
  into v_total,v_cash,v_count
  from public.receivable_receipts r
  where r.cash_session_id=p_cash_id and r.status='completed' and r.created_at<=coalesce(p_cutoff,now());

  select coalesce(jsonb_agg(jsonb_build_object('method',x.payment_method,'name',coalesce(m.name,initcap(replace(x.payment_method,'_',' '))),'amount',x.amount,'count',x.cnt) order by coalesce(m.sort_order,999),x.payment_method),'[]'::jsonb)
  into v_methods
  from (
    select r.payment_method,sum(r.total_amount)::numeric amount,count(*)::int cnt
    from public.receivable_receipts r
    where r.cash_session_id=p_cash_id and r.status='completed' and r.created_at<=coalesce(p_cutoff,now())
    group by r.payment_method
  ) x
  left join public.cash_sessions cs on cs.id=p_cash_id
  left join public.sales_payment_methods m on m.tenant_id=cs.tenant_id and m.company_id=(select company_id from public.pdv_devices d where d.pos_register_id=cs.pos_register_id and d.tenant_id=cs.tenant_id limit 1) and m.code=x.payment_method;

  return jsonb_build_object('receivable_receipt_count',v_count,'receivable_received_total',v_total,'receivable_received_cash',v_cash,'receivable_payments',v_methods);
end
$fn$;

create or replace function public.pdv_cash_preview_v3(p_device_token text, p_cash_open_event_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  data jsonb;
  metrics jsonb;
  receivable_metrics jsonb;
  merged_payments jsonb:='[]'::jsonb;
  cash_id uuid;
begin
  data:=public.pdv_cash_preview_v2(p_device_token,p_cash_open_event_id);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  cash_id:=nullif(data->>'cash_session_id','')::uuid;
  metrics:=private.cash_return_metrics(cash_id,coalesce(nullif(data->>'closed_at','')::timestamptz,now()));
  receivable_metrics:=private.cash_receivable_metrics(cash_id,coalesce(nullif(data->>'closed_at','')::timestamptz,now()));

  select coalesce(jsonb_agg(jsonb_build_object(
    'method',x.method,'name',x.name,'category',x.category,'sort_order',x.sort_order,'amount',x.amount,'count',x.cnt
  ) order by x.sort_order,x.method),'[]'::jsonb)
  into merged_payments
  from (
    select method,
      coalesce(max(name) filter(where nullif(name,'') is not null),initcap(replace(method,'_',' '))) name,
      coalesce(max(category) filter(where nullif(category,'') is not null),'other') category,
      min(sort_order) sort_order,sum(amount)::numeric amount,sum(cnt)::int cnt
    from (
      select p->>'method' method,p->>'name' name,p->>'category' category,
        coalesce(nullif(p->>'sort_order','')::int,999) sort_order,
        coalesce(nullif(p->>'amount','')::numeric,0) amount,coalesce(nullif(p->>'count','')::int,0) cnt
      from jsonb_array_elements(coalesce(data->'payments','[]'::jsonb)) p
      union all
      select r->>'method' method,r->>'name' name,null category,850 sort_order,
        coalesce(nullif(r->>'amount','')::numeric,0) amount,coalesce(nullif(r->>'count','')::int,0) cnt
      from jsonb_array_elements(coalesce(receivable_metrics->'receivable_payments','[]'::jsonb)) r
    ) raw
    where nullif(method,'') is not null
    group by method
  ) x;

  data:=jsonb_set(data,'{payments}',merged_payments,true);
  return data||metrics||receivable_metrics;
end
$fn$;

create or replace function public.pdv_sync_push(p_device_token text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  e jsonb;
  v_event_id uuid;
  v_type text;
  v_payload jsonb;
  v_result jsonb;
  v_call jsonb;
  v_results jsonb:='[]'::jsonb;
  v_status text;
  v_error text;
begin
  if jsonb_typeof(p_events)<>'array' then return jsonb_build_object('ok',false,'error','events_must_be_array'); end if;
  if jsonb_array_length(p_events)>100 then return jsonb_build_object('ok',false,'error','too_many_events','max',100); end if;

  if not exists (
    select 1 from jsonb_array_elements(p_events) cmd
    where lower(trim(coalesce(cmd->>'type',''))) in ('cash_rollover','cash_sessions_query','cash_preview_query','cash_historical_close','receivables_query','receivable_receive')
  ) then
    return public.pdv_sync_push_legacy_v085(p_device_token,p_events);
  end if;

  for e in select * from jsonb_array_elements(p_events) loop
    begin
      v_event_id:=(e->>'id')::uuid;
      v_type:=lower(trim(coalesce(e->>'type','')));
      v_payload:=coalesce(e->'payload','{}'::jsonb);
      v_result:=null;
      v_error:=null;

      if v_type='cash_rollover' then
        v_result:=public.pdv_cash_rollover(p_device_token);
      elsif v_type='cash_sessions_query' then
        v_result:=public.pdv_cash_sessions_list(p_device_token,nullif(v_payload->>'from','')::date,nullif(v_payload->>'to','')::date,coalesce(nullif(v_payload->>'status',''),'all'));
      elsif v_type='cash_preview_query' then
        v_result:=public.pdv_cash_preview_v3(p_device_token,nullif(v_payload->>'cash_open_event_id','')::uuid);
      elsif v_type='cash_historical_close' then
        v_result:=public.pdv_cash_close_session(p_device_token,nullif(v_payload->>'cash_open_event_id','')::uuid,greatest(coalesce(nullif(v_payload->>'closing_amount','')::numeric,0),0),coalesce(v_payload->>'notes',''),nullif(v_payload->>'operator_user_id','')::uuid,coalesce(v_payload->'reconciliation','{}'::jsonb));
      elsif v_type='receivables_query' then
        v_result:=public.pdv_receivables_search(p_device_token,coalesce(v_payload->>'query',''),nullif(v_payload->>'customer_id','')::uuid);
      elsif v_type='receivable_receive' then
        v_result:=public.pdv_receivables_receive(p_device_token,v_payload||jsonb_build_object('client_event_id',v_event_id));
      else
        v_call:=public.pdv_sync_push_legacy_v085(p_device_token,jsonb_build_array(e));
        v_results:=v_results||coalesce(v_call->'results','[]'::jsonb);
        continue;
      end if;

      if coalesce((v_result->>'ok')::boolean,false) then
        v_status:='processed';
        v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_event_id,'type',v_type,'status',v_status,'result',v_result));
      else
        v_status:='rejected';
        v_error:=coalesce(v_result->>'error','pdv_command_failed');
        v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_event_id,'type',v_type,'status',v_status,'error',v_error,'result',v_result));
      end if;
    exception when others then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('id',coalesce(v_event_id,gen_random_uuid()),'type',coalesce(v_type,''),'status','rejected','error',sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ok',true,'server_time',now(),'results',v_results);
end
$fn$;

grant execute on function public.pdv_receivables_search(text,text,uuid) to anon,authenticated,service_role;
grant execute on function public.pdv_receivables_receive(text,jsonb) to anon,authenticated,service_role;
