-- ThorPDV 0.4.1 - permission enforcement hardening

create or replace function private.pdv_staff_permissions(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_staff_user_id uuid
) returns jsonb
language sql
security definer
set search_path to 'public','private'
as $$
 select jsonb_build_object(
   'id',su.id,
   'name',su.name,
   'profile_id',ap.id,
   'profile_name',ap.name,
   'scope',ap.scope,
   'permissions',coalesce(ap.permissions,'{}'::jsonb),
   'active',su.active,
   'profile_active',ap.active
 )
 from public.staff_users su
 join public.access_profiles ap
   on ap.id=su.profile_id
  and ap.tenant_id=su.tenant_id
  and ap.scope='PDV'
  and ap.active=true
 where su.id=p_staff_user_id
   and su.tenant_id=p_tenant_id
   and su.active=true
   and (su.branch_id is null or su.branch_id=p_branch_id)
 limit 1;
$$;

-- Keep the operator cache coherent whenever the linked PDV profile changes.
create or replace function private.touch_staff_users_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public','private'
as $$
begin
  if new.scope='PDV' and (
    new.permissions is distinct from old.permissions
    or new.active is distinct from old.active
    or new.name is distinct from old.name
  ) then
    update public.staff_users
       set updated_at=now()
     where profile_id=new.id
       and tenant_id=new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_staff_users_on_profile_change on public.access_profiles;
create trigger trg_touch_staff_users_on_profile_change
after update of permissions, active, name on public.access_profiles
for each row execute function private.touch_staff_users_on_profile_change();

-- Existing pdv_pull already sends staff_users on every pull. Restrict that list
-- to active PDV profiles so an inactive profile cannot remain usable offline after sync.
do $$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('public.pdv_pull(text,timestamptz)'::regprocedure) into v_def;
  v_patched := replace(
    v_def,
    'from public.staff_users su left join public.access_profiles ap on ap.id=su.profile_id where su.tenant_id=v.tenant_id and su.active=true and coalesce(ap.scope,''PDV'')=''PDV''',
    'from public.staff_users su join public.access_profiles ap on ap.id=su.profile_id and ap.scope=''PDV'' and ap.active=true where su.tenant_id=v.tenant_id and su.active=true'
  );
  if v_patched = v_def then
    raise exception 'pdv_pull staff profile filter signature not found';
  end if;
  execute v_patched;
end;
$$;

create or replace function private.pdv_request_nfce(
  p_device_id uuid,
  p_tenant_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_event_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v_sale public.sales%rowtype;
  v_doc public.fiscal_documents%rowtype;
  v_settings public.fiscal_settings%rowtype;
  v_operator uuid;
  v_op jsonb;
begin
  if nullif(p_payload->>'sale_id','') is not null then
    select * into v_sale
      from public.sales
     where id=(p_payload->>'sale_id')::uuid
       and tenant_id=p_tenant_id
       and branch_id=p_branch_id;
  elsif nullif(p_payload->>'sale_client_event_id','') is not null then
    select * into v_sale
      from public.sales
     where pdv_device_id=p_device_id
       and client_event_id=(p_payload->>'sale_client_event_id')::uuid
       and tenant_id=p_tenant_id;
  end if;

  if v_sale.id is null then return jsonb_build_object('ok',false,'error','sale_not_found'); end if;
  if v_sale.status<>'completed' then return jsonb_build_object('ok',false,'error','sale_not_completed'); end if;

  -- 0.4.1 sends the requesting operator explicitly. For 0.4.0 compatibility,
  -- fall back to the operator who completed the sale.
  v_operator:=coalesce(nullif(p_payload->>'operator_user_id','')::uuid,v_sale.staff_user_id);
  if v_operator is null then return jsonb_build_object('ok',false,'error','operator_required'); end if;
  v_op:=private.pdv_staff_permissions(p_tenant_id,p_branch_id,v_operator);
  if v_op is null then return jsonb_build_object('ok',false,'error','invalid_operator'); end if;
  if not coalesce((v_op#>>'{permissions,fiscal,request_nfce}')::boolean,false) then
    return jsonb_build_object('ok',false,'error','nfce_request_not_allowed');
  end if;

  select * into v_doc
    from public.fiscal_documents
   where sale_id=v_sale.id
     and document_type='nfce'
   order by created_at desc
   limit 1;

  if v_doc.id is not null then
    return jsonb_build_object(
      'ok',true,
      'sale_id',v_sale.id,
      'fiscal_document_id',v_doc.id,
      'status',v_doc.status,
      'access_key',v_doc.access_key,
      'protocol',v_doc.protocol,
      'pdf_path',v_doc.pdf_path,
      'idempotent',true
    );
  end if;

  select * into v_settings
    from public.fiscal_settings
   where tenant_id=p_tenant_id
   limit 1;

  insert into public.fiscal_documents(
    tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,provider,request_payload
  ) values (
    p_tenant_id,p_company_id,p_branch_id,v_sale.id,'nfce',
    coalesce(v_settings.environment,'homologation'),'draft',coalesce(v_settings.nfce_series,'1'),v_settings.provider,
    jsonb_build_object(
      'source','pdv_desktop',
      'requested_by_device',p_device_id,
      'requested_by_operator',v_operator,
      'client_event_id',p_event_id,
      'requested_at',now()
    )
  ) returning * into v_doc;

  return jsonb_build_object(
    'ok',true,
    'sale_id',v_sale.id,
    'fiscal_document_id',v_doc.id,
    'status',v_doc.status,
    'provider',v_doc.provider,
    'requires_provider',v_doc.provider is null or v_doc.provider='internal'
  );
end;
$$;
