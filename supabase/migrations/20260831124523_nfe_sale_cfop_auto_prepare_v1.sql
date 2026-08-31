create or replace function public.erp_nfe_sale_draft_create(p_token text,p_sale_id uuid,p_series_id uuid default null::uuid,p_operation jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  s public.sales%rowtype;
  b public.branches%rowtype;
  cu public.customers%rowtype;
  v_item record;
  v_res jsonb;
  v_items jsonb:='[]'::jsonb;
  v_errors jsonb:='[]'::jsonb;
  v_result jsonb;
  v_purpose text:=coalesce(p_operation->>'purpose','1');
  v_presence text:=coalesce(p_operation->>'presence','1');
  v_consumer_final boolean:=coalesce((p_operation->>'consumer_final')::boolean,true);
  v_indicator_ie text;
  v_cfop text;
  v_snapshot jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_purpose not in ('1','2','3','4') then return jsonb_build_object('ok',false,'error','invalid_purpose'); end if;
  if v_presence not in ('0','1','2','3','5','9') then return jsonb_build_object('ok',false,'error','invalid_presence'); end if;

  select * into s from public.sales where id=p_sale_id and tenant_id=v.tenant_id and status='completed';
  if s.id is null then return jsonb_build_object('ok',false,'error','sale_not_found'); end if;
  select * into b from public.branches where id=s.branch_id and tenant_id=s.tenant_id;
  if s.customer_id is not null then select * into cu from public.customers where id=s.customer_id and tenant_id=s.tenant_id and company_id=s.company_id; end if;
  if cu.id is null then return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',jsonb_build_array('NF-e exige destinatário vinculado à venda')); end if;
  v_indicator_ie:=case when nullif(btrim(coalesce(cu.state_registration,'')),'') is not null then '1' else '9' end;

  for v_item in
    select si.*,p.cfop_default,p.ncm product_ncm,p.name product_name
    from public.sale_items si join public.products p on p.id=si.product_id
    where si.sale_id=s.id order by si.created_at,si.id
  loop
    v_snapshot:=coalesce(v_item.fiscal_snapshot,'{}'::jsonb);
    v_cfop:=coalesce(nullif(v_snapshot->>'cfop',''),nullif(v_item.cfop_default,''));
    v_res:=private.resolve_nfe_cfop(s.tenant_id,v_cfop,v_purpose,v_presence,b.state,cu.state,v_consumer_final,v_indicator_ie);
    if nullif(v_res->>'cfop','') is null then
      v_errors:=v_errors||jsonb_build_array(format('Item %s (%s): %s',coalesce(v_item.sku,''),coalesce(v_item.description,v_item.product_name,''),coalesce(v_res->>'reason','CFOP não identificado')));
    else
      v_snapshot:=jsonb_set(v_snapshot,'{cfop}',to_jsonb(v_res->>'cfop'),true);
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'product_id',v_item.product_id,'sku',v_item.sku,'description',v_item.description,'unit',v_item.unit,
        'quantity',v_item.quantity,'unit_price',v_item.unit_price,'discount',v_item.discount,'total',v_item.total,
        'cfop',v_res->>'cfop','cfop_resolution',v_res,'fiscal_snapshot',v_snapshot
      ));
    end if;
  end loop;
  if jsonb_array_length(v_errors)>0 then
    return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',v_errors,'ready_to_send',false);
  end if;

  v_result:=public.erp_fiscal_prepare_v2(p_token,p_sale_id,'nfe',p_series_id);
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;

  update public.fiscal_documents
  set request_payload=jsonb_set(
        jsonb_set(request_payload,'{operation}',jsonb_build_object(
          'nature_operation',coalesce(nullif(p_operation->>'nature_operation',''),'VENDA DE MERCADORIA'),
          'purpose',v_purpose,'presence',v_presence,'consumer_final',v_consumer_final,
          'destination_scope',case when upper(coalesce(cu.state,''))='EX' then 'foreign' when upper(coalesce(cu.state,''))=upper(coalesce(b.state,'')) then 'internal' else 'interstate' end
        ),true),
        '{items}',v_items,true
      ),updated_at=now()
  where id=(v_result->>'id')::uuid and tenant_id=v.tenant_id;

  return v_result||jsonb_build_object('cfop_automatic',true,'destination_state',cu.state,'emitter_state',b.state,'purpose',v_purpose,'presence',v_presence);
end
$function$;