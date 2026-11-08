-- Corrige cancelamentos e remoção de itens: devolve o saldo de TODOS os lotes vinculados à venda.
create or replace function private.on_sale_lot_allocation()
returns trigger language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v_item record;
begin
 begin
  if tg_table_name='sales' then
   if new.status in ('completed','paid','fiscalized') and
     (tg_op='INSERT' or old.status is distinct from new.status) then
     for v_item in select id from public.sale_items where sale_id=new.id loop
      perform private.allocate_sale_item_lots(v_item.id);
     end loop;
   elsif tg_op='UPDATE' and new.status='cancelled' and old.status in ('completed','paid','fiscalized') then
     -- Restaura somente as baixas automáticas vinculadas aos itens da venda cancelada.
     for v_item in select c.id,c.lot_id,c.quantity from public.product_lot_consumptions c
       join public.sale_items si on si.id=c.sale_item_id where si.sale_id=new.id 
     loop
      update public.product_expiry_lots set quantity=quantity+v_item.quantity,updated_at=now() where id=v_item.lot_id;
      delete from public.product_lot_consumptions where id=v_item.id;
     end loop;
     delete from public.product_lot_allocation_gaps g using public.sale_items si
      where g.sale_item_id=si.id and si.sale_id=new.id;
   end if;
  elsif tg_table_name='sale_items' and tg_op='INSERT' then
   perform private.allocate_sale_item_lots(new.id);
  end if;
 exception when others then
  -- Falhas de rastreabilidade nunca devem derrubar o faturamento/PDV.
  raise warning 'Erro na alocação de lotes (%, %): %',tg_table_name,new.id,sqlerrm;
 end;
 return new;
end $$;


create or replace function private.on_sale_item_lot_delete()
returns trigger language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v record;
begin
 for v in select c.id,c.lot_id,c.quantity from public.product_lot_consumptions c
 where c.sale_item_id=old.id for update
 loop
  update public.product_expiry_lots set quantity=quantity+v.quantity,updated_at=now() where id=v.lot_id;
  delete from public.product_lot_consumptions where id=v.id;
 end loop;
 delete from public.product_lot_allocation_gaps where sale_item_id=old.id;
 return old;
end $$;
drop trigger if exists trg_sale_item_lot_delete on public.sale_items;
create trigger trg_sale_item_lot_delete before delete on public.sale_items
for each row execute function private.on_sale_item_lot_delete();
