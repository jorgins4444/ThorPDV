-- Títulos manuais nunca usam sessão de caixa do PDV. Mesmo a liquidação CNAB é roteada ao Caixa Interno.
create or replace function private.route_manual_receivable_settlement_internal_cash()
returns trigger language plpgsql security definer set search_path='public','private' as $$
declare fe public.financial_entries%rowtype; v_internal uuid;
begin
  select * into fe from public.financial_entries where id=new.financial_entry_id;
  if fe.id is not null and fe.metadata->>'origin'='manual_receivable' then
    v_internal:=private.ensure_internal_cash_account(fe.tenant_id,fe.company_id,fe.branch_id);
    new.destination_type:='bank_account'; new.bank_account_id:=v_internal; new.cash_session_id:=null;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('routed_to_internal_cash',true,'pdv_cash_session',false);
  end if;
  return new;
end $$;
drop trigger if exists trg_manual_receivable_settlement_internal_cash on public.financial_settlements;
create trigger trg_manual_receivable_settlement_internal_cash before insert on public.financial_settlements for each row execute function private.route_manual_receivable_settlement_internal_cash();

create or replace function private.route_manual_receivable_bank_tx_internal_cash()
returns trigger language plpgsql security definer set search_path='public','private' as $$
declare fe public.financial_entries%rowtype; v_internal uuid;
begin
  if new.financial_entry_id is null then return new; end if;
  select * into fe from public.financial_entries where id=new.financial_entry_id;
  if fe.id is not null and fe.metadata->>'origin'='manual_receivable' then
    v_internal:=private.ensure_internal_cash_account(fe.tenant_id,fe.company_id,fe.branch_id);
    new.bank_account_id:=v_internal; new.cash_session_id:=null; new.reconciled:=true;
    new.notes:=concat_ws(' ',nullif(new.notes,''),'Título manual direcionado ao Caixa Interno; não participa do fechamento do PDV.');
  end if;
  return new;
end $$;
drop trigger if exists trg_manual_receivable_bank_tx_internal_cash on public.bank_transactions;
create trigger trg_manual_receivable_bank_tx_internal_cash before insert on public.bank_transactions for each row execute function private.route_manual_receivable_bank_tx_internal_cash();

create or replace function public.erp_term_receivable_settle(p_token text,p_entry_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; fe public.financial_entries%rowtype; s public.sales%rowtype; ba public.bank_accounts%rowtype; v_term_method text; v_destination text:=nullif(p_payload->>'destination_type',''); v_account uuid:=nullif(p_payload->>'bank_account_id','')::uuid; v_payment_method text:=nullif(p_payload->>'payment_method',''); v_manual boolean:=false; v_internal uuid;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id limit 1; if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  if fe.sale_id is not null then select * into s from public.sales where id=fe.sale_id limit 1; end if;
  v_term_method:=coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),'')); v_manual:=fe.metadata->>'origin'='manual_receivable';
  if fe.entry_type<>'receivable' or not (v_manual or (fe.sale_id is not null and (fe.metadata->>'origin'='sale_term' or s.payment_condition='term'))) or v_term_method not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','term_receivable_only'); end if;
  if v_payment_method='store_credit' then return jsonb_build_object('ok',false,'error','invalid_payment_method'); end if;
  if v_manual then v_internal:=private.ensure_internal_cash_account(v.tenant_id,fe.company_id,fe.branch_id); return public.erp_financial_settle(p_token,p_entry_id,p_payload||jsonb_build_object('destination_type','bank_account','bank_account_id',v_internal,'cash_session_id',null)); end if;
  if v_destination<>'bank_account' or v_account is null then return jsonb_build_object('ok',false,'error','financial_account_destination_required'); end if;
  select * into ba from public.bank_accounts where id=v_account and tenant_id=v.tenant_id and active=true and account_type in ('bank','internal_cash') limit 1; if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
  return public.erp_financial_settle(p_token,p_entry_id,p_payload||jsonb_build_object('destination_type','bank_account','bank_account_id',v_account,'cash_session_id',null));
end $$;

