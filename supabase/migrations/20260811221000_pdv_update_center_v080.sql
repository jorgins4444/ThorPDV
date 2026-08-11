-- ThorPDV Update Center v0.8.0
-- Controlled releases, per-scope rollout, rollback target and device audit.

create table if not exists private.pdv_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  channel text not null default 'stable' check (channel in ('stable','pilot')),
  status text not null default 'draft' check (status in ('draft','published','blocked','archived')),
  download_url text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  release_notes text,
  package_size bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists private.pdv_update_policies (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','tenant','device')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  device_id uuid references public.pdv_devices(id) on delete cascade,
  release_id uuid not null references private.pdv_releases(id) on delete restrict,
  mode text not null default 'notify' check (mode in ('notify','mandatory')),
  active boolean not null default true,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope='global' and tenant_id is null and device_id is null) or
    (scope='tenant' and tenant_id is not null and device_id is null) or
    (scope='device' and device_id is not null)
  )
);

create unique index if not exists pdv_update_policy_global_active_uidx
  on private.pdv_update_policies ((1)) where active and scope='global';
create unique index if not exists pdv_update_policy_tenant_active_uidx
  on private.pdv_update_policies (tenant_id) where active and scope='tenant';
create unique index if not exists pdv_update_policy_device_active_uidx
  on private.pdv_update_policies (device_id) where active and scope='device';

