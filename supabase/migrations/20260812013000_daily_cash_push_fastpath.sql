-- Keep normal sale/fiscal/cash event batches on the original optimized push path.
create or replace function public.pdv_sync_push(p_device_token text,p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
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
    select 1
      from jsonb_array_elements(p_events) cmd
     where lower(trim(coalesce(cmd->>'type',''))) in (
       'cash_rollover','cash_sessions_query','cash_preview_query','cash_historical_close'
     )
  ) then
    return public.pdv_sync_push_legacy_v084(p_device_token,p_events);
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
        v_result:=public.pdv_cash_preview_v2(p_device_token,nullif(v_payload->>'cash_open_event_id','')::uuid);
      elsif v_type='cash_historical_close' then
        v_result:=public.pdv_cash_close_session(
          p_device_token,
          nullif(v_payload->>'cash_open_event_id','')::uuid,
          greatest(coalesce(nullif(v_payload->>'closing_amount','')::numeric,0),0),
          coalesce(v_payload->>'notes',''),
          nullif(v_payload->>'operator_user_id','')::uuid,
          coalesce(v_payload->'reconciliation','{}'::jsonb)
        );
      else
        v_call:=public.pdv_sync_push_legacy_v084(p_device_token,jsonb_build_array(e));
        v_results:=v_results||coalesce(v_call->'results','[]'::jsonb);
        continue;
      end if;

      if coalesce((v_result->>'ok')::boolean,false) then
        v_status:='processed';
        v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_event_id,'type',v_type,'status',v_status,'result',v_result));
      else
        v_status:='rejected';
        v_error:=coalesce(v_result->>'error','cash_command_failed');
        v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_event_id,'type',v_type,'status',v_status,'error',v_error,'result',v_result));
      end if;
    exception when others then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('id',coalesce(v_event_id,gen_random_uuid()),'type',coalesce(v_type,''),'status','rejected','error',sqlerrm));
    end;
  end loop;

  return jsonb_build_object('ok',true,'server_time',now(),'results',v_results);
end $$;

grant execute on function public.pdv_sync_push(text,jsonb) to anon,authenticated;