create or replace function public.erp_financial_settle(p_token text,p_entry_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; fe public.financial_entries%rowtype; ba public.bank_accounts%rowtype; cs public.cash_sessions%rowtype; v_remaining numeric; v_amount numeric; v_method text:=nullif(p_payload->>'payment_method',''); v_destination text:=nullif(p_payload->>'destination_type',''); v_account uuid:=nullif(p_payload->>'bank_account_id','')::uuid; v_cash uuid:=nullif(p_payload->>'cash_session_id','')::uuid; v_settlement uuid:=gen_random_uuid(); v_bank_tx uuid; v_internal uuid; v_cm uuid; v_settled_at timestamptz:=coalesce(nullif(p_payload->>'settled_at','')::timestamptz,now()); v_balance numeric; v_manual boolean;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id for update; if fe.id is null or fe.status='cancelled' then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  v_manual:=fe.metadata->>'origin'='manual_receivable'; v_remaining:=greatest(fe.amount-fe.paid_amount,0); v_amount:=coalesce(nullif(p_payload->>'amount','')::numeric,v_remaining);
  if v_amount<=0 or v_amount>v_remaining+0.001 then return jsonb_build_object('ok',false,'error','invalid_settlement_amount','remaining',v_remaining); end if;
  if v_method is null or v_method='term_sale' or not exists(select 1 from public.sales_payment_methods m where m.tenant_id=v.tenant_id and m.company_id=fe.company_id and m.code=v_method and m.active=true) then return jsonb_build_object('ok',false,'error','invalid_payment_method'); end if;
  if v_method='store_credit' then
    if fe.entry_type<>'receivable' or fe.customer_id is null then return jsonb_build_object('ok',false,'error','store_credit_requires_customer'); end if;
    perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':'||fe.customer_id::text)); v_balance:=private.customer_store_credit_balance(v.tenant_id,fe.customer_id); if v_balance+0.001<v_amount then return jsonb_build_object('ok',false,'error','insufficient_store_credit','available',v_balance); end if; v_destination:='store_credit';
  elsif v_destination='cash_session' then
    if v_method<>'cash' then return jsonb_build_object('ok',false,'error','cash_session_requires_cash_payment'); end if;
    select * into cs from public.cash_sessions where id=v_cash and tenant_id=v.tenant_id and status='open' for update; if cs.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;
  elsif v_destination='bank_account' then
    select * into ba from public.bank_accounts where id=v_account and tenant_id=v.tenant_id and active=true for update; if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
    if ba.account_type='internal_cash' and v_method<>'cash' and not v_manual then return jsonb_build_object('ok',false,'error','internal_cash_requires_cash_payment'); end if;
  else return jsonb_build_object('ok',false,'error','destination_required'); end if;
  insert into public.financial_settlements(id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,bank_account_id,cash_session_id,notes,metadata)
  values(v_settlement,v.tenant_id,fe.company_id,fe.branch_id,fe.id,v_amount,v_settled_at,v_method,v_destination,case when v_destination='bank_account' then v_account else null end,case when v_destination='cash_session' then v_cash else null end,nullif(trim(p_payload->>'notes'),''),jsonb_build_object('entry_type',fe.entry_type,'document_type',fe.document_type,'manual_receivable',v_manual));
  if v_method='store_credit' then
    insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(v.tenant_id,fe.company_id,fe.branch_id,fe.customer_id,'debit',v_amount,'financial_settlement',v_settlement,fe.sale_id,'Uso de crédito da loja na quitação de '||fe.description,jsonb_build_object('financial_entry_id',fe.id)) on conflict(tenant_id,source_kind,source_id) do nothing;
  elsif v_destination='cash_session' then
    insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,notes,financial_entry_id,payment_method) values(v.tenant_id,v_cash,case when fe.entry_type='receivable' then 'receivable' else 'expense' end,v_amount,'Liquidação financeira: '||fe.description,fe.id,'cash') returning id into v_cm;
    v_internal:=private.ensure_internal_cash_account(v.tenant_id,fe.company_id,fe.branch_id);
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,v_internal,v_settled_at::date,fe.description,v_amount,case when fe.entry_type='receivable' then 'credit' else 'debit' end,true,fe.id,v_cash,'cash','financial_settlement',v_settlement,'Liquidação vinculada ao caixa do dia.') returning id into v_bank_tx;
  else
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,v_account,v_settled_at::date,fe.description,v_amount,case when fe.entry_type='receivable' then 'credit' else 'debit' end,case when ba.account_type='internal_cash' then true else false end,fe.id,v_method,'financial_settlement',v_settlement,case when ba.account_type='bank' then 'Lançamento previsto; aguarda conciliação com extrato bancário.' else 'Liquidação no Caixa Interno; não altera o fechamento do PDV.' end) returning id into v_bank_tx;
  end if;
  update public.financial_settlements set bank_transaction_id=v_bank_tx where id=v_settlement;
  update public.financial_entries set paid_amount=least(amount,paid_amount+v_amount),status=case when paid_amount+v_amount>=amount-0.001 then 'paid' else 'partial' end,paid_at=case when paid_amount+v_amount>=amount-0.001 then v_settled_at else paid_at end,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method',v_method,'last_destination_type',v_destination,'last_settlement_id',v_settlement) where id=fe.id;
  return jsonb_build_object('ok',true,'settlement_id',v_settlement,'amount',v_amount,'remaining',greatest(v_remaining-v_amount,0),'status',case when v_remaining-v_amount<=0.001 then 'paid' else 'partial' end,'bank_transaction_id',v_bank_tx,'reconciliation_pending',coalesce(ba.account_type='bank',false) and v_destination='bank_account','destination_account_type',ba.account_type);
