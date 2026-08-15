create table if not exists private.bank_webhook_clients (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('sandbox','homologation','production')),
  client_id text not null,
  client_secret_cipher bytea,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,environment,client_id)
);

create table if not exists private.bank_webhook_access_tokens (
  id uuid primary key default gen_random_uuid(),
  webhook_client_id uuid not null references private.bank_webhook_clients(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists bank_webhook_access_tokens_expires_idx on private.bank_webhook_access_tokens(expires_at);

create or replace function public.edge_bank_webhook_oauth_status(p_provider text,p_environment text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare c private.bank_webhook_clients%rowtype;
begin
  select * into c from private.bank_webhook_clients
   where provider=lower(p_provider) and environment=p_environment and active=true
   order by updated_at desc limit 1;
  return jsonb_build_object(
    'ok',true,
    'configured',c.id is not null and c.client_secret_cipher is not null,
    'client_id',case when c.id is not null then c.client_id else null end,
    'provider',lower(p_provider),
    'environment',p_environment
  );
end $$;

create or replace function public.edge_bank_webhook_oauth_issue(
  p_provider text,
  p_environment text,
  p_client_id text,
  p_client_secret text,
  p_access_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare c private.bank_webhook_clients%rowtype; v_hash text; v_expires timestamptz:=now()+interval '5 minutes';
begin
  if p_environment not in ('sandbox','homologation','production') then
    return jsonb_build_object('ok',false,'error','invalid_environment');
  end if;
  select * into c from private.bank_webhook_clients
   where provider=lower(p_provider) and environment=p_environment and client_id=p_client_id and active=true
   limit 1;
  if c.id is null or c.client_secret_cipher is null then
    return jsonb_build_object('ok',false,'error','invalid_client');
  end if;
  if private.platform_decrypt_secret(c.client_secret_cipher) is distinct from p_client_secret then
    return jsonb_build_object('ok',false,'error','invalid_client');
  end if;
  if nullif(p_access_token,'') is null then
    return jsonb_build_object('ok',false,'error','access_token_required');
  end if;
  delete from private.bank_webhook_access_tokens where expires_at < now()-interval '10 minutes';
  v_hash:=encode(extensions.digest(p_access_token,'sha256'),'hex');
  insert into private.bank_webhook_access_tokens(webhook_client_id,token_hash,expires_at)
  values(c.id,v_hash,v_expires);
  return jsonb_build_object('ok',true,'expires_in',300,'expires_at',v_expires);
end $$;

create or replace function public.edge_bank_webhook_oauth_validate(
  p_provider text,
  p_environment text,
  p_access_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare v_hash text; v_id uuid;
begin
  if nullif(p_access_token,'') is null then return jsonb_build_object('ok',false); end if;
  v_hash:=encode(extensions.digest(p_access_token,'sha256'),'hex');
  select t.id into v_id
    from private.bank_webhook_access_tokens t
    join private.bank_webhook_clients c on c.id=t.webhook_client_id
   where t.token_hash=v_hash
     and t.expires_at>now()
     and c.active=true
     and c.provider=lower(p_provider)
     and c.environment=p_environment
   limit 1;
  return jsonb_build_object('ok',v_id is not null);
end $$;

create or replace function public.erp_bank_webhook_client_rotate(
  p_control_token text,
  p_provider text default 'itau',
  p_environment text default 'homologation'
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare a uuid; c private.bank_webhook_clients%rowtype; v_secret text; v_client_id text:='thor-itau-hub';
begin
  a:=private.resolve_platform_admin(p_control_token);
  if a is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_environment not in ('sandbox','homologation','production') then return jsonb_build_object('ok',false,'error','invalid_environment'); end if;
  v_secret:='twc_'||encode(gen_random_bytes(32),'hex');
  insert into private.bank_webhook_clients(provider,environment,client_id,client_secret_cipher,active,updated_at)
  values(lower(p_provider),p_environment,v_client_id,private.platform_encrypt_secret(v_secret),true,now())
  on conflict(provider,environment,client_id) do update
    set client_secret_cipher=excluded.client_secret_cipher,active=true,updated_at=now()
  returning * into c;
  delete from private.bank_webhook_access_tokens where webhook_client_id=c.id;
  return jsonb_build_object('ok',true,'provider',c.provider,'environment',c.environment,'client_id',c.client_id,'client_secret',v_secret,'rotated_at',c.updated_at);
end $$;

revoke all on function public.edge_bank_webhook_oauth_status(text,text) from public,anon,authenticated;
revoke all on function public.edge_bank_webhook_oauth_issue(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.edge_bank_webhook_oauth_validate(text,text,text) from public,anon,authenticated;
grant execute on function public.edge_bank_webhook_oauth_status(text,text) to service_role;
grant execute on function public.edge_bank_webhook_oauth_issue(text,text,text,text,text) to service_role;
grant execute on function public.edge_bank_webhook_oauth_validate(text,text,text) to service_role;

revoke all on function public.erp_bank_webhook_client_rotate(text,text,text) from public;
grant execute on function public.erp_bank_webhook_client_rotate(text,text,text) to anon,authenticated;
