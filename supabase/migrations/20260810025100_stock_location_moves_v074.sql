create or replace function public.erp_stock_move(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare
  v record; v_product uuid; v_qty numeric; v_signed numeric; v_type text; v_location uuid; v_destination_location uuid; v_destination_branch uuid; v_source_branch uuid; v_available numeric; v_unit_cost numeric; v_notes text; v_transfer_id uuid:=gen_random_uuid();
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_product:=nullif(p_payload->>'product_id','')::uuid;
  v_signed:=coalesce(nullif(p_payload->>'quantity','')::numeric,0);
  v_qty:=abs(v_signed);
  v_type:=coalesce(p_payload->>'movement_type','adjustment');
  v_location:=nullif(p_payload->>'stock_location_id','')::uuid;
  v_destination_location:=nullif(p_payload->>'destination_stock_location_id','')::uuid;
  v_destination_branch:=nullif(p_payload->>'destination_branch_id','')::uuid;
  v_unit_cost:=nullif(p_payload->>'unit_cost','')::numeric;
  v_notes:=nullif(p_payload->>'notes','');
  if v_product is null or v_qty<=0 then return jsonb_build_object('ok',false,'error','invalid_stock_movement'); end if;
  if v_location is null then select id into v_location from public.stock_locations where tenant_id=v.tenant_id and branch_id=v.branch_id and is_default and active limit 1; end if;
  select branch_id into v_source_branch from public.stock_locations where id=v_location and tenant_id=v.tenant_id and company_id=v.company_id and active;
  if v_source_branch is null then return jsonb_build_object('ok',false,'error','stock_location_not_found'); end if;
  select coalesce(quantity-reserved_quantity,0) into v_available from public.stock_location_balances where stock_location_id=v_location and product_id=v_product;
  v_available:=coalesce(v_available,0);
  if (v_type in ('out','loss') or (v_type='adjustment' and v_signed<0)) and v_available<v_qty then return jsonb_build_object('ok',false,'error','insufficient_stock_at_location','available',v_available,'requested',v_qty); end if;

  if v_type='transfer' then
    if v_destination_location is null and v_destination_branch is not null then select id into v_destination_location from public.stock_locations where tenant_id=v.tenant_id and branch_id=v_destination_branch and is_default and active limit 1; end if;
    if v_destination_location is null then return jsonb_build_object('ok',false,'error','destination_stock_location_required'); end if;
    select branch_id into v_destination_branch from public.stock_locations where id=v_destination_location and tenant_id=v.tenant_id and company_id=v.company_id and active;
    if v_destination_branch is null or v_destination_location=v_location then return jsonb_build_object('ok',false,'error','invalid_destination_stock_location'); end if;
    if v_available<v_qty then return jsonb_build_object('ok',false,'error','insufficient_stock_at_location','available',v_available,'requested',v_qty); end if;
    insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v_source_branch,v_location,v_product,'transfer_out',-v_qty,v_unit_cost,'transfer',v_transfer_id,v_notes);
    insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v_destination_branch,v_destination_location,v_product,'transfer_in',v_qty,v_unit_cost,'transfer',v_transfer_id,v_notes);
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_source_branch,v_product,-v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_destination_branch,v_product,v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
    return jsonb_build_object('ok',true,'transfer_id',v_transfer_id,'source_stock_location_id',v_location,'destination_stock_location_id',v_destination_location);
  end if;

  v_signed:=case when v_type in ('out','loss') then -v_qty when v_type='adjustment' then v_signed else v_qty end;
  insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,notes) values(v.tenant_id,v_source_branch,v_location,v_product,v_type,v_signed,v_unit_cost,'manual',v_notes);
  insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_source_branch,v_product,v_signed,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
  return jsonb_build_object('ok',true,'product_id',v_product,'stock_location_id',v_location);
end $$;
