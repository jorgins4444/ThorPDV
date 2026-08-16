alter table public.pdv_devices drop constraint if exists pdv_devices_status_check;
alter table public.pdv_devices add constraint pdv_devices_status_check check (status = any (array['online'::text,'offline'::text,'blocked'::text,'reconnect_required'::text]));

create or replace function public.erp_pdv_device_reconnect(p_token text, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  d public.pdv_devices%rowtype;
  r jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into d from public.pdv_devices where id=p_device_id and tenant_id=v.tenant_id;
  if d.id is null then return jsonb_build_object('ok',false,'error','device_not_found'); end if;

  delete from public.pdv_sync_events where device_id=d.id and status='rejected';
  update public.pdv_devices set status='reconnect_required',updated_at=now() where id=d.id;

  select public.erp_pdv_generate_enrollment(p_token,d.pos_register_id,'Reconexão - '||coalesce(d.name,'ThorPDV Desktop')) into r;
  return coalesce(r,'{}'::jsonb)||jsonb_build_object('reconnect',true,'device_id',d.id,'machine_id',d.machine_id,'status','reconnect_required');
end
$function$;

create or replace function private.resolve_pdv_device(p_token text)
returns table(device_id uuid, tenant_id uuid, company_id uuid, branch_id uuid, pos_register_id uuid)
language sql
security definer
set search_path to 'public','private','extensions'
as $function$
  select d.id,d.tenant_id,d.company_id,d.branch_id,d.pos_register_id
  from private.pdv_device_credentials c
  join public.pdv_devices d on d.id=c.device_id
  where c.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and d.status in ('online','offline')
    and private.license_module_enabled(d.tenant_id,'pdv')
  limit 1
$function$;

create or replace function public.pdv_license_status(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  d record;
  l public.tenant_licenses%rowtype;
  v_error text;
begin
  select dev.id,dev.tenant_id,dev.status into d
  from private.pdv_device_credentials c
  join public.pdv_devices dev on dev.id=c.device_id
  where c.token_hash=encode(extensions.digest(p_device_token,'sha256'),'hex')
  limit 1;

  if d.id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if d.status='reconnect_required' then return jsonb_build_object('ok',false,'error','device_reconnect_required','device_id',d.id); end if;
  if d.status='blocked' then return jsonb_build_object('ok',false,'error','device_blocked','device_id',d.id); end if;

  select * into l from public.tenant_licenses where tenant_id=d.tenant_id;
  if not found then return jsonb_build_object('ok',false,'error','license_not_found','device_id',d.id); end if;
  if l.status not in ('trial','active') then
    v_error:=case when l.status='suspended' then 'license_blocked' else 'license_inactive' end;
    return jsonb_build_object('ok',false,'error',v_error,'status',l.status,'blocked_at',l.blocked_at,'blocked_reason',l.blocked_reason,'device_id',d.id);
  end if;
  if l.expires_at is not null and l.expires_at<=now() then return jsonb_build_object('ok',false,'error','license_expired','status',l.status,'expires_at',l.expires_at,'device_id',d.id); end if;
  if not coalesce((l.modules->>'pdv')::boolean,false) then return jsonb_build_object('ok',false,'error','pdv_module_disabled','status',l.status,'device_id',d.id); end if;
  return jsonb_build_object('ok',true,'status',l.status,'expires_at',l.expires_at,'device_id',d.id,'tenant_id',d.tenant_id);
end
$function$;

create or replace function public.pdv_update_check(p_device_token text, p_current_version text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; t record; cmp integer; v_current text;
begin
  select d.id as device_id,d.tenant_id,d.company_id,d.branch_id,d.pos_register_id,d.status into v
  from private.pdv_device_credentials c join public.pdv_devices d on d.id=c.device_id
  where c.token_hash=encode(extensions.digest(p_device_token,'sha256'),'hex')
    and d.status in ('online','offline','reconnect_required')
    and private.license_module_enabled(d.tenant_id,'pdv')
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  v_current:=trim(coalesce(p_current_version,''));
  if v_current ~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    update public.pdv_devices set app_version=v_current,last_seen_at=now(),updated_at=now() where id=v.device_id;
  end if;
  select * into t from private.pdv_target_for_device(v.device_id);
  if not found then return jsonb_build_object('ok',true,'update_available',false,'current_version',v_current,'target_version',null,'direction','none','reconnect_required',v.status='reconnect_required'); end if;
  cmp:=private.pdv_semver_compare(t.version,v_current);
  insert into private.pdv_update_events(tenant_id,device_id,release_id,from_version,to_version,event_type,details)
  values(v.tenant_id,v.device_id,t.release_id,nullif(v_current,''),t.version,'check',jsonb_build_object('scope',t.policy_scope,'available',t.version<>v_current,'reconnect_required',v.status='reconnect_required'));
  return jsonb_build_object('ok',true,'update_available',t.version<>v_current,'current_version',v_current,'target_version',t.version,
    'direction',case when t.version=v_current then 'same' when cmp<0 then 'rollback' else 'upgrade' end,
    'mode',t.policy_mode,'scope',t.policy_scope,'reason',t.policy_reason,'reconnect_required',v.status='reconnect_required',
    'release',jsonb_build_object('id',t.release_id,'version',t.version,'channel',t.channel,'download_url',t.download_url,'sha256',t.sha256,'release_notes',t.release_notes,'package_size',t.package_size));
end
$function$;
