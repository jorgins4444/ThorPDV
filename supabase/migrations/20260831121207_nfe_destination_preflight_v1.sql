create or replace function public.erp_fiscal_prepare_v2(p_token text, p_sale_id uuid, p_document_type text, p_series_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v record;
  s public.sales%rowtype;
  c public.companies%rowtype;
  b public.branches%rowtype;
  cu public.customers%rowtype;
  cfg public.fiscal_settings%rowtype;
  cert record;
  sr public.fiscal_series%rowtype;
  v_doc uuid;
  v_number bigint;
  v_errors jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_pos uuid;
  v_dest_doc text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_document_type not in ('nfe','nfce') then return jsonb_build_object('ok',false,'error','unsupported_document_type'); end if;

  select * into s from public.sales where id=p_sale_id and tenant_id=v.tenant_id and status='completed';
  if s.id is null then return jsonb_build_object('ok',false,'error','sale_not_found'); end if;
  if exists(select 1 from public.fiscal_documents where sale_id=p_sale_id and document_type=p_document_type and status not in ('cancelled','rejected')) then
    return jsonb_build_object('ok',false,'error','fiscal_document_already_exists');
  end if;

  perform private.ensure_fiscal_defaults(s.tenant_id,s.company_id,s.branch_id);
  select * into c from public.companies where id=s.company_id;
  select * into b from public.branches where id=s.branch_id;
  select * into cfg from public.fiscal_settings where tenant_id=s.tenant_id;
  select * into cert from private.fiscal_certificates where tenant_id=s.tenant_id and company_id=s.company_id;
  if s.customer_id is not null then
    select * into cu from public.customers where id=s.customer_id and tenant_id=s.tenant_id and company_id=s.company_id;
  end if;

  if nullif(c.cnpj,'') is null then v_errors:=v_errors||jsonb_build_array('Empresa sem CNPJ cadastrado'); end if;
  if nullif(c.state_registration,'') is null then v_errors:=v_errors||jsonb_build_array('Empresa sem Inscrição Estadual'); end if;
  if exists(select 1 from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=p_sale_id and (nullif(p.ncm,'') is null or nullif(p.cfop_default,'') is null)) then
    v_errors:=v_errors||jsonb_build_array('Há produtos sem NCM ou CFOP padrão');
  end if;
  if cert.company_id is null then
    v_errors:=v_errors||jsonb_build_array('Certificado digital A1 (.pfx/.p12) não configurado');
  elsif cert.valid_to is not null and cert.valid_to<now() then
    v_errors:=v_errors||jsonb_build_array('Certificado digital expirado');
  end if;

  if p_document_type='nfe' then
    if cu.id is null then
      v_errors:=v_errors||jsonb_build_array('NF-e exige destinatário vinculado à venda');
    else
      v_dest_doc:=regexp_replace(coalesce(cu.document,''),'\D','','g');
      if length(v_dest_doc) not in (11,14) then v_errors:=v_errors||jsonb_build_array('CPF/CNPJ do destinatário inválido'); end if;
      if nullif(btrim(coalesce(cu.name,'')),'') is null then v_errors:=v_errors||jsonb_build_array('Nome/Razão Social do destinatário não informado'); end if;
      if nullif(btrim(coalesce(cu.street,'')),'') is null then v_errors:=v_errors||jsonb_build_array('Logradouro do destinatário não informado'); end if;
      if nullif(btrim(coalesce(cu.number,'')),'') is null then v_errors:=v_errors||jsonb_build_array('Número do endereço do destinatário não informado'); end if;
      if nullif(btrim(coalesce(cu.district,'')),'') is null then v_errors:=v_errors||jsonb_build_array('Bairro do destinatário não informado'); end if;
      if nullif(btrim(coalesce(cu.city,'')),'') is null then v_errors:=v_errors||jsonb_build_array('Município do destinatário não informado'); end if;
      if length(btrim(coalesce(cu.state,'')))<>2 then v_errors:=v_errors||jsonb_build_array('UF do destinatário inválida'); end if;
      if length(regexp_replace(coalesce(cu.postal_code,''),'\D','','g'))<>8 then v_errors:=v_errors||jsonb_build_array('CEP do destinatário inválido'); end if;
      if length(regexp_replace(coalesce(cu.ibge_city_code,''),'\D','','g'))<>7 then v_errors:=v_errors||jsonb_build_array('Código IBGE do município do destinatário inválido'); end if;
    end if;

    if jsonb_array_length(v_errors)>0 then
      return jsonb_build_object(
        'ok',false,
        'error','fiscal_preflight_failed',
        'document_type','nfe',
        'ready_to_send',false,
        'validation_errors',v_errors
      );
    end if;
  end if;

  if p_series_id is not null then
    select * into sr from public.fiscal_series where id=p_series_id and tenant_id=s.tenant_id and branch_id=s.branch_id and document_type=p_document_type and active;
    if sr.id is null then return jsonb_build_object('ok',false,'error','fiscal_series_not_found'); end if;
  elsif p_document_type='nfce' and s.cash_session_id is not null then
    select cs.pos_register_id into v_pos from public.cash_sessions cs where cs.id=s.cash_session_id;
    select fs.* into sr from public.fiscal_pos_series fps join public.fiscal_series fs on fs.id=fps.fiscal_series_id where fps.tenant_id=s.tenant_id and fps.pos_register_id=v_pos and fps.in_use and fs.active and fs.document_type='nfce' limit 1;
    if sr.id is null and exists(select 1 from public.fiscal_pos_series fps where fps.tenant_id=s.tenant_id and fps.branch_id=s.branch_id and fps.in_use) then
      return jsonb_build_object('ok',false,'error','nfce_series_not_assigned_to_cash_register');
    end if;
  end if;
  if sr.id is null then
    select * into sr from public.fiscal_series where tenant_id=s.tenant_id and branch_id=s.branch_id and document_type=p_document_type and active and is_default limit 1;
  end if;
  if sr.id is null then return jsonb_build_object('ok',false,'error','fiscal_series_not_configured'); end if;

  select * into sr from public.fiscal_series where id=sr.id for update;
  v_number:=sr.last_number+1;
  if v_number>999999999 then return jsonb_build_object('ok',false,'error','fiscal_number_limit_reached'); end if;
  update public.fiscal_series set last_number=v_number,updated_at=now() where id=sr.id;

  select jsonb_build_object(
    'sale',to_jsonb(s),
    'company',to_jsonb(c),
    'branch',to_jsonb(b),
    'customer',(select to_jsonb(cu2) from public.customers cu2 where cu2.id=s.customer_id),
    'series_id',sr.id,
    'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',si.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total,'fiscal_snapshot',si.fiscal_snapshot)) from public.sale_items si where si.sale_id=s.id),'[]'::jsonb)
  ) into v_payload;

  insert into public.fiscal_documents(tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,number,provider,request_payload,response_payload)
  values(s.tenant_id,s.company_id,s.branch_id,s.id,p_document_type,coalesce(cfg.environment,'homologation'),'draft',sr.series::text,v_number::text,'svrs_direct',v_payload,jsonb_build_object('validation_errors',v_errors))
  returning id into v_doc;

  return jsonb_build_object('ok',true,'id',v_doc,'number',v_number,'series',sr.series,'series_id',sr.id,'validation_errors',v_errors,'ready_to_send',jsonb_array_length(v_errors)=0);
end
$function$;
