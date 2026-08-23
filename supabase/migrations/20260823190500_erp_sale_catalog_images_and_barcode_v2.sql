create or replace function public.erp_sale_catalog(p_token text,p_price_table_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions' as $$
declare v record;v_table uuid;v_data jsonb;v_applied integer;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  v_applied:=private.apply_due_price_adjustments(v.tenant_id);
  if p_price_table_id is not null then
    select id into v_table from price_tables where id=p_price_table_id and tenant_id=v.tenant_id and active=true and (valid_from is null or valid_from<=current_date) and (valid_to is null or valid_to>=current_date);
    if v_table is null then return jsonb_build_object('ok',false,'error','invalid_price_table');end if;
  else
    select id into v_table from price_tables where tenant_id=v.tenant_id and company_id=v.company_id and is_default=true and active=true and (valid_from is null or valid_from<=current_date) and (valid_to is null or valid_to>=current_date) limit 1;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_data from (
    select p.id,p.product_code,p.sku,p.name,p.unit,p.ncm,p.cest,p.parent_product_id,p.variant_attributes,p.variant_label,p.product_structure,
      p.image_url,p.menu_image_url,p.self_service_image_url,
      (select b.barcode from product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
      private.resolve_effective_price(v.tenant_id,v.company_id,p.id,v_table,1) effective_price,p.sale_price base_price,
      coalesce((select sum(i.quantity-i.reserved_quantity) from inventory_balances i where i.tenant_id=v.tenant_id and i.branch_id=v.branch_id and i.product_id=p.id),0) stock,p.active
    from products p where p.tenant_id=v.tenant_id and p.active=true and coalesce(p.product_structure,'simple')<>'grade'
  ) x;
  return jsonb_build_object('ok',true,'price_table_id',v_table,'data',v_data,'executed_adjustments',v_applied);
end $$;
