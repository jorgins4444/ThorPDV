alter table public.products add column if not exists product_code bigint;

with ranked as (
  select id, row_number() over(partition by tenant_id order by created_at, id) as rn
  from public.products
  where product_code is null
)
update public.products p set product_code=ranked.rn from ranked where ranked.id=p.id;

create or replace function private.assign_product_code()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $$
begin
  if new.product_code is null or new.product_code<=0 then
    perform pg_advisory_xact_lock(hashtext('product_code:'||new.tenant_id::text));
    select coalesce(max(product_code),0)+1 into new.product_code from public.products where tenant_id=new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_assign_product_code on public.products;
create trigger trg_products_assign_product_code before insert on public.products for each row execute function private.assign_product_code();

create unique index if not exists ux_products_tenant_product_code on public.products(tenant_id,product_code);
alter table public.products alter column product_code set not null;

create or replace function private.next_internal_ean13(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path='public','private'
as $$
declare v_code text; v_seq bigint;
begin
  loop
    v_seq:=nextval('public.internal_barcode_seq');
    if v_seq>999999999 then raise exception 'internal barcode sequence exhausted'; end if;
    v_code:=private.ean13_from_base('789'||lpad(v_seq::text,9,'0'));
    exit when not exists(select 1 from public.product_barcodes where tenant_id=p_tenant and barcode=v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.erp_generate_product_barcode(p_token text)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare v record; v_code text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_code:=private.next_internal_ean13(v.tenant_id);
  return jsonb_build_object('ok',true,'barcode',v_code,'kind','internal_ean13_789','prefix','789','warning','internal_not_gs1_licensed');
end;
$$;

create or replace function public.erp_product_save_v4(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare r jsonb; v record; v_code bigint;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  r:=public.erp_product_save_v3(p_token,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  select product_code into v_code from public.products where id=(r->>'id')::uuid and tenant_id=v.tenant_id;
  return r||jsonb_build_object('product_code',v_code);
end;
$$;

create or replace function public.erp_product_list_v2(p_token text,p_search text default null)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare v record; v_data jsonb; q text:='%'||coalesce(trim(p_search),'')||'%'; v_numeric bigint;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  begin v_numeric:=nullif(regexp_replace(coalesce(p_search,''),'\D','','g'),'')::bigint; exception when others then v_numeric:=null; end;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_code),'[]'::jsonb) into v_data from (
    select p.id,p.product_code,p.sku,p.name,p.description,p.unit,p.product_type,p.is_weighable,p.label_scale,p.ncm,p.cest,p.cfop_default,p.cost_price,p.sale_price,p.minimum_stock,p.active,
      p.group_id,g.name group_name,p.class_id,c.name class_name,p.production_mode,p.is_manufactured,p.production_sector,p.production_printer,p.auto_print_production,
      (select b.barcode from public.product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
      coalesce((select i.quantity-i.reserved_quantity from public.inventory_balances i where i.product_id=p.id and i.tenant_id=v.tenant_id and i.branch_id=v.branch_id),0) stock,
      p.created_at,p.updated_at
    from public.products p
    left join public.product_groups g on g.id=p.group_id
    left join public.product_classes c on c.id=p.class_id
    where p.tenant_id=v.tenant_id and (
      p_search is null or p_search='' or p.name ilike q or coalesce(p.sku,'') ilike q or p.product_code=v_numeric or
      exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.barcode ilike q)
    ) limit 500
  ) x;
  return jsonb_build_object('ok',true,'data',v_data,'branch_id',v.branch_id);
end;
$$;

create or replace function public.pdv_pull_v6(p_device_token text,p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare data jsonb; dev record; products jsonb;
begin
  data:=public.pdv_pull_v5(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into dev from private.resolve_pdv_device(p_device_token);
  select coalesce(jsonb_agg(x.obj||jsonb_build_object('product_code',p.product_code,'label_scale',coalesce(p.label_scale,false)) order by coalesce((x.obj->>'name'),p.name)),'[]'::jsonb)
    into products
  from jsonb_array_elements(coalesce(data->'products','[]'::jsonb)) x(obj)
  left join public.products p on p.id=(x.obj->>'id')::uuid and p.tenant_id=dev.tenant_id;
  data:=jsonb_set(data,'{products}',coalesce(products,'[]'::jsonb),true);
  return data;
end;
$$;
