-- ThorControl: immediate license enforcement for Thor Gestão and ThorPDV.

alter table public.tenant_licenses add column if not exists status_before_block text;
alter table public.tenant_licenses add column if not exists blocked_at timestamptz;
alter table public.tenant_licenses add column if not exists blocked_reason text;
alter table public.tenant_licenses add column if not exists blocked_by_admin_id uuid;

create or replace function private.resolve_temp_context(p_token text)
returns table(user_id uuid, tenant_id uuid, company_id uuid, branch_id uuid)
language sql
security definer
set search_path to 'public','private','extensions'
as $$
  select s.user_id,c.tenant_id,c.company_id,c.branch_id
  from private.temp_sessions s
  join private.temp_users u on u.id=s.user_id
  join private.temp_user_context c on c.user_id=s.user_id
  join public.tenant_licenses l on l.tenant_id=c.tenant_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.expires_at>now()
    and u.active=true
    and l.status in ('trial','active')
    and (l.expires_at is null or l.expires_at>now())
  limit 1
$$;

create or replace function public.temp_login(p_email text,p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v_user private.temp_users%rowtype;
  v_token text;
  v_token_hash text;
  v_email_hash text;
  v_password_sha text;
  v_failures integer;
  v_bootstrap_ok boolean:=false;
  v_license_status text;
  v_license_expires timestamptz;
begin
  v_email_hash:=encode(extensions.digest(lower(trim(coalesce(p_email,''))),'sha256'),'hex');
  v_password_sha:=encode(extensions.digest(coalesce(p_password,''),'sha256'),'hex');

  select * into v_user
  from private.temp_users
  where email_hash=v_email_hash and active=true
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_credentials'); end if;

  v_bootstrap_ok:=v_user.must_change_password
    and v_email_hash='84d25252d8517cb6a2fe270ee5d38f7dff716206682c0e3f504d33cb2a41db96'
    and v_password_sha='b7d31e3c89c43b596b50289aa812a7733fda7b98edabd4e5467c7e38bb129fca';

  if not v_bootstrap_ok and v_user.locked_until is not null and v_user.locked_until>now() then
    return jsonb_build_object('ok',false,'error','temporarily_locked');
  end if;

  if not v_bootstrap_ok and extensions.crypt(coalesce(p_password,''),v_user.password_hash)<>v_user.password_hash then
    v_failures:=v_user.failed_attempts+1;
    update private.temp_users
    set failed_attempts=v_failures,
        locked_until=case when v_failures>=5 then now()+interval '10 minutes' else null end,
        updated_at=now()
    where id=v_user.id;
    return jsonb_build_object('ok',false,'error','invalid_credentials');
  end if;

  select l.status,l.expires_at into v_license_status,v_license_expires
  from private.temp_user_context c
  join public.tenant_licenses l on l.tenant_id=c.tenant_id
  where c.user_id=v_user.id
  limit 1;
  if not found then return jsonb_build_object('ok',false,'error','license_not_found'); end if;
  if v_license_status='suspended' then return jsonb_build_object('ok',false,'error','license_suspended'); end if;
  if v_license_status='cancelled' then return jsonb_build_object('ok',false,'error','license_cancelled'); end if;
  if v_license_status not in ('trial','active') then return jsonb_build_object('ok',false,'error','license_inactive'); end if;
  if v_license_expires is not null and v_license_expires<=now() then return jsonb_build_object('ok',false,'error','license_expired'); end if;

  update private.temp_users set failed_attempts=0,locked_until=null,updated_at=now() where id=v_user.id;
  delete from private.temp_sessions where expires_at<=now();
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_token_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  insert into private.temp_sessions(token_hash,user_id,expires_at)
  values(v_token_hash,v_user.id,now()+interval '8 hours');

  return jsonb_build_object('ok',true,'session_token',v_token,'must_change_password',v_user.must_change_password);
end $$;

create or replace function public.temp_session_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v_token_hash text;
  v record;
begin
  if p_token is null or length(p_token)<32 then return jsonb_build_object('ok',false); end if;
  v_token_hash:=encode(extensions.digest(p_token,'sha256'),'hex');

  select u.must_change_password,l.status as license_status,l.expires_at as license_expires
  into v
  from private.temp_sessions s
  join private.temp_users u on u.id=s.user_id
  join private.temp_user_context c on c.user_id=u.id
  join public.tenant_licenses l on l.tenant_id=c.tenant_id
  where s.token_hash=v_token_hash
    and s.expires_at>now()
    and u.active=true
  limit 1;

  if not found then return jsonb_build_object('ok',false); end if;
  if v.license_status='suspended' then return jsonb_build_object('ok',false,'error','license_suspended'); end if;
  if v.license_status='cancelled' then return jsonb_build_object('ok',false,'error','license_cancelled'); end if;
  if v.license_status not in ('trial','active') then return jsonb_build_object('ok',false,'error','license_inactive'); end if;
  if v.license_expires is not null and v.license_expires<=now() then return jsonb_build_object('ok',false,'error','license_expired'); end if;

  return jsonb_build_object('ok',true,'must_change_password',v.must_change_password);
end $$;

grant execute on function public.temp_login(text,text) to anon,authenticated;
grant execute on function public.temp_session_status(text) to anon,authenticated;
