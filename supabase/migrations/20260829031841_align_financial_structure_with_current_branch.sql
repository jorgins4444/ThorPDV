create or replace function public.erp_financial_structure_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_accounts jsonb;
  v_categories jsonb;
  v_cost_centers jsonb;
  v_branch_name text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);

  select name into v_branch_name from public.branches where id=v.branch_id and tenant_id=v.tenant_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.code),'[]'::jsonb) into v_accounts from (
    select a.id,a.code,a.name,a.account_type,a.nature,a.posting,a.active,a.parent_id,p.code parent_code,p.name parent_name,a.created_at
    from public.financial_chart_accounts a
    left join public.financial_chart_accounts p on p.id=a.parent_id
    where a.tenant_id=v.tenant_id and a.company_id=v.company_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_categories from (
    select c.id,c.code,c.name,c.entry_type,c.active,c.default_chart_account_id,a.code account_code,a.name account_name,a.account_type
    from public.financial_categories c
    left join public.financial_chart_accounts a on a.id=c.default_chart_account_id
    where c.tenant_id=v.tenant_id and c.company_id=v.company_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.scope_rank,x.name),'[]'::jsonb) into v_cost_centers from (
    select cc.id,cc.code,cc.name,cc.description,cc.branch_id,b.name branch,cc.is_default,cc.active,cc.created_at,
           case when cc.branch_id=v.branch_id then 0 when cc.branch_id is null then 1 else 2 end scope_rank,
           (cc.branch_id=v.branch_id) is_current_branch
    from public.cost_centers cc
    left join public.branches b on b.id=cc.branch_id
    where cc.tenant_id=v.tenant_id and cc.company_id=v.company_id
  ) x;

  return jsonb_build_object(
    'ok',true,
    'accounts',v_accounts,
    'categories',v_categories,
    'cost_centers',v_cost_centers,
    'current_branch_id',v.branch_id,
    'current_branch_name',v_branch_name
  );
end;
$function$;
