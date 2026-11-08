-- Etapa 3: consumo automático por FEFO, baixa manual e rastreabilidade de saída.
-- O estoque físico continua sendo movimentado pelos fluxos existentes de venda/ajuste.
create table if not exists public.product_lot_consumptions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 lot_id uuid not null references public.product_expiry_lots(id) on delete restrict,
 sale_item_id uuid references public.sale_items(id) on delete cascade,
 quantity numeric(15,4) not null check(quantity>0),
 method text not null check(method in ('fefo','manual')),
 note text,
 created_at timestamptz not null default now(),
 unique(sale_item_id,lot_id)
);
create index if not exists product_lot_consumptions_lot_idx on public.product_lot_consumptions(tenant_id,lot_id);
create index if not exists product_lot_consumptions_sale_idx on public.product_lot_consumptions(sale_item_id);
alter table public.product_lot_consumptions enable row level security;
revoke all on public.product_lot_consumptions from anon,authenticated;

create table if not exists public.product_lot_allocation_gaps (
 sale_item_id uuid primary key references public.sale_items(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 untracked_quantity numeric(15,4) not null check(untracked_quantity>0),
 reason text not null default 'insufficient_valid_lot_stock',
 updated_at timestamptz not null default now()
);
alter table public.product_lot_allocation_gaps enable row level security;
revoke all on public.product_lot_allocation_gaps from anon,authenticated;

create or replace function private.allocate_sale_item_lots(p_sale_item uuid)
returns void language plpgsql security definer
set search_path=public,private,extensions
set timezone='America/Fortaleza'
as $$
declare v record; v_lot record; v_needed numeric(15,4); v_take numeric(15,4);v_tracked boolean;
begin
 select si.id,si.tenant_id,si.product_id,si.quantity,s.branch_id,s.status
 into v from public.sale_items si join public.sales s on s.id=si.sale_id where si.id=p_sale_item;
 if not found or v.status not in ('completed','paid','fiscalized') or v.product_id is null then return; end if;
 select exists(select 1 from public.product_expiry_lots l
 where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id and l.product_id=v.product_id) into v_tracked;
 if not v_tracked then return; end if;
 select greatest(v.quantity-coalesce(sum(c.quantity),0),0) into v_needed
 from public.product_lot_consumptions c where c.sale_item_id=v.id;
 for v_lot in
  select l.id,l.quantity from public.product_expiry_lots l
  where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id and l.product_id=v.product_id
   and l.expiry_date>=current_date and l.quantity>0
  order by l.expiry_date,l.created_at,l.id for update
 loop
  exit when v_needed<=0;
  v_take:=least(v_needed,v_lot.quantity);
  update public.product_expiry_lots set quantity=quantity-v_take,updated_at=now() where id=v_lot.id;
  insert into public.product_lot_consumptions(tenant_id,branch_id,product_id,lot_id,sale_item_id,quantity,method,note)
  values(v.tenant_id,v.branch_id,v.product_id,v_lot.id,v.id,v_take,'fefo','Saída automática por vencimento mais próximo')
  on conflict(sale_item_id,lot_id) do update
   set quantity=public.product_lot_consumptions.quantity+excluded.quantity;
  v_needed:=v_needed-v_take;
 end loop;
 if v_needed>0 then
  insert into public.product_lot_allocation_gaps(sale_item_id,tenant_id,branch_id,product_id,untracked_quantity)
  values(v.id,v.tenant_id,v.branch_id,v.product_id,v_needed)
  on conflict(sale_item_id) do update set untracked_quantity=excluded.untracked_quantity,updated_at=now();
 else
  delete from public.product_lot_allocation_gaps where sale_item_id=v.id;
 end if;
end $$;

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
       join public.sale_items si on si.id=c.sale_item_id where si.sale_id=new.id and c.method='fefo'
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

drop trigger if exists trg_sale_lot_allocation on public.sales;
create trigger trg_sale_lot_allocation after insert or update of status on public.sales
for each row execute function private.on_sale_lot_allocation();
drop trigger if exists trg_sale_item_lot_allocation on public.sale_items;
create trigger trg_sale_item_lot_allocation after insert on public.sale_items
for each row execute function private.on_sale_lot_allocation();

create or replace function public.erp_lot_manual_decrement(p_token text,p_lot uuid,p_quantity numeric,p_note text)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v record; v_lot record;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 if not private.management_has_permission(p_token,'stock.adjust') then
  return jsonb_build_object('ok',false,'error','permission_denied'); end if;
 if p_quantity is null or p_quantity<=0 or length(btrim(coalesce(p_note,'')))<3
 then return jsonb_build_object('ok',false,'error','invalid_manual_decrement'); end if;
 select id,tenant_id,branch_id,product_id,quantity into v_lot
 from public.product_expiry_lots
 where id=p_lot and tenant_id=v.tenant_id and branch_id=v.branch_id for update;
 if not found then return jsonb_build_object('ok',false,'error','lot_not_found'); end if;
 if p_quantity>v_lot.quantity then return jsonb_build_object('ok',false,'error','insufficient_lot_quantity');end if;
 update public.product_expiry_lots set quantity=quantity-p_quantity,updated_at=now() where id=p_lot;
 insert into public.product_lot_consumptions(tenant_id,branch_id,product_id,lot_id,quantity,method,note)
 values(v.tenant_id,v.branch_id,v_lot.product_id,p_lot,p_quantity,'manual',left(btrim(p_note),500));
 return jsonb_build_object('ok',true,'remaining',v_lot.quantity-p_quantity);
end $$;
revoke all on function public.erp_lot_manual_decrement(text,uuid,numeric,text) from public;
grant execute on function public.erp_lot_manual_decrement(text,uuid,numeric,text) to anon,authenticated,service_role;
