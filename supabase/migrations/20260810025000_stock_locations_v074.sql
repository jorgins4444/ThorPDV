create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  code text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_locations_name_check check (char_length(trim(name)) between 2 and 80)
);
create unique index if not exists stock_locations_tenant_branch_name_uq on public.stock_locations(tenant_id,branch_id,lower(name));
create unique index if not exists stock_locations_tenant_code_uq on public.stock_locations(tenant_id,lower(code)) where code is not null;
create unique index if not exists stock_locations_default_branch_uq on public.stock_locations(branch_id) where is_default and active;
alter table public.stock_locations enable row level security;
drop policy if exists stock_locations_member_all on public.stock_locations;
create policy stock_locations_member_all on public.stock_locations for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

create table if not exists public.stock_location_balances (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stock_location_id uuid not null references public.stock_locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null default 0,
  reserved_quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key(stock_location_id,product_id)
);
create index if not exists stock_location_balances_tenant_product_idx on public.stock_location_balances(tenant_id,product_id);
alter table public.stock_location_balances enable row level security;
drop policy if exists stock_location_balances_member_all on public.stock_location_balances;
create policy stock_location_balances_member_all on public.stock_location_balances for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

alter table public.stock_movements add column if not exists stock_location_id uuid references public.stock_locations(id) on delete restrict;
create index if not exists stock_movements_stock_location_idx on public.stock_movements(stock_location_id,created_at desc);

insert into public.stock_locations(tenant_id,company_id,branch_id,name,code,is_default,active)
select b.tenant_id,b.company_id,b.id,case when b.is_headquarters then 'Matriz' else b.name end,null,true,true
from public.branches b
where not exists(select 1 from public.stock_locations sl where sl.branch_id=b.id and sl.is_default and sl.active);

update public.stock_movements sm set stock_location_id=sl.id
from public.stock_locations sl
where sm.stock_location_id is null and sl.tenant_id=sm.tenant_id and sl.branch_id=sm.branch_id and sl.is_default and sl.active;

insert into public.stock_location_balances(tenant_id,stock_location_id,product_id,quantity,reserved_quantity,updated_at)
select ib.tenant_id,sl.id,ib.product_id,ib.quantity,ib.reserved_quantity,now()
from public.inventory_balances ib join public.stock_locations sl on sl.tenant_id=ib.tenant_id and sl.branch_id=ib.branch_id and sl.is_default and sl.active
on conflict(stock_location_id,product_id) do update set quantity=excluded.quantity,reserved_quantity=excluded.reserved_quantity,updated_at=now();

create or replace function private.stock_movement_assign_location()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare loc public.stock_locations%rowtype;
begin
  if new.stock_location_id is null then
    select * into loc from public.stock_locations where tenant_id=new.tenant_id and branch_id=new.branch_id and is_default and active limit 1;
    if loc.id is null then raise exception 'default_stock_location_not_found'; end if;
    new.stock_location_id:=loc.id;
  else
    select * into loc from public.stock_locations where id=new.stock_location_id and tenant_id=new.tenant_id and active;
    if loc.id is null then raise exception 'stock_location_not_found'; end if;
    if loc.branch_id<>new.branch_id then raise exception 'stock_location_branch_mismatch'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_movement_assign_location on public.stock_movements;
create trigger trg_stock_movement_assign_location before insert on public.stock_movements for each row execute function private.stock_movement_assign_location();

create or replace function private.stock_movement_apply_location_balance()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_after numeric;
begin
  insert into public.stock_location_balances(tenant_id,stock_location_id,product_id,quantity,reserved_quantity,updated_at)
  values(new.tenant_id,new.stock_location_id,new.product_id,new.quantity,0,now())
  on conflict(stock_location_id,product_id) do update set quantity=public.stock_location_balances.quantity+excluded.quantity,updated_at=now()
  returning quantity-reserved_quantity into v_after;
  if v_after < -0.000001 then raise exception 'insufficient_stock_at_location'; end if;
  return new;
end $$;
drop trigger if exists trg_stock_movement_apply_location_balance on public.stock_movements;
create trigger trg_stock_movement_apply_location_balance after insert on public.stock_movements for each row execute function private.stock_movement_apply_location_balance();