create table if not exists private.pdv_update_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.pdv_devices(id) on delete cascade,
  release_id uuid references private.pdv_releases(id) on delete set null,
  from_version text,
  to_version text,
  event_type text not null check (event_type in ('check','download_started','downloaded','verified','installing','installed','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pdv_update_events_device_idx on private.pdv_update_events(device_id,created_at desc);

revoke all on private.pdv_releases from public, anon, authenticated;
revoke all on private.pdv_update_policies from public, anon, authenticated;
revoke all on private.pdv_update_events from public, anon, authenticated;

create or replace function private.pdv_semver_compare(p_a text,p_b text)
returns integer language plpgsql immutable as $$
declare a text[]; b text[]; i integer; av integer; bv integer;
begin
  if coalesce(p_a,'') !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then return 0; end if;
  if coalesce(p_b,'') !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then return 0; end if;
  a:=string_to_array(p_a,'.'); b:=string_to_array(p_b,'.');
  for i in 1..3 loop
    av:=a[i]::integer; bv:=b[i]::integer;
    if av>bv then return 1; end if;
    if av<bv then return -1; end if;
  end loop;
  return 0;
end $$;

create or replace function private.pdv_target_for_device(p_device uuid)
returns table(
  policy_id uuid, policy_scope text, policy_mode text, policy_reason text,
  release_id uuid, version text, channel text, download_url text, sha256 text,
  release_notes text, package_size bigint
)
language sql stable security definer set search_path='public','private' as $$
  select p.id,p.scope,p.mode,p.reason,r.id,r.version,r.channel,r.download_url,lower(r.sha256),r.release_notes,r.package_size
  from public.pdv_devices d
  join private.pdv_update_policies p on p.active and (
       (p.scope='device' and p.device_id=d.id)
    or (p.scope='tenant' and p.tenant_id=d.tenant_id)
    or (p.scope='global')
  )
  join private.pdv_releases r on r.id=p.release_id and r.status='published'
  where d.id=p_device
  order by case p.scope when 'device' then 1 when 'tenant' then 2 else 3 end, p.updated_at desc
  limit 1
$$;

create or replace function public.platform_release_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a uuid; r private.pdv_releases%rowtype; v_version text; v_status text; v_url text; v_sha text; v_channel text;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_version:=trim(coalesce(p_payload->>'version',''));
  v_status:=coalesce(nullif(p_payload->>'status',''),'draft');
  v_channel:=coalesce(nullif(p_payload->>'channel',''),'stable');
  v_url:=trim(coalesce(p_payload->>'download_url',''));
  v_sha:=lower(trim(coalesce(p_payload->>'sha256','')));
  if v_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then return jsonb_build_object('ok',false,'error','invalid_version'); end if;
  if v_status not in ('draft','published','blocked','archived') then return jsonb_build_object('ok',false,'error','invalid_status'); end if;
  if v_channel not in ('stable','pilot') then return jsonb_build_object('ok',false,'error','invalid_channel'); end if;
  if v_url !~ '^https://' then return jsonb_build_object('ok',false,'error','https_download_required'); end if;
  if v_sha !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'error','invalid_sha256'); end if;

  insert into private.pdv_releases(version,channel,status,download_url,sha256,release_notes,package_size,created_by,published_at,updated_at)
  values(v_version,v_channel,v_status,v_url,v_sha,nullif(p_payload->>'release_notes',''),nullif(p_payload->>'package_size','')::bigint,a,
    case when v_status='published' then now() else null end,now())
  on conflict(version) do update set
    channel=excluded.channel,status=excluded.status,download_url=excluded.download_url,sha256=excluded.sha256,
    release_notes=excluded.release_notes,package_size=excluded.package_size,
    published_at=case when excluded.status='published' then coalesce(private.pdv_releases.published_at,now()) else private.pdv_releases.published_at end,
    updated_at=now()
  returning * into r;
  return jsonb_build_object('ok',true,'release',to_jsonb(r));
end $$;

create or replace function public.platform_update_policy_set(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a uuid; v_scope text; v_mode text; v_release uuid; v_tenant uuid; v_device uuid; p private.pdv_update_policies%rowtype;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_scope:=coalesce(nullif(p_payload->>'scope',''),'global');
  v_mode:=coalesce(nullif(p_payload->>'mode',''),'notify');
  if v_scope not in ('global','tenant','device') then return jsonb_build_object('ok',false,'error','invalid_scope'); end if;
  if v_mode not in ('notify','mandatory') then return jsonb_build_object('ok',false,'error','invalid_mode'); end if;

  if nullif(p_payload->>'release_id','') is not null then
    v_release:=(p_payload->>'release_id')::uuid;
  else
    select id into v_release from private.pdv_releases where version=p_payload->>'version' limit 1;
  end if;
  if v_release is null or not exists(select 1 from private.pdv_releases where id=v_release and status='published') then
    return jsonb_build_object('ok',false,'error','release_not_published');
  end if;

  if v_scope='tenant' then
    v_tenant:=nullif(p_payload->>'tenant_id','')::uuid;
    if v_tenant is null or not exists(select 1 from public.tenants where id=v_tenant) then return jsonb_build_object('ok',false,'error','tenant_not_found'); end if;
    update private.pdv_update_policies set active=false,updated_at=now() where active and scope='tenant' and tenant_id=v_tenant;
  elsif v_scope='device' then
    v_device:=nullif(p_payload->>'device_id','')::uuid;
    select tenant_id into v_tenant from public.pdv_devices where id=v_device;
    if v_device is null or v_tenant is null then return jsonb_build_object('ok',false,'error','device_not_found'); end if;
    update private.pdv_update_policies set active=false,updated_at=now() where active and scope='device' and device_id=v_device;
  else
    update private.pdv_update_policies set active=false,updated_at=now() where active and scope='global';
  end if;

  insert into private.pdv_update_policies(scope,tenant_id,device_id,release_id,mode,active,reason,created_by)
  values(v_scope,v_tenant,v_device,v_release,v_mode,true,nullif(p_payload->>'reason',''),a)
  returning * into p;
  return jsonb_build_object('ok',true,'policy',to_jsonb(p));
end $$;

create or replace function public.platform_update_policy_clear(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a uuid; v_scope text; v_tenant uuid; v_device uuid; n integer;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_scope:=coalesce(nullif(p_payload->>'scope',''),'global');
  if v_scope='tenant' then v_tenant:=nullif(p_payload->>'tenant_id','')::uuid;
  elsif v_scope='device' then v_device:=nullif(p_payload->>'device_id','')::uuid; end if;
  update private.pdv_update_policies set active=false,updated_at=now()
  where active and scope=v_scope
    and (v_scope<>'tenant' or tenant_id=v_tenant)
    and (v_scope<>'device' or device_id=v_device);
  get diagnostics n=row_count;
  return jsonb_build_object('ok',true,'cleared',n);
end $$;

create or replace function public.pdv_update_check(p_device_token text,p_current_version text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; t record; cmp integer; v_current text;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  v_current:=trim(coalesce(p_current_version,''));
  if v_current ~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    update public.pdv_devices set app_version=v_current,last_seen_at=now(),updated_at=now() where id=v.device_id;
  end if;
  select * into t from private.pdv_target_for_device(v.device_id);
  if t.release_id is null then
    return jsonb_build_object('ok',true,'update_available',false,'current_version',v_current,'target_version',null,'direction','none');
  end if;
  cmp:=private.pdv_semver_compare(t.version,v_current);
  insert into private.pdv_update_events(tenant_id,device_id,release_id,from_version,to_version,event_type,details)
  values(v.tenant_id,v.device_id,t.release_id,nullif(v_current,''),t.version,'check',jsonb_build_object('scope',t.policy_scope,'available',t.version<>v_current));
  return jsonb_build_object(
    'ok',true,'update_available',t.version<>v_current,'current_version',v_current,'target_version',t.version,
    'direction',case when t.version=v_current then 'same' when cmp<0 then 'rollback' else 'upgrade' end,
    'mode',t.policy_mode,'scope',t.policy_scope,'reason',t.policy_reason,
    'release',jsonb_build_object('id',t.release_id,'version',t.version,'channel',t.channel,'download_url',t.download_url,
      'sha256',t.sha256,'release_notes',t.release_notes,'package_size',t.package_size)
  );
end $$;

create or replace function public.pdv_update_report(p_device_token text,p_target_version text,p_event_type text,p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; r private.pdv_releases%rowtype; v_from text;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  if p_event_type not in ('download_started','downloaded','verified','installing','installed','failed') then return jsonb_build_object('ok',false,'error','invalid_event'); end if;
  select * into r from private.pdv_releases where version=p_target_version limit 1;
  if r.id is null then return jsonb_build_object('ok',false,'error','release_not_found'); end if;
  select app_version into v_from from public.pdv_devices where id=v.device_id;
  insert into private.pdv_update_events(tenant_id,device_id,release_id,from_version,to_version,event_type,details)
  values(v.tenant_id,v.device_id,r.id,v_from,p_target_version,p_event_type,coalesce(p_details,'{}'::jsonb));
  if p_event_type='installed' then
    update public.pdv_devices set app_version=p_target_version,last_seen_at=now(),updated_at=now() where id=v.device_id;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.platform_update_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare a uuid; result jsonb;
begin
  a:=private.resolve_platform_admin(p_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select jsonb_build_object(
    'ok',true,
    'summary',jsonb_build_object(
      'total_devices',(select count(*) from public.pdv_devices),
      'published_releases',(select count(*) from private.pdv_releases where status='published'),
      'global_target_version',(select r.version from private.pdv_update_policies p join private.pdv_releases r on r.id=p.release_id where p.active and p.scope='global' limit 1),
      'pending_devices',(select count(*) from public.pdv_devices d left join lateral private.pdv_target_for_device(d.id) t on true where t.release_id is not null and coalesce(d.app_version,'')<>t.version)
    ),
    'releases',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select r.id,r.version,r.channel,r.status,r.download_url,lower(r.sha256) sha256,r.release_notes,r.package_size,r.published_at,r.created_at,r.updated_at
      from private.pdv_releases r order by r.created_at desc
    ) x),'[]'::jsonb),
    'tenants',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name) from public.tenants t),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
      select p.id,p.scope,p.tenant_id,p.device_id,p.mode,p.reason,p.active,p.created_at,p.updated_at,r.id release_id,r.version,
        t.name tenant_name,d.name device_name
      from private.pdv_update_policies p
      join private.pdv_releases r on r.id=p.release_id
      left join public.tenants t on t.id=p.tenant_id
      left join public.pdv_devices d on d.id=p.device_id
      where p.active
    ) x),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(to_jsonb(x) order by x.tenant_name,x.device_name) from (
      select d.id,d.tenant_id,d.name device_name,d.hostname,d.app_version,d.status,d.last_seen_at,
        t.name tenant_name,c.trade_name company_name,b.name branch_name,pr.name pos_name,
        u.policy_scope target_scope,u.policy_mode target_mode,u.policy_reason target_reason,u.version target_version,
        case when u.release_id is null then 'none'
             when coalesce(d.app_version,'')=u.version then 'current'
             when private.pdv_semver_compare(u.version,coalesce(d.app_version,'0.0.0'))<0 then 'rollback'
             else 'upgrade' end update_state
      from public.pdv_devices d
      join public.tenants t on t.id=d.tenant_id
      left join public.companies c on c.id=d.company_id
      left join public.branches b on b.id=d.branch_id
      left join public.pos_registers pr on pr.id=d.pos_register_id
      left join lateral private.pdv_target_for_device(d.id) u on true
    ) x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select e.id,e.device_id,e.from_version,e.to_version,e.event_type,e.details,e.created_at,d.name device_name,t.name tenant_name
      from private.pdv_update_events e join public.pdv_devices d on d.id=e.device_id join public.tenants t on t.id=e.tenant_id
      order by e.created_at desc limit 80
    ) x),'[]'::jsonb)
  ) into result;
  return result;
end $$;

grant execute on function public.platform_release_save(text,jsonb) to anon,authenticated;
grant execute on function public.platform_update_policy_set(text,jsonb) to anon,authenticated;
grant execute on function public.platform_update_policy_clear(text,jsonb) to anon,authenticated;
grant execute on function public.platform_update_dashboard(text) to anon,authenticated;
grant execute on function public.pdv_update_check(text,text) to anon,authenticated;
grant execute on function public.pdv_update_report(text,text,text,jsonb) to anon,authenticated;
