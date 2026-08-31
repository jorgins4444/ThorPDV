create or replace function public.erp_nfe_manual_draft_create(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  c public.companies%rowtype;
  b public.branches%rowtype;
  cfg public.fiscal_settings%rowtype;
  sr public.fiscal_series%rowtype;
  v_doc uuid;
  v_number bigint;
  v_errors jsonb := '[]'::jsonb;
  v_ready jsonb;
  v_recipient jsonb := coalesce(p_payload->'recipient','{}'::jsonb);
  v_operation jsonb := coalesce(p_payload->'operation','{}'::jsonb);
  v_items jsonb := coalesce(p_payload->'items','[]'::jsonb);
  v_transport jsonb := coalesce(p_payload->'transport','{}'::jsonb);
  v_billing jsonb := coalesce(p_payload->'billing','{}'::jsonb);
  v_additional jsonb := coalesce(p_payload->'additional','{}'::jsonb);
  v_series_id uuid;
  v_doc_digits text;
  v_total numeric := 0;
  v_freight numeric := greatest(coalesce((p_payload#>>'{totals,freight}')::numeric,0),0);
  v_insurance numeric := greatest(coalesce((p_payload#>>'{totals,insurance}')::numeric,0),0);
  v_other numeric := greatest(coalesce((p_payload#>>'{totals,other}')::numeric,0),0);
  v_item jsonb;
  v_idx integer := 0;
  v_qty numeric;
  v_unit numeric;
  v_discount numeric;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;

  perform private.ensure_fiscal_defaults(v.tenant_id,v.company_id,v.branch_id);
  select * into c from public.companies where id=v.company_id;
  select * into b from public.branches where id=v.branch_id;
  select * into cfg from public.fiscal_settings where tenant_id=v.tenant_id;
  v_ready:=private.fiscal_readiness_v076(v.tenant_id,v.company_id,v.branch_id);
  if not coalesce((v_ready->>'ready')::boolean,false) then
    return jsonb_build_object('ok',false,'error','fiscal_configuration_incomplete','validation_errors',coalesce(v_ready->'missing_fields','[]'::jsonb),'readiness',v_ready);
  end if;

  if nullif(btrim(coalesce(v_operation->>'nature_operation','')),'') is null then v_errors:=v_errors||jsonb_build_array('Natureza da operação não informada'); end if;
  if coalesce(v_operation->>'purpose','1') not in ('1','2','3','4') then v_errors:=v_errors||jsonb_build_array('Finalidade da NF-e inválida'); end if;

  v_doc_digits:=regexp_replace(coalesce(v_recipient->>'document',''),'\D','','g');
  if length(v_doc_digits) not in (11,14) then v_errors:=v_errors||jsonb_build_array('CPF/CNPJ do destinatário inválido'); end if;
  if nullif(btrim(coalesce(v_recipient->>'name','')),'') is null then v_errors:=v_errors||jsonb_build_array('Nome/Razão Social do destinatário não informado'); end if;
  if nullif(btrim(coalesce(v_recipient->>'street','')),'') is null then v_errors:=v_errors||jsonb_build_array('Logradouro do destinatário não informado'); end if;
  if nullif(btrim(coalesce(v_recipient->>'number','')),'') is null then v_errors:=v_errors||jsonb_build_array('Número do endereço do destinatário não informado'); end if;
  if nullif(btrim(coalesce(v_recipient->>'district','')),'') is null then v_errors:=v_errors||jsonb_build_array('Bairro do destinatário não informado'); end if;
  if nullif(btrim(coalesce(v_recipient->>'city','')),'') is null then v_errors:=v_errors||jsonb_build_array('Município do destinatário não informado'); end if;
  if length(btrim(coalesce(v_recipient->>'state','')))<>2 then v_errors:=v_errors||jsonb_build_array('UF do destinatário inválida'); end if;
  if length(regexp_replace(coalesce(v_recipient->>'postal_code',''),'\D','','g'))<>8 then v_errors:=v_errors||jsonb_build_array('CEP do destinatário inválido'); end if;
  if length(regexp_replace(coalesce(v_recipient->>'ibge_city_code',''),'\D','','g'))<>7 then v_errors:=v_errors||jsonb_build_array('Código IBGE do município do destinatário inválido'); end if;

  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then
    v_errors:=v_errors||jsonb_build_array('Inclua pelo menos um item na NF-e');
  else
    for v_item in select value from jsonb_array_elements(v_items) loop
      v_idx:=v_idx+1;
      v_qty:=coalesce((v_item->>'quantity')::numeric,0);
      v_unit:=coalesce((v_item->>'unit_price')::numeric,0);
      v_discount:=greatest(coalesce((v_item->>'discount')::numeric,0),0);
      if nullif(btrim(coalesce(v_item->>'description','')),'') is null then v_errors:=v_errors||jsonb_build_array(format('Item %s sem descrição',v_idx)); end if;
      if v_qty<=0 then v_errors:=v_errors||jsonb_build_array(format('Item %s com quantidade inválida',v_idx)); end if;
      if v_unit<0 then v_errors:=v_errors||jsonb_build_array(format('Item %s com valor unitário inválido',v_idx)); end if;
      if length(regexp_replace(coalesce(v_item->>'ncm',''),'\D','','g'))<>8 then v_errors:=v_errors||jsonb_build_array(format('Item %s com NCM inválido',v_idx)); end if;
      if length(regexp_replace(coalesce(v_item->>'cfop',''),'\D','','g'))<>4 then v_errors:=v_errors||jsonb_build_array(format('Item %s com CFOP inválido',v_idx)); end if;
      if coalesce((v_item->>'origin')::integer,-1) not between 0 and 8 then v_errors:=v_errors||jsonb_build_array(format('Item %s com origem inválida',v_idx)); end if;
      if nullif(btrim(coalesce(v_item->>'unit','')),'') is null then v_errors:=v_errors||jsonb_build_array(format('Item %s sem unidade',v_idx)); end if;
      v_total:=v_total+greatest((v_qty*v_unit)-v_discount,0);
    end loop;
  end if;
  v_total:=round(v_total+v_freight+v_insurance+v_other,2);
  if v_total<=0 then v_errors:=v_errors||jsonb_build_array('Valor total da NF-e deve ser maior que zero'); end if;

  if jsonb_array_length(v_errors)>0 then
    return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',v_errors,'ready_to_send',false);
  end if;

  begin v_series_id:=nullif(p_payload->>'series_id','')::uuid; exception when others then return jsonb_build_object('ok',false,'error','fiscal_series_not_found'); end;
  if v_series_id is not null then
    select * into sr from public.fiscal_series where id=v_series_id and tenant_id=v.tenant_id and branch_id=v.branch_id and document_type='nfe' and active;
  else
    select * into sr from public.fiscal_series where tenant_id=v.tenant_id and branch_id=v.branch_id and document_type='nfe' and active order by is_default desc,series asc limit 1;
  end if;
  if sr.id is null then return jsonb_build_object('ok',false,'error','fiscal_series_not_configured'); end if;

  select * into sr from public.fiscal_series where id=sr.id for update;
  v_number:=sr.last_number+1;
  if v_number>999999999 then return jsonb_build_object('ok',false,'error','fiscal_number_limit_reached'); end if;
  update public.fiscal_series set last_number=v_number,updated_at=now() where id=sr.id;

  insert into public.fiscal_documents(
    tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,number,provider,request_payload,response_payload
  ) values(
    v.tenant_id,v.company_id,v.branch_id,null,'nfe',coalesce(cfg.environment,'homologation'),'draft',sr.series::text,v_number::text,'svrs_direct',
    jsonb_build_object(
      'source','manual_nfe',
      'issuer',jsonb_build_object('company',to_jsonb(c),'branch',to_jsonb(b)),
      'operation',v_operation,
      'recipient',v_recipient,
      'items',v_items,
      'transport',v_transport,
      'billing',v_billing,
      'additional',v_additional,
      'totals',jsonb_build_object('products',round(v_total-v_freight-v_insurance-v_other,2),'freight',v_freight,'insurance',v_insurance,'other',v_other,'total',v_total),
      'series_id',sr.id,
      'created_by',v.user_id,
      'created_at',now()
    ),
    jsonb_build_object('validation_errors','[]'::jsonb,'manual_draft',true)
  ) returning id into v_doc;

  return jsonb_build_object('ok',true,'id',v_doc,'number',v_number,'series',sr.series,'total',v_total,'status','draft','source','manual_nfe');
end
$function$;

create or replace function public.erp_fiscal_documents_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_data
  from (
    select
      f.id,f.sale_id,f.document_type,f.environment,f.status,f.series,f.number,
      f.access_key,f.protocol,f.authorization_at,f.cancellation_protocol,f.cancellation_at,
      f.rejection_code,f.rejection_message,f.provider,f.xml_path,f.pdf_path,f.created_at,f.updated_at,
      coalesce(nullif(f.request_payload->>'source',''),case when f.sale_id is not null then 'sale' else 'manual' end) source,
      coalesce(nullif(f.request_payload#>>'{sale,number}',''),nullif(f.request_payload#>>'{sale,sale_number}','')) sale_number,
      coalesce(nullif(f.request_payload#>>'{recipient,name}',''),nullif(f.request_payload#>>'{customer,name}','')) customer,
      coalesce(nullif(f.request_payload#>>'{totals,total}',''),nullif(f.request_payload#>>'{sale,total}','')) total,
      case when f.status='authorized' and f.authorization_at is not null then f.authorization_at+interval '30 minutes' end cancel_deadline,
      case when f.status='authorized' and f.authorization_at is not null then now()<f.authorization_at+interval '30 minutes' else false end can_cancel,
      case when f.status in ('authorized','cancelled') then
        nullif(coalesce(f.response_payload->>'authorized_xml',f.response_payload->>'xml',''),'') is not null
        or nullif(coalesce(f.xml_path,''),'') is not null
      else false end xml_available
    from public.fiscal_documents f
    where f.tenant_id=v.tenant_id and f.company_id=v.company_id
    order by f.created_at desc
    limit 250
  ) x;

  return jsonb_build_object('ok',true,'data',v_data,'server_time',now());
end
$function$;
