-- ThorControl: reset administrativo de senha do administrador de uma base.
-- A funcao so pode ser executada por uma sessao valida do ThorControl.
create or replace function public.platform_customer_password_reset(
  p_token text,
  p_tenant uuid,
  p_email text
) returns jsonb
language plpgsql security definer
set search_path = 'public','private','extensions'
as $$
declare
  v_admin uuid;
  v_user private.temp_users%rowtype;
  v_email text;
  v_password text;
  v_count integer;
begin
  v_admin := private.resolve_platform_admin(p_token);
  if v_admin is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  if p_tenant is null or not exists (select 1 from public.tenant_licenses where tenant_id=p_tenant) then
    return jsonb_build_object('ok',false,'error','tenant_not_found');
  end if;
  v_email := lower(trim(coalesce(p_email,'')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok',false,'error','invalid_email');
  end if;

  select u.* into v_user
  from private.temp_users u
  join private.temp_user_context ctx on ctx.user_id=u.id
  where ctx.tenant_id=p_tenant
    and u.email_hash=encode(extensions.digest(v_email,'sha256'),'hex')
    and u.active=true
  limit 1
  for update of u;
  if v_user.id is null then
    return jsonb_build_object('ok',false,'error','user_not_found_in_tenant');
  end if;

  -- Falhar antes de modificar a senha caso nao seja possivel revogar sessoes.
  if to_regclass('private.temp_sessions') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='private' and table_name='temp_sessions' and column_name='user_id'
     ) then
    raise exception 'Estrutura de sessoes incompativel; redefinicao cancelada';
  end if;

  v_password := 'Thor#' || upper(encode(extensions.gen_random_bytes(10),'hex'));
  update private.temp_users
  set password_hash=extensions.crypt(v_password,extensions.gen_salt('bf',12)),
      must_change_password=true,
      failed_attempts=0,
      locked_until=null
  where id=v_user.id;

  delete from private.temp_sessions where user_id=v_user.id;
  get diagnostics v_count = row_count;

  insert into public.license_audit(tenant_id,action,actor_admin_id,after_data)
  values(p_tenant,'customer_password_reset',v_admin,
    jsonb_build_object('user_id',v_user.id,'email',v_email,'revoked_sessions',v_count));

  return jsonb_build_object('ok',true,'email',v_email,'temporary_password',v_password,'revoked_sessions',v_count);
end $$;

revoke all on function public.platform_customer_password_reset(text,uuid,text) from public;
revoke all on function public.platform_customer_password_reset(text,uuid,text) from anon;
grant execute on function public.platform_customer_password_reset(text,uuid,text) to authenticated;
grant execute on function public.platform_customer_password_reset(text,uuid,text) to anon;
-- O papel anon necessita executar RPC porque ThorControl usa sessao propria.
-- A autorizacao efetiva e verificada por private.resolve_platform_admin().
