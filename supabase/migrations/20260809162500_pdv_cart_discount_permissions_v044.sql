-- ThorPDV 0.4.4: permissao de remocao de item e novas alçadas de desconto.

update public.access_profiles
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'sale',
    jsonb_build_object('remove_item', true) || coalesce(permissions->'sale', '{}'::jsonb),
  'discount',
    jsonb_build_object(
      'apply', coalesce(nullif(permissions#>>'{discount,max_percent}', '')::numeric, 0) > 0,
      'override_limit', coalesce((permissions#>>'{supervisor,authorize}')::boolean, false)
    ) || coalesce(permissions->'discount', '{}'::jsonb)
)
where scope = 'PDV';

do $$
declare
  v_def text;
  v_create_check text := 'if not coalesce((v_op#>>''{permissions,sale,create}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''operator_not_allowed_to_sell''); end if;';
  v_discount_limit text := 'v_max_discount:=coalesce(nullif(v_op#>>''{permissions,discount,max_percent}'','''')::numeric,0);';
begin
  select pg_get_functiondef('private.pdv_process_sale(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
    into v_def;

  if position('discount_not_allowed' in v_def) = 0 then
    if position(v_create_check in v_def) = 0 then
      raise exception 'pdv_process_sale sale.create guard not found';
    end if;
    v_def := replace(
      v_def,
      v_create_check,
      v_create_check || E'\n  if v_sale_discount>0 and not coalesce((v_op#>>''{permissions,discount,apply}'')::boolean,false) then return jsonb_build_object(''ok'',false,''error'',''discount_not_allowed''); end if;'
    );
  end if;

  if position('{permissions,discount,override_limit}' in v_def) = 0 then
    if position(v_discount_limit in v_def) = 0 then
      raise exception 'pdv_process_sale discount limit assignment not found';
    end if;
    v_def := replace(
      v_def,
      v_discount_limit,
      v_discount_limit || E'\n  if coalesce((v_op#>>''{permissions,discount,override_limit}'')::boolean,false) then v_max_discount:=100; end if;'
    );
  end if;

  execute v_def;
end $$;
