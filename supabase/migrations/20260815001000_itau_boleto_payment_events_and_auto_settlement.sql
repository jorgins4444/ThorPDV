-- ThorGestao / Itaú Boleto
-- Recebe eventos de liquidação de boleto de forma idempotente e executa a baixa automática.

create table if not exists public.bank_billing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_id uuid not null references public.bank_billings(id) on delete cascade,
  provider text not null,
  event_id text not null,
  event_type text not null,
  source text not null default 'webhook',
  status text not null default 'received',
  amount numeric(15,2),
  occurred_at timestamptz,
  processed_at timestamptz,
  financial_settlement_id uuid references public.financial_settlements(id) on delete set null,
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique(tenant_id,provider,event_id)
);

create index if not exists bank_billing_events_billing_idx on public.bank_billing_events(billing_id,created_at desc);
create index if not exists bank_billing_events_status_idx on public.bank_billing_events(tenant_id,status,created_at desc);
alter table public.bank_billing_events enable row level security;

do $$ begin
  alter table public.bank_billing_events add constraint bank_billing_events_status_check
    check(status in ('received','processed','ignored','failed'));
exception when duplicate_object then null; end $$;

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
set search_path=public,private,extensions
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
begin
  if nullif(trim(coalesce(p_provider,'')),'') is null or nullif(trim(coalesce(p_event_id,'')),'') is null then
    return jsonb_build_object('ok',false,'error','provider_and_event_id_required');
  end if;

  select * into b from public.bank_billings where id=p_billing_id for update;
  if b.id is null then return jsonb_build_object('ok',false,'error','billing_not_found'); end if;
  if lower(b.provider)<>lower(p_provider) then return jsonb_build_object('ok',false,'error','provider_mismatch'); end if;
  if b.financial_entry_id is null then return jsonb_build_object('ok',false,'error','billing_without_financial_entry'); end if;

  select * into ev from public.bank_billing_events
  where tenant_id=b.tenant_id and provider=lower(p_provider) and event_id=p_event_id limit 1;
  if ev.id is not null then
    return jsonb_build_object('ok',ev.status='processed','idempotent',true,'event_id',ev.id,'status',ev.status,
      'settlement_id',ev.financial_settlement_id,'bank_transaction_id',ev.bank_transaction_id);
  end if;

  insert into public.bank_billing_events(tenant_id,company_id,billing_id,provider,event_id,event_type,source,status,amount,occurred_at,payload)
  values(b.tenant_id,b.company_id,b.id,lower(p_provider),p_event_id,'payment_confirmed',coalesce(nullif(p_source,''),'webhook'),'received',p_amount,v_paid_at,coalesce(p_payload,'{}'::jsonb))
  returning * into ev;

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

  select * into ba from public.bank_accounts where id=b.bank_account_id and tenant_id=b.tenant_id and active=true for update;
  if ba.id is null or ba.account_type<>'bank' then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message='bank_account_not_found' where id=ev.id;
    return jsonb_build_object('ok',false,'error','bank_account_not_found','event_id',ev.id);
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
      ),
      updated_at=now()
  where id=b.id;

  update public.bank_billing_events
  set status='processed',processed_at=now(),amount=v_amount,financial_settlement_id=v_settlement,bank_transaction_id=v_bank_tx
  where id=ev.id;

  return jsonb_build_object('ok',true,'event_id',ev.id,'billing_id',b.id,'financial_entry_id',fe.id,
    'settlement_id',v_settlement,'bank_transaction_id',v_bank_tx,'amount',v_amount,
    'remaining',greatest(v_remaining-v_amount,0),'status',case when v_remaining-v_amount<=0.001 then 'paid' else 'partial' end);
exception when others then
  if ev.id is not null then
    update public.bank_billing_events set status='failed',processed_at=now(),error_message=left(sqlerrm,500) where id=ev.id;
  end if;
  return jsonb_build_object('ok',false,'error','bank_payment_processing_failed','detail',sqlerrm,'event_id',ev.id);
end $$;

-- Entrada destinada ao webhook real. Somente service_role pode executar.
create or replace function public.erp_bank_billing_payment_event(
  p_provider text,p_event_id text,p_billing_id uuid,p_amount numeric default null,
  p_paid_at timestamptz default now(),p_payload jsonb default '{}'::jsonb
) returns jsonb
language sql
security definer
set search_path=public,private,extensions
as $$
  select private.process_bank_billing_payment_event(p_provider,p_event_id,p_billing_id,p_amount,p_paid_at,'webhook',p_payload)
$$;

revoke all on function public.erp_bank_billing_payment_event(text,text,uuid,numeric,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.erp_bank_billing_payment_event(text,text,uuid,numeric,timestamptz,jsonb) to service_role;

-- Simulador autenticado, restrito ao sandbox Itaú.
create or replace function public.erp_itau_boleto_simulate_payment(p_token text,p_billing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  b public.bank_billings%rowtype;
  fe public.financial_entries%rowtype;
  v_remaining numeric;
  v_event_id text;
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

  select * into fe from public.financial_entries where id=b.financial_entry_id and tenant_id=v.tenant_id for update;
  if fe.id is null then return jsonb_build_object('ok',false,'error','receivable_not_found'); end if;
  v_remaining:=greatest(fe.amount-fe.paid_amount,0);
  v_event_id:='sandbox-liquidation:'||b.id::text;

  return private.process_bank_billing_payment_event('itau',v_event_id,b.id,v_remaining,now(),'sandbox_simulator',
    jsonb_build_object('simulated',true,'event','LIQUIDACAO','occurrence_code','06','billing_id',b.id,'financial_entry_id',fe.id,'amount',v_remaining));
end $$;

grant execute on function public.erp_itau_boleto_simulate_payment(text,uuid) to anon,authenticated,service_role;
