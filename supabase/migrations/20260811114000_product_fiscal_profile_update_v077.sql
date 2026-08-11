create or replace function public.erp_product_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v record;
  v_id uuid;
  v_is_new boolean;
  v_barcode text;
  v_unit text;
  v_stock numeric := greatest(coalesce(nullif(p_payload->>'stock_to_add','')::numeric,0),0);
  v_cost numeric := greatest(coalesce(nullif(p_payload->>'cost_price','')::numeric,0),0);
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_id := nullif(p_payload->>'id','')::uuid;
  v_is_new := v_id is null;
  v_unit := upper(coalesce(nullif(trim(p_payload->>'unit'),''),'UN'));
  if v_unit <> all(array['UN','KG','CX','PC','PCT','FD','LT','ML','G','M','M2','M3','DZ','BD','SC','RL']) then
    return jsonb_build_object('ok',false,'error','invalid_unit');
  end if;

  if coalesce((p_payload->>'generate_barcode')::boolean,false) then
    v_barcode := private.next_internal_ean13(v.tenant_id);
  else
    v_barcode := nullif(regexp_replace(coalesce(p_payload->>'barcode',''),'\s','','g'),'');
  end if;

  if v_barcode is not null and exists(select 1 from product_barcodes where tenant_id=v.tenant_id and barcode=v_barcode and (v_id is null or product_id<>v_id)) then
    return jsonb_build_object('ok',false,'error','barcode_already_exists');
  end if;

  if v_is_new then
    insert into products(tenant_id,company_id,sku,name,description,unit,is_weighable,ncm,cest,origin,cfop_default,fiscal_profile,cost_price,sale_price,minimum_stock,active,group_id,class_id)
    values(v.tenant_id,v.company_id,nullif(p_payload->>'sku',''),p_payload->>'name',nullif(p_payload->>'description',''),v_unit,coalesce((p_payload->>'is_weighable')::boolean,false),nullif(p_payload->>'ncm',''),nullif(p_payload->>'cest',''),coalesce(nullif(p_payload->>'origin','')::smallint,0),nullif(p_payload->>'cfop_default',''),coalesce(p_payload->'fiscal_profile','{}'::jsonb),v_cost,greatest(coalesce(nullif(p_payload->>'sale_price','')::numeric,0),0),greatest(coalesce(nullif(p_payload->>'minimum_stock','')::numeric,0),0),coalesce((p_payload->>'active')::boolean,true),nullif(p_payload->>'group_id','')::uuid,nullif(p_payload->>'class_id','')::uuid)
    returning id into v_id;
  else
    update products set
      sku=case when p_payload ? 'sku' then nullif(p_payload->>'sku','') else sku end,
      name=coalesce(nullif(p_payload->>'name',''),name),
      description=case when p_payload ? 'description' then nullif(p_payload->>'description','') else description end,
      unit=v_unit,
      is_weighable=coalesce((p_payload->>'is_weighable')::boolean,is_weighable),
      ncm=case when p_payload ? 'ncm' then nullif(p_payload->>'ncm','') else ncm end,
      cest=case when p_payload ? 'cest' then nullif(p_payload->>'cest','') else cest end,
      origin=case when p_payload ? 'origin' then coalesce(nullif(p_payload->>'origin','')::smallint,origin) else origin end,
      cfop_default=case when p_payload ? 'cfop_default' then nullif(p_payload->>'cfop_default','') else cfop_default end,
      fiscal_profile=case when p_payload ? 'fiscal_profile' then coalesce(p_payload->'fiscal_profile','{}'::jsonb) else fiscal_profile end,
      cost_price=coalesce(nullif(p_payload->>'cost_price','')::numeric,cost_price),
      sale_price=coalesce(nullif(p_payload->>'sale_price','')::numeric,sale_price),
      minimum_stock=coalesce(nullif(p_payload->>'minimum_stock','')::numeric,minimum_stock),
      active=coalesce((p_payload->>'active')::boolean,active),
      group_id=case when p_payload ? 'group_id' then nullif(p_payload->>'group_id','')::uuid else group_id end,
      class_id=case when p_payload ? 'class_id' then nullif(p_payload->>'class_id','')::uuid else class_id end,
      updated_at=now()
    where id=v_id and tenant_id=v.tenant_id;
    if not found then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
  end if;

  if v_barcode is not null then
    update product_barcodes set is_primary=false where tenant_id=v.tenant_id and product_id=v_id;
    insert into product_barcodes(tenant_id,product_id,barcode,is_primary)
    values(v.tenant_id,v_id,v_barcode,true)
    on conflict(tenant_id,barcode) do update set product_id=excluded.product_id,is_primary=true;
  end if;

  if v_stock > 0 then
    insert into stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes)
    values(v.tenant_id,v.branch_id,v_id,'in',v_stock,v_cost,'product_initial_stock',v_id,'Entrada informada no cadastro do produto');
    insert into inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity)
    values(v.tenant_id,v.branch_id,v_id,v_stock,0)
    on conflict(tenant_id,branch_id,product_id) do update set quantity=inventory_balances.quantity+excluded.quantity,updated_at=now();
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'barcode',v_barcode,'stock_added',v_stock,'is_new',v_is_new);
end;
$function$;
