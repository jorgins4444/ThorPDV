-- Receivables managerial classification and real purchase installments.

create or replace function public.erp_receivable_create(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_customer public.customers%rowtype;
  v_id uuid:=gen_random_uuid();
  v_doc text;
  v_amount numeric;
  v_issued date;
  v_due date;
  v_desc text;
  v_installment int;
  v_installments int;
  v_category uuid:=nullif(p_payload->>'financial_category_id','')::uuid;
  v_account uuid:=nullif(p_payload->>'chart_account_id','')::uuid;
  v_cc uuid:=nullif(p_payload->>'cost_center_id','')::uuid;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);

  v_doc:=lower(trim(coalesce(p_payload->>'document_type','')));
  if v_doc not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','invalid_document_type'); end if;
  v_amount:=coalesce(nullif(p_payload->>'amount','')::numeric,0);
  if v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_amount'); end if;
  v_issued:=coalesce(nullif(p_payload->>'issued_at','')::date,current_date);
  v_due:=nullif(p_payload->>'due_date','')::date;
  if v_due is null then return jsonb_build_object('ok',false,'error','due_date_required'); end if;
  v_desc:=trim(coalesce(p_payload->>'description',''));
  if length(v_desc)<3 then return jsonb_build_object('ok',false,'error','description_required'); end if;

  select * into v_customer from public.customers where id=nullif(p_payload->>'customer_id','')::uuid and tenant_id=v.tenant_id and active=true;
  if v_customer.id is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;

  if v_category is null then
    select id into v_category from public.financial_categories
    where tenant_id=v.tenant_id and company_id=v.company_id and code='SALES' and active
    order by created_at limit 1;
  end if;
  if not exists(select 1 from public.financial_categories where id=v_category and tenant_id=v.tenant_id and company_id=v.company_id and active and entry_type in ('receivable','both')) then
    return jsonb_build_object('ok',false,'error','invalid_financial_category');
  end if;
  if v_account is null then select default_chart_account_id into v_account from public.financial_categories where id=v_category; end if;
  if v_account is not null and not exists(select 1 from public.financial_chart_accounts where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and active and posting) then
    return jsonb_build_object('ok',false,'error','invalid_chart_account');
  end if;
  if v_cc is null then
    select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id=v.branch_id and active order by is_default desc,created_at limit 1;
  end if;
  if v_cc is null then
    select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id is null and active order by is_default desc,created_at limit 1;
  end if;
  if v_cc is not null and not exists(select 1 from public.cost_centers where id=v_cc and tenant_id=v.tenant_id and company_id=v.company_id and active) then
    return jsonb_build_object('ok',false,'error','invalid_cost_center');
  end if;

  v_installment:=greatest(coalesce(nullif(p_payload->>'installment','')::int,1),1);
  v_installments:=greatest(coalesce(nullif(p_payload->>'installments','')::int,v_installment),v_installment);
  insert into public.financial_entries(
    id,tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,customer_id,sale_id,metadata,issued_at,document_type,
    financial_category_id,chart_account_id,cost_center_id
  ) values(
    v_id,v.tenant_id,v.company_id,v.branch_id,'receivable','open',v_desc,round(v_amount,2),0,v_due,v_customer.id,null,
    jsonb_build_object('origin','manual_receivable','term_method',v_doc,'installment',v_installment,'installments',v_installments,'reference',nullif(p_payload->>'reference',''),'notes',nullif(p_payload->>'notes',''),'created_by',v.user_id),
    v_issued,v_doc,v_category,v_account,v_cc
  );
  return jsonb_build_object('ok',true,'id',v_id,'document_type',v_doc,'amount',round(v_amount,2),'financial_category_id',v_category,'chart_account_id',v_account,'cost_center_id',v_cc,'store_credit_balance',private.customer_store_credit_balance(v.tenant_id,v_customer.id));
