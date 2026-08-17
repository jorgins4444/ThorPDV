
create table if not exists public.management_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','attention','critical')),
  entity_type text not null,
  entity_id uuid,
  sale_id uuid references public.sales(id),
  operator_user_id uuid references public.staff_users(id),
  supervisor_user_id uuid references public.staff_users(id),
  device_id uuid references public.pdv_devices(id),
  title text not null,
  reason text,
  amount_before numeric,
  amount_after numeric,
  amount_delta numeric,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);

create index if not exists management_audit_events_tenant_time_idx
  on public.management_audit_events(tenant_id, occurred_at desc);
create index if not exists management_audit_events_tenant_type_idx
  on public.management_audit_events(tenant_id, event_type, occurred_at desc);
create index if not exists management_audit_events_branch_idx
  on public.management_audit_events(tenant_id, branch_id, occurred_at desc);
create index if not exists management_audit_events_operator_idx
  on public.management_audit_events(tenant_id, operator_user_id, occurred_at desc);
create index if not exists management_audit_events_sale_idx
  on public.management_audit_events(sale_id) where sale_id is not null;

alter table public.management_audit_events enable row level security;
revoke all on table public.management_audit_events from public, anon, authenticated;
grant select, insert, update, delete on table public.management_audit_events to service_role;

create or replace function private.block_management_audit_mutation()
returns trigger
language plpgsql
set search_path = public, private, extensions
as $$
begin
  if current_user in ('postgres','service_role') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'management_audit_is_immutable' using errcode='42501';
end
$$;

drop trigger if exists trg_management_audit_immutable on public.management_audit_events;
create trigger trg_management_audit_immutable
before update or delete on public.management_audit_events
for each row execute function private.block_management_audit_mutation();

create or replace function private.capture_management_audit()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_sale public.sales%rowtype;
  v_branch uuid;
  v_reason text;
