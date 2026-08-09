create or replace function public.pdv_pull_v5(p_device_token text,p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare data jsonb; dev record; customers jsonb; products jsonb;
begin
  data:=public.pdv_pull_v4(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into dev from private.resolve_pdv_device(p_device_token);

  select coalesce(jsonb_agg(c.obj || jsonb_build_object(
      'type',p.type,'trade_name',p.trade_name,'birth_date',p.birth_date,'state_registration',p.state_registration,
      'postal_code',p.postal_code,'street',p.street,'number',p.number,'complement',p.complement,'district',p.district,
      'city',p.city,'state',p.state,'ibge_city_code',p.ibge_city_code,
      'store_credit_balance',private.customer_store_credit_balance(dev.tenant_id,p.id)
    ) order by coalesce(c.obj->>'name',p.name)),'[]'::jsonb)
    into customers
  from jsonb_array_elements(coalesce(data->'customers','[]'::jsonb)) c(obj)
  left join public.customers p on p.id=(c.obj->>'id')::uuid and p.tenant_id=dev.tenant_id;
  data:=jsonb_set(data,'{customers}',coalesce(customers,'[]'::jsonb),true);

  select coalesce(jsonb_agg(x.obj || jsonb_build_object(
      'product_code',p.product_code,
      'label_scale',coalesce(p.label_scale,false)
    ) order by coalesce(x.obj->>'name',p.name)),'[]'::jsonb)
    into products
  from jsonb_array_elements(coalesce(data->'products','[]'::jsonb)) x(obj)
  left join public.products p on p.id=(x.obj->>'id')::uuid and p.tenant_id=dev.tenant_id;
  data:=jsonb_set(data,'{products}',coalesce(products,'[]'::jsonb),true);

  return data;
end;
$$;
