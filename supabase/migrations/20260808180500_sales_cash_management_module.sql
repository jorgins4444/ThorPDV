create table if not exists public.cash_session_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  action text not null check (action in ('management_close','management_reopen')),
  previous_status text,
  new_status text,
  previous_closing_amount numeric,
  new_closing_amount numeric,
  previous_closed_at timestamptz,
  new_closed_at timestamptz,
  expected_cash numeric,
  reason text,
  actor_user_id uuid,
  actor_email text,
  source text not null default 'management',
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_session_audit_tenant_date on public.cash_session_audit(tenant_id, created_at desc);
create index if not exists idx_cash_session_audit_session on public.cash_session_audit(cash_session_id, created_at desc);
alter table public.cash_session_audit enable row level security;

create or replace function public.erp_sales_cash_dashboard(
  p_token text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_operator uuid default null,
  p_branch uuid default null,
  p_status text default null
) returns jsonb
language plpgsql security definer
set search_path = public, private, extensions
as $$
declare
  v record;
  v_start timestamptz := coalesce(p_start, date_trunc('day', now()));
  v_end timestamptz := coalesce(p_end, date_trunc('day', now()) + interval '1 day');
  v_sessions jsonb; v_operations jsonb; v_operators jsonb; v_branches jsonb; v_summary jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  with session_calc as (
    select cs.id,cs.status,cs.opening_amount,cs.closing_amount,cs.opened_at,cs.closed_at,cs.notes,
      cs.pos_register_id,cs.staff_user_id,cs.pdv_device_id,pr.name pos,pr.code pos_code,pr.branch_id,b.name branch,su.name operator,
      coalesce((select count(*) from sales s where s.cash_session_id=cs.id and s.status='completed'),0) sales_count,
      coalesce((select sum(s.total) from sales s where s.cash_session_id=cs.id and s.status='completed'),0) sales_total,
      coalesce((select sum(p.amount) from payments p join sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status='paid'),0) received_total,
      coalesce((select sum(p.amount) from payments p join sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status='paid' and p.method='cash'),0) cash_received,
      coalesce((select sum(cm.amount) from cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type='supply'),0) supply,
      coalesce((select sum(cm.amount) from cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('withdrawal','sangria')),0) withdrawal,
      coalesce((select sum(cm.amount) from cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type='expense'),0) expense,
      coalesce((select sum(cm.amount) from cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type='refund'),0) refund,
      coalesce((select count(*) from cash_session_audit a where a.cash_session_id=cs.id and a.action='management_reopen'),0) reopen_count
    from cash_sessions cs join pos_registers pr on pr.id=cs.pos_register_id join branches b on b.id=pr.branch_id left join staff_users su on su.id=cs.staff_user_id
    where cs.tenant_id=v.tenant_id and (p_branch is null or pr.branch_id=p_branch) and (p_operator is null or cs.staff_user_id=p_operator)
      and (p_status is null or p_status='' or cs.status=p_status)
      and (cs.status='open' or cs.opened_at < v_end and coalesce(cs.closed_at,v_end)>=v_start)
  ), enriched as (
    select sc.*,sc.opening_amount+sc.cash_received+sc.supply-sc.withdrawal-sc.expense-sc.refund expected_cash,
      case when sc.status='closed' and sc.closing_amount is not null then sc.closing_amount-(sc.opening_amount+sc.cash_received+sc.supply-sc.withdrawal-sc.expense-sc.refund) else null end difference
    from session_calc sc
  ) select coalesce(jsonb_agg(to_jsonb(e) order by e.opened_at desc),'[]'::jsonb) into v_sessions from enriched e;

  with filtered_sessions as (
    select cs.id,cs.pos_register_id,cs.staff_user_id,pr.branch_id,pr.name pos,b.name branch,su.name operator
    from cash_sessions cs join pos_registers pr on pr.id=cs.pos_register_id join branches b on b.id=pr.branch_id left join staff_users su on su.id=cs.staff_user_id
    where cs.tenant_id=v.tenant_id and (p_branch is null or pr.branch_id=p_branch) and (p_operator is null or cs.staff_user_id=p_operator)
  ), ops as (
    select cs.id::text||':open' op_key,cs.id cash_session_id,cs.opened_at occurred_at,'opening' op_type,'Abertura de caixa' description,cs.opening_amount amount,fs.pos,fs.branch,fs.operator,cs.staff_user_id operator_id,'open' status
      from cash_sessions cs join filtered_sessions fs on fs.id=cs.id where cs.opened_at>=v_start and cs.opened_at<v_end
    union all
    select s.id::text,s.cash_session_id,coalesce(s.completed_at,s.created_at),'sale','Venda #'||s.number::text,s.total,fs.pos,fs.branch,coalesce(su.name,fs.operator),s.staff_user_id,s.status
      from sales s join filtered_sessions fs on fs.id=s.cash_session_id left join staff_users su on su.id=s.staff_user_id
      where coalesce(s.completed_at,s.created_at)>=v_start and coalesce(s.completed_at,s.created_at)<v_end and (p_operator is null or s.staff_user_id=p_operator or fs.staff_user_id=p_operator)
    union all
    select cm.id::text,cm.cash_session_id,cm.created_at,'cash_movement',case cm.movement_type when 'supply' then 'Suprimento' when 'withdrawal' then 'Sangria' when 'sangria' then 'Sangria' when 'expense' then 'Despesa' when 'refund' then 'Devolução em dinheiro' else 'Movimento: '||cm.movement_type end,cm.amount,fs.pos,fs.branch,fs.operator,fs.staff_user_id,cm.movement_type
      from cash_movements cm join filtered_sessions fs on fs.id=cm.cash_session_id where cm.created_at>=v_start and cm.created_at<v_end
    union all
    select cs.id::text||':close:'||extract(epoch from cs.closed_at)::text,cs.id,cs.closed_at,'closing','Fechamento de caixa',cs.closing_amount,fs.pos,fs.branch,fs.operator,cs.staff_user_id,'closed'
      from cash_sessions cs join filtered_sessions fs on fs.id=cs.id where cs.closed_at is not null and cs.closed_at>=v_start and cs.closed_at<v_end
    union all
    select a.id::text,a.cash_session_id,a.created_at,'reopen','Reabertura pelo Gestão'||case when coalesce(a.reason,'')<>'' then ': '||a.reason else '' end,a.previous_closing_amount,fs.pos,fs.branch,coalesce(a.actor_email,fs.operator),fs.staff_user_id,'reopened'
      from cash_session_audit a join filtered_sessions fs on fs.id=a.cash_session_id where a.action='management_reopen' and a.created_at>=v_start and a.created_at<v_end
  ) select coalesce(jsonb_agg(to_jsonb(o) order by o.occurred_at desc),'[]'::jsonb) into v_operations from ops o;

  select coalesce(jsonb_agg(jsonb_build_object('id',su.id,'name',su.name) order by su.name),'[]'::jsonb) into v_operators from staff_users su where su.tenant_id=v.tenant_id and su.active=true;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name),'[]'::jsonb) into v_branches from branches b where b.tenant_id=v.tenant_id;
  with x as (
    select cs.id,cs.status,coalesce((select sum(s.total) from sales s where s.cash_session_id=cs.id and s.status='completed' and coalesce(s.completed_at,s.created_at)>=v_start and coalesce(s.completed_at,s.created_at)<v_end),0) sales_total
    from cash_sessions cs join pos_registers pr on pr.id=cs.pos_register_id
    where cs.tenant_id=v.tenant_id and (p_branch is null or pr.branch_id=p_branch) and (p_operator is null or cs.staff_user_id=p_operator)
  ) select jsonb_build_object('open_cash',coalesce(count(*) filter(where status='open'),0),'closed_cash',coalesce(count(*) filter(where status='closed'),0),'sales_total',coalesce(sum(sales_total),0),'sessions',count(*)) into v_summary from x;
  return jsonb_build_object('ok',true,'sessions',v_sessions,'operations',v_operations,'operators',v_operators,'branches',v_branches,'summary',v_summary,'start',v_start,'end',v_end);
