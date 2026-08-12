create or replace function public.pdv_pull_v8(p_device_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  enriched_products jsonb;
begin
  data := public.pdv_pull_v7(p_device_token, p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;

  select coalesce(jsonb_agg(
    x.obj || jsonb_build_object(
      'product_code', p.product_code,
      'image_url', p.image_url,
      'menu_image_url', p.menu_image_url,
      'self_service_image_url', p.self_service_image_url
    ) order by x.ordinality
  ), '[]'::jsonb)
  into enriched_products
  from jsonb_array_elements(coalesce(data->'products','[]'::jsonb)) with ordinality x(obj, ordinality)
  left join public.products p on p.id = nullif(x.obj->>'id','')::uuid;

  data := jsonb_set(data,'{products}',coalesce(enriched_products,'[]'::jsonb),true);
  return data;
end;
$function$;

grant execute on function public.pdv_pull_v8(text,timestamptz) to anon, authenticated, service_role;
