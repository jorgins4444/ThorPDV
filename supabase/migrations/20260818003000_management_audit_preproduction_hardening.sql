-- Auditoria gerencial: correlação, risco, permissões e paginação por cursor.

alter table public.management_audit_events
  add column if not exists correlation_id uuid;

create index if not exists management_audit_events_tenant_cursor_idx
  on public.management_audit_events (tenant_id, occurred_at desc, id desc);

create index if not exists management_audit_events_tenant_correlation_idx
  on public.management_audit_events (tenant_id, correlation_id, occurred_at desc)
  where correlation_id is not null;

create or replace function private.audit_risk_level(p_event_type text, p_entity_type text, p_operation text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
select case
  when p_event_type in ('sale_cancelled','return_cancelled','receivable_reversed','cash_management_reopen','record_deleted')
    or p_operation='delete' then 'critical'
  when p_event_type in ('sale_return','discount_applied','discount_changed','price_changed','cash_management_correct')
    or p_entity_type in ('financial_entries','financial_settlements','payments','payment_transactions','products','price_tables','price_adjustments')
    then 'attention'
  else 'info'
end
$function$;

create or replace function private.prepare_management_audit_event()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  v_correlation text;
begin
  v_correlation:=nullif(current_setting('app.audit_correlation_id',true),'');
  if new.correlation_id is null and v_correlation is not null then
    begin new.correlation_id:=v_correlation::uuid; exception when others then new.correlation_id:=null; end;
  end if;
  if new.correlation_id is null then new.correlation_id:=new.id; end if;
  new.severity:=private.audit_risk_level(new.event_type,new.entity_type,coalesce(new.metadata->>'operation',''));
  new.metadata:=jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{correlation_id}',to_jsonb(new.correlation_id::text),true);
  return new;
end
$function$;

drop trigger if exists trg_prepare_management_audit_event on public.management_audit_events;
create trigger trg_prepare_management_audit_event
before insert on public.management_audit_events
for each row execute function private.prepare_management_audit_event();

update public.management_audit_events
set correlation_id=id,
    severity=private.audit_risk_level(event_type,entity_type,coalesce(metadata->>'operation','')),
    metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{correlation_id}',to_jsonb(id::text),true)
where correlation_id is null;

create or replace function private.resolve_temp_context(p_token text)
returns table(user_id uuid, tenant_id uuid, company_id uuid, branch_id uuid)
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_company_id uuid;
  v_branch_id uuid;
begin
  select s.user_id,c.tenant_id,c.company_id,c.branch_id
    into v_user_id,v_tenant_id,v_company_id,v_branch_id
  from private.temp_sessions s
  join private.temp_users u on u.id=s.user_id
  join private.temp_user_context c on c.user_id=s.user_id
  join public.tenant_licenses l on l.tenant_id=c.tenant_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.expires_at>now() and u.active=true
    and l.status in ('trial','active')
    and (l.expires_at is null or l.expires_at>now())
  limit 1;

  if v_user_id is null then return; end if;
  perform set_config('app.audit_actor_id',v_user_id::text,true);
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_name',private.audit_actor_display_name('temp_user',v_user_id),true);
  perform set_config('app.audit_tenant_id',v_tenant_id::text,true);
  perform set_config('app.audit_branch_id',coalesce(v_branch_id::text,''),true);
  if nullif(current_setting('app.audit_correlation_id',true),'') is null then
    perform set_config('app.audit_correlation_id',gen_random_uuid()::text,true);
  end if;

  user_id:=v_user_id; tenant_id:=v_tenant_id; company_id:=v_company_id; branch_id:=v_branch_id;
  return next;
end
$function$;

drop function if exists public.erp_management_audit_list(text,date,date,uuid,uuid,text,text);
create function public.erp_management_audit_list(
  p_token text,
  p_start date default null,
  p_end date default null,
  p_branch uuid default null,
  p_operator uuid default null,
  p_event_type text default null,
  p_search text default null,
  p_risk text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_data jsonb;
  v_summary jsonb;
  v_branches jsonb;
  v_operators jsonb;
  v_permissions jsonb:='{}'::jsonb;
  v_can_view boolean:=false;
  v_start timestamptz:=coalesce(p_start,current_date-30)::timestamptz;
  v_end timestamptz:=(coalesce(p_end,current_date)+1)::timestamptz;
  v_query text:='%'||coalesce(trim(p_search),'')||'%';
  v_page_size integer:=least(greatest(coalesce(p_page_size,10),1),50);
  v_has_more boolean:=false;
  v_next_at timestamptz;
  v_next_id uuid;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_end-v_start>interval '370 days' then return jsonb_build_object('ok',false,'error','audit_period_too_large'); end if;

  select coalesce(ap.permissions,'{}'::jsonb) into v_permissions
  from private.temp_users tu
  join public.staff_users su on su.tenant_id=v.tenant_id
    and encode(extensions.digest(lower(trim(su.email)),'sha256'),'hex')=tu.email_hash
  left join public.access_profiles ap on ap.id=su.profile_id and ap.tenant_id=v.tenant_id and ap.active=true
  where tu.id=v.user_id and su.active=true
  order by su.updated_at desc limit 1;
  v_permissions:=coalesce(v_permissions,'{}'::jsonb);
  v_can_view:=coalesce((v_permissions->>'all')::boolean,false)
    or coalesce((v_permissions#>>'{audit,view}')::boolean,false);
  if not v_can_view then return jsonb_build_object('ok',false,'error','audit_forbidden'); end if;

  with enriched as (
    select e.*,
      coalesce(e.correlation_id,e.id) operation_id,
      private.audit_risk_level(e.event_type,e.entity_type,coalesce(e.metadata->>'operation','')) risk_level,
      coalesce(e.operator_user_id,eus.id) effective_operator_id,
      coalesce(nullif(o.name,''),nullif(o.email,''),nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''),nullif(e.metadata->>'actor_name',''),'Sistema') responsible_name,
      coalesce(nullif(o.email,''),nullif(eus.email,''),nullif(eu.email,'')) responsible_email,
      b.name branch_name,su.name supervisor_name,d.name device_name,sa.number sale_number,
      coalesce(nullif(ec.name,''),private.audit_entity_display_name(e.before_data,e.after_data,e.metadata)) entity_name
    from public.management_audit_events e
    left join public.branches b on b.id=e.branch_id
    left join public.customers ec on ec.tenant_id=e.tenant_id and ec.id=case
      when e.entity_type='customer_store_credit_ledger'
       and coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id')::uuid else null end
    left join public.staff_users o on o.id=e.operator_user_id
    left join private.temp_users eu on eu.id=case
      when coalesce(e.metadata->>'actor_type','')='temp_user'
       and coalesce(e.metadata->>'actor_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (e.metadata->>'actor_id')::uuid else null end
    left join public.staff_users eus on eus.tenant_id=e.tenant_id
      and encode(extensions.digest(lower(trim(eus.email)),'sha256'),'hex')=eu.email_hash
    left join public.staff_users su on su.id=e.supervisor_user_id
    left join public.pdv_devices d on d.id=e.device_id
    left join public.sales sa on sa.id=e.sale_id
    where e.tenant_id=v.tenant_id and e.occurred_at>=v_start and e.occurred_at<v_end
  ), filtered as (
    select * from enriched e
    where (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.effective_operator_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_risk is null or e.risk_level=p_risk)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(e.responsible_name,'') ilike v_query or coalesce(e.responsible_email,'') ilike v_query
        or coalesce(e.supervisor_name,'') ilike v_query or coalesce(e.sale_number::text,'') ilike v_query
        or coalesce(e.entity_name,'') ilike v_query)
  ), grouped as (
    select operation_id,max(occurred_at) occurred_at,
      (array_agg(id order by occurred_at desc,id desc))[1] representative_id,
      case when bool_or(risk_level='critical') then 'critical' when bool_or(risk_level='attention') then 'attention' else 'info' end group_risk,
      count(*) event_count,
      jsonb_agg(jsonb_build_object(
        'id',id,'event_type',event_type,'title',title,'entity_type',entity_type,
        'entity_label',private.audit_entity_label(entity_type),'entity_name',entity_name,
        'reason',reason,'before_data',before_data,'after_data',after_data,'metadata',metadata,
        'occurred_at',occurred_at,'risk_level',risk_level
      ) order by occurred_at asc,id asc) related_events
    from filtered group by operation_id
  ), page as (
    select * from grouped
    where p_cursor_at is null or (occurred_at,representative_id)<(p_cursor_at,p_cursor_id)
    order by occurred_at desc,representative_id desc limit v_page_size+1
  ), selected as (
    select * from page order by occurred_at desc,representative_id desc limit v_page_size
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb),
    coalesce((select count(*)>v_page_size from page),false),
    (array_agg(x.occurred_at order by x.occurred_at desc,x.id desc))[v_page_size],
    (array_agg(x.id order by x.occurred_at desc,x.id desc))[v_page_size]
  into v_data,v_has_more,v_next_at,v_next_id
  from (
    select e.id,e.event_type,g.group_risk severity,g.group_risk risk_level,e.entity_type source_entity_type,
      private.audit_entity_label(e.entity_type) entity_type,e.entity_id,e.sale_id,private.audit_entity_label(e.entity_type) entity_label,
      e.entity_name,case when e.entity_type='customer_store_credit_ledger' then 'Saldo de crediário registrado' else e.title end title,
      e.reason,e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,e.metadata,g.occurred_at,
      e.branch_id,e.branch_name,e.operator_user_id,e.responsible_name operator_name,e.responsible_name,e.responsible_email,
      e.supervisor_user_id,e.supervisor_name,e.device_id,e.device_name,e.sale_number,
      g.operation_id correlation_id,g.event_count,g.related_events
    from selected g join enriched e on e.id=g.representative_id
  ) x;

  with enriched as (
    select e.*,
      private.audit_risk_level(e.event_type,e.entity_type,coalesce(e.metadata->>'operation','')) risk_level,
      coalesce(e.operator_user_id,eus.id) effective_operator_id,
      coalesce(nullif(o.name,''),nullif(o.email,''),nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''),nullif(e.metadata->>'actor_name',''),'Sistema') responsible_name,
      coalesce(nullif(ec.name,''),private.audit_entity_display_name(e.before_data,e.after_data,e.metadata)) entity_name
    from public.management_audit_events e
    left join public.customers ec on ec.tenant_id=e.tenant_id and ec.id=case when e.entity_type='customer_store_credit_ledger' and coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id')::uuid else null end
    left join public.staff_users o on o.id=e.operator_user_id
    left join private.temp_users eu on eu.id=case when coalesce(e.metadata->>'actor_type','')='temp_user' and coalesce(e.metadata->>'actor_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (e.metadata->>'actor_id')::uuid else null end
    left join public.staff_users eus on eus.tenant_id=e.tenant_id and encode(extensions.digest(lower(trim(eus.email)),'sha256'),'hex')=eu.email_hash
    where e.tenant_id=v.tenant_id and e.occurred_at>=v_start and e.occurred_at<v_end
  ), filtered as (
    select * from enriched e where (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.effective_operator_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_risk is null or e.risk_level=p_risk)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(e.responsible_name,'') ilike v_query or coalesce(e.entity_name,'') ilike v_query)
  )
  select jsonb_build_object(
    'total_events',count(*),'total_operations',count(distinct coalesce(correlation_id,id)),
    'critical_events',count(*) filter(where risk_level='critical'),
    'authorizations',count(*) filter(where event_type='manager_authorization'),
    'financial_impact',coalesce(sum(abs(amount_delta)) filter(where event_type<>'receivable_received'),0)
  ) into v_summary from filtered;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_branches
  from public.branches where tenant_id=v.tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_operators
  from public.staff_users where tenant_id=v.tenant_id and active=true;

  return jsonb_build_object(
    'ok',true,'data',v_data,'summary',v_summary,'branches',v_branches,'operators',v_operators,
    'pagination',jsonb_build_object('page_size',v_page_size,'has_more',v_has_more,'next_cursor_at',case when v_has_more then v_next_at end,'next_cursor_id',case when v_has_more then v_next_id end),
    'permissions',jsonb_build_object(
      'view',true,
      'details',coalesce((v_permissions->>'all')::boolean,false) or coalesce((v_permissions#>>'{audit,details}')::boolean,false),
      'technical',coalesce((v_permissions->>'all')::boolean,false) or coalesce((v_permissions#>>'{audit,technical}')::boolean,false),
      'export',coalesce((v_permissions->>'all')::boolean,false) or coalesce((v_permissions#>>'{audit,export}')::boolean,false)
    )
  );
end
$function$;

revoke all on function private.audit_risk_level(text,text,text) from public;
revoke all on function private.prepare_management_audit_event() from public;
revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text,text,timestamptz,uuid,integer) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text,text,timestamptz,uuid,integer) to anon,authenticated,service_role;

