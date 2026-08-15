create or replace function public.erp_product_file_export_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_price_table_id uuid;
  v_price_table_name text;
  v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  select pt.id,pt.name
    into v_price_table_id,v_price_table_name
  from public.price_tables pt
  where pt.tenant_id=v.tenant_id
    and pt.company_id=v.company_id
    and pt.active=true
    and pt.is_default=true
    and (pt.valid_from is null or pt.valid_from<=current_date)
    and (pt.valid_to is null or pt.valid_to>=current_date)
  order by pt.updated_at desc
  limit 1;

  select coalesce(jsonb_agg(row_data order by lower(row_data->>'name'),row_data->>'product_code'),'[]'::jsonb)
    into v_data
  from (
    select jsonb_build_object(
      'id',p.id,
      'product_code',p.product_code,
      'sku',p.sku,
      'name',p.name,
      'price',coalesce(pti.price,p.sale_price,0),
      'structure',coalesce(p.product_structure,'simple'),
      'codes',c.codes
    ) as row_data
    from public.products p
    left join public.price_table_items pti
      on pti.price_table_id=v_price_table_id
     and pti.product_id=p.id
    cross join lateral (
      select coalesce(jsonb_agg(x.code order by x.priority,x.code),'[]'::jsonb) as codes
      from (
        select code,min(priority) as priority
        from (
          select p.product_code::text as code,1 as priority
          where p.product_code is not null
          union all
          select trim(p.sku),2
          where nullif(trim(coalesce(p.sku,'')),'') is not null
            and trim(p.sku) ~ '^[0-9]+$'
          union all
          select trim(pb.barcode),case when pb.is_primary then 3 else 4 end
          from public.product_barcodes pb
          where pb.tenant_id=p.tenant_id
            and pb.product_id=p.id
            and nullif(trim(coalesce(pb.barcode,'')),'') is not null
            and trim(pb.barcode) ~ '^[0-9]+$'
        ) raw_codes
        where nullif(code,'') is not null
        group by code
      ) x
    ) c
    where p.tenant_id=v.tenant_id
      and p.company_id=v.company_id
      and p.active=true
      and coalesce(p.product_structure,'simple') in ('simple','variant')
      and jsonb_array_length(c.codes)>0
  ) q;

  return jsonb_build_object(
    'ok',true,
    'generated_at',now(),
    'tenant_id',v.tenant_id,
    'company_id',v.company_id,
    'branch_id',v.branch_id,
    'price_table_id',v_price_table_id,
    'price_table_name',v_price_table_name,
    'data',v_data,
    'product_count',jsonb_array_length(v_data)
  );
end;
$function$;

grant execute on function public.erp_product_file_export_data(text) to anon,authenticated,service_role;
