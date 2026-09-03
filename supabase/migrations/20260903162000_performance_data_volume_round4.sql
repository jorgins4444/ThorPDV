create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_products_active_name_trgm
  on public.products using gin (name extensions.gin_trgm_ops)
  where active = true;

create index if not exists idx_products_active_sku_trgm
  on public.products using gin (sku extensions.gin_trgm_ops)
  where active = true and sku is not null;

create index if not exists idx_product_barcodes_barcode_trgm
  on public.product_barcodes using gin (barcode extensions.gin_trgm_ops);

create or replace function public.erp_sale_catalog_v2(
  p_token text,
  p_price_table_id uuid default null,
  p_search text default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v record;
  v_table uuid;
  v_data jsonb;
  v_applied integer;
  v_limit integer := least(greatest(coalesce(p_limit,40),1),80);
  v_search text := trim(coalesce(p_search,''));
  q text := '%' || trim(coalesce(p_search,'')) || '%';
  v_numeric bigint;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  v_applied := private.apply_due_price_adjustments(v.tenant_id);

  if p_price_table_id is not null then
    select id into v_table
      from public.price_tables
     where id=p_price_table_id
       and tenant_id=v.tenant_id
       and active=true
       and (valid_from is null or valid_from<=current_date)
       and (valid_to is null or valid_to>=current_date);
    if v_table is null then
      return jsonb_build_object('ok',false,'error','invalid_price_table');
    end if;
  else
    select id into v_table
      from public.price_tables
     where tenant_id=v.tenant_id
       and company_id=v.company_id
       and is_default=true
       and active=true
       and (valid_from is null or valid_from<=current_date)
       and (valid_to is null or valid_to>=current_date)
     limit 1;
  end if;

  if v_search = '' then
    return jsonb_build_object(
      'ok',true,
      'price_table_id',v_table,
      'data','[]'::jsonb,
      'executed_adjustments',v_applied,
      'search_required',true
    );
  end if;

  begin
    v_numeric := nullif(regexp_replace(v_search,'\D','','g'),'')::bigint;
  exception when others then
    v_numeric := null;
  end;

  with candidates as (
    select
      p.id,p.product_code,p.sku,p.name,p.unit,
      p.image_url,p.menu_image_url,p.self_service_image_url,
      case
        when p.product_code=v_numeric then 0
        when lower(p.name)=lower(v_search) then 1
        when exists(select 1 from public.product_barcodes eb where eb.product_id=p.id and eb.barcode=v_search) then 1
        else 2
      end as rank
    from public.products p
    where p.tenant_id=v.tenant_id
      and p.active=true
      and coalesce(p.product_structure,'simple')<>'grade'
      and exists (
        select 1
        from public.inventory_balances ib
        where ib.tenant_id=v.tenant_id
          and ib.branch_id=v.branch_id
          and ib.product_id=p.id
          and coalesce(ib.quantity,0)-coalesce(ib.reserved_quantity,0)>0
      )
      and (
        p.product_code=v_numeric
        or p.name ilike q
        or coalesce(p.sku,'') ilike q
        or exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.barcode ilike q)
      )
    order by rank,p.name
    limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank,x.name),'[]'::jsonb)
    into v_data
  from (
    select
      c.id,c.product_code,c.sku,c.name,c.unit,
      c.image_url,c.menu_image_url,c.self_service_image_url,
      (select b.barcode from public.product_barcodes b where b.product_id=c.id order by b.is_primary desc,b.created_at limit 1) barcode,
      private.resolve_effective_price(v.tenant_id,v.company_id,c.id,v_table,1) effective_price,
      coalesce((select sum(i.quantity-i.reserved_quantity) from public.inventory_balances i where i.tenant_id=v.tenant_id and i.branch_id=v.branch_id and i.product_id=c.id),0) stock,
      c.rank
    from candidates c
  ) x;

  return jsonb_build_object(
    'ok',true,
    'price_table_id',v_table,
    'data',v_data,
    'limit',v_limit,
    'search',v_search,
    'executed_adjustments',v_applied
  );
end;
$$;

create or replace function public.erp_product_compact_catalog_v1(
  p_token text,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v record;
  v_data jsonb;
  v_total bigint;
  v_limit integer := least(greatest(coalesce(p_limit,500),1),500);
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  select count(*) into v_total
    from public.products p
   where p.tenant_id=v.tenant_id
     and p.parent_product_id is null
     and p.active=true;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_code),'[]'::jsonb)
    into v_data
  from (
    select p.id,p.product_code,p.sku,p.name,p.unit,p.cost_price,p.sale_price,p.active
      from public.products p
     where p.tenant_id=v.tenant_id
       and p.parent_product_id is null
       and p.active=true
     order by p.product_code
     limit v_limit
  ) x;

  return jsonb_build_object('ok',true,'data',v_data,'total',v_total,'limit',v_limit,'offset',0,'branch_id',v.branch_id);
end;
$$;

grant execute on function public.erp_sale_catalog_v2(text,uuid,text,integer) to anon, authenticated, service_role;
grant execute on function public.erp_product_compact_catalog_v1(text,integer) to anon, authenticated, service_role;
