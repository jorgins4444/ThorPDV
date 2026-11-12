-- Show non-cash receivable settlements in PDV cash operation history without counting them as drawer cash.
CREATE OR REPLACE FUNCTION public.pdv_operation_history_server(p_device_token text, p_query text DEFAULT NULL::text, p_type text DEFAULT 'all'::text, p_limit integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v record;
  v_rows jsonb;
  v_q text := lower(coalesce(p_query,''));
  v_limit int := least(greatest(coalesce(p_limit,250),1),500);
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  with target_sessions as (
    select cs.* from public.cash_sessions cs
    where cs.tenant_id=v.tenant_id and cs.pos_register_id=v.pos_register_id
  ), ops as (
    select
      'cash-open-'||cs.id::text id,'cash_open'::text type,
      coalesce(cs.client_event_id::text,cs.id::text) reference,
      cs.client_event_id::text source_event_id,
      jsonb_build_object('opening_amount',cs.opening_amount,'operator_name',coalesce(su.name,''),'operator',jsonb_build_object('id',su.id,'name',coalesce(su.name,'')),'business_date',cs.business_date,'pos_register_id',cs.pos_register_id,'status',cs.status,'origin','server') payload,
      true sensitive,cs.opened_at created_at,'server'::text origin
    from target_sessions cs left join public.staff_users su on su.id=cs.staff_user_id

    union all
    select
      'cash-close-'||cs.id::text,'cash_close',coalesce(cs.client_event_id::text,cs.id::text),cs.client_event_id::text,
      jsonb_build_object('closing_amount',cs.closing_amount,'opening_amount',cs.opening_amount,'operator_name',coalesce(su.name,''),'operator',jsonb_build_object('id',su.id,'name',coalesce(su.name,'')),'business_date',cs.business_date,'status',cs.status,'notes',cs.notes,'origin','server'),
      true,cs.closed_at,'server'
    from target_sessions cs left join public.staff_users su on su.id=cs.staff_user_id where cs.closed_at is not null

    union all
    select
      'sale-'||s.id::text,'sale',coalesce(s.number::text,s.client_event_id::text,s.id::text),s.client_event_id::text,
      jsonb_build_object('sale_id',s.id,'number',s.number,'total',s.total,'subtotal',s.subtotal,'discount',s.discount,'surcharge',s.surcharge,'status',s.status,'channel',s.channel,'customer_name',coalesce(c.name,''),'operator_name',coalesce(su.name,''),'operator',jsonb_build_object('id',su.id,'name',coalesce(su.name,'')),'payments',coalesce((select jsonb_agg(jsonb_build_object('method',p.method,'amount',p.amount,'status',p.status,'provider',p.provider) order by p.created_at) from public.payments p where p.sale_id=s.id),'[]'::jsonb),'items',coalesce((select jsonb_agg(jsonb_build_object('name',si.description,'sku',si.sku,'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total) order by si.id) from public.sale_items si where si.sale_id=s.id),'[]'::jsonb),'origin',case when s.channel='pdv' then 'ThorPDV' else 'ThorGestão' end),
      false,coalesce(s.completed_at,s.created_at),'server'
    from public.sales s join target_sessions cs on cs.id=s.cash_session_id left join public.staff_users su on su.id=s.staff_user_id left join public.customers c on c.id=s.customer_id

    union all
    select
      'sale-cancel-'||s.id::text,'sale_cancel',coalesce(s.number::text,s.client_event_id::text,s.id::text),s.client_event_id::text,
      jsonb_build_object('sale_id',s.id,'number',s.number,'total',s.total,'reason',s.notes,'status',s.status,'operator_name',coalesce(su.name,''),'operator',jsonb_build_object('id',su.id,'name',coalesce(su.name,'')),'origin',case when s.channel='pdv' then 'ThorPDV' else 'ThorGestão' end),
      true,s.cancelled_at,'server'
    from public.sales s join target_sessions cs on cs.id=s.cash_session_id left join public.staff_users su on su.id=s.staff_user_id where s.cancelled_at is not null or s.status='cancelled'

    union all
    select
      'return-'||r.id::text,'sale_return',coalesce(s.number::text,r.client_event_id::text,r.id::text),r.client_event_id::text,
      jsonb_build_object('sale_id',r.sale_id,'number',s.number,'amount',r.total,'total',r.total,'refund_method',r.refund_method,'reason',r.reason,'status',r.status,'operator_name',coalesce(su.name,''),'operator',jsonb_build_object('id',su.id,'name',coalesce(su.name,'')),'origin',case when r.pdv_device_id is null then 'ThorGestão' else 'ThorPDV' end),
      true,r.created_at,'server'
    from public.sale_returns r join public.sales s on s.id=r.sale_id join target_sessions cs on cs.id=s.cash_session_id left join public.staff_users su on su.id=r.operator_user_id

    union all
    select
      'movement-'||cm.id::text,
      case when cm.movement_type in ('withdrawal','sangria','expense') then 'cash_withdrawal' when cm.movement_type='receivable' then 'receivable' else 'cash_supply' end,
      coalesce(cm.client_event_id::text,cm.id::text),cm.client_event_id::text,
      jsonb_build_object('amount',cm.amount,'movement_type',cm.movement_type,'payment_method',cm.payment_method,'notes',cm.notes,'origin',case when cm.device_id is null then 'ThorGestão' else 'ThorPDV' end),
      true,cm.created_at,'server'
    from public.cash_movements cm join target_sessions cs on cs.id=cm.cash_session_id

    union all
    select
      'receivable-'||rr.id::text, 'receivable'::text,
      coalesce(rr.number::text,rr.client_event_id::text,rr.id::text),
      rr.client_event_id::text,
      jsonb_build_object(
        'amount',rr.total_amount,'total_amount',rr.total_amount,
        'payment_method',rr.payment_method,'receipt_number',rr.number,
        'customer_name',coalesce(c.name,''),'operator_name',coalesce(su.name,''),
        'origin',case when rr.device_id is null then 'ThorGestão' else 'ThorPDV' end
      ),
      true,rr.created_at,'server'::text
    from public.receivable_receipts rr
    join target_sessions cs on cs.id=rr.cash_session_id
    left join public.customers c on c.id=rr.customer_id
    left join public.staff_users su on su.id=rr.operator_user_id
    where rr.payment_method <> 'cash' and rr.status='completed'
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_rows
  from (
    select * from ops
    where created_at is not null
      and (coalesce(p_type,'all')='all' or type=p_type)
      and (v_q='' or lower(coalesce(reference,'')||' '||coalesce(payload::text,'')) like '%'||v_q||'%')
    order by created_at desc limit v_limit
  ) x;

  return jsonb_build_object('ok',true,'data',v_rows);
end
$function$
;
