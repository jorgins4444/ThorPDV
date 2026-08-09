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
  update public.products
     set fractioned = case when coalesce(label_scale,false) then true else fractioned end,
         is_weighable = case when coalesce(label_scale,false) then true else is_weighable end,
         sku = case when v_is_new then v_code::text else sku end,
         updated_at=now()
   where id=(r->>'id')::uuid and tenant_id=v.tenant_id;
  return r||jsonb_build_object('product_code',v_code,'sku',(select sku from public.products where id=(r->>'id')::uuid));
end;
$$;
