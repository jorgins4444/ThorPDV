-- ThorGestão: inteligência de estoque, movimentação e validade por lote.
-- Aplicar no Supabase após validar backup e permissões.
create table if not exists public.product_expiry_lots (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 lot_number text not null,
 expiry_date date not null,
 quantity numeric(15,4) not null default 0 check(quantity>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(branch_id,product_id,lot_number,expiry_date)
);
create index if not exists product_expiry_lots_alert_idx on public.product_expiry_lots(tenant_id,branch_id,expiry_date) where quantity>0;
alter table public.product_expiry_lots enable row level security;
revoke all on public.product_expiry_lots from anon,authenticated;
create or replace function public.erp_inventory_intelligence(p_token text,p_branch uuid default null)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
set timezone='America/Fortaleza'
as $$
declare v record; v_slow jsonb;v_idle jsonb;v_expiry jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 if p_branch is not null and not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=v.tenant_id)
 then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
 with stock as (
  select ib.product_id,sum(greatest(ib.quantity-ib.reserved_quantity,0)) qty
  from public.inventory_balances ib where ib.tenant_id=v.tenant_id and (p_branch is null or ib.branch_id=p_branch)
  group by ib.product_id having sum(greatest(ib.quantity-ib.reserved_quantity,0))>0
 ), history as (
  select si.product_id,max(s.completed_at) last_sale,
  coalesce(sum(si.quantity) filter(where s.completed_at >= now()-interval '30 days'),0) qty_30d
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.tenant_id=v.tenant_id and s.status in ('completed','paid','fiscalized')
   and (p_branch is null or s.branch_id=p_branch)
  group by si.product_id
 ), catalog as (
  select p.id,p.name,p.sku,p.created_at,st.qty,h.last_sale,coalesce(h.qty_30d,0) qty_30d,
   case when h.last_sale is null then null else (current_date-(h.last_sale at time zone 'America/Fortaleza')::date) end idle_days
  from stock st join public.products p on p.id=st.product_id and p.tenant_id=v.tenant_id and p.active
  left join history h on h.product_id=p.id
 )
 select coalesce(jsonb_agg(to_jsonb(z) order by z.qty_30d,z.name),'[]'::jsonb) into v_slow
 from (select id,name,sku,qty,qty_30d from catalog order by qty_30d,name limit 10) z;
 with stock as (
  select ib.product_id,sum(greatest(ib.quantity-ib.reserved_quantity,0)) qty
  from public.inventory_balances ib where ib.tenant_id=v.tenant_id and (p_branch is null or ib.branch_id=p_branch)
  group by ib.product_id having sum(greatest(ib.quantity-ib.reserved_quantity,0))>0
 ), history as (
  select si.product_id,max(s.completed_at) last_sale
  from public.sale_items si join public.sales s on s.id=si.sale_id
  where s.tenant_id=v.tenant_id and s.status in ('completed','paid','fiscalized')
   and (p_branch is null or s.branch_id=p_branch)
  group by si.product_id
 )
 select coalesce(jsonb_agg(to_jsonb(z) order by z.idle_days desc nulls last,z.name),'[]'::jsonb) into v_idle
 from (
  select p.id,p.name,p.sku,st.qty,h.last_sale,
   case when h.last_sale is null then null else current_date-(h.last_sale at time zone 'America/Fortaleza')::date end idle_days,
   case when h.last_sale is null then 'never_sold'
    when h.last_sale < now()-interval '30 days' then '30_plus'
    when h.last_sale < now()-interval '15 days' then '15_29'
    else 'recent' end status
  from stock st join public.products p on p.id=st.product_id and p.tenant_id=v.tenant_id and p.active
  left join history h on h.product_id=p.id
  where h.last_sale < now()-interval '15 days' or h.last_sale is null
  order by h.last_sale asc nulls last,p.name limit 100
 ) z;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.expiry_date,z.name),'[]'::jsonb) into v_expiry
 from (
  select p.name,p.sku,l.lot_number,l.expiry_date,l.quantity,
   (l.expiry_date-current_date) days_left,
   case when l.expiry_date<current_date then 'expired'
    when l.expiry_date<=current_date+30 then '0_30'
    when l.expiry_date<=current_date+45 then '31_45'
    when l.expiry_date<=current_date+60 then '46_60'
    when l.expiry_date<=current_date+90 then '61_90'
    else '90_plus' end bucket
  from public.product_expiry_lots l join public.products p on p.id=l.product_id and p.tenant_id=v.tenant_id
  where l.tenant_id=v.tenant_id and l.quantity>0 and (p_branch is null or l.branch_id=p_branch)
  order by l.expiry_date,p.name limit 300
 ) z;
 return jsonb_build_object('ok',true,'slow',v_slow,'idle',v_idle,'expiry',v_expiry);
end $$;
revoke all on function public.erp_inventory_intelligence(text,uuid) from public;
grant execute on function public.erp_inventory_intelligence(text,uuid) to anon,authenticated,service_role;
