create or replace function public.erp_stock_location_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_id uuid:=nullif(p_payload->>'id','')::uuid; v_branch uuid:=nullif(p_payload->>'branch_id','')::uuid; v_name text:=trim(coalesce(p_payload->>'name','')); v_code text:=nullif(upper(trim(coalesce(p_payload->>'code',''))),''); v_default boolean:=coalesce((p_payload->>'is_default')::boolean,false); v_active boolean:=coalesce((p_payload->>'active')::boolean,true); loc public.stock_locations%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_branch:=coalesce(v_branch,v.branch_id);
  if char_length(v_name)<2 then return jsonb_build_object('ok',false,'error','stock_location_name_required'); end if;
  if not exists(select 1 from public.branches b where b.id=v_branch and b.tenant_id=v.tenant_id and b.company_id=v.company_id) then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
  if v_id is null then
    if not exists(select 1 from public.stock_locations where tenant_id=v.tenant_id and branch_id=v_branch) then v_default:=true; end if;
    if v_default then update public.stock_locations set is_default=false,updated_at=now() where tenant_id=v.tenant_id and branch_id=v_branch; end if;
    insert into public.stock_locations(tenant_id,company_id,branch_id,name,code,is_default,active) values(v.tenant_id,v.company_id,v_branch,v_name,v_code,v_default,v_active) returning * into loc;
  else
    select * into loc from public.stock_locations where id=v_id and tenant_id=v.tenant_id and company_id=v.company_id for update;
    if loc.id is null then return jsonb_build_object('ok',false,'error','stock_location_not_found'); end if;
    if loc.is_default and loc.branch_id<>v_branch then return jsonb_build_object('ok',false,'error','default_stock_location_cannot_change_branch'); end if;
    if loc.branch_id<>v_branch and exists(select 1 from public.stock_location_balances where stock_location_id=v_id and abs(quantity-reserved_quantity)>0.000001) then return jsonb_build_object('ok',false,'error','stock_location_with_balance_cannot_change_branch'); end if;
    if loc.is_default and not v_active then return jsonb_build_object('ok',false,'error','default_stock_location_cannot_be_disabled'); end if;
    if not v_active and exists(select 1 from public.stock_location_balances where stock_location_id=v_id and abs(quantity-reserved_quantity)>0.000001) then return jsonb_build_object('ok',false,'error','stock_location_has_balance'); end if;
    if v_default then update public.stock_locations set is_default=false,updated_at=now() where tenant_id=v.tenant_id and branch_id=v_branch and id<>v_id; end if;
    update public.stock_locations set branch_id=v_branch,name=v_name,code=v_code,is_default=v_default,active=v_active,updated_at=now() where id=v_id returning * into loc;
  end if;
  return jsonb_build_object('ok',true,'id',loc.id,'name',loc.name,'branch_id',loc.branch_id,'is_default',loc.is_default,'active',loc.active);
exception when unique_violation then return jsonb_build_object('ok',false,'error','duplicate_stock_location'); end $$;
