-- ThorPDV 0.8.5
-- Keep daily cash management compatible with the already-deployed /api/pdv/push route.
-- Regular PDV events continue through the previous implementation, one event at a time,
-- while read/control commands are handled here without requiring new Vercel routes.

do $$
begin
  if to_regprocedure('public.pdv_sync_push_legacy_v084(text,jsonb)') is null
     and to_regprocedure('public.pdv_sync_push(text,jsonb)') is not null then
    alter function public.pdv_sync_push(text,jsonb) rename to pdv_sync_push_legacy_v084;
  end if;
end $$;

create or replace function public.pdv_cash_close_session(
  p_device_token text,
  p_cash_open_event_id uuid,
  p_closing_amount numeric,
  p_notes text,
  p_operator_user_id uuid,
  p_reconciliation jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_cash public.cash_sessions%rowtype;
  v_expected numeric:=0;
  v_closing numeric:=greatest(coalesce(p_closing_amount,0),0);
  v_now timestamptz:=now();
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if p_operator_user_id is null or not private.pdv_action_allowed(v.tenant_id,v.branch_id,p_operator_user_id,'cash.close',null) then
    return jsonb_build_object('ok',false,'error','cash_close_not_authorized');
  end if;

  select * into v_cash
    from public.cash_sessions
   where tenant_id=v.tenant_id
     and pos_register_id=v.pos_register_id
     and client_event_id=p_cash_open_event_id
     and status in ('open','pending_close','closed')
   for update;
  if v_cash.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;

  select cs.opening_amount
      +coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status<>'cancelled' and p.method='cash' and p.status in ('paid','authorized')),0)
      +coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('supply','receivable')),0)
      -coalesce((select sum(cm.amount) from public.cash_movements cm where cm.cash_session_id=cs.id and cm.movement_type in ('withdrawal','sangria','expense','refund')),0)
    into v_expected
    from public.cash_sessions cs where cs.id=v_cash.id;

  if v_cash.status='closed' then
    return jsonb_build_object(
      'ok',true,'idempotent',true,'cash_session_id',v_cash.id,'client_event_id',v_cash.client_event_id,
      'business_date',v_cash.business_date,'expected_cash',v_expected,'closing_amount',coalesce(v_cash.closing_amount,0),
      'difference',coalesce(v_cash.closing_amount,0)-v_expected,'closed_at',v_cash.closed_at,
      'reconciliation',coalesce(p_reconciliation,'{}'::jsonb)
    );
  end if;

  update public.cash_sessions
     set status='closed',closing_amount=v_closing,closed_at=v_now,
         notes=concat_ws(' | ',nullif(notes,''),nullif(trim(coalesce(p_notes,'')),''))
   where id=v_cash.id;

  insert into public.cash_session_audit(
    tenant_id,cash_session_id,action,previous_status,new_status,previous_closing_amount,new_closing_amount,
    previous_closed_at,new_closed_at,expected_cash,reason,actor_user_id,source
  ) values(
    v.tenant_id,v_cash.id,'management_close',v_cash.status,'closed',v_cash.closing_amount,v_closing,
    v_cash.closed_at,v_now,v_expected,nullif(trim(coalesce(p_notes,'')),''),p_operator_user_id,'pdv_desktop'
  );

  return jsonb_build_object(
    'ok',true,'cash_session_id',v_cash.id,'client_event_id',v_cash.client_event_id,
    'business_date',v_cash.business_date,'expected_cash',v_expected,'closing_amount',v_closing,
    'difference',v_closing-v_expected,'closed_at',v_now,'reconciliation',coalesce(p_reconciliation,'{}'::jsonb)
  );
end $$;

grant execute on function public.pdv_cash_close_session(text,uuid,numeric,text,uuid,jsonb) to anon,authenticated;

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
        v_result:=public.pdv_cash_sessions_list(
          p_device_token,
          nullif(v_payload->>'from','')::date,
          nullif(v_payload->>'to','')::date,
          coalesce(nullif(v_payload->>'status',''),'all')
        );

      elsif v_type='cash_preview_query' then
        v_result:=public.pdv_cash_preview_v2(
          p_device_token,
          nullif(v_payload->>'cash_open_event_id','')::uuid
        );

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
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'id',v_event_id,'type',v_type,'status',v_status,'result',v_result
        ));
      else
        v_status:='rejected';
        v_error:=coalesce(v_result->>'error','cash_command_failed');
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'id',v_event_id,'type',v_type,'status',v_status,'error',v_error,'result',v_result
        ));
      end if;
    exception when others then
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'id',coalesce(v_event_id,gen_random_uuid()),'type',coalesce(v_type,''),'status','rejected','error',sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object('ok',true,'server_time',now(),'results',v_results);
end $$;

grant execute on function public.pdv_sync_push(text,jsonb) to anon,authenticated;
