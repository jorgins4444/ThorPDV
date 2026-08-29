alter table public.purchases add column if not exists source text not null default 'manual';
alter table public.purchases add column if not exists nfe_access_key text;
alter table public.purchases add column if not exists nfe_model text;
alter table public.purchases add column if not exists nfe_series text;
alter table public.purchases add column if not exists supplier_document text;
alter table public.purchases add column if not exists insurance numeric not null default 0;
alter table public.purchases add column if not exists other_expenses numeric not null default 0;
alter table public.purchases add column if not exists tax_adjustment numeric not null default 0;
alter table public.purchases add column if not exists xml_metadata jsonb not null default '{}'::jsonb;
create unique index if not exists purchases_tenant_nfe_key_uq on public.purchases(tenant_id,nfe_access_key) where nfe_access_key is not null and nfe_access_key<>'';

alter table public.purchase_items add column if not exists source_item_no integer;
alter table public.purchase_items add column if not exists source_code text;
alter table public.purchase_items add column if not exists source_ean text;
alter table public.purchase_items add column if not exists source_unit text;
alter table public.purchase_items add column if not exists source_quantity numeric;
alter table public.purchase_items add column if not exists conversion_factor numeric not null default 1;
alter table public.purchase_items add column if not exists source_unit_cost numeric;
alter table public.purchase_items add column if not exists source_ncm text;
alter table public.purchase_items add column if not exists source_cest text;
alter table public.purchase_items add column if not exists source_cfop text;

