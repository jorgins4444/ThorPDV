create or replace function private.pdv_process_sale(p_device_id uuid, p_tenant_id uuid, p_company_id uuid, p_branch_id uuid, p_pos_register_id uuid, p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  r jsonb;
  v_sale uuid;
  v_term jsonb:=coalesce(p_payload->'term','{}'::jsonb);
  v_is_term boolean:=coalesce(nullif(v_term->>'method',''),'') in ('boleto','crediario') or coalesce(v_term->>'payment_term_id','')<>'';
  v_customer uuid:=nullif(p_payload->>'customer_id','')::uuid;
  v_order uuid:=nullif(p_payload->>'sales_order_id','')::uuid;
  v_fin jsonb;
  v_paid numeric;
  v_total numeric;
begin
  if v_is_term and v_customer is null then return jsonb_build_object('ok',false,'error','term_sale_requires_customer'); end if;
  r:=private.pdv_process_sale_legacy_v070(p_device_id,p_tenant_id,p_company_id,p_branch_id,p_pos_register_id,p_event_id,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  v_sale:=(r->>'sale_id')::uuid;
  v_paid:=coalesce(nullif(r->>'paid','')::numeric,0);
  v_total:=coalesce(nullif(r->>'total','')::numeric,0);

  if v_is_term and v_paid<v_total-0.01 then
    v_fin:=private.create_term_receivables(v_sale,v_customer,v_paid,v_term,v_order);
    if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and tenant_id=p_tenant_id and customer_id=v_customer and status='open'; end if;
    return r||jsonb_build_object('financial_status','term','term',v_fin,'sales_order_id',v_order);
  end if;

  if not v_is_term and v_paid<v_total-0.01 then raise exception 'term_required_for_unpaid_balance'; end if;

  delete from public.financial_entries where sale_id=v_sale and entry_type='receivable';
  update public.sales set payment_condition='immediate',term_method=null,payment_term_id=null,term_installments=null,term_interest_percent=null,term_principal_amount=null,term_interest_amount=null,term_total_amount=null,sales_order_id=v_order where id=v_sale;
  if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and tenant_id=p_tenant_id and status='open'; end if;
  return r||jsonb_build_object('financial_status','not_applicable','sales_order_id',v_order,'term_ignored_because_fully_paid',v_is_term);
end $$;

create or replace function public.erp_create_sale(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  r jsonb;
  v_sale uuid;
  v_term jsonb:=coalesce(p_payload->'term','{}'::jsonb);
  v_is_term boolean:=coalesce(v_term->>'payment_term_id','')<>'';
  v_customer uuid:=nullif(p_payload->>'customer_id','')::uuid;
  v_order uuid:=nullif(p_payload->>'sales_order_id','')::uuid;
  v_fin jsonb;
  p jsonb;
  m text;
  brand text;
  acq text;
  inst int;
  v_paid numeric;
  v_total numeric;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_is_term and v_customer is null then return jsonb_build_object('ok',false,'error','term_sale_requires_customer'); end if;

  if v_is_term then
    if not exists(select 1 from public.sales_payment_terms t where t.id=(v_term->>'payment_term_id')::uuid and t.tenant_id=v.tenant_id and t.company_id=v.company_id and t.active=true) then
      return jsonb_build_object('ok',false,'error','payment_term_not_found_or_inactive');
    end if;
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    m:=lower(coalesce(nullif(p->>'method',''),'cash'));
    if not exists(select 1 from public.sales_payment_methods x where x.tenant_id=v.tenant_id and x.company_id=v.company_id and x.code=m and x.active=true and x.category<>'term') then
      return jsonb_build_object('ok',false,'error','payment_method_not_enabled','method',m);
    end if;
    if m in ('debit_card','credit_card') then
      brand:=nullif(p->>'card_brand_code','');
      acq:=coalesce(nullif(p->>'card_acquirer_cnpj',''),nullif(p->>'provider',''));
      if brand is null or not exists(select 1 from public.sales_card_brand_settings s where s.company_id=v.company_id and s.brand_code=brand and s.active=true) then
        return jsonb_build_object('ok',false,'error','card_brand_required_or_not_enabled');
      end if;
      if acq is null or not exists(select 1 from public.sales_card_acquirer_settings s where s.company_id=v.company_id and s.acquirer_cnpj=acq and s.active=true) then
        return jsonb_build_object('ok',false,'error','card_acquirer_required_or_not_enabled');
      end if;
      inst:=case when m='credit_card' then greatest(coalesce(nullif(p->>'card_installments','')::int,1),1) else 1 end;
      if m='credit_card' and (inst>12 or not exists(select 1 from public.sales_credit_installments s where s.company_id=v.company_id and s.installment_count=inst and s.active=true)) then
        return jsonb_build_object('ok',false,'error','credit_installment_not_enabled');
      end if;
    end if;
  end loop;

  r:=public.erp_create_sale_legacy_v070(p_token,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  v_sale:=(r->>'sale_id')::uuid;
  v_paid:=coalesce(nullif(r->>'paid','')::numeric,0);
  v_total:=coalesce(nullif(r->>'total','')::numeric,0);

  for p in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    m:=lower(coalesce(nullif(p->>'method',''),'cash'));
    if m in ('debit_card','credit_card') then
      brand:=nullif(p->>'card_brand_code','');
      acq:=coalesce(nullif(p->>'card_acquirer_cnpj',''),nullif(p->>'provider',''));
      inst:=case when m='credit_card' then greatest(coalesce(nullif(p->>'card_installments','')::int,1),1) else 1 end;
      update public.payments set provider=acq,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('card_brand_code',brand,'card_acquirer_cnpj',acq,'card_installments',inst)
      where id=(select id from public.payments where sale_id=v_sale and method=m order by created_at desc limit 1);
    end if;
  end loop;

  if v_is_term and v_paid<v_total-0.01 then
    v_fin:=private.create_term_receivables(v_sale,v_customer,v_paid,v_term,v_order);
    if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and customer_id=v_customer and status='open'; end if;
    return r||jsonb_build_object('financial_status','term','term',v_fin,'sales_order_id',v_order);
  end if;

  if not v_is_term and v_paid<v_total-0.01 then raise exception 'term_required_for_unpaid_balance'; end if;

  delete from public.financial_entries where sale_id=v_sale and entry_type='receivable';
  update public.sales set payment_condition='immediate',term_method=null,payment_term_id=null,term_installments=null,term_interest_percent=null,term_principal_amount=null,term_interest_amount=null,term_total_amount=null,sales_order_id=v_order where id=v_sale;
  if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and status='open'; end if;
  return r||jsonb_build_object('financial_status','not_applicable','sales_order_id',v_order,'term_ignored_because_fully_paid',v_is_term);
end $$;
