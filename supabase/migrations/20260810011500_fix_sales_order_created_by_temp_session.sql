-- The Gestão temporary-session user ID belongs to private.temp_users,
-- while sales_orders.created_by references auth.users(id).
-- Keep the audit FK intact and persist created_by only when the session user
-- is also a real Supabase Auth user. Otherwise PostgreSQL stores NULL.

do $migration$
declare
  fn text;
  patched text;
  needle text := 'nullif(p_payload->>''notes'',''''),v.user_id) returning id into oid;';
  replacement text := 'nullif(p_payload->>''notes'',''''),(select au.id from auth.users au where au.id=v.user_id limit 1)) returning id into oid;';
begin
  select pg_get_functiondef(p.oid)
    into fn
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='erp_sales_order_save'
    and pg_get_function_identity_arguments(p.oid)='p_token text, p_payload jsonb'
  limit 1;

  if fn is null then
    raise exception 'erp_sales_order_save(text,jsonb) not found';
  end if;

  -- Idempotent when the corrected expression is already present.
  if position('(select au.id from auth.users au where au.id=v.user_id limit 1)' in fn) > 0 then
    return;
  end if;

  if position(needle in fn) = 0 then
    raise exception 'erp_sales_order_save body changed; created_by patch target not found';
  end if;

  patched := replace(fn, needle, replacement);
  execute patched;
end
$migration$;
