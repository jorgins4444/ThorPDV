create or replace function public.erp_product_save_v4(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare r jsonb; v record; v_code bigint; v_is_new boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_is_new:=nullif(p_payload->>'id','') is null;
  r:=public.erp_product_save_v3(p_token,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  select product_code into v_code from public.products where id=(r->>'id')::uuid and tenant_id=v.tenant_id;
  if v_is_new then update public.products set sku=v_code::text,updated_at=now() where id=(r->>'id')::uuid and tenant_id=v.tenant_id; end if;
  return r||jsonb_build_object('product_code',v_code,'sku',v_code::text);
end;
$$;
