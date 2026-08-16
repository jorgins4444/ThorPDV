create or replace function public.erp_cash_closure_detail_v2(p_token text, p_cash_id uuid, p_closure_audit_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v record;
  v_cs public.cash_sessions%rowtype;
  v_a public.cash_session_audit%rowtype;
  v_cutoff timestamptz;
  v_snapshot jsonb;
  v_session jsonb;
  v_payments jsonb;
  v_movements jsonb;
  v_sales jsonb;
  v_audit jsonb;
  v_fiscal jsonb;
  v_can boolean;
  v_record_state text:='current';
  v_closing numeric;
  v_expected numeric;
  v_status text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into v_cs from public.cash_sessions where id=p_cash_id and tenant_id=v.tenant_id;
  if v_cs.id is null then return jsonb_build_object('ok',false,'error','cash_not_found'); end if;
  v_can:=private.management_has_permission(p_token,'cash.correct_closure');

  if p_closure_audit_id is not null then
    select * into v_a from public.cash_session_audit
    where id=p_closure_audit_id and cash_session_id=p_cash_id and tenant_id=v.tenant_id;
    if v_a.id is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;
    if v_a.action='management_reopen' then
      v_cutoff:=v_a.previous_closed_at; v_record_state:='reopened'; v_closing:=v_a.previous_closing_amount;
    else
      v_cutoff:=coalesce(v_a.new_closed_at,v_a.previous_closed_at); v_closing:=coalesce(v_a.new_closing_amount,v_a.previous_closing_amount);
    end if;
    v_snapshot:=coalesce(v_a.snapshot,private.cash_closure_snapshot(p_cash_id,v_cutoff));
  else
    v_cutoff:=v_cs.closed_at;
    v_closing:=v_cs.closing_amount;
    if v_cutoff is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;
    select * into v_a from public.cash_session_audit
    where cash_session_id=p_cash_id and tenant_id=v.tenant_id
      and action in ('management_close','management_correct')
      and coalesce(new_closed_at,previous_closed_at)=v_cutoff
    order by created_at desc limit 1;
    v_snapshot:=coalesce(v_a.snapshot,private.cash_closure_snapshot(p_cash_id,v_cutoff));
  end if;
  if v_cutoff is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;

  v_expected:=coalesce((v_snapshot->>'expected_cash')::numeric,v_a.expected_cash,0);
  v_closing:=coalesce((v_snapshot->>'closing_amount')::numeric,v_closing,0);
  v_status:=case when v_record_state='reopened' then 'reopened' else 'closed' end;

  select to_jsonb(x)||v_snapshot||jsonb_build_object(
      'id',v_cs.id,'status',v_status,'record_state',v_record_state,
      'closure_audit_id',p_closure_audit_id,'closed_at',v_cutoff,
      'closing_amount',v_closing,'expected_cash',v_expected,'difference',v_closing-v_expected,
      'duration_minutes',extract(epoch from (v_cutoff-v_cs.opened_at))/60,
      'reopened_at',case when v_record_state='reopened' then v_a.created_at else null end,
      'reopen_reason',case when v_record_state='reopened' then v_a.reason else null end
    ) into v_session
  from (
    select v_cs.id,v_cs.business_date,v_cs.opening_amount,v_cs.opened_at,v_cs.notes,v_cs.staff_user_id operator_id,
           su.name operator,su.email operator_email,pr.id pos_id,pr.name pos,pr.code pos_code,
           b.id branch_id,b.name branch,b.cnpj branch_cnpj
    from public.pos_registers pr join public.branches b on b.id=pr.branch_id
    left join public.staff_users su on su.id=v_cs.staff_user_id
    where pr.id=v_cs.pos_register_id
  ) x;

  v_payments:=coalesce(v_snapshot->'payments','[]'::jsonb);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_movements
  from (
    select cm.id,cm.created_at,cm.movement_type,cm.amount,cm.payment_method,cm.notes,cm.financial_entry_id
    from public.cash_movements cm
    where cm.cash_session_id=p_cash_id and cm.created_at<=v_cutoff
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) into v_sales
  from (
    select s.id,s.number,
           case when s.cancelled_at is not null and s.cancelled_at<=v_cutoff then 'cancelled'
                when s.completed_at is not null and s.completed_at<=v_cutoff then 'completed' else s.status end status,
           s.subtotal,s.discount,s.surcharge,s.total,s.payment_condition,s.consumer_document,
           coalesce(s.completed_at,s.created_at) occurred_at,s.cancelled_at,su.name operator,
           fd.id fiscal_document_id,fd.document_type,fd.status fiscal_status,fd.series fiscal_series,fd.number fiscal_number,
           fd.access_key,fd.protocol,fd.cancellation_protocol,fd.rejection_code,fd.rejection_message,
           coalesce(si.items,'[]'::jsonb) items
    from public.sales s
    left join public.staff_users su on su.id=s.staff_user_id
    left join lateral (
      select f.* from public.fiscal_documents f
      where f.sale_id=s.id and f.created_at<=v_cutoff
      order by f.created_at desc limit 1
    ) fd on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,
        'product_id',i.product_id,
        'sku',i.sku,
        'description',i.description,
        'unit',i.unit,
        'quantity',i.quantity,
        'unit_price',i.unit_price,
        'discount',i.discount,
        'total',i.total
      ) order by i.created_at,i.id),'[]'::jsonb) items
      from public.sale_items i
      where i.sale_id=s.id and i.tenant_id=v.tenant_id and i.created_at<=v_cutoff
    ) si on true
    where s.cash_session_id=p_cash_id and coalesce(s.completed_at,s.created_at)<=v_cutoff
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_audit
  from (
    select a.id,a.action,a.previous_status,a.new_status,a.previous_closing_amount,a.new_closing_amount,
           a.previous_closed_at,a.new_closed_at,a.expected_cash,a.reason,a.actor_user_id,a.actor_email,a.source,a.created_at,
           case a.action when 'management_close' then 'Fechamento' when 'management_reopen' then 'Reabertura' when 'management_correct' then 'Correção do fechamento' else a.action end action_label
    from public.cash_session_audit a where a.cash_session_id=p_cash_id
  ) x;

  select jsonb_build_object(
    'total',count(fd.id),
    'authorized',count(fd.id) filter(where fd.status='authorized'),
    'cancelled',count(fd.id) filter(where fd.status='cancelled'),
    'rejected',count(fd.id) filter(where fd.status='rejected'),
    'pending',count(fd.id) filter(where fd.status not in ('authorized','cancelled','rejected')),
    'nfe',count(fd.id) filter(where fd.document_type='nfe'),
    'nfce',count(fd.id) filter(where fd.document_type='nfce')
  ) into v_fiscal
  from public.fiscal_documents fd join public.sales s on s.id=fd.sale_id
  where s.cash_session_id=p_cash_id and coalesce(s.completed_at,s.created_at)<=v_cutoff and fd.created_at<=v_cutoff;

  return jsonb_build_object(
    'ok',true,'session',v_session,'payments',v_payments,'movements',v_movements,'sales',v_sales,
    'audit',v_audit,'fiscal',v_fiscal,'snapshot',v_snapshot,
    'can_correct',v_can and v_record_state='current' and v_cs.status='closed' and v_cs.closed_at=v_cutoff,
    'can_reopen',v_can and v_record_state='current' and v_cs.status='closed' and v_cs.closed_at=v_cutoff,
    'permission','cash.correct_closure'
  );
end;
$function$;