create table if not exists public.supplier_product_links(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 supplier_id uuid not null references public.suppliers(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 source_code text not null,
 source_ean text,
 source_unit text,
 conversion_factor numeric not null default 1 check(conversion_factor>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,supplier_id,source_code)
);
create index if not exists supplier_product_links_product_idx on public.supplier_product_links(product_id);
alter table public.supplier_product_links enable row level security;

create or replace function public.erp_purchase_create(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $function$
declare
 v record;v_purchase uuid;v_supplier uuid;v_number bigint;v_item jsonb;v_product uuid;v_qty numeric;v_cost numeric;v_discount numeric;v_line numeric;v_subtotal numeric:=0;v_doc_discount numeric:=greatest(coalesce((p_payload->>'discount')::numeric,0),0);v_freight numeric:=greatest(coalesce((p_payload->>'freight')::numeric,0),0);v_insurance numeric:=greatest(coalesce((p_payload->>'insurance')::numeric,0),0);v_other numeric:=greatest(coalesce((p_payload->>'other_expenses')::numeric,0),0);v_tax_adjust numeric:=coalesce((p_payload->>'tax_adjustment')::numeric,0);v_total numeric;
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
 if v_doc_discount>v_subtotal+v_freight+v_insurance+v_other+v_tax_adjust then return jsonb_build_object('ok',false,'error','invalid_purchase_discount');end if;
 v_total:=round(v_subtotal+v_freight+v_insurance+v_other+v_tax_adjust-v_doc_discount,2);if v_total<=0 then return jsonb_build_object('ok',false,'error','invalid_purchase_total');end if;
 v_inst_count:=jsonb_array_length(v_schedule);
 if v_inst_count=0 then v_first_due:=coalesce(nullif(p_payload->>'due_date','')::date,current_date);v_schedule:=jsonb_build_array(jsonb_build_object('due_date',v_first_due,'amount',v_total));v_inst_count:=1;
 elsif v_inst_count>60 then return jsonb_build_object('ok',false,'error','too_many_installments');end if;
 for v_inst in select * from jsonb_array_elements(v_schedule) loop
  v_inst_no:=v_inst_no+1;v_inst_due:=nullif(v_inst->>'due_date','')::date;v_inst_amount:=round(coalesce(nullif(v_inst->>'amount','')::numeric,0),2);
  if v_inst_due is null or v_inst_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_payment_installment','installment',v_inst_no);end if;
  if v_inst_no=1 then v_first_due:=v_inst_due;end if;v_inst_total:=v_inst_total+v_inst_amount;
 end loop;
 if abs(round(v_inst_total,2)-v_total)>0.01 then return jsonb_build_object('ok',false,'error','installments_total_mismatch','expected',v_total,'received',round(v_inst_total,2));end if;
 select coalesce(max(number),0)+1 into v_number from purchases where tenant_id=v.tenant_id;
 insert into purchases(tenant_id,company_id,branch_id,supplier_id,number,document_number,issue_date,status,subtotal,discount,freight,insurance,other_expenses,tax_adjustment,total,due_date,notes,source,nfe_access_key,nfe_model,nfe_series,supplier_document,xml_metadata)
 values(v.tenant_id,v.company_id,v.branch_id,v_supplier,v_number,nullif(p_payload->>'document_number',''),coalesce(nullif(p_payload->>'issue_date','')::date,current_date),'received',v_subtotal,v_doc_discount,v_freight,v_insurance,v_other,v_tax_adjust,v_total,v_first_due,nullif(p_payload->>'notes',''),coalesce(nullif(p_payload->>'source',''),'manual'),nullif(p_payload->>'nfe_access_key',''),nullif(p_payload->>'nfe_model',''),nullif(p_payload->>'nfe_series',''),nullif(p_payload->>'supplier_document',''),coalesce(p_payload->'xml_metadata','{}'::jsonb)) returning id into v_purchase;
 for v_item in select * from jsonb_array_elements(p_payload->'items') loop
  v_product:=(v_item->>'product_id')::uuid;v_qty:=(v_item->>'quantity')::numeric;v_cost:=(v_item->>'unit_cost')::numeric;v_discount:=greatest(coalesce((v_item->>'discount')::numeric,0),0);v_line:=v_qty*v_cost-v_discount;
  insert into purchase_items(tenant_id,purchase_id,product_id,quantity,unit_cost,discount,total,source_item_no,source_code,source_ean,source_unit,source_quantity,conversion_factor,source_unit_cost,source_ncm,source_cest,source_cfop)
  values(v.tenant_id,v_purchase,v_product,v_qty,v_cost,v_discount,v_line,nullif(v_item->>'source_item_no','')::int,nullif(v_item->>'source_code',''),nullif(v_item->>'source_ean',''),nullif(v_item->>'source_unit',''),nullif(v_item->>'source_quantity','')::numeric,greatest(coalesce(nullif(v_item->>'conversion_factor','')::numeric,1),0.000001),nullif(v_item->>'source_unit_cost','')::numeric,nullif(v_item->>'source_ncm',''),nullif(v_item->>'source_cest',''),nullif(v_item->>'source_cfop',''));
  insert into stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v.branch_id,v_product,'in',v_qty,v_cost,'purchase',v_purchase,'Entrada automática da compra '||v_number);
  insert into inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v.branch_id,v_product,v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=inventory_balances.quantity+excluded.quantity,updated_at=now();
  update products set cost_price=v_cost,updated_at=now() where id=v_product;
 end loop;
 v_inst_no:=0;
 for v_inst in select * from jsonb_array_elements(v_schedule) loop
  v_inst_no:=v_inst_no+1;v_inst_due:=(v_inst->>'due_date')::date;v_inst_amount:=round((v_inst->>'amount')::numeric,2);
  insert into financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,supplier_id,purchase_id,metadata,financial_category_id,chart_account_id,cost_center_id)
  values(v.tenant_id,v.company_id,v.branch_id,'payable','open',case when v_inst_count>1 then 'Compra '||v_number||' - Parcela '||v_inst_no||'/'||v_inst_count else 'Compra '||v_number end,v_inst_amount,0,v_inst_due,v_supplier,v_purchase,jsonb_build_object('origin',coalesce(nullif(p_payload->>'source',''),'purchase'),'document_number',p_payload->>'document_number','installment',v_inst_no,'installments',v_inst_count,'nfe_access_key',p_payload->>'nfe_access_key'),v_category,v_account,v_cc);
 end loop;
 return jsonb_build_object('ok',true,'purchase_id',v_purchase,'number',v_number,'total',v_total,'installments',v_inst_count,'first_due_date',v_first_due);
end $function$;

