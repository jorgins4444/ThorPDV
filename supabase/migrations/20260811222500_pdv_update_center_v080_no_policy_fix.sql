-- A terminal with no effective update policy must return a clean no-update response.
create or replace function public.pdv_update_check(p_device_token text,p_current_version text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; t record; cmp integer; v_current text;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if not found then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  v_current:=trim(coalesce(p_current_version,''));
  if v_current ~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    update public.pdv_devices set app_version=v_current,last_seen_at=now(),updated_at=now() where id=v.device_id;
  end if;
  select * into t from private.pdv_target_for_device(v.device_id);
  if not found then
    return jsonb_build_object('ok',true,'update_available',false,'current_version',v_current,'target_version',null,'direction','none');
  end if;
  cmp:=private.pdv_semver_compare(t.version,v_current);
  insert into private.pdv_update_events(tenant_id,device_id,release_id,from_version,to_version,event_type,details)
  values(v.tenant_id,v.device_id,t.release_id,nullif(v_current,''),t.version,'check',jsonb_build_object('scope',t.policy_scope,'available',t.version<>v_current));
  return jsonb_build_object(
    'ok',true,'update_available',t.version<>v_current,'current_version',v_current,'target_version',t.version,
    'direction',case when t.version=v_current then 'same' when cmp<0 then 'rollback' else 'upgrade' end,
    'mode',t.policy_mode,'scope',t.policy_scope,'reason',t.policy_reason,
    'release',jsonb_build_object('id',t.release_id,'version',t.version,'channel',t.channel,'download_url',t.download_url,
      'sha256',t.sha256,'release_notes',t.release_notes,'package_size',t.package_size)
  );
end $$;

create or replace function public.pdv_update_report(p_device_token text,p_target_version text,p_event_type text,p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; r private.pdv_releases%rowtype; v_from text;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if not found then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if p_event_type not in ('download_started','downloaded','verified','installing','installed','failed') then return jsonb_build_object('ok',false,'error','invalid_event'); end if;
  select * into r from private.pdv_releases where version=p_target_version limit 1;
  if not found then return jsonb_build_object('ok',false,'error','release_not_found'); end if;
  select app_version into v_from from public.pdv_devices where id=v.device_id;
  insert into private.pdv_update_events(tenant_id,device_id,release_id,from_version,to_version,event_type,details)
  values(v.tenant_id,v.device_id,r.id,v_from,p_target_version,p_event_type,coalesce(p_details,'{}'::jsonb));
  if p_event_type='installed' then
    update public.pdv_devices set app_version=p_target_version,last_seen_at=now(),updated_at=now() where id=v.device_id;
  end if;
  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.pdv_update_check(text,text) to anon,authenticated;
grant execute on function public.pdv_update_report(text,text,text,jsonb) to anon,authenticated;
