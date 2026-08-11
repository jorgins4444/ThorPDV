create or replace function public.thorfiscal_claim_cancellation(
  p_access_token text,
  p_access_kind text,
  p_document_id uuid,
  p_reason text,
  p_operator_user_id uuid default null,
  p_supervisor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v_ctx record;
  v_doc public.fiscal_documents%rowtype;
  v_company public.companies%rowtype;
  v_branch public.branches%rowtype;
  v_cert private.fiscal_certificates%rowtype;
  v_key text;
  v_deadline timestamptz;
  v_reason text;
  v_cnpj text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if p_access_token is null or length(p_access_token) < 20 then
    return jsonb_build_object('ok',false,'error','invalid_access_token');
  end if;

  select * into v_doc
  from public.fiscal_documents
  where id=p_document_id
  for update;

  if v_doc.id is null then return jsonb_build_object('ok',false,'error','document_not_found'); end if;

  if p_access_kind='session' then
    select * into v_ctx from private.resolve_temp_context(p_access_token);
    if v_ctx.user_id is null
      or v_ctx.tenant_id<>v_doc.tenant_id
      or v_ctx.company_id<>v_doc.company_id then
      return jsonb_build_object('ok',false,'error','invalid_session');
    end if;
  elsif p_access_kind='device' then
    select * into v_ctx from private.resolve_pdv_device(p_access_token);
    if v_ctx.device_id is null
      or v_ctx.tenant_id<>v_doc.tenant_id
      or v_ctx.company_id<>v_doc.company_id
      or v_ctx.branch_id<>v_doc.branch_id then
      return jsonb_build_object('ok',false,'error','invalid_device');
    end if;
    if p_operator_user_id is null then
      return jsonb_build_object('ok',false,'error','operator_required');
    end if;
    if not private.pdv_action_allowed(
      v_doc.tenant_id,
      v_doc.branch_id,
      p_operator_user_id,
      'sale.cancel',
      p_supervisor_user_id
    ) then
      return jsonb_build_object('ok',false,'error','sale_cancel_not_authorized');
    end if;
  else
    return jsonb_build_object('ok',false,'error','invalid_access_kind');
  end if;

  if v_doc.document_type<>'nfce' then return jsonb_build_object('ok',false,'error','nfce_only'); end if;
  if v_doc.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'already_cancelled',true,
      'document_id',v_doc.id,
      'status',v_doc.status,
      'cancellation_protocol',v_doc.cancellation_protocol,
      'cancellation_at',v_doc.cancellation_at
    );
  end if;
  if v_doc.status<>'authorized' then
    return jsonb_build_object('ok',false,'error','nfce_not_authorized','status',v_doc.status);
  end if;
  if v_doc.access_key is null or v_doc.access_key !~ '^[0-9]{44}$' then
    return jsonb_build_object('ok',false,'error','nfce_access_key_missing');
  end if;
  if nullif(trim(coalesce(v_doc.protocol,'')),'') is null then
    return jsonb_build_object('ok',false,'error','nfce_authorization_protocol_missing');
  end if;
  if v_doc.authorization_at is null then
    return jsonb_build_object('ok',false,'error','nfce_authorization_time_missing');
  end if;

  v_reason:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));
  if char_length(v_reason)<15 or char_length(v_reason)>255 then
    return jsonb_build_object('ok',false,'error','nfce_cancellation_reason_invalid','min',15,'max',255);
  end if;

  v_deadline:=v_doc.authorization_at + interval '30 minutes';
  if now()>=v_deadline then
    return jsonb_build_object(
      'ok',false,
      'error','nfce_cancellation_window_expired',
      'authorization_at',v_doc.authorization_at,
      'cancel_deadline',v_deadline,
      'server_time',now()
    );
  end if;

  select * into v_company from public.companies where id=v_doc.company_id and tenant_id=v_doc.tenant_id;
  select * into v_branch from public.branches where id=v_doc.branch_id and company_id=v_doc.company_id;
  select * into v_cert from private.fiscal_certificates where tenant_id=v_doc.tenant_id and company_id=v_doc.company_id;
  if v_company.id is null or v_branch.id is null then return jsonb_build_object('ok',false,'error','fiscal_issuer_not_found'); end if;
  if v_cert.company_id is null then return jsonb_build_object('ok',false,'error','fiscal_certificate_not_configured'); end if;
  if v_cert.valid_to is not null and v_cert.valid_to<=now() then return jsonb_build_object('ok',false,'error','fiscal_certificate_expired'); end if;

  v_cnpj:=regexp_replace(coalesce(nullif(v_branch.cnpj,''),v_company.cnpj),'\D','','g');
  if length(v_cnpj)<>14 then return jsonb_build_object('ok',false,'error','issuer_cnpj_invalid'); end if;

  select secret into v_key from private.fiscal_crypto_keys where id=1;
  if v_key is null then return jsonb_build_object('ok',false,'error','fiscal_crypto_key_missing'); end if;

  return jsonb_build_object(
    'ok',true,
    'document',to_jsonb(v_doc),
    'cnpj',v_cnpj,
    'cancel_deadline',v_deadline,
    'server_time',now(),
    'certificate',jsonb_build_object(
      'pfx_base64',encode(extensions.pgp_sym_decrypt_bytea(v_cert.pfx_cipher,v_key),'base64'),
      'password',extensions.pgp_sym_decrypt(v_cert.password_cipher,v_key),
      'valid_to',v_cert.valid_to,
      'fingerprint_sha256',v_cert.fingerprint_sha256
    )
  );
