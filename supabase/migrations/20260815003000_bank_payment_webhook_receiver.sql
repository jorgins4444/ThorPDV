-- ThorGestao / Banking Webhook
-- Receptor genérico de eventos bancários de liquidação.
-- O webhook registra o envelope recebido, identifica a cobrança e reutiliza
-- private.process_bank_billing_payment_event, evitando uma segunda regra de baixa.

create table if not exists public.bank_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('sandbox','production')),
  event_id text not null,
  event_type text not null,
  source text not null default 'webhook' check (source in ('webhook','simulation')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  billing_id uuid references public.bank_billings(id) on delete set null,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  our_number text,
  external_id text,
  pix_txid text,
  correlation_id text,
  payment_channel text,
  paid_amount numeric(14,2),
  paid_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received','processing','processed','ignored','unmatched','failed')),
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  processing_result jsonb not null default '{}'::jsonb,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,environment,event_id)
);

create index if not exists bank_webhook_events_billing_idx
  on public.bank_webhook_events(billing_id,received_at desc);
create index if not exists bank_webhook_events_financial_idx
  on public.bank_webhook_events(financial_entry_id,received_at desc);
create index if not exists bank_webhook_events_reference_idx
  on public.bank_webhook_events(provider,environment,our_number,external_id,pix_txid);

alter table public.bank_webhook_events enable row level security;
revoke all on public.bank_webhook_events from anon, authenticated;