exception when others then
  if sqlerrm like 'insufficient_crediario_credit:%' then return jsonb_build_object('ok',false,'error','insufficient_crediario_credit','detail',sqlerrm); end if;
  return jsonb_build_object('ok',false,'error',sqlerrm);
end
$function$;

create or replace function public.erp_receivables_list(p_token text, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record; v_data jsonb;
  v_issued_from date:=nullif(p_filters->>'issued_from','')::date; v_issued_to date:=nullif(p_filters->>'issued_to','')::date;
  v_doc text:=nullif(lower(trim(p_filters->>'document_type')),''); v_customer uuid:=nullif(p_filters->>'customer_id','')::uuid;
  v_due_from date:=nullif(p_filters->>'due_from','')::date; v_due_to date:=nullif(p_filters->>'due_to','')::date;
  v_paid_from date:=nullif(p_filters->>'paid_from','')::date; v_paid_to date:=nullif(p_filters->>'paid_to','')::date;
  v_status text:=nullif(lower(trim(p_filters->>'status')),''); v_name text:=nullif(trim(p_filters->>'customer_name'),'');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.priority asc,x.due_date asc nulls last,x.issued_at desc,x.created_at desc),'[]'::jsonb) into v_data
  from (
    select f.id,f.issued_at,
      coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) document_type,
      case when f.status in ('open','partial') and f.due_date<current_date then 'overdue' else f.status end status,
      f.description,f.amount,f.paid_amount,case when f.status='cancelled' then 0 else greatest(f.amount-f.paid_amount,0) end remaining,
      f.due_date,f.paid_at,f.customer_id,c.name customer,c.document customer_document,f.sale_id,s.number sale_number,
      coalesce(s.completed_at,s.created_at,f.created_at) operation_at,f.created_at,
      nullif(f.metadata->>'installment','')::int installment,nullif(f.metadata->>'installments','')::int installments,
      f.metadata->>'origin' origin,(f.metadata->>'origin'='manual_receivable') manual,
      f.financial_category_id,fc.code financial_category_code,fc.name financial_category,
      f.chart_account_id,fa.code account_code,fa.name account,
      f.cost_center_id,cc.code cost_center_code,cc.name cost_center,
      coalesce((select count(*) from public.financial_settlements fs where fs.financial_entry_id=f.id and fs.status='active'),0) settlements_count,
      coalesce((select sum(fs.amount) from public.financial_settlements fs where fs.financial_entry_id=f.id and fs.status='active'),0) received_total,
      exists(select 1 from public.fiscal_documents fd where fd.sale_id=f.sale_id and fd.document_type='nfce') has_nfce,
      case when f.status in ('open','partial') and f.due_date<current_date then 0 when f.status in ('open','partial') then 1 when f.status='paid' then 2 when f.status='cancelled' then 3 else 4 end priority
    from public.financial_entries f
    left join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id
    left join public.sales s on s.id=f.sale_id and s.tenant_id=f.tenant_id
    left join public.financial_categories fc on fc.id=f.financial_category_id
    left join public.financial_chart_accounts fa on fa.id=f.chart_account_id
    left join public.cost_centers cc on cc.id=f.cost_center_id
    where f.tenant_id=v.tenant_id and f.entry_type='receivable'
      and ((f.metadata->>'origin'='manual_receivable') or (f.sale_id is not null and (f.metadata->>'origin'='sale_term' or s.payment_condition='term')))
      and coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) in ('boleto','crediario')
      and (v_issued_from is null or f.issued_at>=v_issued_from) and (v_issued_to is null or f.issued_at<=v_issued_to)
      and (v_doc is null or coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),''))=v_doc)
      and (v_customer is null or f.customer_id=v_customer)
      and (v_name is null or coalesce(c.name,'') ilike '%'||v_name||'%')
      and (v_due_from is null or f.due_date>=v_due_from) and (v_due_to is null or f.due_date<=v_due_to)
      and (v_paid_from is null or f.paid_at::date>=v_paid_from) and (v_paid_to is null or f.paid_at::date<=v_paid_to)
      and (v_status is null or
        (v_status='overdue' and f.status in ('open','partial') and f.due_date<current_date) or
        (v_status='open' and f.status in ('open','partial') and (f.due_date is null or f.due_date>=current_date)) or
        (v_status='paid' and f.status='paid') or
        (v_status in ('cancelled','reversed') and f.status='cancelled'))
    limit 1000
  ) x;
  return jsonb_build_object('ok',true,'data',v_data);
