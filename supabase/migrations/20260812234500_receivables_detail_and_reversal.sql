-- ThorGestão / Contas a Receber
-- Detalhes completos do título e estorno financeiro auditável.

alter table public.financial_settlements
  add column if not exists status text not null default 'active',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text,
  add column if not exists reversal_bank_transaction_id uuid references public.bank_transactions(id) on delete set null;

do $$ begin
  alter table public.financial_settlements
    add constraint financial_settlements_status_check check (status in ('active','reversed'));
exception when duplicate_object then null; end $$;

create unique index if not exists bank_transactions_financial_settlement_reversal_uidx
  on public.bank_transactions(tenant_id,origin_type,origin_id)
  where origin_type='financial_settlement_reversal' and origin_id is not null;

create or replace function public.erp_receivables_list(p_token text,p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  v_data jsonb;
  v_issued_from date:=nullif(p_filters->>'issued_from','')::date;
  v_issued_to date:=nullif(p_filters->>'issued_to','')::date;
  v_doc text:=nullif(lower(trim(p_filters->>'document_type')),'');
  v_customer uuid:=nullif(p_filters->>'customer_id','')::uuid;
  v_due_from date:=nullif(p_filters->>'due_from','')::date;
  v_due_to date:=nullif(p_filters->>'due_to','')::date;
  v_paid_from date:=nullif(p_filters->>'paid_from','')::date;
  v_paid_to date:=nullif(p_filters->>'paid_to','')::date;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.issued_at desc,x.due_date desc nulls last,x.created_at desc),'[]'::jsonb)
  into v_data
  from (
    select
      f.id,
      f.issued_at,
      coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) as document_type,
      f.status,
      f.description,
      f.amount,
      f.paid_amount,
      case when f.status='cancelled' then 0 else greatest(f.amount-f.paid_amount,0) end remaining,
      f.due_date,
      f.paid_at,
      f.customer_id,
      c.name customer,
      f.sale_id,
      s.number sale_number,
      coalesce(s.completed_at,s.created_at) operation_at,
      f.created_at,
      nullif(f.metadata->>'installment','')::int installment,
      nullif(f.metadata->>'installments','')::int installments,
      coalesce((select count(*) from public.financial_settlements fs where fs.financial_entry_id=f.id and fs.status='active'),0) settlements_count,
      coalesce((select sum(fs.amount) from public.financial_settlements fs where fs.financial_entry_id=f.id and fs.status='active'),0) received_total,
      exists(select 1 from public.fiscal_documents fd where fd.sale_id=f.sale_id and fd.document_type='nfce') has_nfce
    from public.financial_entries f
    left join public.customers c on c.id=f.customer_id
    left join public.sales s on s.id=f.sale_id
    where f.tenant_id=v.tenant_id
      and f.entry_type='receivable'
      and f.sale_id is not null
      and (f.metadata->>'origin'='sale_term' or s.payment_condition='term')
      and coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) in ('boleto','crediario')
      and (v_issued_from is null or f.issued_at>=v_issued_from)
      and (v_issued_to is null or f.issued_at<=v_issued_to)
      and (v_doc is null or coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),''))=v_doc)
      and (v_customer is null or f.customer_id=v_customer)
      and (v_due_from is null or f.due_date>=v_due_from)
      and (v_due_to is null or f.due_date<=v_due_to)
      and (v_paid_from is null or f.paid_at::date>=v_paid_from)
      and (v_paid_to is null or f.paid_at::date<=v_paid_to)
    limit 1000
  ) x;

  return jsonb_build_object('ok',true,'data',v_data);
end $$;

grant execute on function public.erp_receivables_list(text,jsonb) to anon,authenticated,service_role;

