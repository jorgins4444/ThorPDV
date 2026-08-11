-- ThorControl: complete customer base provisioning and owner-controlled license blocking.

create or replace function public.platform_customer_create(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  a uuid;
  v_tenant uuid;
  v_company uuid;
  v_branch uuid;
  v_user uuid;
  v_temp_password text;
  v_email_hash text;
  pr private.platform_pricing%rowtype;
  v_modules jsonb;
  v_users int;
  v_pdvs int;
  v_monthly numeric;
  v_legal text;
  v_trade text;
  v_cnpj text;
  v_admin_email text;
  v_license_status text;
  v_crt text;
  v_cep text;
  v_uf text;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_legal:=trim(coalesce(p_payload->>'legal_name',''));
  v_trade:=trim(coalesce(p_payload->>'trade_name',''));
  v_cnpj:=regexp_replace(coalesce(p_payload->>'cnpj',''),'\D','','g');
  v_admin_email:=lower(trim(coalesce(p_payload->>'admin_email','')));
  v_license_status:=coalesce(nullif(p_payload->>'license_status',''),'trial');
  v_crt:=trim(coalesce(p_payload->>'tax_regime',''));
  v_cep:=regexp_replace(coalesce(p_payload->>'postal_code',''),'\D','','g');
  v_uf:=upper(trim(coalesce(p_payload->>'state','')));

  if v_legal='' then return jsonb_build_object('ok',false,'error','legal_name_required'); end if;
  if length(v_cnpj)<>14 then return jsonb_build_object('ok',false,'error','invalid_cnpj'); end if;
  if v_admin_email='' or position('@' in v_admin_email)=0 then return jsonb_build_object('ok',false,'error','admin_email_required'); end if;
  if v_license_status not in ('trial','active') then return jsonb_build_object('ok',false,'error','invalid_initial_license_status'); end if;
  if v_crt<>'' and v_crt not in ('1','2','3','4') then return jsonb_build_object('ok',false,'error','invalid_tax_regime'); end if;
  if v_cep<>'' and length(v_cep)<>8 then return jsonb_build_object('ok',false,'error','invalid_postal_code'); end if;
  if v_uf<>'' and v_uf !~ '^[A-Z]{2}$' then return jsonb_build_object('ok',false,'error','invalid_state'); end if;
  if exists(select 1 from public.tenants where document=v_cnpj)
     or exists(select 1 from public.companies where cnpj=v_cnpj) then
    return jsonb_build_object('ok',false,'error','cnpj_already_registered');
  end if;

  v_email_hash:=encode(extensions.digest(v_admin_email,'sha256'),'hex');
  if exists(select 1 from private.temp_users where email_hash=v_email_hash and active=true) then
    return jsonb_build_object('ok',false,'error','admin_email_already_in_use');
  end if;

  select * into pr from private.platform_pricing where id=1;
  v_modules:=coalesce(p_payload->'modules',private.default_license_modules());
  v_users:=greatest(coalesce(nullif(p_payload->>'management_user_limit','')::int,pr.included_management_users),0);
  v_pdvs:=greatest(coalesce(nullif(p_payload->>'pdv_terminal_limit','')::int,pr.included_pdv_terminals),0);
  v_monthly:=pr.base_erp_price
    + greatest(v_users-pr.included_management_users,0)*pr.extra_management_user_price
    + greatest(v_pdvs-pr.included_pdv_terminals,0)*pr.extra_pdv_terminal_price;

  insert into public.tenants(name,document,status)
  values(coalesce(nullif(v_trade,''),v_legal),v_cnpj,'active')
  returning id into v_tenant;

  insert into public.companies(
    tenant_id,legal_name,trade_name,cnpj,state_registration,municipal_registration,tax_regime,email,phone,status
  ) values(
    v_tenant,v_legal,coalesce(nullif(v_trade,''),v_legal),v_cnpj,
    nullif(trim(coalesce(p_payload->>'state_registration','')),''),
    nullif(trim(coalesce(p_payload->>'municipal_registration','')),''),
    nullif(v_crt,''),
    nullif(trim(coalesce(p_payload->>'company_email','')),''),
    nullif(trim(coalesce(p_payload->>'phone','')),''),
    'active'
  ) returning id into v_company;

  insert into public.branches(
    tenant_id,company_id,name,cnpj,is_headquarters,street,number,complement,district,city,state,postal_code,ibge_city_code
  ) values(
    v_tenant,v_company,
    coalesce(nullif(trim(p_payload->>'branch_name'),''),coalesce(nullif(v_trade,''),'Matriz')),
    v_cnpj,true,
    nullif(trim(coalesce(p_payload->>'street','')),''),
    nullif(trim(coalesce(p_payload->>'number','')),''),
    nullif(trim(coalesce(p_payload->>'complement','')),''),
    nullif(trim(coalesce(p_payload->>'district','')),''),
    nullif(trim(coalesce(p_payload->>'city','')),''),
    nullif(v_uf,'')::char(2),
    nullif(v_cep,''),
    nullif(trim(coalesce(p_payload->>'ibge_city_code','')),'')
  ) returning id into v_branch;

  insert into public.branch_settings(
    branch_id,tenant_id,email,phone,state_registration,municipal_registration,crt,contact,responsible,updated_at
  ) values(
    v_branch,v_tenant,
    nullif(trim(coalesce(p_payload->>'company_email','')),''),
    nullif(trim(coalesce(p_payload->>'phone','')),''),
    nullif(trim(coalesce(p_payload->>'state_registration','')),''),
    nullif(trim(coalesce(p_payload->>'municipal_registration','')),''),
    nullif(v_crt,''),
    nullif(trim(coalesce(p_payload->>'contact','')),''),
    nullif(trim(coalesce(p_payload->>'responsible','')),''),
    now()
  ) on conflict(branch_id) do update set
    email=excluded.email,
    phone=excluded.phone,
    state_registration=excluded.state_registration,
    municipal_registration=excluded.municipal_registration,
    crt=excluded.crt,
    contact=excluded.contact,
    responsible=excluded.responsible,
    updated_at=now();

  insert into public.tenant_licenses(
    tenant_id,status,plan_name,modules,management_user_limit,pdv_terminal_limit,
    base_monthly_amount,extra_management_user_price,extra_pdv_terminal_price,monthly_amount,
    starts_at,expires_at,notes
  ) values(
    v_tenant,v_license_status,
    coalesce(nullif(p_payload->>'plan_name',''),'ThorERP Personalizado'),
    v_modules,v_users,v_pdvs,
    pr.base_erp_price,pr.extra_management_user_price,pr.extra_pdv_terminal_price,v_monthly,
    now(),nullif(p_payload->>'expires_at','')::timestamptz,nullif(p_payload->>'notes','')
  );

  v_temp_password:='Thor#'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,12));
  insert into private.temp_users(email,email_hash,password_hash,must_change_password,active)
  values(
    v_admin_email,v_email_hash,
    extensions.crypt(v_temp_password,extensions.gen_salt('bf',12)),true,true
  ) returning id into v_user;

  insert into private.temp_user_context(user_id,tenant_id,company_id,branch_id)
  values(v_user,v_tenant,v_company,v_branch);

  insert into public.license_audit(tenant_id,action,after_data,actor_admin_id)
  values(v_tenant,'customer_created',jsonb_build_object(
    'cnpj',v_cnpj,
    'admin_email',v_admin_email,
    'modules',v_modules,
    'management_user_limit',v_users,
    'pdv_terminal_limit',v_pdvs,
    'monthly_amount',v_monthly
  ),a);

  return jsonb_build_object(
    'ok',true,
    'tenant_id',v_tenant,
    'company_id',v_company,
    'branch_id',v_branch,
    'admin_email',v_admin_email,
    'temporary_password',v_temp_password,
    'monthly_amount',v_monthly
  );
