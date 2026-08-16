create or replace function public.erp_pdv_devices(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare v record; v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,
    'name',d.name,
    'machine_id',d.machine_id,
    'hostname',d.hostname,
    'app_version',d.app_version,
    'status',case when d.status='blocked' then 'blocked' when d.status='reconnect_required' then 'reconnect_required' when d.last_seen_at>now()-interval '2 minutes' then 'online' else 'offline' end,
    'sync_health',case
      when d.status='blocked' then 'blocked'
      when d.status='reconnect_required' then 'reconnect_required'
      when d.last_seen_at<=now()-interval '2 minutes' then 'offline'
      when coalesce((d.config#>>'{last_metrics,queue,rejected}')::int,0)>0 then 'warning'
      when coalesce((d.config#>>'{last_metrics,queue,pending}')::int,0)>20 then 'warning'
      else 'healthy'
    end,
    'last_seen_at',d.last_seen_at,
    'enrolled_at',d.enrolled_at,
    'capabilities',d.capabilities,
    'config',d.config,
    'pos_register_id',d.pos_register_id,
    'pos_name',pr.name,
    'pos_code',pr.code,
    'branch_id',d.branch_id,
    'branch_name',b.name,
    'queue_pending',coalesce((d.config#>>'{last_metrics,queue,pending}')::int,0),
    'queue_rejected',coalesce((d.config#>>'{last_metrics,queue,rejected}')::int,0),
    'queue_synced',coalesce((d.config#>>'{last_metrics,queue,synced}')::int,0),
    'last_push_at',nullif(d.config#>>'{last_metrics,lastPushAt}',''),
    'last_pull_at',nullif(d.config#>>'{last_metrics,lastPullAt}',''),
    'sync_processed',coalesce((select count(*) from public.pdv_sync_events se where se.device_id=d.id and se.status='processed'),0),
    'sync_rejected',coalesce((select count(*) from public.pdv_sync_events se where se.device_id=d.id and se.status='rejected'),0),
    'last_event_at',(select max(se.received_at) from public.pdv_sync_events se where se.device_id=d.id),
    'last_sale_sync_at',(select max(se.processed_at) from public.pdv_sync_events se where se.device_id=d.id and se.event_type='sale_completed' and se.status='processed'),
    'last_sync_error',(select se.error from public.pdv_sync_events se where se.device_id=d.id and se.status='rejected' order by se.received_at desc limit 1)
  ) order by d.created_at desc),'[]'::jsonb) into v_data
  from public.pdv_devices d
  join public.pos_registers pr on pr.id=d.pos_register_id
  join public.branches b on b.id=d.branch_id
  where d.tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'data',v_data);
end
$function$;
