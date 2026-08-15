create index if not exists products_tenant_parent_active_idx on public.products(tenant_id,parent_product_id,active);
create index if not exists products_tenant_parent_group_idx on public.products(tenant_id,parent_product_id,group_id);
create index if not exists products_tenant_parent_brand_idx on public.products(tenant_id,parent_product_id,brand_id);
create index if not exists products_tenant_parent_category_idx on public.products(tenant_id,parent_product_id,category_id);
create index if not exists products_tenant_parent_structure_idx on public.products(tenant_id,parent_product_id,product_structure);
create index if not exists products_tenant_ncm_idx on public.products(tenant_id,ncm);
create index if not exists products_tenant_reform_cst_idx on public.products(tenant_id,((fiscal_profile->>'reform_cst'))) where parent_product_id is null;
create index if not exists products_tenant_csosn_idx on public.products(tenant_id,((fiscal_profile->>'csosn'))) where parent_product_id is null;
create index if not exists products_tenant_cst_icms_idx on public.products(tenant_id,((fiscal_profile->>'cst_icms'))) where parent_product_id is null;

create or replace function public.erp_product_list_v4(
  p_token text,
  p_search text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare
  v record;
  v_data jsonb;
  v_total bigint:=0;
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),500);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  q text:='%'||coalesce(trim(p_search),'')||'%';
  v_numeric bigint;
  v_ncm text:=regexp_replace(coalesce(p_filters->>'ncm',''),'\D','','g');
  v_tax text:=coalesce(p_filters->>'tax_situation','');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  begin v_numeric:=nullif(regexp_replace(coalesce(p_search,''),'\D','','g'),'')::bigint; exception when others then v_numeric:=null; end;

  select count(*) into v_total
  from public.products p
  where p.tenant_id=v.tenant_id
    and p.parent_product_id is null
    and (p_search is null or trim(p_search)='' or p.name ilike q or coalesce(p.sku,'') ilike q or p.product_code=v_numeric
      or exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.barcode ilike q)
      or exists(select 1 from public.products vp left join public.product_barcodes vb on vb.product_id=vp.id where vp.parent_product_id=p.id and (vp.name ilike q or coalesce(vp.sku,'') ilike q or coalesce(vb.barcode,'') ilike q)))
    and (coalesce(p_filters->>'category_id','')='' or p.category_id::text=p_filters->>'category_id')
    and (coalesce(p_filters->>'brand_id','')='' or p.brand_id::text=p_filters->>'brand_id')
    and (coalesce(p_filters->>'group_id','')='' or p.group_id::text=p_filters->>'group_id')
    and (v_ncm='' or regexp_replace(coalesce(p.ncm,''),'\D','','g') like '%'||v_ncm||'%')
    and (coalesce(p_filters->>'product_structure','')='' or p.product_structure=p_filters->>'product_structure')
    and (coalesce(p_filters->>'active','')='' or (lower(p_filters->>'active')='true' and p.active=true) or (lower(p_filters->>'active')='false' and p.active=false))
    and (v_tax='' or
      (split_part(v_tax,':',1)='reform' and coalesce(p.fiscal_profile->>'reform_cst','')=split_part(v_tax,':',2)) or
      (split_part(v_tax,':',1)='csosn' and coalesce(p.fiscal_profile->>'csosn','')=split_part(v_tax,':',2)) or
      (split_part(v_tax,':',1)='cst' and coalesce(p.fiscal_profile->>'cst_icms','')=split_part(v_tax,':',2)));

  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_code),'[]'::jsonb) into v_data
  from (
    select p.id,p.product_code,p.sku,p.name,p.description,p.unit,p.product_type,p.product_structure,p.is_weighable,p.label_scale,
      p.ncm,p.cest,p.cfop_default,p.cost_price,p.sale_price,p.minimum_stock,p.active,p.image_url,p.menu_image_url,p.self_service_image_url,
      p.group_id,g.name group_name,p.class_id,c.name class_name,p.brand_id,br.name brand_name,p.category_id,cat.name category_name,
      nullif(p.fiscal_profile->>'reform_cst','') reform_cst,nullif(p.fiscal_profile->>'csosn','') csosn,nullif(p.fiscal_profile->>'cst_icms','') cst_icms,
      case when nullif(p.fiscal_profile->>'reform_cst','') is not null then 'reform:'||(p.fiscal_profile->>'reform_cst')
           when nullif(p.fiscal_profile->>'csosn','') is not null then 'csosn:'||(p.fiscal_profile->>'csosn')
           when nullif(p.fiscal_profile->>'cst_icms','') is not null then 'cst:'||(p.fiscal_profile->>'cst_icms') else null end tax_situation,
      p.production_mode,p.is_manufactured,p.production_sector,p.production_printer,p.auto_print_production,
      (select b.barcode from public.product_barcodes b where b.product_id=p.id order by b.is_primary desc,b.created_at limit 1) barcode,
      case when p.product_structure='grade' then coalesce((select sum(coalesce(i.quantity,0)-coalesce(i.reserved_quantity,0)) from public.products vp left join public.inventory_balances i on i.product_id=vp.id and i.tenant_id=v.tenant_id and i.branch_id=v.branch_id where vp.parent_product_id=p.id and vp.tenant_id=v.tenant_id and vp.active=true),0)
           else coalesce((select i.quantity-i.reserved_quantity from public.inventory_balances i where i.product_id=p.id and i.tenant_id=v.tenant_id and i.branch_id=v.branch_id),0) end stock,
      (select count(*)::int from public.products vp where vp.parent_product_id=p.id and vp.tenant_id=v.tenant_id) variant_count,
      (select min(vp.sale_price) from public.products vp where vp.parent_product_id=p.id and vp.tenant_id=v.tenant_id and vp.active=true) variant_price_min,
      (select max(vp.sale_price) from public.products vp where vp.parent_product_id=p.id and vp.tenant_id=v.tenant_id and vp.active=true) variant_price_max,
      p.created_at,p.updated_at
    from public.products p
    left join public.product_groups g on g.id=p.group_id
    left join public.product_classes c on c.id=p.class_id
    left join public.product_brands br on br.id=p.brand_id
    left join public.product_categories cat on cat.id=p.category_id
    where p.tenant_id=v.tenant_id and p.parent_product_id is null
      and (p_search is null or trim(p_search)='' or p.name ilike q or coalesce(p.sku,'') ilike q or p.product_code=v_numeric
        or exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.barcode ilike q)
        or exists(select 1 from public.products vp left join public.product_barcodes vb on vb.product_id=vp.id where vp.parent_product_id=p.id and (vp.name ilike q or coalesce(vp.sku,'') ilike q or coalesce(vb.barcode,'') ilike q)))
      and (coalesce(p_filters->>'category_id','')='' or p.category_id::text=p_filters->>'category_id')
      and (coalesce(p_filters->>'brand_id','')='' or p.brand_id::text=p_filters->>'brand_id')
      and (coalesce(p_filters->>'group_id','')='' or p.group_id::text=p_filters->>'group_id')
      and (v_ncm='' or regexp_replace(coalesce(p.ncm,''),'\D','','g') like '%'||v_ncm||'%')
      and (coalesce(p_filters->>'product_structure','')='' or p.product_structure=p_filters->>'product_structure')
      and (coalesce(p_filters->>'active','')='' or (lower(p_filters->>'active')='true' and p.active=true) or (lower(p_filters->>'active')='false' and p.active=false))
      and (v_tax='' or
        (split_part(v_tax,':',1)='reform' and coalesce(p.fiscal_profile->>'reform_cst','')=split_part(v_tax,':',2)) or
        (split_part(v_tax,':',1)='csosn' and coalesce(p.fiscal_profile->>'csosn','')=split_part(v_tax,':',2)) or
        (split_part(v_tax,':',1)='cst' and coalesce(p.fiscal_profile->>'cst_icms','')=split_part(v_tax,':',2)))
    order by p.product_code
    limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('ok',true,'data',v_data,'total',v_total,'limit',v_limit,'offset',v_offset,'branch_id',v.branch_id);
