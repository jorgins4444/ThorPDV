-- Thor Control: owner portal, tenant licensing and commercial limits

create table if not exists private.platform_admins (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique,
  password_hash text not null,
  must_change_password boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bootstrap_password_sha text
);

create table if not exists private.platform_sessions (
  token_hash text primary key,
  admin_id uuid not null references private.platform_admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists private.platform_pricing (
  id smallint primary key default 1 check (id=1),
  base_erp_price numeric(12,2) not null default 0,
  included_management_users integer not null default 5 check (included_management_users>=0),
  extra_management_user_price numeric(12,2) not null default 0 check (extra_management_user_price>=0),
  included_pdv_terminals integer not null default 1 check (included_pdv_terminals>=0),
  extra_pdv_terminal_price numeric(12,2) not null default 0 check (extra_pdv_terminal_price>=0),
  updated_at timestamptz not null default now()
);
insert into private.platform_pricing(id) values(1) on conflict(id) do nothing;

create table if not exists public.tenant_licenses (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  status text not null default 'active' check(status in ('trial','active','suspended','cancelled')),
  plan_name text not null default 'ThorERP Personalizado',
  modules jsonb not null default '{}'::jsonb,
  management_user_limit integer not null default 5 check(management_user_limit>=0),
  pdv_terminal_limit integer not null default 1 check(pdv_terminal_limit>=0),
  base_monthly_amount numeric(12,2) not null default 0,
  extra_management_user_price numeric(12,2) not null default 0,
  extra_pdv_terminal_price numeric(12,2) not null default 0,
  monthly_amount numeric(12,2) not null default 0,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_licenses enable row level security;

create table if not exists public.license_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  actor_admin_id uuid,
  created_at timestamptz not null default now()
);
alter table public.license_audit enable row level security;

create or replace function private.default_license_modules()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'people',true,'sales',true,'products',true,'pricing',true,'stock',true,
    'purchases',true,'finance',true,'fiscal',true,'production',true,
    'reports',true,'administration',true,'integrations',true,'support',true,'pdv',true
  )
$$;

insert into public.tenant_licenses(tenant_id,status,plan_name,modules,management_user_limit,pdv_terminal_limit)
select t.id,'active','ThorERP Legado',private.default_license_modules(),5,
       greatest(1,coalesce((select count(*) from public.pdv_devices d where d.tenant_id=t.id),0))
from public.tenants t
on conflict(tenant_id) do nothing;

create or replace function private.resolve_platform_admin(p_token text)
returns uuid language sql security definer set search_path='public','private','extensions' as $$
  select s.admin_id
  from private.platform_sessions s
  join private.platform_admins a on a.id=s.admin_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.expires_at>now() and a.active=true
  limit 1
$$;

create or replace function public.platform_login(p_email text,p_password text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a private.platform_admins%rowtype; v_hash text; v_token text; v_fail integer; v_bootstrap boolean:=false;
begin
  v_hash:=encode(extensions.digest(lower(trim(coalesce(p_email,''))),'sha256'),'hex');
  select * into a from private.platform_admins where email_hash=v_hash and active=true limit 1;
  if a.id is null then return jsonb_build_object('ok',false,'error','invalid_credentials'); end if;
  v_bootstrap:=a.must_change_password and a.bootstrap_password_sha is not null and encode(extensions.digest(coalesce(p_password,''),'sha256'),'hex')=a.bootstrap_password_sha;
  if not v_bootstrap and a.locked_until is not null and a.locked_until>now() then return jsonb_build_object('ok',false,'error','temporarily_locked'); end if;
  if not v_bootstrap and extensions.crypt(coalesce(p_password,''),a.password_hash)<>a.password_hash then
    v_fail:=a.failed_attempts+1;
    update private.platform_admins set failed_attempts=v_fail,locked_until=case when v_fail>=5 then now()+interval '10 minutes' else null end,updated_at=now() where id=a.id;
    return jsonb_build_object('ok',false,'error','invalid_credentials');
  end if;
  update private.platform_admins set failed_attempts=0,locked_until=null,updated_at=now() where id=a.id;
  delete from private.platform_sessions where expires_at<=now();
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into private.platform_sessions(token_hash,admin_id,expires_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),a.id,now()+interval '8 hours');
  return jsonb_build_object('ok',true,'session_token',v_token,'must_change_password',a.must_change_password);
end $$;