end $$;

create or replace function public.erp_term_receivable_detail(p_token text,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; fe public.financial_entries%rowtype; s public.sales%rowtype; v_manual boolean:=false; v_title jsonb; v_operation jsonb; v_products jsonb:='[]'::jsonb; v_nfce jsonb:=jsonb_build_object('has_nfce',false); v_receipts jsonb; v_received numeric:=0; v_ever_received boolean:=false; v_active_received boolean:=false; v_method text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id; if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  v_manual:=fe.metadata->>'origin'='manual_receivable'; if fe.sale_id is not null then select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id; end if;
  v_method:=coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),''));
  if fe.entry_type<>'receivable' or v_method not in ('boleto','crediario') or not (v_manual or (s.id is not null and (fe.metadata->>'origin'='sale_term' or s.payment_condition='term'))) then return jsonb_build_object('ok',false,'error','term_receivable_only'); end if;
  select jsonb_build_object('id',fe.id,'status',case when fe.status in ('open','partial') and fe.due_date<current_date then 'overdue' else fe.status end,'description',fe.description,'issued_at',fe.issued_at,'due_date',fe.due_date,'paid_at',fe.paid_at,'amount',fe.amount,'paid_amount',fe.paid_amount,'remaining',case when fe.status='cancelled' then 0 else greatest(fe.amount-fe.paid_amount,0) end,'document_type',v_method,'installment',nullif(fe.metadata->>'installment','')::int,'installments',nullif(fe.metadata->>'installments','')::int,'customer_id',fe.customer_id,'customer',coalesce(c.name,'Cliente não identificado'),'customer_document',c.document,'origin',fe.metadata->>'origin','reference',fe.metadata->>'reference','notes',fe.metadata->>'notes','reversal_reason',fe.metadata->>'reversal_reason','reversed_at',nullif(fe.metadata->>'reversed_at','')) into v_title from public.customers c where c.id=fe.customer_id;
  if v_title is null then v_title:=jsonb_build_object('id',fe.id,'status',fe.status,'description',fe.description,'amount',fe.amount,'remaining',greatest(fe.amount-fe.paid_amount,0),'document_type',v_method,'customer','Cliente não identificado','origin',fe.metadata->>'origin'); end if;
  if v_manual then v_operation:=jsonb_build_object('manual',true,'number',null,'operation_at',fe.created_at,'total',fe.amount,'operator','Lançamento manual','origin','Contas a Receber');
  else
    select jsonb_build_object('manual',false,'sale_id',s.id,'number',s.number,'channel',s.channel,'status',s.status,'created_at',s.created_at,'completed_at',s.completed_at,'operation_at',coalesce(s.completed_at,s.created_at),'subtotal',s.subtotal,'discount',s.discount,'surcharge',s.surcharge,'total',s.total,'payment_condition',s.payment_condition,'term_method',s.term_method,'term_installments',s.term_installments,'operator',su.name,'consumer_document',s.consumer_document) into v_operation from public.sales x left join public.staff_users su on su.id=s.staff_user_id where x.id=s.id;
    select coalesce(jsonb_agg(jsonb_build_object('id',si.id,'product_id',si.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total) order by si.created_at),'[]'::jsonb) into v_products from public.sale_items si where si.sale_id=s.id;
    select jsonb_build_object('has_nfce',true,'id',fd.id,'status',fd.status,'series',fd.series,'number',fd.number,'access_key',fd.access_key,'protocol',fd.protocol,'authorization_at',fd.authorization_at,'cancellation_at',fd.cancellation_at,'rejection_code',fd.rejection_code,'rejection_message',fd.rejection_message) into v_nfce from public.fiscal_documents fd where fd.sale_id=s.id and fd.document_type='nfce' order by fd.created_at desc limit 1; if v_nfce is null then v_nfce:=jsonb_build_object('has_nfce',false); end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',fs.id,'status',fs.status,'amount',fs.amount,'settled_at',fs.settled_at,'payment_method',fs.payment_method,'destination_type',fs.destination_type,'account_id',fs.bank_account_id,'account',ba.name,'account_type',ba.account_type,'notes',fs.notes,'reversed_at',fs.reversed_at,'reversal_reason',fs.reversal_reason) order by fs.settled_at desc),'[]'::jsonb),coalesce(sum(fs.amount) filter(where fs.status='active'),0),count(*)>0,count(*) filter(where fs.status='active')>0 into v_receipts,v_received,v_ever_received,v_active_received from public.financial_settlements fs left join public.bank_accounts ba on ba.id=fs.bank_account_id where fs.financial_entry_id=fe.id;
  return jsonb_build_object('ok',true,'title',v_title,'operation',v_operation,'products',v_products,'nfce',v_nfce,'receipts',v_receipts,'receipt_summary',jsonb_build_object('ever_received',v_ever_received,'active_received',v_active_received,'active_total',v_received,'remaining',case when fe.status='cancelled' then 0 else greatest(fe.amount-fe.paid_amount,0) end));
