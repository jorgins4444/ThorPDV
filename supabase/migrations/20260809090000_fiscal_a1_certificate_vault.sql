create table if not exists private.fiscal_crypto_keys (
  id smallint primary key check (id = 1),
  secret text not null,
  created_at timestamptz not null default now()
);
insert into private.fiscal_crypto_keys(id,secret)
values (1, encode(extensions.gen_random_bytes(32),'hex'))
on conflict (id) do nothing;

create table if not exists private.fiscal_certificates (
  company_id uuid primary key references public.companies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  filename text not null,
  pfx_cipher bytea not null,
  password_cipher bytea not null,
  subject_cn text,
  subject_cnpj text,
  serial_number text,
  valid_from timestamptz,
  valid_to timestamptz,
  fingerprint_sha256 text,
  file_sha256 text not null,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fiscal_certificates_tenant_idx on private.fiscal_certificates(tenant_id);

create or replace function public.erp_fiscal_certificate_get(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record; c record;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into c from private.fiscal_certificates where tenant_id=v.tenant_id and company_id=v.company_id;
  if c.company_id is null then return jsonb_build_object('ok',true,'configured',false,'certificate',null); end if;
  return jsonb_build_object('ok',true,'configured',true,'certificate',jsonb_build_object('filename',c.filename,'subject_cn',c.subject_cn,'subject_cnpj',c.subject_cnpj,'serial_number',c.serial_number,'valid_from',c.valid_from,'valid_to',c.valid_to,'fingerprint_sha256',c.fingerprint_sha256,'file_sha256',c.file_sha256,'uploaded_at',c.uploaded_at,'expired',(c.valid_to is not null and c.valid_to < now())));
end $function$;

create or replace function public.erp_fiscal_certificate_save(p_token text,p_filename text,p_pfx_base64 text,p_password text,p_subject_cn text default null,p_subject_cnpj text default null,p_serial_number text default null,p_valid_from timestamptz default null,p_valid_to timestamptz default null,p_fingerprint_sha256 text default null,p_file_sha256 text default null)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record; v_key text; v_pfx bytea; v_sha text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_filename is null or lower(p_filename) !~ '\.(pfx|p12)$' then return jsonb_build_object('ok',false,'error','invalid_certificate_file'); end if;
  if p_password is null or length(p_password)=0 then return jsonb_build_object('ok',false,'error','certificate_password_required'); end if;
  if p_pfx_base64 is null or length(p_pfx_base64)>8000000 then return jsonb_build_object('ok',false,'error','certificate_too_large'); end if;
  begin v_pfx:=decode(p_pfx_base64,'base64'); exception when others then return jsonb_build_object('ok',false,'error','invalid_certificate_payload'); end;
  if octet_length(v_pfx)=0 or octet_length(v_pfx)>5000000 then return jsonb_build_object('ok',false,'error','certificate_too_large'); end if;
  v_sha:=encode(extensions.digest(v_pfx,'sha256'),'hex');
  if p_file_sha256 is not null and lower(p_file_sha256)<>lower(v_sha) then return jsonb_build_object('ok',false,'error','certificate_hash_mismatch'); end if;
  select secret into v_key from private.fiscal_crypto_keys where id=1;
  insert into private.fiscal_certificates(company_id,tenant_id,filename,pfx_cipher,password_cipher,subject_cn,subject_cnpj,serial_number,valid_from,valid_to,fingerprint_sha256,file_sha256,uploaded_by)
  values(v.company_id,v.tenant_id,p_filename,extensions.pgp_sym_encrypt_bytea(v_pfx,v_key,'cipher-algo=aes256,compress-algo=0'),extensions.pgp_sym_encrypt(p_password,v_key,'cipher-algo=aes256'),nullif(p_subject_cn,''),nullif(p_subject_cnpj,''),nullif(p_serial_number,''),p_valid_from,p_valid_to,nullif(p_fingerprint_sha256,''),v_sha,v.user_id)
  on conflict(company_id) do update set tenant_id=excluded.tenant_id,filename=excluded.filename,pfx_cipher=excluded.pfx_cipher,password_cipher=excluded.password_cipher,subject_cn=excluded.subject_cn,subject_cnpj=excluded.subject_cnpj,serial_number=excluded.serial_number,valid_from=excluded.valid_from,valid_to=excluded.valid_to,fingerprint_sha256=excluded.fingerprint_sha256,file_sha256=excluded.file_sha256,uploaded_by=excluded.uploaded_by,uploaded_at=now(),updated_at=now();
  return jsonb_build_object('ok',true,'configured',true,'certificate',jsonb_build_object('filename',p_filename,'subject_cn',p_subject_cn,'subject_cnpj',p_subject_cnpj,'serial_number',p_serial_number,'valid_from',p_valid_from,'valid_to',p_valid_to,'fingerprint_sha256',p_fingerprint_sha256,'file_sha256',v_sha));
end $function$;

create or replace function public.erp_fiscal_certificate_delete(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  delete from private.fiscal_certificates where tenant_id=v.tenant_id and company_id=v.company_id;
  return jsonb_build_object('ok',true);
end $function$;

create or replace function public.erp_fiscal_settings_get(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record;s record;c record;
begin
 select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 select * into s from fiscal_settings where tenant_id=v.tenant_id;
 select * into c from private.fiscal_certificates where tenant_id=v.tenant_id and company_id=v.company_id;
 return jsonb_build_object('ok',true,'settings',jsonb_build_object('provider','svrs_direct','transport','SVRS direta','environment',coalesce(s.environment,'homologation'),'nfe_series',coalesce(s.nfe_series,'1'),'nfce_series',coalesce(s.nfce_series,'1'),'csc_id',s.csc_id,'configured',c.company_id is not null,'certificate',case when c.company_id is null then null else jsonb_build_object('filename',c.filename,'subject_cn',c.subject_cn,'subject_cnpj',c.subject_cnpj,'serial_number',c.serial_number,'valid_from',c.valid_from,'valid_to',c.valid_to,'fingerprint_sha256',c.fingerprint_sha256,'file_sha256',c.file_sha256,'uploaded_at',c.uploaded_at,'expired',(c.valid_to is not null and c.valid_to<now())) end));
end $function$;

create or replace function public.erp_fiscal_settings_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record;
begin
 select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 insert into fiscal_settings(tenant_id,provider,environment,nfe_series,nfce_series,csc_id) values(v.tenant_id,'svrs_direct',coalesce(p_payload->>'environment','homologation'),coalesce(nullif(p_payload->>'nfe_series',''),'1'),coalesce(nullif(p_payload->>'nfce_series',''),'1'),nullif(p_payload->>'csc_id',''))
 on conflict(tenant_id) do update set provider='svrs_direct',environment=excluded.environment,nfe_series=excluded.nfe_series,nfce_series=excluded.nfce_series,csc_id=excluded.csc_id,updated_at=now();
 return jsonb_build_object('ok',true,'provider','svrs_direct');
end $function$;

create or replace function public.erp_fiscal_prepare(p_token text,p_sale_id uuid,p_document_type text)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record;s record;c record;fs record;cert record;v_doc uuid;v_number bigint;v_series text;v_errors jsonb:='[]'::jsonb;v_payload jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 if p_document_type not in ('nfe','nfce') then return jsonb_build_object('ok',false,'error','unsupported_document_type');end if;
 select * into s from sales where id=p_sale_id and tenant_id=v.tenant_id and status='completed';if s.id is null then return jsonb_build_object('ok',false,'error','sale_not_found');end if;
 if exists(select 1 from fiscal_documents where sale_id=p_sale_id and document_type=p_document_type and status not in ('cancelled','rejected')) then return jsonb_build_object('ok',false,'error','fiscal_document_already_exists');end if;
 select * into c from companies where id=v.company_id; select * into fs from fiscal_settings where tenant_id=v.tenant_id; select * into cert from private.fiscal_certificates where tenant_id=v.tenant_id and company_id=v.company_id;
 if nullif(c.cnpj,'') is null then v_errors:=v_errors||jsonb_build_array('Empresa sem CNPJ cadastrado');end if;
 if nullif(c.state_registration,'') is null then v_errors:=v_errors||jsonb_build_array('Empresa sem Inscrição Estadual');end if;
 if exists(select 1 from sale_items si join products p on p.id=si.product_id where si.sale_id=p_sale_id and (nullif(p.ncm,'') is null or nullif(p.cfop_default,'') is null)) then v_errors:=v_errors||jsonb_build_array('Há produtos sem NCM ou CFOP padrão');end if;
 if cert.company_id is null then v_errors:=v_errors||jsonb_build_array('Certificado digital A1 (.pfx/.p12) não configurado'); elsif cert.valid_to is not null and cert.valid_to<now() then v_errors:=v_errors||jsonb_build_array('Certificado digital expirado'); end if;
 v_series:=case when p_document_type='nfce' then coalesce(fs.nfce_series,'1') else coalesce(fs.nfe_series,'1') end;
 select coalesce(max(nullif(number,'')::bigint),0)+1 into v_number from fiscal_documents where tenant_id=v.tenant_id and document_type=p_document_type and series=v_series and number~'^[0-9]+$';
 select jsonb_build_object('sale',to_jsonb(s),'company',to_jsonb(c),'customer',(select to_jsonb(cu) from customers cu where cu.id=s.customer_id),'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',si.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,'quantity',si.quantity,'unit_price',si.unit_price,'discount',si.discount,'total',si.total,'fiscal_snapshot',si.fiscal_snapshot)) from sale_items si where si.sale_id=s.id),'[]'::jsonb)) into v_payload;
 insert into fiscal_documents(tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,number,provider,request_payload,response_payload) values(v.tenant_id,v.company_id,v.branch_id,s.id,p_document_type,coalesce(fs.environment,'homologation'),'draft',v_series,v_number::text,'svrs_direct',v_payload,jsonb_build_object('validation_errors',v_errors)) returning id into v_doc;
 return jsonb_build_object('ok',true,'id',v_doc,'number',v_number,'series',v_series,'validation_errors',v_errors,'ready_to_send',jsonb_array_length(v_errors)=0);
end $function$;

create or replace function public.erp_fiscal_send(p_token text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private','extensions'
as $function$
declare v record;d record;cert record;errors jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select * into d from fiscal_documents where id=p_document_id and tenant_id=v.tenant_id for update;if d.id is null then return jsonb_build_object('ok',false,'error','document_not_found');end if;
 errors:=coalesce(d.response_payload->'validation_errors','[]'::jsonb);if jsonb_array_length(errors)>0 then return jsonb_build_object('ok',false,'error','fiscal_validation_failed','validation_errors',errors);end if;
 select * into cert from private.fiscal_certificates where tenant_id=v.tenant_id and company_id=d.company_id;
 if cert.company_id is null then return jsonb_build_object('ok',false,'error','certificate_required','message','Anexe o certificado A1 nas Configurações Fiscais.'); end if;
 if cert.valid_to is not null and cert.valid_to<now() then return jsonb_build_object('ok',false,'error','certificate_expired','message','O certificado A1 configurado está expirado.'); end if;
 return jsonb_build_object('ok',false,'error','svrs_transport_pending','provider','svrs_direct','message','Certificado A1 validado e disponível. O transporte SOAP/assinatura XML do ThorFiscal para a SVRS ainda precisa concluir a etapa de transmissão.');
end $function$;