-- Permite que o simulador de baixa da conta bancária trate também boletos
-- Sandbox emitidos pelo laboratório BoleCode sem Contas a Receber vinculado.
-- Nesses casos o boleto é marcado como pago e o crédito bancário fica pendente
-- de conciliação. Quando existe financial_entry_id, permanece a baixa completa.

create or replace function private.process_bank_billing_payment_event(
  p_provider text,
  p_event_id text,
  p_billing_id uuid,
  p_amount numeric default null,
  p_paid_at timestamptz default now(),
  p_source text default 'webhook',
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  b public.bank_billings%rowtype;
  fe public.financial_entries%rowtype;
  ba public.bank_accounts%rowtype;
  ev public.bank_billing_events%rowtype;
  v_remaining numeric;
  v_amount numeric;
  v_settlement uuid:=gen_random_uuid();
  v_bank_tx uuid;
  v_paid_at timestamptz:=coalesce(p_paid_at,now());
  v_external_tx_id text;
begin
  if nullif(trim(coalesce(p_provider,'')),'') is null or nullif(trim(coalesce(p_event_id,'')),'') is null then
    return jsonb_build_object('ok',false,'error','provider_and_event_id_required');
  end if;

  select * into b from public.bank_billings where id=p_billing_id for update;
  if b.id is null then return jsonb_build_object('ok',false,'error','billing_not_found'); end if;
  if lower(b.provider)<>lower(p_provider) then return jsonb_build_object('ok',false,'error','provider_mismatch'); end if;

  select * into ev from public.bank_billing_events
   where tenant_id=b.tenant_id and provider=lower(p_provider) and event_id=p_event_id limit 1;
  if ev.id is not null then
    return jsonb_build_object('ok',ev.status='processed','idempotent',true,'event_id',ev.id,'status',ev.status,
      'settlement_id',ev.financial_settlement_id,'bank_transaction_id',ev.bank_transaction_id,
      'bank_only',ev.financial_settlement_id is null and ev.bank_transaction_id is not null);
  end if;

  insert into public.bank_billing_events(tenant_id,company_id,billing_id,provider,event_id,event_type,source,status,amount,occurred_at,payload)
  values(b.tenant_id,b.company_id,b.id,lower(p_provider),p_event_id,'payment_confirmed',coalesce(nullif(p_source,''),'webhook'),'received',p_amount,v_paid_at,coalesce(p_payload,'{}'::jsonb))
  returning * into ev;

  select * into ba from public.bank_accounts where id=b.bank_account_id and tenant_id=b.tenant_id and active=true for update;
  if ba.id is null or ba.account_type<>'bank' then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message='bank_account_not_found' where id=ev.id;
    return jsonb_build_object('ok',false,'error','bank_account_not_found','event_id',ev.id);
  end if;

  if b.financial_entry_id is null then
    v_amount:=coalesce(p_amount,b.amount);
    if v_amount is null or v_amount<=0 then
      update public.bank_billing_events set status='failed',processed_at=now(),error_message='invalid_payment_amount' where id=ev.id;
      return jsonb_build_object('ok',false,'error','invalid_payment_amount','event_id',ev.id);
    end if;
    if abs(v_amount-b.amount)>0.001 then
      update public.bank_billing_events set status='failed',processed_at=now(),error_message='standalone_payment_amount_mismatch' where id=ev.id;
      return jsonb_build_object('ok',false,'error','standalone_payment_amount_mismatch','billing_amount',b.amount,'amount',v_amount,'event_id',ev.id);
    end if;

    v_external_tx_id:='bank-event:'||lower(p_provider)||':'||p_event_id;
    insert into public.bank_transactions(
      tenant_id,bank_account_id,transaction_date,description,amount,direction,external_id,reconciled,
      financial_entry_id,payment_method,origin_type,origin_id,notes
    ) values(
      b.tenant_id,b.bank_account_id,v_paid_at::date,
      'Liquidação boleto Itaú avulso · '||coalesce(b.our_number,b.external_id,b.id::text),
      v_amount,'credit',v_external_tx_id,false,null,'bank_slip','bank_billing',b.id,
      'Crédito recebido por evento bancário Sandbox. Sem título financeiro vinculado; pendente de conciliação.'
    ) returning id into v_bank_tx;

    update public.bank_billings
       set status='paid',paid_at=coalesce(paid_at,v_paid_at),
           response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object(
             'last_payment_event',jsonb_build_object('provider',lower(p_provider),'event_id',p_event_id,'amount',v_amount,'paid_at',v_paid_at,'source',coalesce(nullif(p_source,''),'webhook'),'bank_only',true)
           ),updated_at=now()
     where id=b.id;

    update public.bank_billing_events
       set status='processed',processed_at=now(),amount=v_amount,bank_transaction_id=v_bank_tx,error_message=null
     where id=ev.id;

    return jsonb_build_object('ok',true,'event_id',ev.id,'billing_id',b.id,'financial_entry_id',null,
      'settlement_id',null,'bank_transaction_id',v_bank_tx,'amount',v_amount,'status','paid',
      'bank_only',true,'pending_reconciliation',true);
  end if;

  select * into fe from public.financial_entries where id=b.financial_entry_id and tenant_id=b.tenant_id for update;
  if fe.id is null or fe.entry_type<>'receivable' then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message='receivable_not_found' where id=ev.id;
    return jsonb_build_object('ok',false,'error','receivable_not_found','event_id',ev.id);
  end if;

  if fe.status='cancelled' then
    update public.bank_billing_events set status='ignored',processed_at=now(),error_message='receivable_cancelled' where id=ev.id;
    return jsonb_build_object('ok',false,'error','receivable_cancelled','event_id',ev.id);
  end if;

  v_remaining:=greatest(fe.amount-fe.paid_amount,0);
  if v_remaining<=0.001 or fe.status='paid' then
    update public.bank_billings set status='paid',paid_at=coalesce(paid_at,fe.paid_at,v_paid_at),updated_at=now() where id=b.id;
    update public.bank_billing_events set status='processed',processed_at=now(),amount=0,error_message='receivable_already_paid' where id=ev.id;
    return jsonb_build_object('ok',true,'idempotent',true,'already_paid',true,'event_id',ev.id,'billing_id',b.id,'financial_entry_id',fe.id);
  end if;

  v_amount:=coalesce(p_amount,b.amount,v_remaining);
  if v_amount<=0 then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message='invalid_payment_amount' where id=ev.id;
    return jsonb_build_object('ok',false,'error','invalid_payment_amount','event_id',ev.id);
  end if;
  if v_amount>v_remaining+0.001 then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message='payment_amount_exceeds_remaining' where id=ev.id;
    return jsonb_build_object('ok',false,'error','payment_amount_exceeds_remaining','remaining',v_remaining,'amount',v_amount,'event_id',ev.id);
  end if;

  insert into public.financial_settlements(
    id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,
    bank_account_id,notes,metadata,status
  ) values(
    v_settlement,b.tenant_id,fe.company_id,fe.branch_id,fe.id,v_amount,v_paid_at,'other','bank_account',b.bank_account_id,
    'Baixa automática por liquidação de boleto Itaú.',
    jsonb_build_object('source',coalesce(nullif(p_source,''),'webhook'),'provider',lower(p_provider),'event_id',p_event_id,'billing_id',b.id,'our_number',b.our_number,'external_id',b.external_id),
    'active'
  );

  insert into public.bank_transactions(
    tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,
    payment_method,origin_type,origin_id,external_id,notes
  ) values(
    b.tenant_id,b.bank_account_id,v_paid_at::date,
    'Liquidação boleto Itaú · '||coalesce(b.our_number,b.external_id,fe.description),
    v_amount,'credit',true,fe.id,'other','financial_settlement',v_settlement,
    coalesce(b.external_id,p_event_id),'Confirmado automaticamente por evento bancário de liquidação.'
  ) returning id into v_bank_tx;

  update public.financial_settlements set bank_transaction_id=v_bank_tx where id=v_settlement;
  update public.financial_entries
     set paid_amount=least(amount,paid_amount+v_amount),
         status=case when paid_amount+v_amount>=amount-0.001 then 'paid' else 'partial' end,
         paid_at=case when paid_amount+v_amount>=amount-0.001 then v_paid_at else paid_at end,
         updated_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'last_payment_method','other','last_destination_type','bank_account','last_settlement_id',v_settlement,
           'last_bank_event_id',p_event_id,'last_bank_provider',lower(p_provider),'last_bank_billing_id',b.id
         )
   where id=fe.id;

  update public.bank_billings
     set status=case when v_amount>=v_remaining-0.001 then 'paid' else status end,
         paid_at=case when v_amount>=v_remaining-0.001 then v_paid_at else paid_at end,
         response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object(
           'last_payment_event',jsonb_build_object('provider',lower(p_provider),'event_id',p_event_id,'amount',v_amount,'paid_at',v_paid_at,'source',coalesce(nullif(p_source,''),'webhook'))
         ),updated_at=now()
   where id=b.id;

  update public.bank_billing_events
     set status='processed',processed_at=now(),amount=v_amount,financial_settlement_id=v_settlement,bank_transaction_id=v_bank_tx
   where id=ev.id;

  return jsonb_build_object('ok',true,'event_id',ev.id,'billing_id',b.id,'financial_entry_id',fe.id,
    'settlement_id',v_settlement,'bank_transaction_id',v_bank_tx,'amount',v_amount,
    'remaining',greatest(v_remaining-v_amount,0),'status',case when v_remaining-v_amount<=0.001 then 'paid' else 'partial' end,
    'bank_only',false,'pending_reconciliation',false);