end;
$function$;

create or replace function public.pdv_pull_v7(p_device_token text, p_since timestamp with time zone default null::timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  data jsonb;
  enriched jsonb;
begin
  data:=public.pdv_pull_v6(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;

  select coalesce(jsonb_agg(
    x.obj || jsonb_build_object(
      'fiscal',
      case when fd.id is null then x.obj->'fiscal'
      else coalesce(x.obj->'fiscal','{}'::jsonb) || jsonb_build_object(
        'last_error_code',fd.last_error_code,
        'last_error_message',fd.last_error_message,
        'last_attempt_at',fd.last_attempt_at,
        'attempt_count',fd.attempt_count,
        'cStat',coalesce(nullif(fd.response_payload->>'cStat',''),nullif(fd.rejection_code,'')),
        'xMotivo',coalesce(nullif(fd.response_payload->>'xMotivo',''),nullif(fd.rejection_message,'')),
        'retryable',coalesce((fd.response_payload->>'retry_same_xml')::boolean,false) or fd.status='transmission_error',
        'cancellation_protocol',fd.cancellation_protocol,
        'cancellation_at',fd.cancellation_at,
        'cancel_deadline',case when fd.status='authorized' and fd.authorization_at is not null then fd.authorization_at+interval '30 minutes' else null end,
        'cancel_window_seconds',1800,
        'can_cancel',case when fd.status='authorized' and fd.authorization_at is not null then now()<fd.authorization_at+interval '30 minutes' else false end,
        'events',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',e.id,'type',e.event_type,'level',e.level,'code',e.code,'message',e.message,'payload',e.payload,'created_at',e.created_at
          ) order by e.created_at)
          from (
            select * from public.fiscal_document_events fe
            where fe.fiscal_document_id=fd.id
            order by fe.created_at desc limit 30
          ) e
        ),'[]'::jsonb)
      ) end
    ) order by coalesce((x.obj->>'completed_at')::timestamptz,(x.obj->>'created_at')::timestamptz) desc
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(data->'sales_history','[]'::jsonb)) x(obj)
  left join public.fiscal_documents fd
    on fd.id=nullif(x.obj#>>'{fiscal,id}','')::uuid;

  data:=jsonb_set(data,'{sales_history}',coalesce(enriched,'[]'::jsonb),true);
  return data;
end;
$function$;