begin
  if tg_table_name='sales' then
    if tg_op='INSERT' then
      if coalesce(new.discount,0)>0 then
        insert into public.management_audit_events(
          tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
          operator_user_id,supervisor_user_id,device_id,title,amount_before,amount_after,amount_delta,after_data,occurred_at
        ) values (
          new.tenant_id,new.branch_id,'discount_applied',
          case when new.subtotal>0 and new.discount/new.subtotal>=0.10 then 'critical' else 'attention' end,
          'sale',new.id,new.id,new.staff_user_id,new.supervisor_user_id,new.pdv_device_id,
          'Desconto aplicado na venda',new.subtotal,new.total,-new.discount,
          jsonb_build_object('sale_number',new.number,'subtotal',new.subtotal,'discount',new.discount,'total',new.total),
          coalesce(new.completed_at,new.created_at,now())
        );
      end if;
      return new;
    end if;
    if coalesce(old.discount,0) is distinct from coalesce(new.discount,0) then
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
        operator_user_id,supervisor_user_id,device_id,title,amount_before,amount_after,amount_delta,before_data,after_data,occurred_at
      ) values (
        new.tenant_id,new.branch_id,'discount_changed','attention','sale',new.id,new.id,
        new.staff_user_id,new.supervisor_user_id,new.pdv_device_id,'Desconto da venda alterado',
        old.discount,new.discount,new.discount-old.discount,
        jsonb_build_object('discount',old.discount,'total',old.total),
        jsonb_build_object('sale_number',new.number,'discount',new.discount,'total',new.total),now()
      );
    end if;
    if old.status is distinct from new.status and new.status='cancelled' then
      v_reason=nullif(trim(split_part(coalesce(new.notes,''),'Cancelada pelo Gestão:',2)),'');
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
        operator_user_id,supervisor_user_id,device_id,title,reason,amount_before,amount_after,amount_delta,before_data,after_data,occurred_at
      ) values (
        new.tenant_id,new.branch_id,'sale_cancelled','critical','sale',new.id,new.id,
        new.staff_user_id,new.supervisor_user_id,new.pdv_device_id,'Venda cancelada',v_reason,
        old.total,0,-old.total,jsonb_build_object('status',old.status,'total',old.total),
        jsonb_build_object('sale_number',new.number,'status',new.status,'total',new.total),coalesce(new.cancelled_at,now())
      );
    end if;
    return new;
  elsif tg_table_name='sale_returns' then
    select * into v_sale from public.sales where id=new.sale_id;
    if tg_op='INSERT' then
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
        operator_user_id,supervisor_user_id,device_id,title,reason,amount_before,amount_after,amount_delta,after_data,occurred_at
      ) values (
        new.tenant_id,v_sale.branch_id,'sale_return','attention','sale_return',new.id,new.sale_id,
        new.operator_user_id,new.supervisor_user_id,new.pdv_device_id,'Devolução de venda registrada',new.reason,
        0,new.total,new.total,
        jsonb_build_object('refund_method',new.refund_method,'status',new.status,'customer_id',new.customer_id),
        coalesce(new.created_at,now())
      );
    elsif old.status is distinct from new.status and new.status='cancelled' then
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
        operator_user_id,supervisor_user_id,device_id,title,reason,amount_before,amount_after,amount_delta,before_data,after_data,occurred_at
      ) values (
        new.tenant_id,v_sale.branch_id,'return_cancelled','critical','sale_return',new.id,new.sale_id,
        new.operator_user_id,new.supervisor_user_id,new.pdv_device_id,'Devolução cancelada',new.reason,
        old.total,0,-old.total,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),now()
      );
    end if;
    return new;
  elsif tg_table_name='receivable_receipts' then
    if tg_op='INSERT' then
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,
        operator_user_id,device_id,title,reason,amount_before,amount_after,amount_delta,after_data,occurred_at
      ) values (
        new.tenant_id,new.branch_id,'receivable_received','info','receivable_receipt',new.id,
        new.operator_user_id,new.device_id,'Recebimento de crediário',new.notes,
        0,new.total_amount,new.total_amount,
        jsonb_build_object('customer_id',new.customer_id,'payment_method',new.payment_method,'status',new.status,'pending_total_after',new.pending_total_after),
        coalesce(new.created_at,now())
      );
    elsif old.status is distinct from new.status and new.status='reversed' then
      insert into public.management_audit_events(
        tenant_id,branch_id,event_type,severity,entity_type,entity_id,
        operator_user_id,device_id,title,reason,amount_before,amount_after,amount_delta,before_data,after_data,occurred_at
      ) values (
        new.tenant_id,new.branch_id,'receivable_reversed','critical','receivable_receipt',new.id,
        new.operator_user_id,new.device_id,'Recebimento de crediário estornado',new.notes,
        old.total_amount,0,-old.total_amount,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),now()
      );
    end if;
    return new;
  elsif tg_table_name='supervisor_authorizations' then
    insert into public.management_audit_events(
      tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
      operator_user_id,supervisor_user_id,device_id,title,reason,amount_after,amount_delta,after_data,occurred_at
    ) values (
      new.tenant_id,new.branch_id,'manager_authorization','attention','supervisor_authorization',new.id,new.sale_id,
      new.operator_user_id,new.supervisor_user_id,new.pdv_device_id,'Autorização gerencial: '||new.action,new.reason,
      new.requested_value,new.requested_value,
      jsonb_build_object('action',new.action,'requested_value',new.requested_value,'operator_limit',new.operator_limit,'metadata',new.metadata),
      coalesce(new.created_at,now())
    );
    return new;
  elsif tg_table_name='cash_session_audit' then
    insert into public.management_audit_events(
      tenant_id,event_type,severity,entity_type,entity_id,title,reason,
      amount_before,amount_after,amount_delta,before_data,after_data,metadata,occurred_at
    ) values (
      new.tenant_id,'cash_'||new.action,
      case when new.action='management_reopen' then 'critical' else 'attention' end,
      'cash_session',new.cash_session_id,
      case new.action when 'management_reopen' then 'Caixa reaberto' when 'management_correct' then 'Fechamento de caixa corrigido' else 'Caixa fechado pela gestão' end,
      new.reason,new.previous_closing_amount,new.new_closing_amount,
      coalesce(new.new_closing_amount,0)-coalesce(new.previous_closing_amount,0),
      jsonb_build_object('status',new.previous_status,'closed_at',new.previous_closed_at),
      jsonb_build_object('status',new.new_status,'closed_at',new.new_closed_at,'expected_cash',new.expected_cash),
      jsonb_build_object('actor_user_id',new.actor_user_id,'actor_email',new.actor_email,'source',new.source),
      coalesce(new.created_at,now())
    );
    return new;
  elsif tg_table_name='product_history' then
    if lower(coalesce(new.event_type,'')) like '%preço%' or coalesce(new.source_type,'') in ('product_price','price_table_item') then
      insert into public.management_audit_events(
        tenant_id,event_type,severity,entity_type,entity_id,title,reason,
        before_data,after_data,metadata,occurred_at
      ) values (
        new.tenant_id,'price_changed','attention','product',new.product_id,
        'Preço de produto alterado',new.description,
        coalesce(new.before_data,'{}'::jsonb),coalesce(new.after_data,'{}'::jsonb),
        coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('actor_type',new.actor_type,'actor_id',new.actor_id,'actor_name',new.actor_name,'source_type',new.source_type,'source_id',new.source_id),
        coalesce(new.created_at,now())
      );
    end if;
    return new;
  end if;
  return coalesce(new,old);
