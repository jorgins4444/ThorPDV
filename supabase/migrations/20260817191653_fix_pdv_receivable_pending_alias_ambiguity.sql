-- Fix PL/pgSQL ambiguity between the `fe` row variable and the final pending-entries table alias.
-- Applied to production as migration 20260817191653.

create or replace function public.pdv_receivables_receive(p_device_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $fn$
declare
  v record;
  v_cash public.cash_sessions%rowtype;
  v_customer public.customers%rowtype;
  v_operator public.staff_users%rowtype;
  fe public.financial_entries%rowtype;
  s public.sales%rowtype;
  e jsonb;
  v_entry_id uuid;
  v_customer_id uuid:=nullif(p_payload->>'customer_id','')::uuid;
  v_operator_id uuid:=nullif(p_payload->>'operator_user_id','')::uuid;
  v_event_id uuid:=nullif(p_payload->>'client_event_id','')::uuid;
  v_method text:=lower(trim(coalesce(p_payload->>'payment_method','')));
  v_amount numeric;
  v_remaining numeric;
  v_total numeric:=0;
  v_receipt_id uuid;
  v_receipt_number bigint;
  v_settlement_id uuid;
  v_bank_tx uuid;
  v_internal uuid;
  v_pending_count int:=0;
  v_pending_total numeric:=0;
  v_existing uuid;
  v_items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if v_event_id is null then return jsonb_build_object('ok',false,'error','client_event_id_required'); end if;

  select id into v_existing from public.receivable_receipts where device_id=v.device_id and client_event_id=v_event_id limit 1;
  if v_existing is not null then return private.pdv_receivable_receipt_result(v_existing); end if;

  if v_customer_id is null then return jsonb_build_object('ok',false,'error','customer_required'); end if;
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then return jsonb_build_object('ok',false,'error','receivable_items_required'); end if;
  if jsonb_array_length(v_items)>100 then return jsonb_build_object('ok',false,'error','too_many_receivable_items'); end if;
  if exists(
    select 1 from jsonb_array_elements(v_items) item
    group by item->>'financial_entry_id'
    having count(*)>1
  ) then return jsonb_build_object('ok',false,'error','duplicate_receivable_item'); end if;

  select * into v_cash from public.cash_sessions cs
  where cs.tenant_id=v.tenant_id and cs.pos_register_id=v.pos_register_id and cs.status='open'
    and cs.business_date=private.pdv_business_date(now())
  order by cs.opened_at desc limit 1 for update;
  if v_cash.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;

  select * into v_customer from public.customers where id=v_customer_id and tenant_id=v.tenant_id and active=true limit 1;
  if v_customer.id is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;
  select * into v_operator from public.staff_users where id=v_operator_id and tenant_id=v.tenant_id and active=true limit 1;
  if v_operator.id is null then return jsonb_build_object('ok',false,'error','operator_required'); end if;

  if v_method not in ('cash','pix','debit_card','credit_card','other') or not exists(
    select 1 from public.sales_payment_methods m where m.tenant_id=v.tenant_id and m.company_id=v.company_id and m.code=v_method and m.active=true
  ) then return jsonb_build_object('ok',false,'error','invalid_payment_method'); end if;

  perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':receivable:'||v_customer_id::text));

  for e in select * from jsonb_array_elements(v_items) loop
    v_entry_id:=nullif(e->>'financial_entry_id','')::uuid;
    v_amount:=round(coalesce(nullif(e->>'amount','')::numeric,0),2);
    if v_entry_id is null or v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_receivable_amount'); end if;
    select * into fe from public.financial_entries where id=v_entry_id and tenant_id=v.tenant_id and customer_id=v_customer_id for update;
    if fe.id is null or fe.status not in ('open','partial') then return jsonb_build_object('ok',false,'error','receivable_not_open','financial_entry_id',v_entry_id); end if;
    if fe.sale_id is not null then select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id limit 1; else s:=null; end if;
    if coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),'')<>'crediario'
       or not ((fe.metadata->>'origin'='sale_term') or (s.id is not null and s.payment_condition='term')) then
      return jsonb_build_object('ok',false,'error','crediario_receivable_only','financial_entry_id',v_entry_id);
    end if;
    v_remaining:=greatest(fe.amount-fe.paid_amount,0);
    if v_amount>v_remaining+0.001 then return jsonb_build_object('ok',false,'error','receivable_amount_exceeds_remaining','financial_entry_id',v_entry_id,'remaining',v_remaining); end if;
    v_total:=v_total+v_amount;
  end loop;

  if v_total<=0 then return jsonb_build_object('ok',false,'error','invalid_receipt_total'); end if;
  perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':receivable_receipt_number'));
  select coalesce(max(number),0)+1 into v_receipt_number from public.receivable_receipts where tenant_id=v.tenant_id;

  insert into public.receivable_receipts(
    tenant_id,company_id,branch_id,device_id,cash_session_id,operator_user_id,customer_id,number,client_event_id,payment_method,total_amount,notes,metadata
  ) values(
    v.tenant_id,v.company_id,v.branch_id,v.device_id,v_cash.id,v_operator.id,v_customer.id,v_receipt_number,v_event_id,v_method,round(v_total,2),nullif(trim(p_payload->>'notes'),''),
    jsonb_build_object('source','thorpdv','business_date',v_cash.business_date,'pos_register_id',v.pos_register_id)
  ) returning id into v_receipt_id;

  if v_method='cash' then v_internal:=private.ensure_internal_cash_account(v.tenant_id,v.company_id,v.branch_id); end if;

  for e in select * from jsonb_array_elements(v_items) loop
    v_entry_id:=(e->>'financial_entry_id')::uuid;
    v_amount:=round((e->>'amount')::numeric,2);
    select * into fe from public.financial_entries where id=v_entry_id for update;
    v_remaining:=greatest(fe.amount-fe.paid_amount,0);
    v_settlement_id:=gen_random_uuid();
    v_bank_tx:=null;

    insert into public.financial_settlements(
      id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,cash_session_id,notes,metadata
    ) values(
      v_settlement_id,v.tenant_id,fe.company_id,fe.branch_id,fe.id,v_amount,now(),v_method,'cash_session',v_cash.id,
      'Recebimento no ThorPDV #'||v_receipt_number,
      jsonb_build_object('source','pdv_receivable_receipt','receipt_id',v_receipt_id,'receipt_number',v_receipt_number,'client_event_id',v_event_id,'device_id',v.device_id)
    );

    if v_method='cash' then
      insert into public.bank_transactions(
        tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes
      ) values(
        v.tenant_id,v_internal,current_date,'Recebimento crediário #'||v_receipt_number||' - '||fe.description,v_amount,'credit',true,fe.id,v_cash.id,'cash','financial_settlement',v_settlement_id,'Recebimento em dinheiro no ThorPDV.'
      ) returning id into v_bank_tx;
      update public.financial_settlements set bank_transaction_id=v_bank_tx where id=v_settlement_id;
    end if;

    insert into public.receivable_receipt_items(
      tenant_id,receipt_id,financial_entry_id,sale_id,entry_amount,paid_before,remaining_before,amount_applied,remaining_after,due_date,installment,installments
    ) values(
      v.tenant_id,v_receipt_id,fe.id,fe.sale_id,fe.amount,fe.paid_amount,v_remaining,v_amount,greatest(v_remaining-v_amount,0),fe.due_date,
      nullif(fe.metadata->>'installment','')::int,nullif(fe.metadata->>'installments','')::int
    );

    update public.financial_entries
    set paid_amount=least(amount,paid_amount+v_amount),
        status=case when paid_amount+v_amount>=amount-0.001 then 'paid' else 'partial' end,
        paid_at=case when paid_amount+v_amount>=amount-0.001 then now() else paid_at end,
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method',v_method,'last_destination_type','cash_session','last_settlement_id',v_settlement_id,'last_pdv_receipt_id',v_receipt_id)
    where id=fe.id;
  end loop;

  if v_method='cash' then
    insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,notes,device_id,client_event_id,payment_method)
    values(v.tenant_id,v_cash.id,'receivable',round(v_total,2),'Recebimento de crediário #'||v_receipt_number,v.device_id,v_event_id,'cash')
    on conflict(device_id,client_event_id) do nothing;
  end if;

  select count(*)::int,coalesce(sum(greatest(pending_fe.amount-pending_fe.paid_amount,0)),0)::numeric
  into v_pending_count,v_pending_total
  from public.financial_entries pending_fe
  left join public.sales sx on sx.id=pending_fe.sale_id and sx.tenant_id=pending_fe.tenant_id
  where pending_fe.tenant_id=v.tenant_id and pending_fe.customer_id=v_customer_id and pending_fe.entry_type='receivable' and pending_fe.status in ('open','partial')
    and greatest(pending_fe.amount-pending_fe.paid_amount,0)>0.001
    and coalesce(nullif(pending_fe.metadata->>'term_method',''),nullif(sx.term_method,''),'')='crediario'
    and ((pending_fe.metadata->>'origin'='sale_term') or (sx.id is not null and sx.payment_condition='term'));

  update public.receivable_receipts set pending_count_after=v_pending_count,pending_total_after=v_pending_total where id=v_receipt_id;
  return private.pdv_receivable_receipt_result(v_receipt_id);
end
$fn$;
