-- ThorFiscal: alinhamento de descontos do PDV com vProd/vDesc da NFC-e.
-- O PFX/senha somente podem ser materializados por service_role (Edge Function).
create or replace function public.thorfiscal_claim_document(
  p_access_token text,
  p_access_kind text,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v_ctx record;
  v_doc public.fiscal_documents%rowtype;
  v_sale public.sales%rowtype;
  v_company public.companies%rowtype;
  v_branch public.branches%rowtype;
  v_settings public.fiscal_settings%rowtype;
  v_cert private.fiscal_certificates%rowtype;
  v_key text;
  v_series text;
  v_number bigint;
  v_items jsonb;
  v_payments jsonb;
  v_customer jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if p_access_token is null or length(p_access_token) < 20 then
    return jsonb_build_object('ok',false,'error','invalid_access_token');
  end if;

  select * into v_doc from public.fiscal_documents where id = p_document_id for update;
  if v_doc.id is null then return jsonb_build_object('ok',false,'error','document_not_found'); end if;

  if p_access_kind = 'session' then
    select * into v_ctx from private.resolve_temp_context(p_access_token);
    if v_ctx.user_id is null or v_ctx.tenant_id <> v_doc.tenant_id or v_ctx.company_id <> v_doc.company_id then
      return jsonb_build_object('ok',false,'error','invalid_session');
    end if;
  elsif p_access_kind = 'device' then
    select * into v_ctx from private.resolve_pdv_device(p_access_token);
    if v_ctx.device_id is null or v_ctx.tenant_id <> v_doc.tenant_id or v_ctx.company_id <> v_doc.company_id or v_ctx.branch_id <> v_doc.branch_id then
      return jsonb_build_object('ok',false,'error','invalid_device');
    end if;
  else
    return jsonb_build_object('ok',false,'error','invalid_access_kind');
  end if;

  if v_doc.document_type <> 'nfce' then return jsonb_build_object('ok',false,'error','nfce_only'); end if;
  if v_doc.status = 'authorized' then
    return jsonb_build_object('ok',true,'already_authorized',true,'document',jsonb_build_object('id',v_doc.id,'status',v_doc.status,'access_key',v_doc.access_key,'protocol',v_doc.protocol,'authorization_at',v_doc.authorization_at,'number',v_doc.number,'series',v_doc.series));
  end if;
  if v_doc.status = 'cancelled' then return jsonb_build_object('ok',false,'error','document_cancelled'); end if;
  if v_doc.sale_id is null then return jsonb_build_object('ok',false,'error','sale_not_linked'); end if;

  select * into v_sale from public.sales where id=v_doc.sale_id and tenant_id=v_doc.tenant_id and company_id=v_doc.company_id;
  if v_sale.id is null or v_sale.status <> 'completed' then return jsonb_build_object('ok',false,'error','sale_not_completed'); end if;

  select * into v_company from public.companies where id=v_doc.company_id;
  select * into v_branch from public.branches where id=v_doc.branch_id;
  select * into v_settings from public.fiscal_settings where tenant_id=v_doc.tenant_id;
  select * into v_cert from private.fiscal_certificates where tenant_id=v_doc.tenant_id and company_id=v_doc.company_id;

  if v_cert.company_id is null then return jsonb_build_object('ok',false,'error','certificate_not_configured'); end if;
  if v_cert.valid_to is not null and v_cert.valid_to <= now() then return jsonb_build_object('ok',false,'error','certificate_expired','valid_to',v_cert.valid_to); end if;

  v_series := coalesce(nullif(v_doc.series,''),nullif(v_settings.nfce_series,''),'1');
  if v_doc.number is null or v_doc.number !~ '^[0-9]+$' then
    perform pg_advisory_xact_lock(hashtext(v_doc.tenant_id::text),hashtext('nfce:'||v_series));
    select coalesce(max(number::bigint),0)+1 into v_number from public.fiscal_documents where tenant_id=v_doc.tenant_id and document_type='nfce' and series=v_series and number ~ '^[0-9]+$';
    update public.fiscal_documents set series=v_series,number=v_number::text,updated_at=now() where id=v_doc.id returning * into v_doc;
  else
    v_number := v_doc.number::bigint;
  end if;

  if nullif(v_company.cnpj,'') is null or nullif(v_company.state_registration,'') is null or v_company.tax_regime is null then
    return jsonb_build_object('ok',false,'error','company_fiscal_data_incomplete');
  end if;
  if nullif(v_branch.state,'') is null or nullif(v_branch.ibge_city_code,'') is null or nullif(v_branch.city,'') is null or nullif(v_branch.street,'') is null or nullif(v_branch.number,'') is null or nullif(v_branch.district,'') is null or nullif(v_branch.postal_code,'') is null then
    return jsonb_build_object('ok',false,'error','branch_fiscal_address_incomplete');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',si.id,'product_id',si.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,
    'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total,
    'fiscal_snapshot',coalesce(si.fiscal_snapshot,'{}'::jsonb),
    'product',jsonb_build_object('ncm',p.ncm,'cest',p.cest,'origin',p.origin,'cfop_default',p.cfop_default,'fiscal_profile',coalesce(p.fiscal_profile,'{}'::jsonb))
  ) order by si.created_at),'[]'::jsonb)
  into v_items
  from public.sale_items si left join public.products p on p.id=si.product_id
  where si.sale_id=v_sale.id;

  if jsonb_array_length(v_items)=0 then return jsonb_build_object('ok',false,'error','sale_without_items'); end if;

  -- vProd precisa ser bruto e vDesc separado. O ThorPDV grava sale_items.total líquido.
  -- O desconto global é rateado com ajuste de centavos no último item.
  if coalesce(v_sale.surcharge,0) <> 0 then
    return jsonb_build_object('ok',false,'error','sale_surcharge_requires_fiscal_allocation','detail','Acréscimo global ainda precisa ser convertido em despesas acessórias por item antes da NFC-e.');
  end if;

  with x as (
    select j.obj,j.ord,coalesce((j.obj->>'total')::numeric,0) as net_value,coalesce((j.obj->>'discount')::numeric,0) as item_discount
    from jsonb_array_elements(v_items) with ordinality as j(obj,ord)
  ),
  a as (
    select x.*,count(*) over() as cnt,sum(net_value) over() as net_sum from x
  ),
  alloc as (
    select a.*,
      case
        when coalesce(v_sale.discount,0)=0 or coalesce(a.net_sum,0)=0 then 0::numeric
        when a.ord < a.cnt then round(v_sale.discount * a.net_value / a.net_sum,2)
        else v_sale.discount - coalesce((select sum(round(v_sale.discount * a2.net_value / a2.net_sum,2)) from a a2 where a2.ord < a2.cnt),0)
      end as sale_discount
    from a
  )
  select coalesce(jsonb_agg(obj || jsonb_build_object('total',round(net_value + item_discount,2),'discount',round(item_discount + sale_discount,2)) order by ord),'[]'::jsonb)
  into v_items
  from alloc;

  select coalesce(jsonb_agg(jsonb_build_object(
    'method',p.method,'status',p.status,'amount',p.amount,'tendered_amount',p.tendered_amount,'change_amount',p.change_amount,
    'provider',p.provider,'external_id',p.external_id,'txid',p.txid,'metadata',coalesce(p.metadata,'{}'::jsonb)
  ) order by p.created_at) filter (where p.status in ('approved','paid','completed') or p.status is null),'[]'::jsonb)
  into v_payments
  from public.payments p where p.sale_id=v_sale.id;

  select to_jsonb(cu) into v_customer from public.customers cu where cu.id=v_sale.customer_id;
  select secret into v_key from private.fiscal_crypto_keys where id=1;
  if v_key is null then return jsonb_build_object('ok',false,'error','fiscal_crypto_key_missing'); end if;

  update public.fiscal_documents set status='processing',provider='svrs_direct',updated_at=now(),rejection_code=null,rejection_message=null where id=v_doc.id;

  return jsonb_build_object(
    'ok',true,
    'document',to_jsonb(v_doc) || jsonb_build_object('series',v_series,'number',v_number::text),
    'sale',to_jsonb(v_sale),'company',to_jsonb(v_company),'branch',to_jsonb(v_branch),'settings',coalesce(to_jsonb(v_settings),'{}'::jsonb),
    'customer',v_customer,'items',v_items,'payments',v_payments,
    'certificate',jsonb_build_object(
      'pfx_base64',encode(extensions.pgp_sym_decrypt_bytea(v_cert.pfx_cipher,v_key),'base64'),
      'password',extensions.pgp_sym_decrypt(v_cert.password_cipher,v_key),
      'filename',v_cert.filename,'subject_cn',v_cert.subject_cn,'subject_cnpj',v_cert.subject_cnpj,'serial_number',v_cert.serial_number,
      'valid_from',v_cert.valid_from,'valid_to',v_cert.valid_to,'fingerprint_sha256',v_cert.fingerprint_sha256
    )
  );
end;
$$;

revoke all on function public.thorfiscal_claim_document(text,text,uuid) from public,anon,authenticated;
grant execute on function public.thorfiscal_claim_document(text,text,uuid) to service_role;
