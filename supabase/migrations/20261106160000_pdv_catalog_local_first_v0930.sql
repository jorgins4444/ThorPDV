-- Local-first catalog mutations from authenticated PDV devices.
-- Must be applied BEFORE enabling the Windows UI. Protected by device + operator permissions.
create table if not exists public.pdv_catalog_mutations (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.pdv_devices(id) on delete cascade,
  operator_user_id uuid not null references public.staff_users(id),
  kind text not null check (kind in ('customer_save','product_create','product_price','stock_adjust')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(device_id,id)
);
create index if not exists pdv_catalog_mutations_tenant_created
  on public.pdv_catalog_mutations(tenant_id,created_at desc);
alter table public.pdv_catalog_mutations enable row level security;
revoke all on public.pdv_catalog_mutations from public, anon, authenticated;

create or replace function public.pdv_catalog_apply_v1(
  p_device_token text, p_event_id uuid, p_kind text, p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path='public','private','extensions'
as $$
declare
  v record; v_operator uuid; v_permission jsonb; v_path text[];
  v_existing jsonb; v_result jsonb; v_id uuid; v_group uuid;
  v_name text; v_document text; v_customer_type text; v_cost numeric; v_price numeric;
  v_delta numeric; v_old numeric; v_table uuid; v_actor text;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if p_event_id is null then return jsonb_build_object('ok',false,'error','event_id_required'); end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    return jsonb_build_object('ok',false,'error','invalid_payload');
  end if;

  select m.result into v_existing from public.pdv_catalog_mutations m
   where m.id=p_event_id and m.device_id=v.device_id and m.tenant_id=v.tenant_id;
  if found then return v_existing||jsonb_build_object('idempotent',true); end if;

  if p_kind not in ('customer_save','product_create','product_price','stock_adjust') then
    return jsonb_build_object('ok',false,'error','unsupported_action');
  end if;
  v_operator:=nullif(p_payload->>'operator_user_id','')::uuid;
  v_permission:=private.pdv_staff_permissions(v.tenant_id,v.branch_id,v_operator);
  if v_permission is null then return jsonb_build_object('ok',false,'error','operator_not_authorized'); end if;
  v_path:=case p_kind
    when 'customer_save' then array['permissions','customer','create']
    when 'product_create' then array['permissions','product','create']
    when 'product_price' then array['permissions','product','price_edit']
    else array['permissions','stock','adjust'] end;
  if not coalesce((v_permission#>>v_path)::boolean,false) then
    return jsonb_build_object('ok',false,'error','permission_denied');
  end if;

  select name into v_actor from public.staff_users
   where id=v_operator and tenant_id=v.tenant_id;
  perform set_config('app.audit_actor_type','staff_user',true);
  perform set_config('app.audit_actor_id',v_operator::text,true);
  perform set_config('app.audit_actor_name',coalesce(v_actor,'Operador PDV'),true);
  perform set_config('app.audit_source_type','pdv_local_first',true);

  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is null then return jsonb_build_object('ok',false,'error','record_id_required'); end if;

  if p_kind='customer_save' then
    v_name:=trim(coalesce(p_payload->>'name',''));
    v_document:=regexp_replace(coalesce(p_payload->>'document',''),'\D','','g');
    v_customer_type:=case when upper(coalesce(p_payload->>'type','PF'))='PJ' then 'company' else 'individual' end;
    if v_name='' or length(v_name)>240 then return jsonb_build_object('ok',false,'error','invalid_name'); end if;
    if v_document<>'' and (
      (v_customer_type='individual' and not private.br_valid_cpf(v_document)) or
      (v_customer_type='company' and not private.br_valid_cnpj(v_document))
    ) then return jsonb_build_object('ok',false,'error','invalid_document'); end if;
    if v_document<>'' and exists(
      select 1 from public.customers where tenant_id=v.tenant_id and document=v_document and id<>v_id
    ) then return jsonb_build_object('ok',false,'error','document_already_registered'); end if;
    if exists(select 1 from public.customers where id=v_id and tenant_id<>v.tenant_id) then
      return jsonb_build_object('ok',false,'error','record_not_found'); end if;
    insert into public.customers(
      id,tenant_id,company_id,type,name,document,email,phone,active
    ) values (
      v_id,v.tenant_id,v.company_id,v_customer_type,v_name,nullif(v_document,''),
      nullif(trim(coalesce(p_payload->>'email','')),''),
      nullif(trim(coalesce(p_payload->>'phone','')),''),true
    ) on conflict(id) do update set
      name=excluded.name,type=excluded.type,document=excluded.document,
      email=excluded.email,phone=excluded.phone,updated_at=now()
    where public.customers.tenant_id=v.tenant_id;
    v_result:=jsonb_build_object('ok',true,'id',v_id,'kind',p_kind);

  elsif p_kind='product_create' then
    v_name:=trim(coalesce(p_payload->>'name',''));
    if v_name='' or length(v_name)>240 then return jsonb_build_object('ok',false,'error','invalid_name'); end if;
    if upper(trim(coalesce(p_payload->>'unit','UN'))) not in ('UN','KG','G','L','ML','CX','PC','FD','MT') then
      return jsonb_build_object('ok',false,'error','invalid_unit'); end if;
    if nullif(p_payload->>'ncm','') is not null and
       (p_payload->>'ncm') !~ '^[0-9]{8}$' then return jsonb_build_object('ok',false,'error','invalid_ncm'); end if;
    v_price:=nullif(p_payload->>'sale_price','')::numeric;
    v_cost:=nullif(p_payload->>'cost_price','')::numeric;
    if v_price is null or v_price<0 or v_price>9999999 or v_cost is null or v_cost<0 or v_cost>9999999 then
      return jsonb_build_object('ok',false,'error','invalid_price'); end if;
    if nullif(trim(coalesce(p_payload->>'category','')),'') is not null then
      select g.id into v_group from public.product_groups g
       where g.tenant_id=v.tenant_id and lower(g.name)=lower(trim(p_payload->>'category')) limit 1;
      if v_group is null then return jsonb_build_object('ok',false,'error','category_not_found'); end if;
    end if;
    if exists(select 1 from public.products where id=v_id) then return jsonb_build_object('ok',false,'error','product_id_exists'); end if;
    insert into public.products(id,tenant_id,company_id,sku,name,unit,group_id,ncm,cost_price,sale_price,active)
    values(v_id,v.tenant_id,v.company_id,coalesce(nullif(p_payload->>'sku',''), 'LOC-'||substr(v_id::text,1,8)),
      v_name,upper(trim(coalesce(p_payload->>'unit','UN'))),v_group,
      nullif(p_payload->>'ncm',''),v_cost,v_price,true);
    v_result:=jsonb_build_object('ok',true,'id',v_id,'kind',p_kind);

  elsif p_kind='product_price' then
    v_price:=nullif(p_payload->>'sale_price','')::numeric;
    if v_price is null or v_price<0 or v_price>9999999 then return jsonb_build_object('ok',false,'error','invalid_price'); end if;
    update public.products set sale_price=v_price,updated_at=now()
     where id=v_id and tenant_id=v.tenant_id;
    if not found then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
    select pt.id into v_table from public.price_tables pt
      where pt.tenant_id=v.tenant_id and pt.company_id=v.company_id and pt.is_default=true and pt.active=true
      order by pt.updated_at desc limit 1;
    if v_table is not null then
      insert into public.price_table_items(price_table_id,product_id,price)
      values(v_table,v_id,v_price)
      on conflict(price_table_id,product_id) do update set price=excluded.price;
    end if;
    v_result:=jsonb_build_object('ok',true,'id',v_id,'kind',p_kind);

  elsif p_kind='stock_adjust' then
    v_delta:=nullif(p_payload->>'delta','')::numeric;
    if v_delta is null or v_delta=0 or abs(v_delta)>9999999 then
      return jsonb_build_object('ok',false,'error','invalid_quantity'); end if;
    perform 1 from public.products where id=v_id and tenant_id=v.tenant_id;
    if not found then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity,updated_at)
    values(v.tenant_id,v.branch_id,v_id,0,0,now())
    on conflict(branch_id,product_id) do nothing;
    select quantity into v_old from public.inventory_balances
     where branch_id=v.branch_id and product_id=v_id for update;
    if v_old+v_delta<0 then return jsonb_build_object('ok',false,'error','insufficient_stock'); end if;
    update public.inventory_balances set quantity=quantity+v_delta,updated_at=now()
     where branch_id=v.branch_id and product_id=v_id;
    insert into public.stock_movements(
      tenant_id,branch_id,product_id,movement_type,quantity,reference_type,reference_id,notes,
      actor_type,actor_id
    ) values (
      v.tenant_id,v.branch_id,v_id,
      case when v_delta>0 then 'in' else 'out' end,abs(v_delta),
      'pdv_catalog',p_event_id,
      'Ajuste PDV: '||left(trim(coalesce(p_payload->>'reason','')),180),
      'staff_user',v_operator
    );
    v_result:=jsonb_build_object('ok',true,'id',v_id,'kind',p_kind,'quantity',v_old+v_delta);
  end if;

  insert into public.pdv_catalog_mutations(id,tenant_id,device_id,operator_user_id,kind,payload,result)
  values(p_event_id,v.tenant_id,v.device_id,v_operator,p_kind,p_payload,v_result);
  return v_result;
exception when unique_violation then
  select m.result into v_existing from public.pdv_catalog_mutations m
  where m.id=p_event_id and m.device_id=v.device_id;
  if v_existing is not null then return v_existing||jsonb_build_object('idempotent',true); end if;
  return jsonb_build_object('ok',false,'error','duplicate_record');
when others then
  raise;
end $$;

revoke all on function public.pdv_catalog_apply_v1(text,uuid,text,jsonb) from public;
grant execute on function public.pdv_catalog_apply_v1(text,uuid,text,jsonb) to anon,authenticated;
