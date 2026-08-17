CREATE OR REPLACE FUNCTION private.audit_entity_display_name(p_before jsonb, p_after jsonb, p_metadata jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
select coalesce(
  nullif(p_metadata->>'entity_name',''),
  nullif(p_after->>'name',''),
  nullif(p_after->>'trade_name',''),
  nullif(p_after->>'full_name',''),
  nullif(p_after->>'title',''),
  nullif(p_after->>'description',''),
  nullif(p_after->>'code',''),
  nullif(p_after->>'number',''),
  nullif(p_before->>'name',''),
  nullif(p_before->>'trade_name',''),
  nullif(p_before->>'full_name',''),
  nullif(p_before->>'title',''),
  nullif(p_before->>'description',''),
  nullif(p_before->>'code',''),
  nullif(p_before->>'number','')
)
$function$
;

CREATE OR REPLACE FUNCTION public.erp_management_audit_list(p_token text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_branch uuid DEFAULT NULL::uuid, p_operator uuid DEFAULT NULL::uuid, p_event_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
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
    select e.id,e.event_type,e.severity,e.entity_type,e.entity_id,e.sale_id,private.audit_entity_label(e.entity_type) entity_label,private.audit_entity_display_name(e.before_data,e.after_data,e.metadata) entity_name,e.title,
      case
        when coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,'')) is not null
          then replace(
            e.reason,
            'Responsável: Usuário ERP',
            'Responsável: '||coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''))
          )
        else e.reason
      end reason,
      e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,
      case
        when coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,'')) is not null
          then jsonb_set(
            coalesce(e.metadata,'{}'::jsonb),
            '{actor_name}',
            to_jsonb(coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''))),
            true
          )
        else e.metadata
      end metadata,
      e.occurred_at,
      e.branch_id,b.name branch_name,e.operator_user_id,o.name operator_name,
      coalesce(nullif(o.name,''),nullif(o.email,''),nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''),nullif(e.metadata->>'actor_name',''),'Sistema') responsible_name,
      coalesce(nullif(o.email,''),nullif(eus.email,''),nullif(eu.email,'')) responsible_email,
      e.supervisor_user_id,su.name supervisor_name,e.device_id,d.name device_name,
      sa.number sale_number
    from public.management_audit_events e
    left join public.branches b on b.id=e.branch_id
    left join public.staff_users o on o.id=e.operator_user_id
    left join private.temp_users eu on eu.id=case
      when coalesce(e.metadata->>'actor_type','')='temp_user'
       and coalesce(e.metadata->>'actor_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (e.metadata->>'actor_id')::uuid else null end
    left join private.temp_user_context euc
      on euc.user_id=eu.id and euc.tenant_id=e.tenant_id
    left join public.staff_users eus
      on eus.tenant_id=e.tenant_id
     and encode(extensions.digest(lower(trim(eus.email)),'sha256'),'hex')=eu.email_hash
    left join public.staff_users su on su.id=e.supervisor_user_id
    left join public.pdv_devices d on d.id=e.device_id
    left join public.sales sa on sa.id=e.sale_id
    where e.tenant_id=v.tenant_id
      and e.occurred_at>=v_start and e.occurred_at<v_end
      and (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.operator_user_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(o.name,'') ilike v_query or coalesce(o.email,'') ilike v_query
        or coalesce(eus.name,'') ilike v_query or coalesce(eus.email,'') ilike v_query
        or coalesce(eu.email,'') ilike v_query or coalesce(su.name,'') ilike v_query
        or coalesce(sa.number::text,'') ilike v_query or coalesce(private.audit_entity_display_name(e.before_data,e.after_data,e.metadata),'') ilike v_query)
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
$function$
;

revoke all on function private.audit_entity_display_name(jsonb,jsonb,jsonb) from public;
revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) to anon,authenticated,service_role;
