do $do$
declare
  v_def text;
  v_before text;
begin
  v_def := pg_get_functiondef('private.pdv_process_sale(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  v_before := v_def;
  v_def := replace(
    v_def,
    'if v_prod_mode is null then return jsonb_build_object(''ok'',false,''error'',''product_not_found'',''product_id'',v_product); end if; if not coalesce(v_product_fractioned,false) and abs(v_qty-round(v_qty))>0.000001 then return jsonb_build_object(''ok'',false,''error'',''fractional_quantity_not_allowed'',''product_id'',v_product); end if;',
    'if v_prod_mode is null then return jsonb_build_object(''ok'',false,''error'',''product_not_found'',''product_id'',v_product); end if; if v_sale_discount>0 and not coalesce(v_product_allow_discount,true) then return jsonb_build_object(''ok'',false,''error'',''product_discount_not_allowed'',''product_id'',v_product); end if; if not coalesce(v_product_fractioned,false) and abs(v_qty-round(v_qty))>0.000001 then return jsonb_build_object(''ok'',false,''error'',''fractional_quantity_not_allowed'',''product_id'',v_product); end if;'
  );
  if v_def = v_before then raise exception 'global product discount guard not applied'; end if;
  execute v_def;
end
$do$;