create or replace function public.erp_stock_overview(p_token text)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_locations jsonb; v_balances jsonb; v_history jsonb;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_default desc,x.branch_name,x.name),'[]'::jsonb) into v_locations from (
    select sl.id,sl.name,sl.code,sl.branch_id,b.name branch_name,b.is_headquarters,sl.is_default,sl.active,coalesce(sum(slb.quantity-slb.reserved_quantity),0) total_quantity,count(slb.product_id) filter(where abs(slb.quantity-slb.reserved_quantity)>0)::int product_count,sl.created_at,sl.updated_at
    from public.stock_locations sl join public.branches b on b.id=sl.branch_id left join public.stock_location_balances slb on slb.stock_location_id=sl.id
    where sl.tenant_id=v.tenant_id and sl.company_id=v.company_id group by sl.id,b.name,b.is_headquarters
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.location_name,x.product_name),'[]'::jsonb) into v_balances from (
    select slb.stock_location_id,sl.name location_name,sl.branch_id,b.name branch_name,slb.product_id,p.name product_name,p.sku,p.product_code,p.unit,slb.quantity,slb.reserved_quantity,(slb.quantity-slb.reserved_quantity) available
    from public.stock_location_balances slb join public.stock_locations sl on sl.id=slb.stock_location_id join public.branches b on b.id=sl.branch_id join public.products p on p.id=slb.product_id
    where slb.tenant_id=v.tenant_id and sl.company_id=v.company_id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_history from (
    select sm.id,sm.created_at,p.name product,p.sku,p.product_code,sm.product_id,sm.movement_type,sm.quantity,sm.unit_cost,b.name branch,sl.id stock_location_id,sl.name stock_location,sm.notes
    from public.stock_movements sm join public.products p on p.id=sm.product_id join public.branches b on b.id=sm.branch_id left join public.stock_locations sl on sl.id=sm.stock_location_id
    where sm.tenant_id=v.tenant_id order by sm.created_at desc limit 500
  ) x;
  return jsonb_build_object('ok',true,'current_branch_id',v.branch_id,'locations',v_locations,'balances',v_balances,'history',v_history);
end $$;

create or replace function public.erp_stock_location_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_id uuid:=nullif(p_payload->>'id','')::uuid; v_branch uuid:=nullif(p_payload->>'branch_id','')::uuid; v_name text:=trim(coalesce(p_payload->>'name','')); v_code text:=nullif(upper(trim(coalesce(p_payload->>'code',''))),''); v_default boolean:=coalesce((p_payload->>'is_default')::boolean,false); v_active boolean:=coalesce((p_payload->>'active')::boolean,true); loc public.stock_locations%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if; v_branch:=coalesce(v_branch,v.branch_id);
  if char_length(v_name)<2 then return jsonb_build_object('ok',false,'error','stock_location_name_required'); end if;
  if not exists(select 1 from public.branches b where b.id=v_branch and b.tenant_id=v.tenant_id and b.company_id=v.company_id) then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
  if v_id is null then
    if not exists(select 1 from public.stock_locations where tenant_id=v.tenant_id and branch_id=v_branch) then v_default:=true; end if;
    if v_default then update public.stock_locations set is_default=false,updated_at=now() where tenant_id=v.tenant_id and branch_id=v_branch; end if;
    insert into public.stock_locations(tenant_id,company_id,branch_id,name,code,is_default,active) values(v.tenant_id,v.company_id,v_branch,v_name,v_code,v_default,v_active) returning * into loc;
  else
    select * into loc from public.stock_locations where id=v_id and tenant_id=v.tenant_id and company_id=v.company_id for update; if loc.id is null then return jsonb_build_object('ok',false,'error','stock_location_not_found'); end if;
    if loc.is_default and not v_active then return jsonb_build_object('ok',false,'error','default_stock_location_cannot_be_disabled'); end if;
    if not v_active and exists(select 1 from public.stock_location_balances where stock_location_id=v_id and abs(quantity-reserved_quantity)>0.000001) then return jsonb_build_object('ok',false,'error','stock_location_has_balance'); end if;
    if v_default then update public.stock_locations set is_default=false,updated_at=now() where tenant_id=v.tenant_id and branch_id=v_branch and id<>v_id; end if;
    update public.stock_locations set branch_id=v_branch,name=v_name,code=v_code,is_default=v_default,active=v_active,updated_at=now() where id=v_id returning * into loc;
  end if;
  return jsonb_build_object('ok',true,'id',loc.id,'name',loc.name,'branch_id',loc.branch_id,'is_default',loc.is_default,'active',loc.active);
exception when unique_violation then return jsonb_build_object('ok',false,'error','duplicate_stock_location'); end $$;

grant execute on function public.erp_stock_overview(text) to authenticated,anon;
grant execute on function public.erp_stock_location_save(text,jsonb) to authenticated,anon;