end
$function$;

create or replace function public.erp_purchase_create(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;v_purchase uuid;v_supplier uuid;v_number bigint;v_item jsonb;v_product uuid;v_qty numeric;v_cost numeric;v_discount numeric;v_line numeric;v_subtotal numeric:=0;v_doc_discount numeric:=greatest(coalesce((p_payload->>'discount')::numeric,0),0);v_freight numeric:=greatest(coalesce((p_payload->>'freight')::numeric,0),0);v_total numeric;
  v_category uuid:=nullif(p_payload->>'financial_category_id','')::uuid;v_account uuid:=nullif(p_payload->>'chart_account_id','')::uuid;v_cc uuid:=nullif(p_payload->>'cost_center_id','')::uuid;
  v_schedule jsonb:=coalesce(p_payload->'payment_installments','[]'::jsonb);v_inst jsonb;v_inst_count int;v_inst_no int:=0;v_inst_amount numeric;v_inst_total numeric:=0;v_inst_due date;v_first_due date;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);
  v_supplier:=nullif(p_payload->>'supplier_id','')::uuid;if not exists(select 1 from suppliers where id=v_supplier and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','supplier_not_found');end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','purchase_without_items');end if;
  if jsonb_typeof(v_schedule)<>'array' then return jsonb_build_object('ok',false,'error','invalid_payment_installments'); end if;

  if v_category is null then select id into v_category from public.financial_categories where tenant_id=v.tenant_id and company_id=v.company_id and code='PURCHASE_RESALE'; end if;
  if not exists(select 1 from public.financial_categories where id=v_category and tenant_id=v.tenant_id and company_id=v.company_id and active and entry_type in ('payable','both')) then return jsonb_build_object('ok',false,'error','invalid_financial_category'); end if;
  if v_account is null then select default_chart_account_id into v_account from public.financial_categories where id=v_category; end if;
  if not exists(select 1 from public.financial_chart_accounts where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and active and posting) then return jsonb_build_object('ok',false,'error','invalid_chart_account'); end if;
  if v_cc is null then select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id=v.branch_id and active order by is_default desc,created_at limit 1; end if;
  if v_cc is null then select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id is null and active order by is_default desc,created_at limit 1; end if;
  if v_cc is not null and not exists(select 1 from public.cost_centers where id=v_cc and tenant_id=v.tenant_id and company_id=v.company_id and active) then return jsonb_build_object('ok',false,'error','invalid_cost_center'); end if;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_product:=(v_item->>'product_id')::uuid;v_qty:=(v_item->>'quantity')::numeric;v_cost:=(v_item->>'unit_cost')::numeric;v_discount:=greatest(coalesce((v_item->>'discount')::numeric,0),0);
    if v_qty<=0 or v_cost<0 then return jsonb_build_object('ok',false,'error','invalid_purchase_item');end if;
    if not exists(select 1 from products where id=v_product and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','product_not_found','product_id',v_product);end if;
    v_line:=v_qty*v_cost-v_discount;if v_line<0 then return jsonb_build_object('ok',false,'error','invalid_item_discount');end if;v_subtotal:=v_subtotal+v_line;
  end loop;
  if v_doc_discount>v_subtotal+v_freight then return jsonb_build_object('ok',false,'error','invalid_purchase_discount');end if;
  v_total:=round(v_subtotal+v_freight-v_doc_discount,2);
  if v_total<=0 then return jsonb_build_object('ok',false,'error','invalid_purchase_total'); end if;

  v_inst_count:=jsonb_array_length(v_schedule);
  if v_inst_count=0 then
    v_first_due:=coalesce(nullif(p_payload->>'due_date','')::date,current_date);
    v_schedule:=jsonb_build_array(jsonb_build_object('due_date',v_first_due,'amount',v_total));
    v_inst_count:=1;
  elsif v_inst_count>60 then
    return jsonb_build_object('ok',false,'error','too_many_installments');
  end if;
  for v_inst in select * from jsonb_array_elements(v_schedule) loop
    v_inst_no:=v_inst_no+1;
    v_inst_due:=nullif(v_inst->>'due_date','')::date;
    v_inst_amount:=round(coalesce(nullif(v_inst->>'amount','')::numeric,0),2);
    if v_inst_due is null or v_inst_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_payment_installment','installment',v_inst_no); end if;
    if v_inst_no=1 then v_first_due:=v_inst_due; end if;
    v_inst_total:=v_inst_total+v_inst_amount;
  end loop;
  if abs(round(v_inst_total,2)-v_total)>0.01 then return jsonb_build_object('ok',false,'error','installments_total_mismatch','expected',v_total,'received',round(v_inst_total,2)); end if;

  select coalesce(max(number),0)+1 into v_number from purchases where tenant_id=v.tenant_id;
  insert into purchases(tenant_id,company_id,branch_id,supplier_id,number,document_number,issue_date,status,subtotal,discount,freight,total,due_date,notes)
  values(v.tenant_id,v.company_id,v.branch_id,v_supplier,v_number,nullif(p_payload->>'document_number',''),coalesce(nullif(p_payload->>'issue_date','')::date,current_date),'received',v_subtotal,v_doc_discount,v_freight,v_total,v_first_due,nullif(p_payload->>'notes','')) returning id into v_purchase;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
    v_product:=(v_item->>'product_id')::uuid;v_qty:=(v_item->>'quantity')::numeric;v_cost:=(v_item->>'unit_cost')::numeric;v_discount:=greatest(coalesce((v_item->>'discount')::numeric,0),0);v_line:=v_qty*v_cost-v_discount;
    insert into purchase_items(tenant_id,purchase_id,product_id,quantity,unit_cost,discount,total) values(v.tenant_id,v_purchase,v_product,v_qty,v_cost,v_discount,v_line);
    insert into stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v.branch_id,v_product,'in',v_qty,v_cost,'purchase',v_purchase,'Entrada automática da compra '||v_number);
    insert into inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v.branch_id,v_product,v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=inventory_balances.quantity+excluded.quantity,updated_at=now();
    update products set cost_price=v_cost,updated_at=now() where id=v_product;
  end loop;

  v_inst_no:=0;
  for v_inst in select * from jsonb_array_elements(v_schedule) loop
    v_inst_no:=v_inst_no+1;v_inst_due:=(v_inst->>'due_date')::date;v_inst_amount:=round((v_inst->>'amount')::numeric,2);
    insert into financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,supplier_id,purchase_id,metadata,financial_category_id,chart_account_id,cost_center_id)
    values(v.tenant_id,v.company_id,v.branch_id,'payable','open',case when v_inst_count>1 then 'Compra '||v_number||' - Parcela '||v_inst_no||'/'||v_inst_count else 'Compra '||v_number end,v_inst_amount,0,v_inst_due,v_supplier,v_purchase,
      jsonb_build_object('origin','purchase','document_number',p_payload->>'document_number','installment',v_inst_no,'installments',v_inst_count),v_category,v_account,v_cc);
  end loop;
  return jsonb_build_object('ok',true,'purchase_id',v_purchase,'number',v_number,'total',v_total,'installments',v_inst_count,'first_due_date',v_first_due);
