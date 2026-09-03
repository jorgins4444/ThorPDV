create or replace function public.erp_screen_bootstrap_v1(p_token text, p_screen text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_context jsonb;
  v_branch uuid;
  v_branch_config jsonb := jsonb_build_object('ok', false, 'error', 'branch_context_required');
begin
  case lower(trim(coalesce(p_screen,'')))
    when 'products' then
      return jsonb_build_object(
        'ok', true,
        'products', public.erp_product_list_v2(p_token, null::text),
        'groups', public.erp_list(p_token, 'groups', null::text),
        'classes', public.erp_list(p_token, 'classes', null::text),
        'suppliers', public.erp_list(p_token, 'suppliers', null::text),
        'modifiers', public.erp_list(p_token, 'modifiers', null::text),
        'branches', public.erp_list(p_token, 'branches', null::text),
        'categories', public.erp_product_categories_list(p_token, null::text),
        'brands', public.erp_product_brands_list(p_token, null::text)
      );

    when 'sale' then
      v_context := public.erp_context(p_token);
      if coalesce((v_context->>'ok')::boolean, false) and nullif(v_context->>'branch_id','') is not null then
        v_branch := (v_context->>'branch_id')::uuid;
        v_branch_config := public.erp_branch_configuration_get(p_token, v_branch);
      end if;
      return jsonb_build_object(
        'ok', true,
        'customers', public.erp_list(p_token, 'customers', null::text),
        'price_tables', public.erp_list(p_token, 'price_tables', null::text),
        'sales_options', public.erp_sales_options_get(p_token),
        'context', v_context,
        'branch_config', v_branch_config
      );

    when 'nfe' then
      return jsonb_build_object(
        'ok', true,
        'settings', public.erp_fiscal_settings_get(p_token),
        'sales', public.erp_list(p_token, 'sales', null::text),
        'documents', public.erp_fiscal_documents_v2(p_token),
        'customers', public.erp_list(p_token, 'customers', null::text),
        'products', public.erp_list(p_token, 'products', null::text),
        'cfop_rules', public.erp_fiscal_cfop_rules_get(p_token)
      );

    when 'fiscal_documents' then
      return jsonb_build_object(
        'ok', true,
        'settings', public.erp_fiscal_settings_get(p_token),
        'sales', public.erp_list(p_token, 'sales', null::text),
        'documents', public.erp_fiscal_documents_v2(p_token)
      );

    else
      return jsonb_build_object('ok', false, 'error', 'unsupported_screen');
  end case;
end;
$$;

grant execute on function public.erp_screen_bootstrap_v1(text,text) to anon, authenticated, service_role;