create or replace function public.platform_session_status(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a private.platform_admins%rowtype; v_id uuid;
begin
  v_id:=private.resolve_platform_admin(p_token);
  if v_id is null then return jsonb_build_object('ok',false); end if;
  select * into a from private.platform_admins where id=v_id;
  return jsonb_build_object('ok',true,'must_change_password',a.must_change_password);
end $$;

create or replace function public.platform_change_password(p_token text,p_new_password text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v_id uuid;
begin
  if length(coalesce(p_new_password,''))<8 then return jsonb_build_object('ok',false,'error','password_too_short'); end if;
  v_id:=private.resolve_platform_admin(p_token);
  if v_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  update private.platform_admins
  set password_hash=extensions.crypt(p_new_password,extensions.gen_salt('bf',12)),bootstrap_password_sha=null,
      must_change_password=false,failed_attempts=0,locked_until=null,updated_at=now()
  where id=v_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.platform_logout(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
begin
  delete from private.platform_sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  return jsonb_build_object('ok',true);
end $$;

create or replace function private.license_module_enabled(p_tenant uuid,p_module text)
returns boolean language sql stable security definer set search_path='public','private' as $$
  select coalesce((
    select l.status in ('trial','active')
      and (l.expires_at is null or l.expires_at>now())
      and coalesce((l.modules->>p_module)::boolean,false)
    from public.tenant_licenses l where l.tenant_id=p_tenant
  ),false)
$$;

create or replace function private.license_pdv_limit(p_tenant uuid)
returns integer language sql stable security definer set search_path='public','private' as $$
  select case when private.license_module_enabled(p_tenant,'pdv')
    then coalesce((select pdv_terminal_limit from public.tenant_licenses where tenant_id=p_tenant),0)
    else 0 end
$$;

create or replace function public.erp_license_get(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; l public.tenant_licenses%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into l from public.tenant_licenses where tenant_id=v.tenant_id;
  if l.tenant_id is null then return jsonb_build_object('ok',false,'error','license_not_found'); end if;
  return jsonb_build_object('ok',true,'tenant_id',v.tenant_id,'status',l.status,'plan_name',l.plan_name,
    'modules',l.modules,'management_user_limit',l.management_user_limit,'pdv_terminal_limit',l.pdv_terminal_limit,
    'monthly_amount',l.monthly_amount,'expires_at',l.expires_at);
end $$;

create or replace function public.platform_pricing_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a uuid; r private.platform_pricing%rowtype;
begin
  a:=private.resolve_platform_admin(p_token); if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  update private.platform_pricing set
    base_erp_price=greatest(coalesce(nullif(p_payload->>'base_erp_price','')::numeric,base_erp_price),0),
    included_management_users=greatest(coalesce(nullif(p_payload->>'included_management_users','')::int,included_management_users),0),
    extra_management_user_price=greatest(coalesce(nullif(p_payload->>'extra_management_user_price','')::numeric,extra_management_user_price),0),
    included_pdv_terminals=greatest(coalesce(nullif(p_payload->>'included_pdv_terminals','')::int,included_pdv_terminals),0),
    extra_pdv_terminal_price=greatest(coalesce(nullif(p_payload->>'extra_pdv_terminal_price','')::numeric,extra_pdv_terminal_price),0),
    updated_at=now() where id=1 returning * into r;
  return jsonb_build_object('ok',true,'pricing',to_jsonb(r));
end $$;

create or replace function private.enforce_management_user_license_limit()
returns trigger language plpgsql security definer set search_path='public','private' as $$
declare v_scope text; v_limit int; v_count int;
begin
  if coalesce(new.active,true)=false then return new; end if;
  select scope into v_scope from public.access_profiles where id=new.profile_id and tenant_id=new.tenant_id;
  if v_scope<>'ADM' then return new; end if;
  select management_user_limit into v_limit from public.tenant_licenses
   where tenant_id=new.tenant_id and status in ('trial','active') and (expires_at is null or expires_at>now());
  if v_limit is null then raise exception 'management_license_inactive'; end if;
  select count(*) into v_count from public.staff_users su
   join public.access_profiles ap on ap.id=su.profile_id
   where su.tenant_id=new.tenant_id and su.active=true and ap.scope='ADM'
     and (tg_op='INSERT' or su.id<>new.id);
  if v_count>=v_limit then raise exception 'management_user_license_limit_reached: limit %',v_limit; end if;
  return new;
end $$;
drop trigger if exists trg_management_user_license_limit on public.staff_users;
create trigger trg_management_user_license_limit
before insert or update of profile_id,active,tenant_id on public.staff_users
for each row execute function private.enforce_management_user_license_limit();

-- The complete customer provisioning, license update, dashboard, fiscal monitor and
-- PDV enrollment enforcement RPCs are installed by the live migration and maintained
-- as SECURITY DEFINER functions in the project database. This migration captures the
-- persistent schema, owner authentication, pricing and core enforcement contracts.