create or replace function public.erp_purchase_xml_context(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v record;v_sup jsonb;v_prod jsonb;v_links jsonb;v_units jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]'::jsonb) into v_sup from (select id,name,trade_name,document,state_registration,active from suppliers where tenant_id=v.tenant_id and active=true) s;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]'::jsonb) into v_prod from (
  select p.id,p.product_code,p.sku,p.name,p.unit,p.ncm,p.cest,p.cost_price,p.sale_price,p.active,
   (select b.barcode from product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
   coalesce((select jsonb_agg(jsonb_build_object('unit',u.unit,'conversion_factor',u.conversion_factor,'barcode',u.barcode,'is_default',u.is_default) order by u.is_default desc,u.unit) from product_purchase_units u where u.product_id=p.id),'[]'::jsonb) purchase_units
  from products p where p.tenant_id=v.tenant_id and p.active=true and p.parent_product_id is null limit 1000) p;
 select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) into v_links from (select supplier_id,product_id,source_code,source_ean,source_unit,conversion_factor from supplier_product_links where tenant_id=v.tenant_id) l;
 select coalesce(jsonb_agg(jsonb_build_object('code',u.code,'name',u.name) order by u.code),'[]'::jsonb) into v_units from product_units u where u.tenant_id=v.tenant_id and u.active=true;
 return jsonb_build_object('ok',true,'suppliers',v_sup,'products',v_prod,'links',v_links,'units',v_units,'branch_id',v.branch_id);
end $function$;