exception when unique_violation then
  select * into ev from public.bank_billing_events
   where tenant_id=b.tenant_id and provider=lower(p_provider) and event_id=p_event_id limit 1;
  if ev.id is not null then
    return jsonb_build_object('ok',ev.status='processed','idempotent',true,'event_id',ev.id,'status',ev.status,
      'settlement_id',ev.financial_settlement_id,'bank_transaction_id',ev.bank_transaction_id);
  end if;
  return jsonb_build_object('ok',false,'error','duplicate_bank_transaction','detail',sqlerrm);
when others then
  if ev.id is not null then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message=left(sqlerrm,500) where id=ev.id;
  end if;
  return jsonb_build_object('ok',false,'error','bank_payment_processing_failed','detail',sqlerrm,'event_id',ev.id);
end $$;

create or replace function public.erp_itau_boleto_simulate_payment(p_token text,p_billing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record;
  b public.bank_billings%rowtype;
  fe public.financial_entries%rowtype;
  v_amount numeric;
  v_event_id text;
  v_paid_at timestamptz:=now();
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into b from public.bank_billings
   where id=p_billing_id and tenant_id=v.tenant_id and company_id=v.company_id and provider='itau'
   for update;
  if b.id is null then return jsonb_build_object('ok',false,'error','billing_not_found'); end if;
  if b.environment<>'sandbox' then return jsonb_build_object('ok',false,'error','sandbox_only'); end if;
  if b.status not in ('issued','processing') then
    if b.status='paid' then return jsonb_build_object('ok',true,'idempotent',true,'already_paid',true,'billing_id',b.id); end if;
    return jsonb_build_object('ok',false,'error','billing_not_payable','status',b.status);
  end if;

  if b.financial_entry_id is null then
    v_amount:=b.amount;
  else
    select * into fe from public.financial_entries where id=b.financial_entry_id and tenant_id=v.tenant_id for update;
    if fe.id is null then return jsonb_build_object('ok',false,'error','receivable_not_found'); end if;
    v_amount:=greatest(fe.amount-fe.paid_amount,0);
  end if;

  v_event_id:='sandbox-webhook-liquidation:'||b.id::text;
  return private.process_bank_payment_event(
    'itau','sandbox',v_event_id,'LIQUIDACAO',
    jsonb_build_object(
      'simulated',true,'event','LIQUIDACAO','occurrence_code','06','billing_id',b.id,
      'our_number',b.our_number,'external_id',b.external_id,'pix_txid',b.pix_txid,
      'financial_entry_id',b.financial_entry_id,'amount',v_amount,'paid_at',v_paid_at,'simulated_by',v.user_id
    ),
    jsonb_build_object(
      'source','simulation','payment_status','liquidado','payment_channel','boleto',
      'billing_id',b.id,'our_number',b.our_number,'external_id',b.external_id,'pix_txid',b.pix_txid,
      'amount',v_amount,'paid_at',v_paid_at
    )
  );
end $$;

revoke all on function public.erp_itau_boleto_simulate_payment(text,uuid) from public;
grant execute on function public.erp_itau_boleto_simulate_payment(text,uuid) to anon,authenticated;
