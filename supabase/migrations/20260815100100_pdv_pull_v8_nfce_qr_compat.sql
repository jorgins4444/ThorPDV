create or replace function public.pdv_pull_v8(p_device_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  enriched_products jsonb;
  enriched_sales jsonb;
  dev record;
  params jsonb:='{}'::jsonb;
  v_allow boolean:=false;
begin
  data:=public.pdv_pull_v7(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into dev from private.resolve_pdv_device(p_device_token);

  select coalesce(bs.pdv_parameters,'{}'::jsonb)
    into params
  from public.branch_settings bs
  where bs.tenant_id=dev.tenant_id and bs.branch_id=dev.branch_id
  limit 1;
  params:=coalesce(params,'{}'::jsonb);
  v_allow:=private.pdv_allow_negative_stock(dev.tenant_id,dev.branch_id);
  params:=jsonb_set(params,'{allow_negative_stock}',to_jsonb(v_allow),true);

  select coalesce(jsonb_agg(
    x.obj||jsonb_build_object(
      'product_code',p.product_code,
      'image_url',p.image_url,
      'menu_image_url',p.menu_image_url,
      'self_service_image_url',p.self_service_image_url,
      'product_structure',p.product_structure,
      'parent_product_id',p.parent_product_id,
      'variant_label',p.variant_label,
      'variant_attributes',p.variant_attributes
    ) order by x.ordinality
  ),'[]'::jsonb)
  into enriched_products
  from jsonb_array_elements(coalesce(data->'products','[]'::jsonb)) with ordinality x(obj,ordinality)
  left join public.products p on p.id=nullif(x.obj->>'id','')::uuid
  where p.id is null or coalesce(p.product_structure,'simple')<>'grade';

  data:=jsonb_set(data,'{products}',coalesce(enriched_products,'[]'::jsonb),true);
  data:=jsonb_set(data,'{context}',coalesce(data->'context','{}'::jsonb)||jsonb_build_object('pdv_parameters',params,'allow_negative_stock',v_allow),true);

  select coalesce(jsonb_agg(
    case
      when fd.id is null then x.obj
      else jsonb_set(
        x.obj,
        '{fiscal}',
        coalesce(x.obj->'fiscal','{}'::jsonb) || jsonb_build_object(
          'environment',fd.environment,
          'qr_code_url',coalesce(fd.response_payload->>'qr_code_url',fd.request_payload->>'qr_code_url')
        ),
        true
      )
    end
    order by coalesce((x.obj->>'completed_at')::timestamptz,(x.obj->>'created_at')::timestamptz) desc
  ),'[]'::jsonb)
  into enriched_sales
  from jsonb_array_elements(coalesce(data->'sales_history','[]'::jsonb)) x(obj)
  left join public.fiscal_documents fd on fd.id=nullif(x.obj#>>'{fiscal,id}','')::uuid;

  data:=jsonb_set(data,'{sales_history}',coalesce(enriched_sales,'[]'::jsonb),true);
  return data;
end;
$function$;
