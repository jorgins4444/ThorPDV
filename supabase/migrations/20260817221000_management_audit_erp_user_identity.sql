CREATE OR REPLACE FUNCTION public.temp_login(p_email text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v_user private.temp_users%rowtype;
  v_token text;
  v_token_hash text;
  v_email_hash text;
  v_password_sha text;
  v_failures integer;
  v_bootstrap_ok boolean:=false;
  v_license_status text;
  v_license_expires timestamptz;
begin
  v_email_hash:=encode(extensions.digest(lower(trim(coalesce(p_email,''))),'sha256'),'hex');
  v_password_sha:=encode(extensions.digest(coalesce(p_password,''),'sha256'),'hex');
  select * into v_user from private.temp_users where email_hash=v_email_hash and active=true limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_credentials'); end if;
  v_bootstrap_ok:=v_user.must_change_password and v_email_hash='84d25252d8517cb6a2fe270ee5d38f7dff716206682c0e3f504d33cb2a41db96' and v_password_sha='b7d31e3c89c43b596b50289aa812a7733fda7b98edabd4e5467c7e38bb129fca';
  if not v_bootstrap_ok and v_user.locked_until is not null and v_user.locked_until>now() then return jsonb_build_object('ok',false,'error','temporarily_locked'); end if;
  if not v_bootstrap_ok and extensions.crypt(coalesce(p_password,''),v_user.password_hash)<>v_user.password_hash then
    v_failures:=v_user.failed_attempts+1;
    update private.temp_users set failed_attempts=v_failures,locked_until=case when v_failures>=5 then now()+interval '10 minutes' else null end,updated_at=now() where id=v_user.id;
    return jsonb_build_object('ok',false,'error','invalid_credentials');
  end if;
  select l.status,l.expires_at into v_license_status,v_license_expires from private.temp_user_context c join public.tenant_licenses l on l.tenant_id=c.tenant_id where c.user_id=v_user.id limit 1;
  if not found then return jsonb_build_object('ok',false,'error','license_not_found'); end if;
  if v_license_status='suspended' then return jsonb_build_object('ok',false,'error','license_suspended'); end if;
  if v_license_status='cancelled' then return jsonb_build_object('ok',false,'error','license_cancelled'); end if;
  if v_license_status not in ('trial','active') then return jsonb_build_object('ok',false,'error','license_inactive'); end if;
  if v_license_expires is not null and v_license_expires<=now() then return jsonb_build_object('ok',false,'error','license_expired'); end if;
  update private.temp_users set email=lower(trim(p_email)),failed_attempts=0,locked_until=null,updated_at=now() where id=v_user.id;
  delete from private.temp_sessions where expires_at<=now();
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_token_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  insert into private.temp_sessions(token_hash,user_id,expires_at) values(v_token_hash,v_user.id,now()+interval '8 hours');
  return jsonb_build_object('ok',true,'session_token',v_token,'must_change_password',v_user.must_change_password);
end $function$;

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
    select e.id,e.event_type,e.severity,e.entity_type,e.entity_id,e.sale_id,e.title,e.reason,
      e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,e.metadata,e.occurred_at,
      e.branch_id,b.name branch_name,e.operator_user_id,o.name operator_name,
      coalesce(nullif(o.name,''),nullif(o.email,''),nullif(eu.email,''),nullif(e.metadata->>'actor_name',''),'Sistema') responsible_name,
      coalesce(nullif(o.email,''),nullif(eu.email,'')) responsible_email,
      e.supervisor_user_id,su.name supervisor_name,e.device_id,d.name device_name,
      sa.number sale_number
    from public.management_audit_events e
    left join public.branches b on b.id=e.branch_id
    left join public.staff_users o on o.id=e.operator_user_id
    left join private.temp_users eu on eu.id=case
      when coalesce(e.metadata->>'actor_type','')='temp_user'
       and coalesce(e.metadata->>'actor_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (e.metadata->>'actor_id')::uuid else null end
    left join public.staff_users su on su.id=e.supervisor_user_id
    left join public.pdv_devices d on d.id=e.device_id
    left join public.sales sa on sa.id=e.sale_id
    where e.tenant_id=v.tenant_id
      and e.occurred_at>=v_start and e.occurred_at<v_end
      and (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.operator_user_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(o.name,'') ilike v_query or coalesce(o.email,'') ilike v_query or coalesce(eu.email,'') ilike v_query or coalesce(su.name,'') ilike v_query
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
$function$;

revoke all on function public.temp_login(text,text) from public;
grant execute on function public.temp_login(text,text) to anon, authenticated, service_role;
revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) to anon, authenticated, service_role;
