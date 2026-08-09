create or replace function public.erp_product_list(p_token text, p_search text default null)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare v record; v_data jsonb; q text := '%' || coalesce(trim(p_search),'') || '%'; q_digits text := regexp_replace(coalesce(trim(p_search),''),'\D','','g');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_code asc),'[]'::jsonb) into v_data
  from (
    select p.id,p.product_code,p.sku,p.name,p.description,p.unit,p.product_type,p.is_weighable,p.label_scale,p.ncm,p.cest,p.cfop_default,p.cost_price,p.sale_price,p.minimum_stock,p.active,
           p.group_id,g.name group_name,p.class_id,c.name class_name,p.production_mode,p.is_manufactured,p.production_sector,p.production_printer,p.auto_print_production,
           (select b.barcode from product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
           coalesce((select i.quantity-i.reserved_quantity from inventory_balances i where i.product_id=p.id and i.tenant_id=v.tenant_id and i.branch_id=v.branch_id),0) stock,
           p.created_at,p.updated_at
    from products p
    left join product_groups g on g.id=p.group_id
    left join product_classes c on c.id=p.class_id
    where p.tenant_id=v.tenant_id
      and (p_search is null
        or p.name ilike q
        or coalesce(p.sku,'') ilike q
        or (q_digits <> '' and p.product_code::text = q_digits)
        or exists(select 1 from product_barcodes b where b.product_id=p.id and b.barcode ilike q))
    limit 500
  ) x;
  return jsonb_build_object('ok',true,'data',v_data,'branch_id',v.branch_id);
end $function$;
