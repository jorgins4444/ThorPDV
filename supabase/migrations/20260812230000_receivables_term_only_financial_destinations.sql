-- ThorGestão Financeiro: Contas a Receber somente para Venda a Prazo.
-- O módulo passa a listar e liquidar exclusivamente títulos de Crediário/Boleto.

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
      coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) as term_method,
      f.status,
      f.description,
      f.amount,
      f.paid_amount,
      greatest(f.amount-f.paid_amount,0) remaining,
      f.due_date,
      f.paid_at,
      f.customer_id,
      c.name customer,
      f.sale_id,
      f.created_at,
      nullif(f.metadata->>'installment','')::int installment,
      nullif(f.metadata->>'installments','')::int installments,
      coalesce((select count(*) from public.financial_settlements fs where fs.financial_entry_id=f.id),0) settlements_count,
      (select fs.payment_method from public.financial_settlements fs where fs.financial_entry_id=f.id order by fs.settled_at desc limit 1) last_payment_method,
      (select fs.destination_type from public.financial_settlements fs where fs.financial_entry_id=f.id order by fs.settled_at desc limit 1) last_destination_type
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

create or replace function public.erp_term_receivable_settle(p_token text,p_entry_id uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  fe public.financial_entries%rowtype;
  s public.sales%rowtype;
  ba public.bank_accounts%rowtype;
  v_term_method text;
  v_destination text:=nullif(p_payload->>'destination_type','');
  v_account uuid:=nullif(p_payload->>'bank_account_id','')::uuid;
  v_payment_method text:=nullif(p_payload->>'payment_method','');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id limit 1;
  if fe.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;

  select * into s from public.sales where id=fe.sale_id limit 1;
  v_term_method:=coalesce(nullif(fe.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(fe.document_type),''));

  if fe.entry_type<>'receivable'
     or fe.sale_id is null
     or not (fe.metadata->>'origin'='sale_term' or s.payment_condition='term')
     or v_term_method not in ('boleto','crediario') then
    return jsonb_build_object('ok',false,'error','term_receivable_only');
  end if;

  if v_destination<>'bank_account' or v_account is null then
    return jsonb_build_object('ok',false,'error','financial_account_destination_required');
  end if;

  if v_payment_method='store_credit' then
    return jsonb_build_object('ok',false,'error','invalid_payment_method');
  end if;

  select * into ba
  from public.bank_accounts
  where id=v_account and tenant_id=v.tenant_id and active=true and account_type in ('bank','internal_cash')
  limit 1;
  if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;

  return public.erp_financial_settle(p_token,p_entry_id,p_payload || jsonb_build_object(
    'destination_type','bank_account',
    'bank_account_id',v_account,
    'cash_session_id',null
  ));
end $$;

grant execute on function public.erp_term_receivable_settle(text,uuid,jsonb) to anon,authenticated,service_role;
