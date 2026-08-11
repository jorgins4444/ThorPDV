create or replace function public.erp_fiscal_documents_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
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
end;
$function$;

create or replace function public.fiscal_document_delivery(
  p_access_token text,
  p_access_kind text,
  p_document uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v_ctx record;
  f public.fiscal_documents%rowtype;
  v_xml text;
  v_issuer jsonb;
  v_branch jsonb;
  v_sale jsonb;
  v_items jsonb;
  v_payments jsonb;
begin
  select * into f from public.fiscal_documents where id=p_document;
  if f.id is null then return jsonb_build_object('ok',false,'error','document_not_found'); end if;

  if p_access_kind='session' then
    select * into v_ctx from private.resolve_temp_context(p_access_token);
    if v_ctx.user_id is null or v_ctx.tenant_id<>f.tenant_id or v_ctx.company_id<>f.company_id then
      return jsonb_build_object('ok',false,'error','invalid_session');
    end if;
  elsif p_access_kind='device' then
    select * into v_ctx from private.resolve_pdv_device(p_access_token);
    if v_ctx.device_id is null or v_ctx.tenant_id<>f.tenant_id or v_ctx.company_id<>f.company_id or v_ctx.branch_id<>f.branch_id then
      return jsonb_build_object('ok',false,'error','invalid_device');
    end if;
  else
    return jsonb_build_object('ok',false,'error','invalid_access_kind');
  end if;

  if f.document_type<>'nfce' then return jsonb_build_object('ok',false,'error','nfce_only'); end if;
  if f.status not in ('authorized','cancelled') then return jsonb_build_object('ok',false,'error','fiscal_document_not_available','status',f.status); end if;

  v_xml:=coalesce(f.response_payload->>'authorized_xml',f.response_payload->>'xml');
  if nullif(v_xml,'') is null then return jsonb_build_object('ok',false,'error','xml_not_available'); end if;

  select jsonb_build_object(
    'legal_name',c.legal_name,'trade_name',c.trade_name,'cnpj',coalesce(nullif(b.cnpj,''),c.cnpj),
    'state_registration',c.state_registration
  ), jsonb_build_object(
    'name',b.name,'street',b.street,'number',b.number,'complement',b.complement,
    'district',b.district,'city',b.city,'state',b.state,'postal_code',b.postal_code,'ibge_city_code',b.ibge_city_code
  )
  into v_issuer,v_branch
  from public.companies c
  join public.branches b on b.id=f.branch_id
  where c.id=f.company_id and c.tenant_id=f.tenant_id;

  select to_jsonb(x) into v_sale
  from (
    select s.id,s.number,s.total,s.subtotal,s.discount,s.surcharge,s.completed_at,s.created_at,s.consumer_document
    from public.sales s where s.id=f.sale_id and s.tenant_id=f.tenant_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_items
  from (
    select si.sku,si.description,si.quantity,si.unit_price,si.discount,si.total,si.created_at
    from public.sale_items si where si.sale_id=f.sale_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_payments
  from (
    select p.method,p.amount,p.status,p.created_at
    from public.payments p where p.sale_id=f.sale_id
  ) x;

  return jsonb_build_object(
    'ok',true,
    'document',jsonb_build_object(
      'id',f.id,'sale_id',f.sale_id,'document_type',f.document_type,'environment',f.environment,'status',f.status,
      'series',f.series,'number',f.number,'access_key',f.access_key,'protocol',f.protocol,'authorization_at',f.authorization_at,
      'cancellation_protocol',f.cancellation_protocol,'cancellation_at',f.cancellation_at,
      'qr_code_url',coalesce(f.response_payload->>'qr_code_url',f.request_payload->>'qr_code_url')
    ),
    'issuer',coalesce(v_issuer,'{}'::jsonb),'branch',coalesce(v_branch,'{}'::jsonb),'sale',coalesce(v_sale,'{}'::jsonb),
    'items',coalesce(v_items,'[]'::jsonb),'payments',coalesce(v_payments,'[]'::jsonb),'xml',v_xml
  );
end;
$function$;

create or replace function public.erp_sales_cash_fiscal_xml(p_token text, p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare v record; f fiscal_documents%rowtype; x text;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 select * into f from fiscal_documents where id=p_document and tenant_id=v.tenant_id and company_id=v.company_id;
 if f.id is null then return jsonb_build_object('ok',false,'error','document_not_found'); end if;
 if f.status not in ('authorized','cancelled') then return jsonb_build_object('ok',false,'error','document_not_available','status',f.status); end if;
 x:=coalesce(f.response_payload->>'authorized_xml',f.response_payload->>'xml');
 if nullif(x,'') is null then return jsonb_build_object('ok',false,'error','xml_not_available'); end if;
 return jsonb_build_object('ok',true,'xml',x,'xml_path',f.xml_path,'status',f.status,'filename','NFCe-'||coalesce(f.number,f.id::text)||'.xml');
end;
$function$;

grant execute on function public.erp_fiscal_documents_v2(text) to anon, authenticated, service_role;
grant execute on function public.fiscal_document_delivery(text,text,uuid) to anon, authenticated, service_role;
grant execute on function public.erp_sales_cash_fiscal_xml(text,uuid) to anon, authenticated, service_role;