end $$;

create or replace function public.erp_cash_management_close(p_token text,p_cash_id uuid,p_closing numeric,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_cs cash_sessions%rowtype;v_expected numeric;v_diff numeric;v_email text;v_cash numeric;v_supply numeric;v_withdrawal numeric;v_expense numeric;v_refund numeric;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  if p_closing is null or p_closing<0 then return jsonb_build_object('ok',false,'error','invalid_closing_amount');end if;
  select * into v_cs from cash_sessions where id=p_cash_id and tenant_id=v.tenant_id for update;if v_cs.id is null or v_cs.status<>'open' then return jsonb_build_object('ok',false,'error','cash_not_open');end if;
  select email into v_email from private.temp_users where id=v.user_id;
  select coalesce(sum(p.amount),0) into v_cash from payments p join sales s on s.id=p.sale_id where s.cash_session_id=p_cash_id and s.status='completed' and p.status='paid' and p.method='cash';
  select coalesce(sum(amount) filter(where movement_type='supply'),0),coalesce(sum(amount) filter(where movement_type in ('withdrawal','sangria')),0),coalesce(sum(amount) filter(where movement_type='expense'),0),coalesce(sum(amount) filter(where movement_type='refund'),0) into v_supply,v_withdrawal,v_expense,v_refund from cash_movements where cash_session_id=p_cash_id;
  v_expected:=v_cs.opening_amount+v_cash+v_supply-v_withdrawal-v_expense-v_refund;v_diff:=p_closing-v_expected;
  insert into cash_session_audit(tenant_id,cash_session_id,action,previous_status,new_status,previous_closing_amount,new_closing_amount,previous_closed_at,new_closed_at,expected_cash,reason,actor_user_id,actor_email)
  values(v.tenant_id,p_cash_id,'management_close',v_cs.status,'closed',v_cs.closing_amount,p_closing,v_cs.closed_at,now(),v_expected,p_notes,v.user_id,v_email);
  update cash_sessions set status='closed',closing_amount=p_closing,closed_at=now(),notes=concat_ws(E'\n',notes,p_notes,'Fechado pelo Gestão. Esperado: '||v_expected::text||' Diferença: '||v_diff::text) where id=p_cash_id;
  return jsonb_build_object('ok',true,'expected',v_expected,'closing',p_closing,'difference',v_diff);
end $$;

create or replace function public.erp_cash_management_reopen(p_token text,p_cash_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_cs cash_sessions%rowtype;v_email text;v_expected numeric;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  if length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'error','reopen_reason_required');end if;
  select * into v_cs from cash_sessions where id=p_cash_id and tenant_id=v.tenant_id for update;if v_cs.id is null or v_cs.status<>'closed' then return jsonb_build_object('ok',false,'error','cash_not_closed');end if;
  if exists(select 1 from cash_sessions where pos_register_id=v_cs.pos_register_id and status='open' and id<>p_cash_id) then return jsonb_build_object('ok',false,'error','pos_has_another_open_cash');end if;
  select email into v_email from private.temp_users where id=v.user_id;
  v_expected:=v_cs.opening_amount+coalesce((select sum(p.amount) from payments p join sales s on s.id=p.sale_id where s.cash_session_id=p_cash_id and s.status='completed' and p.status='paid' and p.method='cash'),0)+coalesce((select sum(amount) from cash_movements where cash_session_id=p_cash_id and movement_type='supply'),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=p_cash_id and movement_type in ('withdrawal','sangria')),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=p_cash_id and movement_type='expense'),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=p_cash_id and movement_type='refund'),0);
  insert into cash_session_audit(tenant_id,cash_session_id,action,previous_status,new_status,previous_closing_amount,new_closing_amount,previous_closed_at,new_closed_at,expected_cash,reason,actor_user_id,actor_email)
  values(v.tenant_id,p_cash_id,'management_reopen','closed','open',v_cs.closing_amount,null,v_cs.closed_at,null,v_expected,trim(p_reason),v.user_id,v_email);
  update cash_sessions set status='open',closing_amount=null,closed_at=null,notes=concat_ws(E'\n',notes,'Reaberto pelo Gestão em '||now()::text||'. Motivo: '||trim(p_reason)) where id=p_cash_id;
  return jsonb_build_object('ok',true,'id',p_cash_id,'expected',v_expected);
