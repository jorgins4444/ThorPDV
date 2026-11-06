-- Smoke test for migration v0930, run ONLY against the staging Supabase database.
-- This script makes no data changes; it validates object presence, RLS and invalid device rejection.
begin;
do $$
declare
  v_result jsonb;
  v_rls boolean;
begin
  if to_regprocedure('public.pdv_catalog_apply_v1(text,uuid,text,jsonb)') is null then
    raise exception 'Missing public.pdv_catalog_apply_v1 RPC';
  end if;
  if to_regclass('public.pdv_catalog_mutations') is null then
    raise exception 'Missing public.pdv_catalog_mutations table';
  end if;
  select c.relrowsecurity into v_rls from pg_class c
   where c.oid='public.pdv_catalog_mutations'::regclass;
  if not coalesce(v_rls,false) then
    raise exception 'RLS not enabled on catalog mutation ledger';
  end if;
  if has_table_privilege('anon','public.pdv_catalog_mutations','SELECT')
    or has_table_privilege('authenticated','public.pdv_catalog_mutations','INSERT') then
    raise exception 'Mutation ledger privilege leak';
  end if;
  select public.pdv_catalog_apply_v1(
    'invalid-staging-device',gen_random_uuid(),'product_price',
    jsonb_build_object('id',gen_random_uuid(),'sale_price',10,'expected_sale_price',8)
  ) into v_result;
  if v_result->>'error' is distinct from 'invalid_device' then
    raise exception 'Invalid device not rejected: %',v_result;
  end if;
  raise notice 'ThorPDV catalog v0930 staging smoke test succeeded';
end $$;
rollback;
