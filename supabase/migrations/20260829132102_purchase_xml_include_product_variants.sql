create or replace function public.erp_purchase_xml_context(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private' as $function$
declare v record;v_sup jsonb;v_prod jsonb;v_links jsonb;v_units jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.name),'[]'::jsonb) into v_sup from (select id,name,trade_name,document,state_registration,active from suppliers where tenant_id=v.tenant_id and active=true) s;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.variant_label),'[]'::jsonb) into v_prod from (
  select p.id,p.product_code,p.sku,p.name,p.unit,p.ncm,p.cest,p.cost_price,p.sale_price,p.active,p.product_structure,p.parent_product_id,p.variant_label,
   (select b.barcode from product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
   coalesce((select jsonb_agg(jsonb_build_object('unit',u.unit,'conversion_factor',u.conversion_factor,'barcode',u.barcode,'is_default',u.is_default) order by u.is_default desc,u.unit) from product_purchase_units u where u.product_id=p.id),'[]'::jsonb) purchase_units
  from products p
  where p.tenant_id=v.tenant_id and p.active=true
    and (p.parent_product_id is not null or coalesce(p.product_structure,'simple')<>'grade')
  limit 1500) p;
 select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) into v_links from (select supplier_id,product_id,source_code,source_ean,source_unit,conversion_factor from supplier_product_links where tenant_id=v.tenant_id) l;
 select coalesce(jsonb_agg(jsonb_build_object('code',u.code,'name',u.name) order by u.code),'[]'::jsonb) into v_units from product_units u where u.tenant_id=v.tenant_id and u.active=true;
 return jsonb_build_object('ok',true,'suppliers',v_sup,'products',v_prod,'links',v_links,'units',v_units,'branch_id',v.branch_id);
end $function$;
