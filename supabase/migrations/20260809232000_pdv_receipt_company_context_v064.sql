create or replace function public.pdv_pull_v6(p_device_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  dev record;
  products jsonb;
  context_extra jsonb;
begin
  data:=public.pdv_pull_v5(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;

  select * into dev from private.resolve_pdv_device(p_device_token);

  select coalesce(jsonb_agg(x.obj||jsonb_build_object(
      'product_code',p.product_code,
      'label_scale',coalesce(p.label_scale,false)
    ) order by coalesce((x.obj->>'name'),p.name)),'[]'::jsonb)
    into products
  from jsonb_array_elements(coalesce(data->'products','[]'::jsonb)) x(obj)
  left join public.products p on p.id=(x.obj->>'id')::uuid and p.tenant_id=dev.tenant_id;

  data:=jsonb_set(data,'{products}',coalesce(products,'[]'::jsonb),true);

  select jsonb_build_object(
      'company_legal_name',c.legal_name,
      'company_trade_name',c.trade_name,
      'company_cnpj',c.cnpj,
      'company_state_registration',c.state_registration,
      'company_municipal_registration',c.municipal_registration,
      'company_phone',c.phone,
      'company_email',c.email,
      'branch_cnpj',b.cnpj,
      'branch_street',b.street,
      'branch_number',b.number,
      'branch_complement',b.complement,
      'branch_district',b.district,
      'branch_city',b.city,
      'branch_state',b.state,
      'branch_postal_code',b.postal_code
    )
    into context_extra
  from public.companies c
  join public.branches b on b.id=dev.branch_id and b.company_id=c.id
  where c.id=dev.company_id and c.tenant_id=dev.tenant_id;

  data:=jsonb_set(
    data,
    '{context}',
    coalesce(data->'context','{}'::jsonb) || coalesce(context_extra,'{}'::jsonb),
    true
  );

  return data;
end;
$function$;