end $$;

create or replace function public.erp_term_receivable_reverse(p_token text,p_entry_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; fe public.financial_entries%rowtype; s public.sales%rowtype; fs record; bt public.bank_transactions%rowtype; ba public.bank_accounts%rowtype; v_reversal_tx uuid; v_reversed_count int:=0; v_reversed_total numeric:=0; v_manual boolean:=false; v_method text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'error','reversal_reason_required'); end if;
  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id for update; if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  v_manual:=fe.metadata->>'origin'='manual_receivable'; if fe.sale_id is not null then select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id; end if;
  v_method:=coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),''));
  if fe.entry_type<>'receivable' or v_method not in ('boleto','crediario') or not (v_manual or (s.id is not null and (fe.metadata->>'origin'='sale_term' or s.payment_condition='term'))) then return jsonb_build_object('ok',false,'error','term_receivable_only'); end if;
  if fe.status='cancelled' then return jsonb_build_object('ok',true,'idempotent',true,'entry_id',fe.id); end if;
  if exists(select 1 from public.financial_settlements x where x.financial_entry_id=fe.id and x.status='active' and x.destination_type<>'bank_account') then return jsonb_build_object('ok',false,'error','legacy_settlement_requires_manual_reversal'); end if;
  for fs in select * from public.financial_settlements where financial_entry_id=fe.id and status='active' order by settled_at for update loop
    if fs.bank_transaction_id is not null then select * into bt from public.bank_transactions where id=fs.bank_transaction_id and tenant_id=v.tenant_id; if bt.id is null then return jsonb_build_object('ok',false,'error','settlement_ledger_missing'); end if; select * into ba from public.bank_accounts where id=bt.bank_account_id;
      insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,bt.bank_account_id,current_date,'Estorno: '||fe.description,bt.amount,case when bt.direction='credit' then 'debit' else 'credit' end,case when ba.account_type='internal_cash' then true else false end,fe.id,fs.payment_method,'financial_settlement_reversal',fs.id,'Estorno financeiro do recebimento. Motivo: '||trim(p_reason)) on conflict do nothing returning id into v_reversal_tx;
      if v_reversal_tx is null then select id into v_reversal_tx from public.bank_transactions where tenant_id=v.tenant_id and origin_type='financial_settlement_reversal' and origin_id=fs.id limit 1; end if;
    end if;
    update public.financial_settlements set status='reversed',reversed_at=now(),reversed_by=v.user_id,reversal_reason=trim(p_reason),reversal_bank_transaction_id=v_reversal_tx,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reversed_at',now(),'reversal_reason',trim(p_reason)) where id=fs.id;
    v_reversed_count:=v_reversed_count+1; v_reversed_total:=v_reversed_total+fs.amount; v_reversal_tx:=null;
  end loop;
  update public.financial_entries set status='cancelled',paid_amount=0,paid_at=null,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reversed_by','gestao','reversed_at',now(),'reversal_reason',trim(p_reason),'reversed_receipts',v_reversed_count,'reversed_total',v_reversed_total) where id=fe.id;
  return jsonb_build_object('ok',true,'entry_id',fe.id,'status','cancelled','reversed_receipts',v_reversed_count,'reversed_total',v_reversed_total,'fiscal_untouched',true,'sale_untouched',true,'manual',v_manual);
end $$;