create or replace function public.erp_term_receivable_detail(p_token text,p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  fe public.financial_entries%rowtype;
  s public.sales%rowtype;
  v_title jsonb;
  v_operation jsonb;
  v_products jsonb;
  v_nfce jsonb;
  v_receipts jsonb;
  v_received numeric:=0;
  v_ever_received boolean:=false;
  v_active_received boolean:=false;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id;
  if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;

  select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id;
  if s.id is null or fe.entry_type<>'receivable'
     or not (fe.metadata->>'origin'='sale_term' or s.payment_condition='term')
     or coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),'')) not in ('boleto','crediario') then
    return jsonb_build_object('ok',false,'error','term_receivable_only');
  end if;

  select jsonb_build_object(
    'id',fe.id,'status',fe.status,'description',fe.description,'issued_at',fe.issued_at,
    'due_date',fe.due_date,'paid_at',fe.paid_at,'amount',fe.amount,'paid_amount',fe.paid_amount,
    'remaining',case when fe.status='cancelled' then 0 else greatest(fe.amount-fe.paid_amount,0) end,
    'document_type',coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),lower(fe.document_type)),
    'installment',nullif(fe.metadata->>'installment','')::int,
    'installments',nullif(fe.metadata->>'installments','')::int,
    'customer_id',fe.customer_id,'customer',c.name,'customer_document',c.document,
    'reversal_reason',fe.metadata->>'reversal_reason','reversed_at',nullif(fe.metadata->>'reversed_at','')
  ) into v_title
  from public.customers c where c.id=fe.customer_id;

  if v_title is null then
    v_title:=jsonb_build_object(
      'id',fe.id,'status',fe.status,'description',fe.description,'issued_at',fe.issued_at,
      'due_date',fe.due_date,'paid_at',fe.paid_at,'amount',fe.amount,'paid_amount',fe.paid_amount,
      'remaining',case when fe.status='cancelled' then 0 else greatest(fe.amount-fe.paid_amount,0) end,
      'document_type',coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),lower(fe.document_type)),
      'installment',nullif(fe.metadata->>'installment','')::int,
      'installments',nullif(fe.metadata->>'installments','')::int,
      'customer_id',fe.customer_id,'customer','Cliente não identificado'
    );
  end if;

  select jsonb_build_object(
    'sale_id',s.id,'number',s.number,'channel',s.channel,'status',s.status,
    'created_at',s.created_at,'completed_at',s.completed_at,'operation_at',coalesce(s.completed_at,s.created_at),
    'subtotal',s.subtotal,'discount',s.discount,'surcharge',s.surcharge,'total',s.total,
    'payment_condition',s.payment_condition,'term_method',s.term_method,'term_installments',s.term_installments,
    'operator',su.name,'consumer_document',s.consumer_document
  ) into v_operation
  from public.sales x
  left join public.staff_users su on su.id=s.staff_user_id
  where x.id=s.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',si.id,'product_id',si.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,
    'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total
  ) order by si.created_at),'[]'::jsonb)
  into v_products
  from public.sale_items si where si.sale_id=s.id;

  select jsonb_build_object(
    'has_nfce',true,'id',fd.id,'status',fd.status,'series',fd.series,'number',fd.number,
    'access_key',fd.access_key,'protocol',fd.protocol,'authorization_at',fd.authorization_at,
    'cancellation_at',fd.cancellation_at,'rejection_code',fd.rejection_code,'rejection_message',fd.rejection_message
  ) into v_nfce
  from public.fiscal_documents fd
  where fd.sale_id=s.id and fd.document_type='nfce'
  order by fd.created_at desc limit 1;
  if v_nfce is null then v_nfce:=jsonb_build_object('has_nfce',false); end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',fs.id,'status',fs.status,'amount',fs.amount,'settled_at',fs.settled_at,
      'payment_method',fs.payment_method,'destination_type',fs.destination_type,
      'account_id',fs.bank_account_id,'account',ba.name,'account_type',ba.account_type,
      'notes',fs.notes,'reversed_at',fs.reversed_at,'reversal_reason',fs.reversal_reason
    ) order by fs.settled_at desc),'[]'::jsonb),
    coalesce(sum(fs.amount) filter(where fs.status='active'),0),
    count(*)>0,
    count(*) filter(where fs.status='active')>0
  into v_receipts,v_received,v_ever_received,v_active_received
  from public.financial_settlements fs
  left join public.bank_accounts ba on ba.id=fs.bank_account_id
  where fs.financial_entry_id=fe.id;

  return jsonb_build_object(
    'ok',true,
    'title',v_title,
    'operation',v_operation,
    'products',v_products,
    'nfce',v_nfce,
    'receipts',v_receipts,
    'receipt_summary',jsonb_build_object(
      'ever_received',v_ever_received,
      'active_received',v_active_received,
      'active_total',v_received,
      'remaining',case when fe.status='cancelled' then 0 else greatest(fe.amount-fe.paid_amount,0) end
    )
  );
