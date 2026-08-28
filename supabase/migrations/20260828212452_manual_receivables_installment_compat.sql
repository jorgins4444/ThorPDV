create or replace function public.erp_receivable_create(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_customer public.customers%rowtype;
  v_id uuid;
  v_first_id uuid;
  v_group_id uuid:=gen_random_uuid();
  v_ids jsonb:='[]'::jsonb;
  v_doc text;
  v_total_amount numeric;
  v_issued date;
  v_due date;
  v_first_due date;
  v_desc text;
  v_category uuid:=nullif(p_payload->>'financial_category_id','')::uuid;
  v_account uuid:=nullif(p_payload->>'chart_account_id','')::uuid;
  v_cc uuid:=nullif(p_payload->>'cost_center_id','')::uuid;
  v_schedule jsonb:=coalesce(p_payload->'payment_installments','[]'::jsonb);
  v_inst jsonb;
  v_inst_count int;
  v_inst_no int:=0;
  v_inst_number int;
  v_inst_total_label int;
  v_inst_amount numeric;
  v_inst_total numeric:=0;
  v_requested_installment int:=greatest(coalesce(nullif(p_payload->>'installment','')::int,1),1);
  v_requested_installments int;
  v_reference text:=nullif(trim(coalesce(p_payload->>'reference','')),'');
  v_notes text:=nullif(trim(coalesce(p_payload->>'notes','')),'');
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_offset int;
  v_target_month date;
  v_target_last_day int;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);

  v_doc:=lower(trim(coalesce(p_payload->>'document_type','')));
  if v_doc not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','invalid_document_type'); end if;
  v_total_amount:=round(coalesce(nullif(p_payload->>'amount','')::numeric,0),2);
  if v_total_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_amount'); end if;
  v_issued:=coalesce(nullif(p_payload->>'issued_at','')::date,current_date);
  v_desc:=trim(coalesce(p_payload->>'description',''));
  if length(v_desc)<3 then return jsonb_build_object('ok',false,'error','description_required'); end if;

  select * into v_customer
  from public.customers
  where id=nullif(p_payload->>'customer_id','')::uuid
    and tenant_id=v.tenant_id
    and active=true;
  if v_customer.id is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;

  if v_category is null then
    select id into v_category
    from public.financial_categories
    where tenant_id=v.tenant_id and company_id=v.company_id and code='SALES' and active
    order by created_at limit 1;
  end if;
  if not exists(
    select 1 from public.financial_categories
    where id=v_category and tenant_id=v.tenant_id and company_id=v.company_id and active and entry_type in ('receivable','both')
  ) then return jsonb_build_object('ok',false,'error','invalid_financial_category'); end if;
  if v_account is null then select default_chart_account_id into v_account from public.financial_categories where id=v_category; end if;
  if v_account is not null and not exists(
    select 1 from public.financial_chart_accounts
    where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and active and posting
  ) then return jsonb_build_object('ok',false,'error','invalid_chart_account'); end if;
  if v_cc is null then
    select id into v_cc from public.cost_centers
    where tenant_id=v.tenant_id and company_id=v.company_id and branch_id=v.branch_id and active
    order by is_default desc,created_at limit 1;
  end if;
  if v_cc is null then
    select id into v_cc from public.cost_centers
    where tenant_id=v.tenant_id and company_id=v.company_id and branch_id is null and active
    order by is_default desc,created_at limit 1;
  end if;
  if v_cc is not null and not exists(
    select 1 from public.cost_centers
    where id=v_cc and tenant_id=v.tenant_id and company_id=v.company_id and active
  ) then return jsonb_build_object('ok',false,'error','invalid_cost_center'); end if;

  if jsonb_typeof(v_schedule)<>'array' then return jsonb_build_object('ok',false,'error','invalid_payment_installments'); end if;
  v_inst_count:=jsonb_array_length(v_schedule);
  v_requested_installments:=greatest(coalesce(nullif(p_payload->>'installments','')::int,v_requested_installment),v_requested_installment);

  if v_inst_count=0 then
    v_first_due:=nullif(p_payload->>'due_date','')::date;
    if v_first_due is null then return jsonb_build_object('ok',false,'error','due_date_required'); end if;
    if v_requested_installments>60 then return jsonb_build_object('ok',false,'error','too_many_installments'); end if;

    if v_requested_installment=1 and v_requested_installments>1 then
      v_total_cents:=round(v_total_amount*100)::bigint;
      v_base_cents:=v_total_cents/v_requested_installments;
      v_remainder:=v_total_cents-(v_base_cents*v_requested_installments);
      v_schedule:='[]'::jsonb;
      for v_offset in 0..v_requested_installments-1 loop
        v_target_month:=(date_trunc('month',v_first_due)::date + make_interval(months=>v_offset))::date;
        v_target_last_day:=extract(day from (v_target_month + interval '1 month' - interval '1 day'))::int;
        v_due:=v_target_month + (least(extract(day from v_first_due)::int,v_target_last_day)-1);
        v_inst_amount:=(v_base_cents + case when v_offset<v_remainder then 1 else 0 end)::numeric/100;
        v_schedule:=v_schedule||jsonb_build_array(jsonb_build_object(
          'due_date',v_due,
          'amount',v_inst_amount,
          'installment_no',v_offset+1,
          'installment_total',v_requested_installments
        ));
      end loop;
      v_inst_count:=v_requested_installments;
    else
      v_schedule:=jsonb_build_array(jsonb_build_object(
        'due_date',v_first_due,
        'amount',v_total_amount,
        'installment_no',v_requested_installment,
        'installment_total',v_requested_installments
      ));
      v_inst_count:=1;
    end if;
  elsif v_inst_count>60 then
    return jsonb_build_object('ok',false,'error','too_many_installments');
  end if;

  for v_inst in select * from jsonb_array_elements(v_schedule) loop
    v_inst_no:=v_inst_no+1;
    v_due:=nullif(v_inst->>'due_date','')::date;
    v_inst_amount:=round(coalesce(nullif(v_inst->>'amount','')::numeric,0),2);
    if v_due is null or v_inst_amount<=0 then
      return jsonb_build_object('ok',false,'error','invalid_payment_installment','installment',v_inst_no);
    end if;
    v_inst_total:=v_inst_total+v_inst_amount;
  end loop;
  if abs(round(v_inst_total,2)-v_total_amount)>0.01 then
    return jsonb_build_object('ok',false,'error','installments_total_mismatch','expected',v_total_amount,'received',round(v_inst_total,2));
  end if;

  v_inst_no:=0;
  for v_inst in select * from jsonb_array_elements(v_schedule) loop
    v_inst_no:=v_inst_no+1;
    v_id:=gen_random_uuid();
    if v_first_id is null then v_first_id:=v_id; end if;
    v_due:=(v_inst->>'due_date')::date;
    v_inst_amount:=round((v_inst->>'amount')::numeric,2);
    v_inst_number:=greatest(coalesce(nullif(v_inst->>'installment_no','')::int,v_inst_no),1);
    v_inst_total_label:=greatest(coalesce(nullif(v_inst->>'installment_total','')::int,v_inst_count),v_inst_number);

    insert into public.financial_entries(
      id,tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,
      customer_id,sale_id,metadata,issued_at,document_type,financial_category_id,chart_account_id,cost_center_id
    ) values(
      v_id,v.tenant_id,v.company_id,v.branch_id,'receivable','open',
      case when v_inst_total_label>1 then v_desc||' - Parcela '||v_inst_number||'/'||v_inst_total_label else v_desc end,
      v_inst_amount,0,v_due,v_customer.id,null,
      jsonb_build_object(
        'origin','manual_receivable','term_method',v_doc,'receivable_group_id',v_group_id,
        'installment',v_inst_number,'installments',v_inst_total_label,'group_total_amount',v_total_amount,
        'reference',v_reference,'notes',v_notes,'created_by',v.user_id
      ),
      v_issued,v_doc,v_category,v_account,v_cc
    );
    v_ids:=v_ids||jsonb_build_array(v_id);
  end loop;

  return jsonb_build_object(
    'ok',true,'id',v_first_id,'ids',v_ids,'group_id',v_group_id,'document_type',v_doc,
    'amount',v_total_amount,'installments',jsonb_array_length(v_schedule),
    'financial_category_id',v_category,'chart_account_id',v_account,'cost_center_id',v_cc,
    'store_credit_balance',private.customer_store_credit_balance(v.tenant_id,v_customer.id)
  );
exception when others then
  if sqlerrm like 'insufficient_crediario_credit:%' then
    return jsonb_build_object('ok',false,'error','insufficient_crediario_credit','detail',sqlerrm);
  end if;
  return jsonb_build_object('ok',false,'error',sqlerrm);
end
$function$;
