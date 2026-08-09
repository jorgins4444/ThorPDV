do $do$
declare
  v_def text;
  v_before text;
  nl text := chr(10);
begin
  v_def := pg_get_functiondef('private.pdv_process_sale(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);

  v_before := v_def;
  v_def := replace(v_def,
    'v_prod_mode text; v_sale_item uuid; v_ticket jsonb; v_tickets jsonb:=''[]''::jsonb;',
    'v_prod_mode text; v_sale_item uuid; v_ticket jsonb; v_tickets jsonb:=''[]''::jsonb; v_item_discount_pct numeric:=0; v_item_discount_max_pct numeric:=0; v_item_discount_over boolean:=false;');
  if v_def = v_before then raise exception 'v045 declaration patch not applied'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'if v_sale_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''discount_not_allowed''); end if;',
    'if v_sale_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''discount_not_allowed''); end if;' || nl ||
    '  v_max_discount:=coalesce(nullif(v_op#>>''{permissions,discount,max_percent}'','''')::numeric,0);' || nl ||
    '  if coalesce((v_op#>>''{permissions,discount,override_limit}'')::boolean,false) then v_max_discount:=100; end if;');
  if v_def = v_before then raise exception 'v045 operator discount patch not applied'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'if v_item_discount>v_qty*v_client_price then return jsonb_build_object(''ok'',false,''error'',''invalid_item_discount'',''product_id'',v_product); end if;',
    'if v_item_discount>v_qty*v_client_price then return jsonb_build_object(''ok'',false,''error'',''invalid_item_discount'',''product_id'',v_product); end if;' || nl ||
    '    if v_item_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''item_discount_not_allowed'',''product_id'',v_product); end if;' || nl ||
    '    v_item_discount_pct:=case when v_qty*v_client_price>0 then (v_item_discount/(v_qty*v_client_price))*100 else 0 end;' || nl ||
    '    if v_item_discount_pct>v_max_discount+0.0001 then v_item_discount_over:=true; v_item_discount_max_pct:=greatest(v_item_discount_max_pct,v_item_discount_pct); end if;');
  if v_def = v_before then raise exception 'v045 item discount patch not applied'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'if v_sale_discount>v_subtotal then return jsonb_build_object(''ok'',false,''error'',''invalid_sale_discount''); end if;',
    'if v_item_discount_over then' || nl ||
    '    v_supervisor:=nullif(v_override->>''supervisor_user_id'','''')::uuid;' || nl ||
    '    if v_supervisor is null then return jsonb_build_object(''ok'',false,''error'',''supervisor_authorization_required'',''item_discount_percent'',v_item_discount_max_pct); end if;' || nl ||
    '    v_sup:=private.pdv_staff_permissions(p_tenant_id,p_branch_id,v_supervisor);' || nl ||
    '    if v_sup is null or not coalesce((v_sup#>>''{permissions,supervisor,authorize}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''invalid_supervisor_authorization''); end if;' || nl ||
    '    if not coalesce((v_sup#>>''{permissions,discount,override_limit}'')::boolean,false) and v_item_discount_max_pct>coalesce(nullif(v_sup#>>''{permissions,discount,max_percent}'','''')::numeric,0)+0.0001 then return jsonb_build_object(''ok'',false,''error'',''discount_exceeds_supervisor_limit''); end if;' || nl ||
    '  end if;' || nl || nl ||
    '  if v_sale_discount>v_subtotal then return jsonb_build_object(''ok'',false,''error'',''invalid_sale_discount''); end if;');
  if v_def = v_before then raise exception 'v045 item supervisor patch not applied'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'if v_discount_pct>coalesce(nullif(v_sup#>>''{permissions,discount,max_percent}'','''')::numeric,0)+0.0001 then return jsonb_build_object(''ok'',false,''error'',''discount_exceeds_supervisor_limit''); end if;',
    'if not coalesce((v_sup#>>''{permissions,discount,override_limit}'')::boolean,false) and v_discount_pct>coalesce(nullif(v_sup#>>''{permissions,discount,max_percent}'','''')::numeric,0)+0.0001 then return jsonb_build_object(''ok'',false,''error'',''discount_exceeds_supervisor_limit''); end if;');
  if v_def = v_before then raise exception 'v045 supervisor override patch not applied'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'if v_supervisor is not null then',
    'if v_supervisor is not null then' || nl ||
    '    if v_item_discount_over then insert into public.supervisor_authorizations(tenant_id,branch_id,pdv_device_id,sale_id,operator_user_id,supervisor_user_id,action,requested_value,operator_limit,reason,client_event_id,metadata) values(p_tenant_id,p_branch_id,p_device_id,v_sale,v_operator,v_supervisor,''item_discount'',v_item_discount_max_pct,v_max_discount,nullif(v_override->>''reason'',''''),p_event_id,jsonb_build_object(''source'',''pdv_desktop'')); end if;');
  if v_def = v_before then raise exception 'v045 authorization audit patch not applied'; end if;

  execute v_def;
end
$do$;
