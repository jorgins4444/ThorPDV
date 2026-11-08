-- ThorGestão | Cadastro e manutenção de lotes por filial.
-- Operações são realizadas exclusivamente através de RPC com sessão temporária válida.
create or replace function public.erp_expiry_lots_manage(
 p_token text,
 p_action text default 'list',
 p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path=public,private,extensions
set timezone='America/Fortaleza'
as $$
declare
 v record; v_branch uuid; v_id uuid; v_product uuid;
 v_lot text; v_date date; v_qty numeric(15,4);
 v_data jsonb; v_products jsonb; v_branches jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 if p_action in ('save','remove') and not private.management_has_permission(p_token,'stock.adjust') then
   return jsonb_build_object('ok',false,'error','permission_denied');
 end if;
 -- A filial ativa da sessão é o escopo de escrita, nunca um tenant/branch vindo do cliente.
 v_branch:=v.branch_id;
 if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;
 if p_action='list' then
   select coalesce(jsonb_agg(to_jsonb(x) order by x.expiry_date,x.name),'[]'::jsonb) into v_data
   from (
    select l.id,l.product_id,p.name,p.sku,l.lot_number,l.expiry_date,l.quantity,
     l.created_at,l.updated_at,(l.expiry_date-current_date) days_left
    from public.product_expiry_lots l join public.products p on p.id=l.product_id
    where l.tenant_id=v.tenant_id and l.branch_id=v_branch
    order by l.expiry_date,p.name limit 2000
   ) x;
   select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_products
   from (
    select p.id,p.name,p.sku,coalesce(ib.quantity-ib.reserved_quantity,0) stock
    from public.products p
    left join public.inventory_balances ib on ib.product_id=p.id and ib.branch_id=v_branch and ib.tenant_id=v.tenant_id
    where p.tenant_id=v.tenant_id and p.active=true order by p.name limit 5000
   ) x;
   return jsonb_build_object('ok',true,'lots',v_data,'products',v_products,'branch_id',v_branch);
 elsif p_action='save' then
   v_id:=nullif(p_payload->>'id','')::uuid;
   v_product:=nullif(p_payload->>'product_id','')::uuid;
   v_lot:=btrim(coalesce(p_payload->>'lot_number',''));
   v_date:=nullif(p_payload->>'expiry_date','')::date;
   v_qty:=(p_payload->>'quantity')::numeric;
   if v_product is null or v_date is null or length(v_lot)=0 or length(v_lot)>100 or v_qty is null or v_qty<0
   then return jsonb_build_object('ok',false,'error','invalid_lot_fields'); end if;
   if not exists(select 1 from public.products p where p.id=v_product and p.tenant_id=v.tenant_id and p.active=true)
   then return jsonb_build_object('ok',false,'error','invalid_product'); end if;
   if v_id is null then
     insert into public.product_expiry_lots(tenant_id,branch_id,product_id,lot_number,expiry_date,quantity)
     values(v.tenant_id,v_branch,v_product,v_lot,v_date,v_qty)
     on conflict(branch_id,product_id,lot_number,expiry_date)
     do update set quantity=excluded.quantity,updated_at=now()
     returning id into v_id;
   else
     update public.product_expiry_lots l
      set product_id=v_product,lot_number=v_lot,expiry_date=v_date,quantity=v_qty,updated_at=now()
      where l.id=v_id and l.tenant_id=v.tenant_id and l.branch_id=v_branch
      returning id into v_id;
     if not found then return jsonb_build_object('ok',false,'error','lot_not_found'); end if;
   end if;
   return jsonb_build_object('ok',true,'id',v_id);
 elsif p_action='remove' then
   v_id:=nullif(p_payload->>'id','')::uuid;
   if v_id is null then return jsonb_build_object('ok',false,'error','invalid_lot_id'); end if;
   -- Mantém registro histórico, mas exclui o lote dos alertas e cálculos de validade.
   update public.product_expiry_lots l set quantity=0,updated_at=now()
   where l.id=v_id and l.tenant_id=v.tenant_id and l.branch_id=v_branch;
   if not found then return jsonb_build_object('ok',false,'error','lot_not_found'); end if;
   return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('ok',false,'error','invalid_action');
exception
 when unique_violation then return jsonb_build_object('ok',false,'error','duplicate_lot');
 when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
 return jsonb_build_object('ok',false,'error','invalid_lot_fields');
end $$;
revoke all on function public.erp_expiry_lots_manage(text,text,jsonb) from public;
grant execute on function public.erp_expiry_lots_manage(text,text,jsonb) to anon,authenticated,service_role;