create or replace function private.process_bank_payment_event(
  p_provider text,
  p_environment text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_normalized jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_event public.bank_webhook_events%rowtype;
  v_billing public.bank_billings%rowtype;
  v_event_uuid uuid;
  v_billing_id uuid;
  v_match_count integer:=0;
  v_status text:=lower(coalesce(nullif(p_normalized->>'payment_status',''),p_event_type,''));
  v_source text:=case when coalesce(p_normalized->>'source','webhook')='simulation' then 'simulation' else 'webhook' end;
  v_our_number text:=nullif(trim(coalesce(p_normalized->>'our_number','')),'');
  v_external_id text:=nullif(trim(coalesce(p_normalized->>'external_id','')),'');
  v_pix_txid text:=nullif(trim(coalesce(p_normalized->>'pix_txid','')),'');
  v_correlation text:=nullif(trim(coalesce(p_normalized->>'correlation_id','')),'');
  v_payment_channel text:=lower(coalesce(nullif(p_normalized->>'payment_channel',''),'boleto'));
  v_paid_amount numeric;
  v_paid_at timestamptz;
  v_result jsonb;
begin
  if nullif(trim(coalesce(p_provider,'')),'') is null
     or p_environment not in ('sandbox','production')
     or nullif(trim(coalesce(p_event_id,'')),'') is null then
    return jsonb_build_object('ok',false,'error','invalid_webhook_event');
  end if;

  begin v_paid_amount:=nullif(p_normalized->>'amount','')::numeric; exception when others then v_paid_amount:=null; end;
  begin v_paid_at:=nullif(p_normalized->>'paid_at','')::timestamptz; exception when others then v_paid_at:=null; end;
  v_paid_at:=coalesce(v_paid_at,now());

  insert into public.bank_webhook_events(
    provider,environment,event_id,event_type,source,our_number,external_id,pix_txid,
    correlation_id,payment_channel,paid_amount,paid_at,raw_payload,normalized_payload
  ) values(
    lower(p_provider),p_environment,p_event_id,coalesce(nullif(p_event_type,''),'unknown'),v_source,
    v_our_number,v_external_id,v_pix_txid,v_correlation,v_payment_channel,v_paid_amount,v_paid_at,
    coalesce(p_payload,'{}'::jsonb),coalesce(p_normalized,'{}'::jsonb)
  )
  on conflict(provider,environment,event_id) do nothing
  returning id into v_event_uuid;

  if v_event_uuid is null then
    select * into v_event
      from public.bank_webhook_events
     where provider=lower(p_provider) and environment=p_environment and event_id=p_event_id
     for update;
    if v_event.processing_status in ('processed','ignored') then
      return coalesce(v_event.processing_result,'{}'::jsonb)
        || jsonb_build_object('ok',true,'duplicate',true,'webhook_event_id',v_event.id);
    end if;
    v_event_uuid:=v_event.id;
    update public.bank_webhook_events
       set event_type=coalesce(nullif(p_event_type,''),event_type),source=v_source,
           our_number=coalesce(v_our_number,our_number),external_id=coalesce(v_external_id,external_id),
           pix_txid=coalesce(v_pix_txid,pix_txid),correlation_id=coalesce(v_correlation,correlation_id),
           payment_channel=coalesce(v_payment_channel,payment_channel),paid_amount=coalesce(v_paid_amount,paid_amount),
           paid_at=coalesce(v_paid_at,paid_at),raw_payload=coalesce(p_payload,raw_payload),
           normalized_payload=coalesce(p_normalized,normalized_payload),processing_status='received',
           error_code=null,updated_at=now()
     where id=v_event_uuid;
  end if;

  if v_status !~ '(paid|pago|liquid|settled|quitad|compensad)' then
    v_result:=jsonb_build_object('ok',true,'ignored',true,'reason','event_not_payment_settlement','webhook_event_id',v_event_uuid);
    update public.bank_webhook_events
       set processing_status='ignored',processing_result=v_result,processed_at=now(),updated_at=now()
     where id=v_event_uuid;
    return v_result;
  end if;

  begin v_billing_id:=nullif(p_normalized->>'billing_id','')::uuid;
  exception when invalid_text_representation then v_billing_id:=null; end;

  if v_billing_id is not null then
    select count(*) into v_match_count
      from public.bank_billings
     where id=v_billing_id and provider=lower(p_provider) and environment=p_environment;
    if v_match_count=1 then
      select * into v_billing from public.bank_billings where id=v_billing_id;
    end if;
  end if;

  if v_billing.id is null and v_external_id is not null then
    select count(*) into v_match_count
      from public.bank_billings
     where provider=lower(p_provider) and environment=p_environment
       and external_id=v_external_id and status<>'cancelled';
    if v_match_count=1 then
      select * into v_billing
        from public.bank_billings
       where provider=lower(p_provider) and environment=p_environment
         and external_id=v_external_id and status<>'cancelled';
    end if;
  end if;

  if v_billing.id is null and v_pix_txid is not null then
    select count(*) into v_match_count
      from public.bank_billings
     where provider=lower(p_provider) and environment=p_environment
       and pix_txid=v_pix_txid and status<>'cancelled';
    if v_match_count=1 then
      select * into v_billing
        from public.bank_billings
       where provider=lower(p_provider) and environment=p_environment
         and pix_txid=v_pix_txid and status<>'cancelled';
    end if;
  end if;

  if v_billing.id is null and v_our_number is not null then
    select count(*) into v_match_count
      from public.bank_billings
     where provider=lower(p_provider) and environment=p_environment
       and our_number=v_our_number and status in ('issued','processing','simulated','paid')
       and (v_paid_amount is null or abs(amount-v_paid_amount)<0.01);
    if v_match_count=1 then
      select * into v_billing
        from public.bank_billings
       where provider=lower(p_provider) and environment=p_environment
         and our_number=v_our_number and status in ('issued','processing','simulated','paid')
         and (v_paid_amount is null or abs(amount-v_paid_amount)<0.01);
    end if;
  end if;

  if v_billing.id is null then
    v_result:=jsonb_build_object(
      'ok',false,
      'error',case when v_match_count>1 then 'ambiguous_bank_billing' else 'bank_billing_not_found' end,
      'matches',v_match_count,'webhook_event_id',v_event_uuid
    );
    update public.bank_webhook_events
       set processing_status='unmatched',processing_result=v_result,error_code=v_result->>'error',
           processed_at=now(),updated_at=now()
     where id=v_event_uuid;
    return v_result;
  end if;

  update public.bank_webhook_events
     set tenant_id=v_billing.tenant_id,bank_account_id=v_billing.bank_account_id,billing_id=v_billing.id,
         financial_entry_id=v_billing.financial_entry_id,processing_status='processing',updated_at=now()
   where id=v_event_uuid;

  v_result:=private.process_bank_billing_payment_event(
    lower(p_provider),p_event_id,v_billing.id,v_paid_amount,v_paid_at,v_source,
    coalesce(p_payload,'{}'::jsonb)
      || jsonb_build_object('normalized',coalesce(p_normalized,'{}'::jsonb),'webhook_event_id',v_event_uuid)
  );

  if coalesce((v_result->>'ok')::boolean,false) then
    update public.bank_webhook_events
       set processing_status='processed',tenant_id=v_billing.tenant_id,bank_account_id=v_billing.bank_account_id,
           billing_id=v_billing.id,financial_entry_id=v_billing.financial_entry_id,
           paid_amount=coalesce(v_paid_amount,paid_amount),paid_at=coalesce(v_paid_at,paid_at),
           processing_result=v_result||jsonb_build_object('webhook_event_id',v_event_uuid),
           error_code=null,processed_at=now(),updated_at=now()
     where id=v_event_uuid;
    return v_result||jsonb_build_object('webhook_event_id',v_event_uuid,'source',v_source);
  end if;

  update public.bank_webhook_events
     set processing_status='failed',processing_result=v_result||jsonb_build_object('webhook_event_id',v_event_uuid),
         error_code=coalesce(v_result->>'error','bank_payment_processing_failed'),processed_at=now(),updated_at=now()
   where id=v_event_uuid;
  return v_result||jsonb_build_object('webhook_event_id',v_event_uuid,'source',v_source);
exception when others then
  if v_event_uuid is not null then
    update public.bank_webhook_events
       set processing_status='failed',error_code='webhook_processing_exception',
           processing_result=jsonb_build_object('ok',false,'error','webhook_processing_exception','detail',sqlerrm),
           processed_at=now(),updated_at=now()
     where id=v_event_uuid;
  end if;
  return jsonb_build_object('ok',false,'error','webhook_processing_exception','detail',sqlerrm,'webhook_event_id',v_event_uuid);
end $$;

revoke all on function private.process_bank_payment_event(text,text,text,text,jsonb,jsonb) from public;

create or replace function public.bank_webhook_receive(
  p_provider text,
  p_environment text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_normalized jsonb
) returns jsonb
language sql
security definer
set search_path = public, private, extensions
as $$
  select private.process_bank_payment_event(
    p_provider,p_environment,p_event_id,p_event_type,p_payload,p_normalized
  );
$$;

revoke all on function public.bank_webhook_receive(text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.bank_webhook_receive(text,text,text,text,jsonb,jsonb)
  to service_role;

create or replace function public.erp_bank_webhook_events_list(p_token text,p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare v record;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  return jsonb_build_object('ok',true,'events',coalesce((
    select jsonb_agg(to_jsonb(x) order by x.received_at desc)
      from (
        select e.id,e.provider,e.environment,e.event_id,e.event_type,e.source,e.processing_status,
               e.billing_id,e.financial_entry_id,e.our_number,e.external_id,e.pix_txid,e.payment_channel,
               e.paid_amount,e.paid_at,e.error_code,e.received_at,e.processed_at,e.processing_result
          from public.bank_webhook_events e
         where e.tenant_id=v.tenant_id
         order by e.received_at desc
         limit greatest(1,least(coalesce(p_limit,50),200))
      ) x
  ),'[]'::jsonb));
end $$;

revoke all on function public.erp_bank_webhook_events_list(text,integer) from public;
grant execute on function public.erp_bank_webhook_events_list(text,integer)
  to anon, authenticated, service_role;

-- O simulador Sandbox usa o MESMO pipeline do webhook externo.
create or replace function public.erp_itau_boleto_simulate_payment(p_token text,p_billing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v record;
  b public.bank_billings%rowtype;
  fe public.financial_entries%rowtype;
  v_remaining numeric;
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

  select * into fe from public.financial_entries
   where id=b.financial_entry_id and tenant_id=v.tenant_id for update;
  if fe.id is null then return jsonb_build_object('ok',false,'error','receivable_not_found'); end if;
  v_remaining:=greatest(fe.amount-fe.paid_amount,0);
  v_event_id:='sandbox-webhook-liquidation:'||b.id::text;

  return private.process_bank_payment_event(
    'itau','sandbox',v_event_id,'LIQUIDACAO',
    jsonb_build_object(
      'simulated',true,'event','LIQUIDACAO','occurrence_code','06','billing_id',b.id,
      'our_number',b.our_number,'external_id',b.external_id,'pix_txid',b.pix_txid,
      'financial_entry_id',fe.id,'amount',v_remaining,'paid_at',v_paid_at,'simulated_by',v.user_id
    ),
    jsonb_build_object(
      'source','simulation','payment_status','liquidado','payment_channel','boleto',
      'billing_id',b.id,'our_number',b.our_number,'external_id',b.external_id,'pix_txid',b.pix_txid,
      'amount',v_remaining,'paid_at',v_paid_at
    )
  );
end $$;

-- Remove o nome genérico temporário caso tenha sido criado durante homologação.
drop function if exists public.erp_bank_billing_simulate_paid(text,uuid,numeric,timestamptz);