end $$;

create or replace function public.erp_cash_closure_history(p_token text,p_start timestamptz default null,p_end timestamptz default null,p_operator uuid default null,p_branch uuid default null) returns jsonb
language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_start timestamptz:=coalesce(p_start,date_trunc('day',now()));v_end timestamptz:=coalesce(p_end,date_trunc('day',now())+interval '1 day');v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  with base as (
    select cs.id,cs.status,cs.opening_amount,cs.closing_amount,cs.opened_at,cs.closed_at,cs.staff_user_id,pr.name pos,pr.code pos_code,pr.branch_id,b.name branch,su.name operator,
      cs.opening_amount+coalesce((select sum(p.amount) from payments p join sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status='paid' and p.method='cash'),0)+coalesce((select sum(amount) from cash_movements where cash_session_id=cs.id and movement_type='supply'),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria')),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=cs.id and movement_type='expense'),0)-coalesce((select sum(amount) from cash_movements where cash_session_id=cs.id and movement_type='refund'),0) expected_now,
      coalesce((select sum(s.total) from sales s where s.cash_session_id=cs.id and s.status='completed'),0) sales_total,coalesce((select count(*) from sales s where s.cash_session_id=cs.id and s.status='completed'),0) sales_count
    from cash_sessions cs join pos_registers pr on pr.id=cs.pos_register_id join branches b on b.id=pr.branch_id left join staff_users su on su.id=cs.staff_user_id
    where cs.tenant_id=v.tenant_id and (p_branch is null or pr.branch_id=p_branch) and (p_operator is null or cs.staff_user_id=p_operator)
  ), history as (
    select b.id cash_session_id,b.pos,b.pos_code,b.branch,b.operator,b.staff_user_id operator_id,b.opened_at,b.closed_at,b.opening_amount,b.sales_count,b.sales_total,b.expected_now expected_cash,b.closing_amount,b.closing_amount-b.expected_now difference,null::timestamptz reopened_at,null::text reopen_reason,'current'::text record_state
      from base b where b.status='closed' and b.closed_at>=v_start and b.closed_at<v_end
    union all
    select b.id,b.pos,b.pos_code,b.branch,b.operator,b.staff_user_id,b.opened_at,a.previous_closed_at,b.opening_amount,b.sales_count,b.sales_total,coalesce(a.expected_cash,b.expected_now),a.previous_closing_amount,a.previous_closing_amount-coalesce(a.expected_cash,b.expected_now),a.created_at,a.reason,'reopened'::text
      from cash_session_audit a join base b on b.id=a.cash_session_id where a.action='management_reopen' and a.previous_closed_at>=v_start and a.previous_closed_at<v_end
  ) select coalesce(jsonb_agg(to_jsonb(h) order by h.closed_at desc),'[]'::jsonb) into v_data from history h;
  return jsonb_build_object('ok',true,'data',v_data,'start',v_start,'end',v_end);
end $$;