end $$;

create or replace function public.platform_license_block(
  p_token text,
  p_tenant uuid,
  p_blocked boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  a uuid;
  oldrow public.tenant_licenses%rowtype;
  newrow public.tenant_licenses%rowtype;
  v_restore text;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into oldrow
  from public.tenant_licenses
  where tenant_id=p_tenant
  for update;
  if not found then return jsonb_build_object('ok',false,'error','license_not_found'); end if;

  if p_blocked then
    if oldrow.status='cancelled' then
      return jsonb_build_object('ok',false,'error','cancelled_license_cannot_be_blocked');
    end if;

    update public.tenant_licenses set
      status_before_block=case when status<>'suspended' then status else coalesce(status_before_block,'active') end,
      status='suspended',
      blocked_at=coalesce(blocked_at,now()),
      blocked_reason=nullif(trim(coalesce(p_reason,'')),''),
      blocked_by_admin_id=a,
      updated_at=now()
    where tenant_id=p_tenant
    returning * into newrow;

    delete from private.temp_sessions s
    using private.temp_user_context c
    where c.user_id=s.user_id and c.tenant_id=p_tenant;

    insert into public.license_audit(tenant_id,action,before_data,after_data,actor_admin_id)
    values(p_tenant,'license_blocked',to_jsonb(oldrow),to_jsonb(newrow),a);

    return jsonb_build_object('ok',true,'blocked',true,'license',to_jsonb(newrow));
  end if;

  if oldrow.status<>'suspended' then
    return jsonb_build_object('ok',true,'blocked',false,'license',to_jsonb(oldrow));
  end if;

  v_restore:=case when oldrow.status_before_block in ('trial','active') then oldrow.status_before_block else 'active' end;
  update public.tenant_licenses set
    status=v_restore,
    status_before_block=null,
    blocked_at=null,
    blocked_reason=null,
    blocked_by_admin_id=null,
    updated_at=now()
  where tenant_id=p_tenant
  returning * into newrow;

  insert into public.license_audit(tenant_id,action,before_data,after_data,actor_admin_id)
  values(p_tenant,'license_unblocked',to_jsonb(oldrow),to_jsonb(newrow),a);

  return jsonb_build_object('ok',true,'blocked',false,'license',to_jsonb(newrow));
end $$;

create or replace function public.platform_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  a uuid;
  v_clients jsonb;
  v_pricing jsonb;
  v_summary jsonb;
  v_fiscal jsonb;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select to_jsonb(p) into v_pricing from private.platform_pricing p where id=1;

  select coalesce(jsonb_agg(x order by x->>'name'),'[]'::jsonb)
  into v_clients
  from (
    select jsonb_build_object(
      'tenant_id',t.id,
      'name',t.name,
      'document',t.document,
      'tenant_status',t.status,
      'company_id',c.id,
      'legal_name',c.legal_name,
      'trade_name',c.trade_name,
      'cnpj',c.cnpj,
      'state_registration',c.state_registration,
      'municipal_registration',c.municipal_registration,
      'tax_regime',c.tax_regime,
      'company_email',c.email,
      'phone',c.phone,
      'branch_id',b.id,
      'branch_name',b.name,
      'street',b.street,
      'number',b.number,
      'complement',b.complement,
      'district',b.district,
      'city',b.city,
      'state',b.state,
      'postal_code',b.postal_code,
      'ibge_city_code',b.ibge_city_code,
      'admin_email',(
        select u.email
        from private.temp_user_context uc
        join private.temp_users u on u.id=uc.user_id
        where uc.tenant_id=t.id
        order by uc.created_at
        limit 1
      ),
      'license_status',l.status,
      'plan_name',l.plan_name,
      'modules',l.modules,
      'management_user_limit',l.management_user_limit,
      'pdv_terminal_limit',l.pdv_terminal_limit,
      'monthly_amount',l.monthly_amount,
      'starts_at',l.starts_at,
      'expires_at',l.expires_at,
      'license_notes',l.notes,
      'blocked_at',l.blocked_at,
      'blocked_reason',l.blocked_reason,
      'status_before_block',l.status_before_block,
      'pdv_devices',(select count(*) from public.pdv_devices d where d.tenant_id=t.id and d.status<>'blocked'),
      'fiscal_documents',(select count(*) from public.fiscal_documents fd where fd.tenant_id=t.id)
    ) x
    from public.tenants t
    left join lateral (
      select * from public.companies cx
      where cx.tenant_id=t.id
      order by cx.created_at
      limit 1
    ) c on true
    left join lateral (
      select * from public.branches bx
      where bx.tenant_id=t.id
      order by bx.is_headquarters desc,bx.created_at
      limit 1
    ) b on true
    left join public.tenant_licenses l on l.tenant_id=t.id
  ) q;

  select jsonb_build_object(
    'clients',(select count(*) from public.tenants),
    'active_licenses',(select count(*) from public.tenant_licenses where status in ('trial','active') and (expires_at is null or expires_at>now())),
    'blocked_licenses',(select count(*) from public.tenant_licenses where status='suspended'),
    'monthly_recurring',coalesce((select sum(monthly_amount) from public.tenant_licenses where status='active'),0),
    'pdv_devices',(select count(*) from public.pdv_devices where status<>'blocked'),
    'fiscal_today',(select count(*) from public.fiscal_documents where created_at>=date_trunc('day',now()))
  ) into v_summary;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]'::jsonb)
  into v_fiscal
  from (
    select fd.id,fd.tenant_id,t.name tenant_name,fd.company_id,
      coalesce(c.trade_name,c.legal_name) company,fd.branch_id,b.name branch,
      fd.sale_id,s.number sale_number,fd.document_type,fd.environment,fd.status,
      fd.series,fd.number,fd.access_key,fd.protocol,fd.authorization_at,
      fd.cancellation_protocol,fd.cancellation_at,fd.rejection_code,fd.rejection_message,
      fd.xml_path,fd.pdf_path,fd.created_at,fd.updated_at,fd.response_payload
    from public.fiscal_documents fd
    join public.tenants t on t.id=fd.tenant_id
    join public.companies c on c.id=fd.company_id
    join public.branches b on b.id=fd.branch_id
    left join public.sales s on s.id=fd.sale_id
    order by fd.created_at desc
    limit 200
  ) f;

  return jsonb_build_object('ok',true,'clients',v_clients,'pricing',v_pricing,'summary',v_summary,'fiscal',v_fiscal);
end $$;

grant execute on function public.platform_customer_create(text,jsonb) to anon,authenticated;
grant execute on function public.platform_license_block(text,uuid,boolean,text) to anon,authenticated;
grant execute on function public.platform_dashboard(text) to anon,authenticated;
