-- Resolver pendências de baixa de vendas por seleção manual do lote.
create or replace function public.erp_sale_lot_manual_assign(
 p_token text,p_sale_item uuid,p_lot uuid,p_quantity numeric
)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v record;v_gap record;v_lot record;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 if not private.management_has_permission(p_token,'stock.adjust') then return jsonb_build_object('ok',false,'error','permission_denied');end if;
 if p_quantity is null or p_quantity<=0 then return jsonb_build_object('ok',false,'error','invalid_quantity');end if;
 select g.sale_item_id,g.tenant_id,g.branch_id,g.product_id,g.untracked_quantity
 into v_gap from public.product_lot_allocation_gaps g
 join public.sale_items si on si.id=g.sale_item_id
 join public.sales s on s.id=si.sale_id
 where g.sale_item_id=p_sale_item and g.tenant_id=v.tenant_id and g.branch_id=v.branch_id
 and s.status in ('completed','paid','fiscalized')
 for update of g;
 if not found then return jsonb_build_object('ok',false,'error','untracked_sale_item_not_found');end if;
 select id,quantity from public.product_expiry_lots
 into v_lot where id=p_lot and tenant_id=v.tenant_id and branch_id=v.branch_id
  and product_id=v_gap.product_id and expiry_date>=current_date
 for update;
 if not found then return jsonb_build_object('ok',false,'error','valid_lot_not_found');end if;
 if p_quantity>v_lot.quantity or p_quantity>v_gap.untracked_quantity
 then return jsonb_build_object('ok',false,'error','quantity_exceeds_available');end if;
 if exists(select 1 from public.product_lot_consumptions
  where sale_item_id=p_sale_item and lot_id=p_lot)
 then return jsonb_build_object('ok',false,'error','lot_already_assigned_to_sale');end if;
 update public.product_expiry_lots set quantity=quantity-p_quantity,updated_at=now() where id=p_lot;
 insert into public.product_lot_consumptions(tenant_id,branch_id,product_id,lot_id,sale_item_id,quantity,method,note)
 values(v.tenant_id,v.branch_id,v_gap.product_id,p_lot,p_sale_item,p_quantity,'manual','Alocação manual da saída vinculada à venda');
 if p_quantity=v_gap.untracked_quantity then
  delete from public.product_lot_allocation_gaps where sale_item_id=p_sale_item;
 else
  update public.product_lot_allocation_gaps set untracked_quantity=untracked_quantity-p_quantity,updated_at=now()
  where sale_item_id=p_sale_item;
 end if;
 return jsonb_build_object('ok',true,'allocated',p_quantity);
end $$;
revoke all on function public.erp_sale_lot_manual_assign(text,uuid,uuid,numeric) from public;
grant execute on function public.erp_sale_lot_manual_assign(text,uuid,uuid,numeric) to anon,authenticated,service_role;

create or replace function public.erp_sale_lot_pending(p_token text)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v record;v_rows jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_rows
 from (
  select g.sale_item_id,g.product_id,g.untracked_quantity,s.number as sale_number,
   s.completed_at as created_at,p.name as product,p.sku
  from public.product_lot_allocation_gaps g
  join public.sale_items si on si.id=g.sale_item_id
  join public.sales s on s.id=si.sale_id
  join public.products p on p.id=g.product_id
  where g.tenant_id=v.tenant_id and g.branch_id=v.branch_id and s.status in ('completed','paid','fiscalized')
  order by s.completed_at desc limit 200
 ) x;
 return jsonb_build_object('ok',true,'pending',v_rows);
end $$;
revoke all on function public.erp_sale_lot_pending(text) from public;
grant execute on function public.erp_sale_lot_pending(text) to anon,authenticated,service_role;
