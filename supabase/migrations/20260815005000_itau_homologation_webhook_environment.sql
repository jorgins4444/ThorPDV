-- Separa o ambiente de Homologação Itaú do Sandbox e da Produção.
-- O Hub de Notificação do Itaú deve chamar o Thor com environment=homologation.

alter table public.bank_account_integrations
  drop constraint if exists bank_account_integrations_environment_check;

alter table public.bank_account_integrations
  add constraint bank_account_integrations_environment_check
  check (environment in ('sandbox','homologation','production'));

alter table private.platform_bank_provider_credentials
  drop constraint if exists platform_bank_provider_credentials_environment_check;

alter table private.platform_bank_provider_credentials
  add constraint platform_bank_provider_credentials_environment_check
  check (environment in ('sandbox','homologation','production'));

alter table public.bank_webhook_events
  drop constraint if exists bank_webhook_events_environment_check;

alter table public.bank_webhook_events
  add constraint bank_webhook_events_environment_check
  check (environment in ('sandbox','homologation','production'));

do $$
declare
  v_sql text;
begin
  select pg_get_functiondef(
    'private.process_bank_payment_event(text,text,text,text,jsonb,jsonb)'::regprocedure
  ) into v_sql;

  v_sql := replace(
    v_sql,
    $old$p_environment not in ('sandbox','production')$old$,
    $new$p_environment not in ('sandbox','homologation','production')$new$
  );

  if v_sql not like '%homologation%' then
    raise exception 'Could not patch private.process_bank_payment_event environment validation';
  end if;

  execute v_sql;
end $$;
