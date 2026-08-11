create or replace function public.erp_branch_configuration_save(p_token text, p_branch uuid, p_section text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare v record;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if not exists(select 1 from branches b where b.id=p_branch and b.tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
  insert into branch_settings(branch_id,tenant_id) values(p_branch,v.tenant_id) on conflict(branch_id) do nothing;

  if p_section='general' then
    update branches set
      name=coalesce(nullif(p_payload->>'name',''),name),
      cnpj=nullif(p_payload->>'cnpj',''),
      street=nullif(p_payload->>'street',''),
      number=nullif(p_payload->>'number',''),
      complement=nullif(p_payload->>'complement',''),
      district=nullif(p_payload->>'district',''),
      city=nullif(p_payload->>'city',''),
      state=nullif(p_payload->>'state','')::char(2),
      postal_code=nullif(p_payload->>'postal_code',''),
      ibge_city_code=nullif(p_payload->>'ibge_city_code',''),
      updated_at=now()
    where id=p_branch and tenant_id=v.tenant_id;

    update branch_settings set
      contact=nullif(p_payload->>'contact',''),
      responsible=nullif(p_payload->>'responsible',''),
      email=nullif(p_payload->>'email',''),
      crt=nullif(p_payload->>'crt',''),
      state_registration=nullif(p_payload->>'state_registration',''),
      municipal_registration=nullif(p_payload->>'municipal_registration',''),
      business_type=nullif(p_payload->>'business_type',''),
      business_detail=nullif(p_payload->>'business_detail',''),
      phone=nullif(p_payload->>'phone',''),
      mobile=nullif(p_payload->>'mobile',''),
      observations=nullif(p_payload->>'observations',''),
      updated_at=now()
    where branch_id=p_branch;

  elsif p_section='fiscal' then
    return jsonb_build_object(
      'ok',false,
      'error','fiscal_configuration_centralized',
      'message','Certificado A1, CSC, ambiente, séries, numeração, CFOP e DANFE devem ser configurados exclusivamente no módulo Fiscal.'
    );

  elsif p_section='parameters' then
    update branch_settings set
      pdv_parameters=coalesce(p_payload,'{}'::jsonb),
      receipt_header=nullif(p_payload->>'receipt_header',''),
      receipt_footer=nullif(p_payload->>'receipt_footer',''),
      updated_at=now()
    where branch_id=p_branch;

  elsif p_section='branding' then
    update branch_settings set branding=coalesce(p_payload,'{}'::jsonb),updated_at=now() where branch_id=p_branch;

  else
    return jsonb_build_object('ok',false,'error','unsupported_section');
  end if;

  insert into branch_config_history(tenant_id,branch_id,section,action,actor,details)
  values(v.tenant_id,p_branch,p_section,'save',v.user_id::text,p_payload-'csc_homologation_token'-'csc_production_token'-'certificate_password');
  return jsonb_build_object('ok',true);
end;
$function$;