end $function$;

create or replace function public.erp_product_filtered_ids_v1(
  p_token text,
  p_search text default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare
  v record;
  v_ids jsonb;
  q text:='%'||coalesce(trim(p_search),'')||'%';
  v_numeric bigint;
  v_ncm text:=regexp_replace(coalesce(p_filters->>'ncm',''),'\D','','g');
  v_tax text:=coalesce(p_filters->>'tax_situation','');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  begin v_numeric:=nullif(regexp_replace(coalesce(p_search,''),'\D','','g'),'')::bigint; exception when others then v_numeric:=null; end;
  select coalesce(jsonb_agg(p.id order by p.product_code),'[]'::jsonb) into v_ids
  from public.products p
  where p.tenant_id=v.tenant_id and p.parent_product_id is null
    and (p_search is null or trim(p_search)='' or p.name ilike q or coalesce(p.sku,'') ilike q or p.product_code=v_numeric
      or exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.barcode ilike q)
      or exists(select 1 from public.products vp left join public.product_barcodes vb on vb.product_id=vp.id where vp.parent_product_id=p.id and (vp.name ilike q or coalesce(vp.sku,'') ilike q or coalesce(vb.barcode,'') ilike q)))
    and (coalesce(p_filters->>'category_id','')='' or p.category_id::text=p_filters->>'category_id')
    and (coalesce(p_filters->>'brand_id','')='' or p.brand_id::text=p_filters->>'brand_id')
    and (coalesce(p_filters->>'group_id','')='' or p.group_id::text=p_filters->>'group_id')
    and (v_ncm='' or regexp_replace(coalesce(p.ncm,''),'\D','','g') like '%'||v_ncm||'%')
    and (coalesce(p_filters->>'product_structure','')='' or p.product_structure=p_filters->>'product_structure')
    and (coalesce(p_filters->>'active','')='' or (lower(p_filters->>'active')='true' and p.active=true) or (lower(p_filters->>'active')='false' and p.active=false))
    and (v_tax='' or
      (split_part(v_tax,':',1)='reform' and coalesce(p.fiscal_profile->>'reform_cst','')=split_part(v_tax,':',2)) or
      (split_part(v_tax,':',1)='csosn' and coalesce(p.fiscal_profile->>'csosn','')=split_part(v_tax,':',2)) or
      (split_part(v_tax,':',1)='cst' and coalesce(p.fiscal_profile->>'cst_icms','')=split_part(v_tax,':',2)));
  return jsonb_build_object('ok',true,'ids',v_ids,'total',jsonb_array_length(v_ids));