end
$$;

drop trigger if exists trg_management_audit_sales on public.sales;
create trigger trg_management_audit_sales after insert or update on public.sales
for each row execute function private.capture_management_audit();

drop trigger if exists trg_management_audit_returns on public.sale_returns;
create trigger trg_management_audit_returns after insert or update on public.sale_returns
for each row execute function private.capture_management_audit();

drop trigger if exists trg_management_audit_receipts on public.receivable_receipts;
create trigger trg_management_audit_receipts after insert or update on public.receivable_receipts
for each row execute function private.capture_management_audit();

drop trigger if exists trg_management_audit_authorizations on public.supervisor_authorizations;
create trigger trg_management_audit_authorizations after insert on public.supervisor_authorizations
for each row execute function private.capture_management_audit();

drop trigger if exists trg_management_audit_cash on public.cash_session_audit;
create trigger trg_management_audit_cash after insert on public.cash_session_audit
for each row execute function private.capture_management_audit();

drop trigger if exists trg_management_audit_prices on public.product_history;
create trigger trg_management_audit_prices after insert on public.product_history
for each row execute function private.capture_management_audit();

create or replace function public.erp_management_audit_list(
  p_token text,
  p_start date default null,
  p_end date default null,
  p_branch uuid default null,
  p_operator uuid default null,
  p_event_type text default null,
  p_search text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v record;
  v_data jsonb;
  v_summary jsonb;
  v_branches jsonb;
  v_operators jsonb;
  v_start timestamptz:=coalesce(p_start,current_date-30)::timestamptz;
  v_end timestamptz:=(coalesce(p_end,current_date)+1)::timestamptz;
  v_query text:='%'||coalesce(trim(p_search),'')||'%';
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_end-v_start>interval '370 days' then return jsonb_build_object('ok',false,'error','audit_period_too_large'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) into v_data
  from (
    select e.id,e.event_type,e.severity,e.entity_type,e.entity_id,e.sale_id,e.title,e.reason,
      e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,e.metadata,e.occurred_at,
      e.branch_id,b.name branch_name,e.operator_user_id,o.name operator_name,
      e.supervisor_user_id,su.name supervisor_name,e.device_id,d.name device_name,
      sa.number sale_number
    from public.management_audit_events e
    left join public.branches b on b.id=e.branch_id
    left join public.staff_users o on o.id=e.operator_user_id
    left join public.staff_users su on su.id=e.supervisor_user_id
    left join public.pdv_devices d on d.id=e.device_id
    left join public.sales sa on sa.id=e.sale_id
    where e.tenant_id=v.tenant_id
      and e.occurred_at>=v_start and e.occurred_at<v_end
      and (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.operator_user_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(o.name,'') ilike v_query or coalesce(su.name,'') ilike v_query
        or coalesce(sa.number::text,'') ilike v_query)
    order by e.occurred_at desc limit 500
  ) x;

  select jsonb_build_object(
    'total_events',count(*),
    'critical_events',count(*) filter(where severity='critical'),
    'authorizations',count(*) filter(where event_type='manager_authorization'),
    'financial_impact',coalesce(sum(abs(amount_delta)) filter(where event_type not in ('receivable_received')),0)
  ) into v_summary
  from public.management_audit_events e
  where e.tenant_id=v.tenant_id and e.occurred_at>=v_start and e.occurred_at<v_end
    and (p_branch is null or e.branch_id=p_branch)
    and (p_operator is null or e.operator_user_id=p_operator)
    and (p_event_type is null or e.event_type=p_event_type);

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_branches
  from public.branches where tenant_id=v.tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_operators
  from public.staff_users where tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'data',v_data,'summary',v_summary,'branches',v_branches,'operators',v_operators);
end
$$;

revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) to anon, authenticated, service_role;