end
$function$;

create or replace function public.erp_purchase_cancel(p_token text, p_purchase_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare v record;p record;i record;v_available numeric;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  select * into p from purchases where id=p_purchase_id and tenant_id=v.tenant_id and status='received' for update;
  if p.id is null then return jsonb_build_object('ok',false,'error','purchase_not_cancellable');end if;
  if exists(select 1 from financial_entries f where f.purchase_id=p.id and f.entry_type='payable' and (coalesce(f.paid_amount,0)>0 or f.status in ('partial','paid')))
     or exists(select 1 from financial_settlements fs join financial_entries f on f.id=fs.financial_entry_id where f.purchase_id=p.id and fs.status='active') then
    return jsonb_build_object('ok',false,'error','purchase_has_payments');
  end if;
  for i in select * from purchase_items where purchase_id=p.id loop
    select coalesce(sum(quantity-reserved_quantity),0) into v_available from inventory_balances where tenant_id=v.tenant_id and branch_id=p.branch_id and product_id=i.product_id;
    if v_available<i.quantity then return jsonb_build_object('ok',false,'error','insufficient_stock_to_cancel','product_id',i.product_id,'available',v_available,'required',i.quantity);end if;
  end loop;
  for i in select * from purchase_items where purchase_id=p.id loop
    insert into stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,p.branch_id,i.product_id,'out',-i.quantity,i.unit_cost,'purchase_cancel',p.id,'Estorno da compra '||p.number);
    update inventory_balances set quantity=quantity-i.quantity,updated_at=now() where tenant_id=v.tenant_id and branch_id=p.branch_id and product_id=i.product_id;
  end loop;
  update purchases set status='cancelled',updated_at=now() where id=p.id;
  update financial_entries set status='cancelled',updated_at=now() where purchase_id=p.id and status<>'cancelled';
  return jsonb_build_object('ok',true);
