create or replace function public.erp_list_page_v1(
  p_token text,
  p_resource text,
  p_search text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $function$
declare
  v_result jsonb;
  v_data jsonb;
  v_page jsonb;
  v_total integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  -- Preserva autenticação, escopo de tenant/filial e regras do erp_list existente.
  -- A paginação é aplicada dentro do PostgreSQL, antes da resposta sair para o app.
  v_result := public.erp_list(p_token, p_resource, p_search);

  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  v_data := coalesce(v_result->'data', '[]'::jsonb);
  if jsonb_typeof(v_data) <> 'array' then
    v_data := '[]'::jsonb;
  end if;

  v_total := jsonb_array_length(v_data);

  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into v_page
  from jsonb_array_elements(v_data) with ordinality as e(item, ordinality)
  where ordinality > v_offset
    and ordinality <= v_offset + v_limit;

  return jsonb_build_object(
    'ok', true,
    'resource', p_resource,
    'data', coalesce(v_page, '[]'::jsonb),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$function$;

grant execute on function public.erp_list_page_v1(text,text,text,integer,integer) to anon, authenticated, service_role;
