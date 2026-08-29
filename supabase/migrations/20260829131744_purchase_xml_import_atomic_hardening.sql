create or replace function public.erp_purchase_xml_import(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare
 v record;v_supplier uuid;v_doc text;v_s jsonb;v_item jsonb;v_product uuid;v_result jsonb;v_purchase uuid;v_purchase_payload jsonb;v_items jsonb:='[]'::jsonb;v_new jsonb;v_barcode text;v_unit text;v_sale numeric;v_factor numeric;v_source_code text;v_key text;v_failed jsonb:=null;v_updated int;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 v_key:=regexp_replace(coalesce(p_payload->>'nfe_access_key',''),'\D','','g');
 if length(v_key)<>44 then return jsonb_build_object('ok',false,'error','invalid_nfe_access_key');end if;
 if exists(select 1 from purchases where tenant_id=v.tenant_id and nfe_access_key=v_key) then return jsonb_build_object('ok',false,'error','nfe_already_imported');end if;
 if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','purchase_without_items');end if;

 begin
  v_s:=coalesce(p_payload->'supplier','{}'::jsonb);v_doc:=regexp_replace(coalesce(v_s->>'document',''),'\D','','g');v_supplier:=nullif(p_payload->>'supplier_id','')::uuid;
  if v_supplier is not null and not exists(select 1 from suppliers where id=v_supplier and tenant_id=v.tenant_id and active=true) then
   v_failed:=jsonb_build_object('ok',false,'error','supplier_not_found');raise exception 'xml_import_abort';
  end if;
  if v_supplier is null and v_doc<>'' then select id into v_supplier from suppliers where tenant_id=v.tenant_id and regexp_replace(coalesce(document,''),'\D','','g')=v_doc and active=true order by created_at limit 1;end if;
  if v_supplier is null then
   if nullif(trim(v_s->>'name'),'') is null or v_doc='' then v_failed:=jsonb_build_object('ok',false,'error','supplier_not_found');raise exception 'xml_import_abort';end if;
   insert into suppliers(tenant_id,company_id,name,trade_name,document,state_registration,email,phone,street,number,complement,district,city,state,postal_code,ibge_city_code,active,type)
   values(v.tenant_id,v.company_id,v_s->>'name',nullif(v_s->>'trade_name',''),v_doc,nullif(v_s->>'state_registration',''),nullif(v_s->>'email',''),nullif(v_s->>'phone',''),nullif(v_s->>'street',''),nullif(v_s->>'number',''),nullif(v_s->>'complement',''),nullif(v_s->>'district',''),nullif(v_s->>'city',''),nullif(v_s->>'state',''),nullif(v_s->>'postal_code',''),nullif(v_s->>'ibge_city_code',''),true,case when length(v_doc)=14 then 'company' else 'person' end) returning id into v_supplier;
  end if;

  for v_item in select * from jsonb_array_elements(p_payload->'items') loop
   v_product:=nullif(v_item->>'product_id','')::uuid;
   v_factor:=greatest(coalesce(nullif(v_item->>'conversion_factor','')::numeric,1),0.000001);
   v_source_code:=coalesce(v_item->>'source_code','');
   v_sale:=greatest(coalesce(nullif(v_item->>'sale_price','')::numeric,0),0);
   v_unit:=upper(coalesce(nullif(v_item->>'stock_unit',''),'UN'));
   v_barcode:=nullif(regexp_replace(coalesce(v_item->>'source_ean',''),'\s','','g'),'');
   if upper(coalesce(v_barcode,'')) in ('SEMGTIN','SEM GTIN') then v_barcode:=null;end if;
   if coalesce(nullif(v_item->>'quantity','')::numeric,0)<=0 or coalesce(nullif(v_item->>'unit_cost','')::numeric,-1)<0 or v_sale<=0 then
    v_failed:=jsonb_build_object('ok',false,'error','invalid_xml_item_values','source_code',v_source_code);raise exception 'xml_import_abort';
   end if;
   if v_product is null then
    if not coalesce((v_item->>'create_product')::boolean,false) then v_failed:=jsonb_build_object('ok',false,'error','xml_item_product_required','source_code',v_source_code);raise exception 'xml_import_abort';end if;
    v_new:=public.erp_product_save_v6(p_token,jsonb_build_object('name',v_item->>'source_name','sku',nullif(v_source_code,''),'unit',v_unit,'barcode',coalesce(v_barcode,''),'ncm',coalesce(v_item->>'source_ncm',''),'cest',coalesce(v_item->>'source_cest',''),'cost_price',coalesce(nullif(v_item->>'unit_cost','')::numeric,0),'sale_price',v_sale,'supplier_id',v_supplier,'product_type','resale','product_structure','simple','active',true));
    if not coalesce((v_new->>'ok')::boolean,false) then v_failed:=jsonb_build_object('ok',false,'error','xml_product_create_failed','source_code',v_source_code,'detail',v_new);raise exception 'xml_import_abort';end if;
    v_product:=(v_new->>'id')::uuid;
   elsif not exists(select 1 from products where id=v_product and tenant_id=v.tenant_id and active=true) then
    v_failed:=jsonb_build_object('ok',false,'error','product_not_found','source_code',v_source_code);raise exception 'xml_import_abort';
   end if;

   v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',nullif(v_item->>'quantity','')::numeric,'unit_cost',nullif(v_item->>'unit_cost','')::numeric,'discount',0,'source_item_no',v_item->>'source_item_no','source_code',v_source_code,'source_ean',v_item->>'source_ean','source_unit',v_item->>'source_unit','source_quantity',v_item->>'source_quantity','conversion_factor',v_factor,'source_unit_cost',v_item->>'source_unit_cost','source_ncm',v_item->>'source_ncm','source_cest',v_item->>'source_cest','source_cfop',v_item->>'source_cfop'));

   update products set sale_price=v_sale,ncm=coalesce(nullif(v_item->>'source_ncm',''),ncm),cest=coalesce(nullif(v_item->>'source_cest',''),cest),supplier_id=coalesce(supplier_id,v_supplier),updated_at=now() where id=v_product;
   if v_source_code<>'' then
    insert into supplier_product_links(tenant_id,supplier_id,product_id,source_code,source_ean,source_unit,conversion_factor)
    values(v.tenant_id,v_supplier,v_product,v_source_code,nullif(v_item->>'source_ean',''),nullif(v_item->>'source_unit',''),v_factor)
    on conflict(tenant_id,supplier_id,source_code) do update set product_id=excluded.product_id,source_ean=excluded.source_ean,source_unit=excluded.source_unit,conversion_factor=excluded.conversion_factor,updated_at=now();
   end if;
   if nullif(v_item->>'source_unit','') is not null and upper(v_item->>'source_unit')<>v_unit then
    update product_purchase_units set conversion_factor=v_factor,barcode=coalesce(v_barcode,barcode),is_default=true,updated_at=now()
      where tenant_id=v.tenant_id and product_id=v_product and upper(unit)=upper(v_item->>'source_unit');
    get diagnostics v_updated=row_count;
    if v_updated=0 then
      insert into product_purchase_units(tenant_id,product_id,unit,conversion_factor,barcode,is_default)
      values(v.tenant_id,v_product,upper(v_item->>'source_unit'),v_factor,v_barcode,true);
    end if;
   end if;
  end loop;

  v_purchase_payload:=jsonb_build_object('supplier_id',v_supplier,'document_number',p_payload->>'document_number','issue_date',p_payload->>'issue_date','due_date',p_payload->>'due_date','financial_category_id',p_payload->>'financial_category_id','chart_account_id',p_payload->>'chart_account_id','cost_center_id',p_payload->>'cost_center_id','freight',coalesce((p_payload->>'freight')::numeric,0),'insurance',coalesce((p_payload->>'insurance')::numeric,0),'other_expenses',coalesce((p_payload->>'other_expenses')::numeric,0),'tax_adjustment',coalesce((p_payload->>'tax_adjustment')::numeric,0),'discount',0,'notes',p_payload->>'notes','payment_installments',coalesce(p_payload->'payment_installments','[]'::jsonb),'items',v_items,'source','nfe_xml','nfe_access_key',v_key,'nfe_model',p_payload->>'nfe_model','nfe_series',p_payload->>'nfe_series','supplier_document',v_doc,'xml_metadata',coalesce(p_payload->'xml_metadata','{}'::jsonb));
  v_result:=public.erp_purchase_create(p_token,v_purchase_payload);
  if not coalesce((v_result->>'ok')::boolean,false) then v_failed:=v_result;raise exception 'xml_import_abort';end if;
  v_purchase:=(v_result->>'purchase_id')::uuid;
  return v_result||jsonb_build_object('supplier_id',v_supplier,'source','nfe_xml','nfe_access_key',v_key);
 exception
  when unique_violation then return jsonb_build_object('ok',false,'error','nfe_already_imported');
  when others then
   if v_failed is not null then return v_failed;end if;
   return jsonb_build_object('ok',false,'error','xml_import_failed','detail',sqlerrm);
 end;
end $function$;