end
$function$;

create or replace function public.erp_purchase_list(p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare v record;v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_data from (
    select p.id,p.number,p.document_number,p.issue_date,p.status,p.subtotal,p.discount,p.freight,p.total,p.due_date,p.notes,
           s.name supplier,b.name branch,coalesce(pi.item_count,0)::int item_count,p.created_at,
           cls.financial_category_id,fc.name financial_category,cls.chart_account_id,fa.code account_code,fa.name chart_account,cls.cost_center_id,cc.name cost_center,
           coalesce(fin.installment_count,0)::int installment_count,fin.next_due_date,coalesce(fin.financial_total,0) financial_total,
           coalesce(fin.paid_amount,0) financial_paid_amount,coalesce(fin.open_amount,0) open_amount
    from purchases p
    join suppliers s on s.id=p.supplier_id
    join branches b on b.id=p.branch_id
    left join lateral(select count(*) item_count from purchase_items i where i.purchase_id=p.id) pi on true
    left join lateral(select f.financial_category_id,f.chart_account_id,f.cost_center_id from public.financial_entries f where f.purchase_id=p.id and f.entry_type='payable' order by f.created_at limit 1) cls on true
    left join lateral(
      select count(*) installment_count,
             min(f.due_date) filter(where f.status in ('open','partial')) next_due_date,
             sum(f.amount) financial_total,
             sum(f.paid_amount) paid_amount,
             sum(case when f.status='cancelled' then 0 else greatest(f.amount-f.paid_amount,0) end) open_amount
      from public.financial_entries f where f.purchase_id=p.id and f.entry_type='payable'
    ) fin on true
    left join public.financial_categories fc on fc.id=cls.financial_category_id
    left join public.financial_chart_accounts fa on fa.id=cls.chart_account_id
    left join public.cost_centers cc on cc.id=cls.cost_center_id
    where p.tenant_id=v.tenant_id
    order by p.created_at desc
    limit 250
  )x;
  return jsonb_build_object('ok',true,'data',v_data);
end
$function$;