end $$;

grant execute on function public.erp_term_receivable_detail(text,uuid) to anon,authenticated,service_role;

create or replace function public.erp_term_receivable_reverse(p_token text,p_entry_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  fe public.financial_entries%rowtype;
  s public.sales%rowtype;
  fs record;
  bt public.bank_transactions%rowtype;
  ba public.bank_accounts%rowtype;
  v_reversal_tx uuid;
  v_reversed_count int:=0;
  v_reversed_total numeric:=0;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if length(trim(coalesce(p_reason,'')))<3 then return jsonb_build_object('ok',false,'error','reversal_reason_required'); end if;

  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id for update;
  if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  select * into s from public.sales where id=fe.sale_id and tenant_id=v.tenant_id;

  if fe.entry_type<>'receivable' or s.id is null
     or not (fe.metadata->>'origin'='sale_term' or s.payment_condition='term')
     or coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),'')) not in ('boleto','crediario') then
    return jsonb_build_object('ok',false,'error','term_receivable_only');
  end if;

  if fe.status='cancelled' then return jsonb_build_object('ok',true,'idempotent',true,'entry_id',fe.id); end if;

  if exists(select 1 from public.financial_settlements x where x.financial_entry_id=fe.id and x.status='active' and x.destination_type<>'bank_account') then
    return jsonb_build_object('ok',false,'error','legacy_settlement_requires_manual_reversal');
  end if;

  for fs in
    select * from public.financial_settlements
    where financial_entry_id=fe.id and status='active'
    order by settled_at
    for update
  loop
    if fs.bank_transaction_id is not null then
      select * into bt from public.bank_transactions where id=fs.bank_transaction_id and tenant_id=v.tenant_id;
      if bt.id is null then return jsonb_build_object('ok',false,'error','settlement_ledger_missing'); end if;
      select * into ba from public.bank_accounts where id=bt.bank_account_id;

      insert into public.bank_transactions(
        tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,
        financial_entry_id,payment_method,origin_type,origin_id,notes
      ) values(
        v.tenant_id,bt.bank_account_id,current_date,
        'Estorno: '||fe.description,bt.amount,
        case when bt.direction='credit' then 'debit' else 'credit' end,
        case when ba.account_type='internal_cash' then true else false end,
        fe.id,fs.payment_method,'financial_settlement_reversal',fs.id,
        'Estorno financeiro do recebimento. Motivo: '||trim(p_reason)
      ) on conflict do nothing
      returning id into v_reversal_tx;

      if v_reversal_tx is null then
        select id into v_reversal_tx from public.bank_transactions
        where tenant_id=v.tenant_id and origin_type='financial_settlement_reversal' and origin_id=fs.id
        limit 1;
      end if;
    end if;

    update public.financial_settlements
    set status='reversed',reversed_at=now(),reversed_by=v.user_id,reversal_reason=trim(p_reason),
        reversal_bank_transaction_id=v_reversal_tx,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reversed_at',now(),'reversal_reason',trim(p_reason))
    where id=fs.id;

    v_reversed_count:=v_reversed_count+1;
    v_reversed_total:=v_reversed_total+fs.amount;
    v_reversal_tx:=null;
  end loop;

  update public.financial_entries
  set status='cancelled',paid_amount=0,paid_at=null,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'reversed_by','gestao','reversed_at',now(),'reversal_reason',trim(p_reason),
        'reversed_receipts',v_reversed_count,'reversed_total',v_reversed_total
      )
  where id=fe.id;

  return jsonb_build_object(
    'ok',true,'entry_id',fe.id,'status','cancelled',
    'reversed_receipts',v_reversed_count,'reversed_total',v_reversed_total,
    'fiscal_untouched',true,'sale_untouched',true
  );
end $$;

grant execute on function public.erp_term_receivable_reverse(text,uuid,text) to anon,authenticated,service_role;