end $function$;

create or replace function public.erp_product_set_active_v1(p_token text,p_product uuid,p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare v record; v_count integer:=0; v_name text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select name into v_name from public.products where id=p_product and tenant_id=v.tenant_id and parent_product_id is null;
  if v_name is null then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
  update public.products set active=p_active,updated_at=now()
  where tenant_id=v.tenant_id and (id=p_product or parent_product_id=p_product);
  get diagnostics v_count=row_count;
  insert into public.product_history(tenant_id,product_id,event_type,description,created_by,after_data)
  values(v.tenant_id,p_product,'status_change',case when p_active then 'Produto ativado pela listagem' else 'Produto desativado pela listagem' end,v.user_id,jsonb_build_object('active',p_active));
  return jsonb_build_object('ok',true,'id',p_product,'active',p_active,'affected',v_count);
end $function$;

create or replace function public.erp_product_bulk_update_v1(p_token text,p_product_ids uuid[],p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare
  v record;
  v_parent_ids uuid[];
  v_count integer:=0;
  v_parent_count integer:=0;
  v_group uuid;
  v_brand uuid;
  v_ncm text;
  v_tax text;
  v_tax_kind text;
  v_tax_code text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if coalesce(array_length(p_product_ids,1),0)=0 then return jsonb_build_object('ok',false,'error','no_products_selected'); end if;
  if p_patch is null or p_patch='{}'::jsonb then return jsonb_build_object('ok',false,'error','no_changes'); end if;

  select array_agg(id),count(*) into v_parent_ids,v_parent_count from public.products
  where tenant_id=v.tenant_id and parent_product_id is null and id=any(p_product_ids);
  if coalesce(v_parent_count,0)=0 then return jsonb_build_object('ok',false,'error','no_valid_products'); end if;

  if p_patch ? 'group_id' then
    v_group:=nullif(p_patch->>'group_id','')::uuid;
    if v_group is not null and not exists(select 1 from public.product_groups where id=v_group and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','invalid_group'); end if;
  end if;
  if p_patch ? 'brand_id' then
    v_brand:=nullif(p_patch->>'brand_id','')::uuid;
    if v_brand is not null and not exists(select 1 from public.product_brands where id=v_brand and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','invalid_brand'); end if;
  end if;
  if p_patch ? 'ncm' then
    v_ncm:=regexp_replace(coalesce(p_patch->>'ncm',''),'\D','','g');
    if v_ncm<>'' and length(v_ncm)<>8 then return jsonb_build_object('ok',false,'error','invalid_ncm'); end if;
  end if;
  if p_patch ? 'tax_situation' then
    v_tax:=coalesce(p_patch->>'tax_situation','');
    v_tax_kind:=split_part(v_tax,':',1); v_tax_code:=split_part(v_tax,':',2);
    if v_tax_kind not in ('reform','csosn','cst') or v_tax_code='' then return jsonb_build_object('ok',false,'error','invalid_tax_situation'); end if;
  end if;

  update public.products p set
    group_id=case when p_patch ? 'group_id' then v_group else p.group_id end,
    brand_id=case when p_patch ? 'brand_id' then v_brand else p.brand_id end,
    ncm=case when p_patch ? 'ncm' then nullif(v_ncm,'') else p.ncm end,
    is_weighable=case when p_patch ? 'is_weighable' then coalesce((p_patch->>'is_weighable')::boolean,false) else p.is_weighable end,
    fiscal_profile=case when p_patch ? 'tax_situation' then
      case v_tax_kind
        when 'reform' then case when left(coalesce(p.fiscal_profile->>'reform_classification',''),3)=v_tax_code
          then jsonb_set(coalesce(p.fiscal_profile,'{}'::jsonb),'{reform_cst}',to_jsonb(v_tax_code),true)
          else jsonb_set(coalesce(p.fiscal_profile,'{}'::jsonb),'{reform_cst}',to_jsonb(v_tax_code),true)-'reform_classification' end
        when 'csosn' then jsonb_set(coalesce(p.fiscal_profile,'{}'::jsonb)-'cst_icms','{csosn}',to_jsonb(v_tax_code),true)
        when 'cst' then jsonb_set(coalesce(p.fiscal_profile,'{}'::jsonb)-'csosn','{cst_icms}',to_jsonb(v_tax_code),true)
        else p.fiscal_profile end
      else p.fiscal_profile end,
    updated_at=now()
  where p.tenant_id=v.tenant_id and (p.id=any(v_parent_ids) or p.parent_product_id=any(v_parent_ids));
  get diagnostics v_count=row_count;

  insert into public.product_history(tenant_id,product_id,event_type,description,created_by,after_data)
  select v.tenant_id,id,'bulk_update','Cadastro alterado em massa pela listagem',v.user_id,p_patch
  from public.products where tenant_id=v.tenant_id and id=any(v_parent_ids);

  return jsonb_build_object('ok',true,'selected',v_parent_count,'affected',v_count);
end $function$;