create or replace function public.erp_purchase_xml_import(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v record;v_supplier uuid;v_doc text;v_s jsonb;v_item jsonb;v_product uuid;v_result jsonb;v_purchase uuid;v_purchase_payload jsonb;v_items jsonb:='[]'::jsonb;v_new jsonb;v_barcode text;v_unit text;v_sale numeric;v_factor numeric;v_source_code text;v_key text;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 v_key:=regexp_replace(coalesce(p_payload->>'nfe_access_key',''),'\D','','g');if length(v_key)<>44 then return jsonb_build_object('ok',false,'error','invalid_nfe_access_key');end if;
 if exists(select 1 from purchases where tenant_id=v.tenant_id and nfe_access_key=v_key and status<>'cancelled') then return jsonb_build_object('ok',false,'error','nfe_already_imported');end if;
 v_s:=coalesce(p_payload->'supplier','{}'::jsonb);v_doc:=regexp_replace(coalesce(v_s->>'document',''),'\D','','g');v_supplier:=nullif(p_payload->>'supplier_id','')::uuid;
 if v_supplier is null and v_doc<>'' then select id into v_supplier from suppliers where tenant_id=v.tenant_id and regexp_replace(coalesce(document,''),'\D','','g')=v_doc and active=true order by created_at limit 1;end if;
 if v_supplier is null then
  if nullif(trim(v_s->>'name'),'') is null or v_doc='' then return jsonb_build_object('ok',false,'error','supplier_not_found');end if;
  insert into suppliers(tenant_id,company_id,name,trade_name,document,state_registration,email,phone,street,number,complement,district,city,state,postal_code,ibge_city_code,active,type)
  values(v.tenant_id,v.company_id,v_s->>'name',nullif(v_s->>'trade_name',''),v_doc,nullif(v_s->>'state_registration',''),nullif(v_s->>'email',''),nullif(v_s->>'phone',''),nullif(v_s->>'street',''),nullif(v_s->>'number',''),nullif(v_s->>'complement',''),nullif(v_s->>'district',''),nullif(v_s->>'city',''),nullif(v_s->>'state',''),nullif(v_s->>'postal_code',''),nullif(v_s->>'ibge_city_code',''),true,case when length(v_doc)=14 then 'company' else 'person' end) returning id into v_supplier;
 end if;
 if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','purchase_without_items');end if;
 for v_item in select * from jsonb_array_elements(p_payload->'items') loop
  v_product:=nullif(v_item->>'product_id','')::uuid;v_factor:=greatest(coalesce(nullif(v_item->>'conversion_factor','')::numeric,1),0.000001);v_source_code:=coalesce(v_item->>'source_code','');v_sale:=greatest(coalesce(nullif(v_item->>'sale_price','')::numeric,0),0);v_unit:=upper(coalesce(nullif(v_item->>'stock_unit',''),'UN'));v_barcode:=nullif(regexp_replace(coalesce(v_item->>'source_ean',''),'\s','','g'),'');if upper(coalesce(v_barcode,'')) in ('SEMGTIN','SEM GTIN') then v_barcode:=null;end if;
  if v_product is null then
   if not coalesce((v_item->>'create_product')::boolean,false) then return jsonb_build_object('ok',false,'error','xml_item_product_required','source_code',v_source_code);end if;
   v_new:=public.erp_product_save_v6(p_token,jsonb_build_object('name',v_item->>'source_name','sku',nullif(v_source_code,''),'unit',v_unit,'barcode',coalesce(v_barcode,''),'ncm',coalesce(v_item->>'source_ncm',''),'cest',coalesce(v_item->>'source_cest',''),'cost_price',coalesce(nullif(v_item->>'unit_cost','')::numeric,0),'sale_price',v_sale,'supplier_id',v_supplier,'product_type','resale','product_structure','simple','active',true));
   if not coalesce((v_new->>'ok')::boolean,false) then return jsonb_build_object('ok',false,'error','xml_product_create_failed','source_code',v_source_code,'detail',v_new);end if;v_product:=(v_new->>'id')::uuid;
  elsif not exists(select 1 from products where id=v_product and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','product_not_found','source_code',v_source_code);end if;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',nullif(v_item->>'quantity','')::numeric,'unit_cost',nullif(v_item->>'unit_cost','')::numeric,'discount',0,'source_item_no',v_item->>'source_item_no','source_code',v_source_code,'source_ean',v_item->>'source_ean','source_unit',v_item->>'source_unit','source_quantity',v_item->>'source_quantity','conversion_factor',v_factor,'source_unit_cost',v_item->>'source_unit_cost','source_ncm',v_item->>'source_ncm','source_cest',v_item->>'source_cest','source_cfop',v_item->>'source_cfop'));
  update products set sale_price=v_sale,ncm=coalesce(nullif(v_item->>'source_ncm',''),ncm),cest=coalesce(nullif(v_item->>'source_cest',''),cest),supplier_id=coalesce(supplier_id,v_supplier),updated_at=now() where id=v_product;
  if v_source_code<>'' then insert into supplier_product_links(tenant_id,supplier_id,product_id,source_code,source_ean,source_unit,conversion_factor) values(v.tenant_id,v_supplier,v_product,v_source_code,nullif(v_item->>'source_ean',''),nullif(v_item->>'source_unit',''),v_factor) on conflict(tenant_id,supplier_id,source_code) do update set product_id=excluded.product_id,source_ean=excluded.source_ean,source_unit=excluded.source_unit,conversion_factor=excluded.conversion_factor,updated_at=now();end if;
  if nullif(v_item->>'source_unit','') is not null and upper(v_item->>'source_unit')<>v_unit then insert into product_purchase_units(tenant_id,product_id,unit,conversion_factor,barcode,is_default) values(v.tenant_id,v_product,upper(v_item->>'source_unit'),v_factor,v_barcode,true) on conflict(product_id,unit) do update set conversion_factor=excluded.conversion_factor,barcode=coalesce(excluded.barcode,product_purchase_units.barcode),is_default=true,updated_at=now();end if;
 end loop;
 v_purchase_payload:=jsonb_build_object('supplier_id',v_supplier,'document_number',p_payload->>'document_number','issue_date',p_payload->>'issue_date','due_date',p_payload->>'due_date','financial_category_id',p_payload->>'financial_category_id','chart_account_id',p_payload->>'chart_account_id','cost_center_id',p_payload->>'cost_center_id','freight',coalesce((p_payload->>'freight')::numeric,0),'insurance',coalesce((p_payload->>'insurance')::numeric,0),'other_expenses',coalesce((p_payload->>'other_expenses')::numeric,0),'tax_adjustment',coalesce((p_payload->>'tax_adjustment')::numeric,0),'discount',0,'notes',p_payload->>'notes','payment_installments',coalesce(p_payload->'payment_installments','[]'::jsonb),'items',v_items,'source','nfe_xml','nfe_access_key',v_key,'nfe_model',p_payload->>'nfe_model','nfe_series',p_payload->>'nfe_series','supplier_document',v_doc,'xml_metadata',coalesce(p_payload->'xml_metadata','{}'::jsonb));
 v_result:=public.erp_purchase_create(p_token,v_purchase_payload);if not coalesce((v_result->>'ok')::boolean,false) then return v_result;end if;v_purchase:=(v_result->>'purchase_id')::uuid;
 return v_result||jsonb_build_object('supplier_id',v_supplier,'source','nfe_xml','nfe_access_key',v_key);
exception when unique_violation then return jsonb_build_object('ok',false,'error','nfe_already_imported');
end $function$;
