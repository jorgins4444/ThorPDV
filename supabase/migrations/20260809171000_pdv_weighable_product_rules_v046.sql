do $do$
declare
  v_def text;
  v_before text;
begin
  v_def := pg_get_functiondef('public.erp_product_save_v3(text,jsonb)'::regprocedure);
  v_before := v_def;
  v_def := replace(
    v_def,
    'update public.products set',
    'update public.products set fractioned=case when coalesce((p_payload->>''is_weighable'')::boolean,is_weighable) then true else fractioned end,'
  );
  if v_def = v_before then raise exception 'product save weighable patch not applied'; end if;
  execute v_def;

  v_def := pg_get_functiondef('public.pdv_pull(text,timestamp with time zone)'::regprocedure);
  v_before := v_def;
  v_def := replace(
    v_def,
    '''sale_price'',p.sale_price,''minimum_stock'',p.minimum_stock,''active'',p.active,''is_weighable'',p.is_weighable,',
    '''sale_price'',p.sale_price,''minimum_stock'',p.minimum_stock,''active'',p.active,''is_weighable'',p.is_weighable,''fractioned'',p.fractioned,''allow_discount'',p.allow_discount,'
  );
  if v_def = v_before then raise exception 'pdv pull weighable patch not applied'; end if;
  execute v_def;

  v_def := pg_get_functiondef('private.pdv_process_sale(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  v_before := v_def;
  v_def := replace(
    v_def,
    'v_prod_mode text; v_sale_item uuid; v_ticket jsonb; v_tickets jsonb:=''[]''::jsonb; v_item_discount_pct numeric:=0; v_item_discount_max_pct numeric:=0; v_item_discount_over boolean:=false;',
    'v_prod_mode text; v_product_fractioned boolean:=false; v_product_allow_discount boolean:=true; v_sale_item uuid; v_ticket jsonb; v_tickets jsonb:=''[]''::jsonb; v_item_discount_pct numeric:=0; v_item_discount_max_pct numeric:=0; v_item_discount_over boolean:=false;'
  );
  if v_def = v_before then raise exception 'pdv sale declaration patch not applied'; end if;

  v_before := v_def;
  v_def := replace(
    v_def,
    'select p.production_mode into v_prod_mode from public.products p where p.id=v_product and p.tenant_id=p_tenant_id and p.active=true;',
    'select p.production_mode,(p.is_weighable or p.fractioned),p.allow_discount into v_prod_mode,v_product_fractioned,v_product_allow_discount from public.products p where p.id=v_product and p.tenant_id=p_tenant_id and p.active=true;'
  );
  if v_def = v_before then raise exception 'pdv sale product flags patch not applied'; end if;

  v_before := v_def;
  v_def := replace(
    v_def,
    'if v_prod_mode is null then return jsonb_build_object(''ok'',false,''error'',''product_not_found'',''product_id'',v_product); end if;',
    'if v_prod_mode is null then return jsonb_build_object(''ok'',false,''error'',''product_not_found'',''product_id'',v_product); end if; if not coalesce(v_product_fractioned,false) and abs(v_qty-round(v_qty))>0.000001 then return jsonb_build_object(''ok'',false,''error'',''fractional_quantity_not_allowed'',''product_id'',v_product); end if;'
  );
  if v_def = v_before then raise exception 'pdv sale fractional quantity guard not applied'; end if;

  v_before := v_def;
  v_def := replace(
    v_def,
    'if v_item_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''item_discount_not_allowed'',''product_id'',v_product); end if;',
    'if v_item_discount>0 and not coalesce(v_product_allow_discount,true) then return jsonb_build_object(''ok'',false,''error'',''product_discount_not_allowed'',''product_id'',v_product); end if; if v_item_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''item_discount_not_allowed'',''product_id'',v_product); end if;'
  );
  if v_def = v_before then raise exception 'pdv sale product discount guard not applied'; end if;

  execute v_def;
end
$do$;
