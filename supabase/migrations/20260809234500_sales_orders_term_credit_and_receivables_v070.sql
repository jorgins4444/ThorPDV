-- ThorPDV v0.7.0: pedidos de venda, venda a prazo e contas a receber apenas para saldo financiado.

create table if not exists public.sales_payment_terms (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade, name text not null,
  method text not null check (method in ('boleto','crediario')),
  installment_count integer not null default 1 check (installment_count between 1 and 60),
  first_due_days integer not null default 30 check (first_due_days between 0 and 3650),
  interval_days integer not null default 30 check (interval_days between 1 and 365),
  interest_percent numeric(9,4) not null default 0 check (interest_percent >= 0 and interest_percent <= 999),
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,company_id,name)
);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade, branch_id uuid not null references public.branches(id) on delete cascade,
  number bigint not null, status text not null default 'open' check (status in ('open','converted','cancelled')),
  customer_id uuid not null references public.customers(id), seller_user_id uuid references public.staff_users(id) on delete set null,
  price_table_id uuid references public.price_tables(id) on delete set null,
  payment_condition text not null default 'immediate' check (payment_condition in ('immediate','term')), payment_method text,
  payment_term_id uuid references public.sales_payment_terms(id) on delete set null,
  term_method text check (term_method is null or term_method in ('boleto','crediario')),
  installment_count integer check (installment_count is null or installment_count between 1 and 60),
  first_due_days integer check (first_due_days is null or first_due_days between 0 and 3650),
  interval_days integer check (interval_days is null or interval_days between 1 and 365), interest_percent numeric(9,4) check (interest_percent is null or interest_percent >= 0),
  subtotal numeric(14,2) not null default 0, discount numeric(14,2) not null default 0, surcharge numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  notes text, converted_sale_id uuid references public.sales(id) on delete set null, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,number)
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.sales_orders(id) on delete cascade, product_id uuid not null references public.products(id), sku text,
  description text not null, unit text not null default 'UN', quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0), discount numeric(14,2) not null default 0 check (discount >= 0), total numeric(14,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_orders_tenant_status on public.sales_orders(tenant_id,status,updated_at desc);
create index if not exists idx_sales_orders_customer on public.sales_orders(tenant_id,customer_id,updated_at desc);
create index if not exists idx_sales_order_items_order on public.sales_order_items(order_id);
create index if not exists idx_sales_payment_terms_company on public.sales_payment_terms(tenant_id,company_id,active);

alter table public.sales add column if not exists payment_condition text not null default 'immediate';
alter table public.sales add column if not exists term_method text;
alter table public.sales add column if not exists payment_term_id uuid references public.sales_payment_terms(id) on delete set null;
alter table public.sales add column if not exists term_installments integer;
alter table public.sales add column if not exists term_interest_percent numeric(9,4);
alter table public.sales add column if not exists term_principal_amount numeric(14,2);
alter table public.sales add column if not exists term_interest_amount numeric(14,2);
alter table public.sales add column if not exists term_total_amount numeric(14,2);
alter table public.sales add column if not exists sales_order_id uuid references public.sales_orders(id) on delete set null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='sales_payment_condition_check') then alter table public.sales add constraint sales_payment_condition_check check(payment_condition in ('immediate','term')); end if;
  if not exists(select 1 from pg_constraint where conname='sales_term_method_check') then alter table public.sales add constraint sales_term_method_check check(term_method is null or term_method in ('boleto','crediario')); end if;
end $$;

alter table public.sales_payment_terms enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='sales_payment_terms' and policyname='sales_payment_terms_tenant') then create policy sales_payment_terms_tenant on public.sales_payment_terms for all using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id)); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='sales_orders' and policyname='sales_orders_tenant') then create policy sales_orders_tenant on public.sales_orders for all using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id)); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='sales_order_items' and policyname='sales_order_items_tenant') then create policy sales_order_items_tenant on public.sales_order_items for all using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id)); end if;
end $$;

create or replace function private.sales_order_touch() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_sales_orders_touch on public.sales_orders;
create trigger trg_sales_orders_touch before update on public.sales_orders for each row execute function private.sales_order_touch();
drop trigger if exists trg_sales_payment_terms_touch on public.sales_payment_terms;
create trigger trg_sales_payment_terms_touch before update on public.sales_payment_terms for each row execute function private.sales_order_touch();

insert into public.sales_payment_terms(tenant_id,company_id,name,method,installment_count,first_due_days,interval_days,interest_percent)
select c.tenant_id,c.id,'Crediário 1x - 30 dias','crediario',1,30,30,0 from public.companies c on conflict(tenant_id,company_id,name) do nothing;
insert into public.sales_payment_terms(tenant_id,company_id,name,method,installment_count,first_due_days,interval_days,interest_percent)
select c.tenant_id,c.id,'Boleto 1x - 30 dias','boleto',1,30,30,0 from public.companies c on conflict(tenant_id,company_id,name) do nothing;

create or replace function private.create_term_receivables(p_sale_id uuid,p_customer_id uuid,p_paid numeric,p_term jsonb,p_sales_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare
  s public.sales%rowtype; cfg public.sales_payment_terms%rowtype; v_method text; v_count int; v_first int; v_interval int; v_rate numeric;
  v_principal numeric; v_interest numeric; v_financed numeric; v_base_due date; v_each numeric; v_amount numeric; v_inserted numeric:=0; i int;
begin
  select * into s from public.sales where id=p_sale_id for update; if s.id is null then raise exception 'sale_not_found'; end if;
  if p_customer_id is null then raise exception 'term_sale_requires_customer'; end if;
  if coalesce(p_term->>'payment_term_id','')<>'' then select * into cfg from public.sales_payment_terms where id=(p_term->>'payment_term_id')::uuid and tenant_id=s.tenant_id and company_id=s.company_id and active=true; end if;
  v_method:=lower(coalesce(nullif(p_term->>'method',''),cfg.method)); if v_method not in ('boleto','crediario') then raise exception 'invalid_term_method'; end if;
  v_count:=coalesce(nullif(p_term->>'installments','')::int,cfg.installment_count,1); v_first:=coalesce(nullif(p_term->>'first_due_days','')::int,cfg.first_due_days,30); v_interval:=coalesce(nullif(p_term->>'interval_days','')::int,cfg.interval_days,30); v_rate:=greatest(coalesce(nullif(p_term->>'interest_percent','')::numeric,cfg.interest_percent,0),0);
  if v_count<1 or v_count>60 then raise exception 'invalid_installment_count'; end if; if v_first<0 or v_first>3650 or v_interval<1 or v_interval>365 then raise exception 'invalid_term_schedule'; end if;
  v_principal:=greatest(round((s.total-coalesce(p_paid,0))::numeric,2),0); if v_principal<=0 then raise exception 'term_sale_has_no_financed_balance'; end if;
  v_interest:=round(v_principal*v_rate/100,2); v_financed:=v_principal+v_interest; v_each:=round(v_financed/v_count,2); v_base_due:=coalesce(s.completed_at,s.created_at,now())::date;
  delete from public.financial_entries where sale_id=s.id and entry_type='receivable';
  for i in 1..v_count loop
    v_amount:=case when i=v_count then round(v_financed-v_inserted,2) else v_each end;
    insert into public.financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,customer_id,sale_id,metadata)
    values(s.tenant_id,s.company_id,s.branch_id,'receivable','open','Venda a prazo '||s.number||' - parcela '||i||'/'||v_count,v_amount,0,v_base_due+v_first+((i-1)*v_interval),p_customer_id,s.id,
      jsonb_build_object('origin','sale_term','term_method',v_method,'installment',i,'installments',v_count,'interest_percent',v_rate,'principal_total',v_principal,'interest_total',v_interest,'sales_order_id',p_sales_order_id,'payment_term_id',cfg.id));
    v_inserted:=v_inserted+v_amount;
  end loop;
  update public.sales set payment_condition='term',term_method=v_method,payment_term_id=cfg.id,term_installments=v_count,term_interest_percent=v_rate,term_principal_amount=v_principal,term_interest_amount=v_interest,term_total_amount=v_financed,sales_order_id=coalesce(p_sales_order_id,sales_order_id) where id=s.id;
  return jsonb_build_object('method',v_method,'installments',v_count,'principal',v_principal,'interest',v_interest,'financed_total',v_financed,'first_due_days',v_first,'interval_days',v_interval,'payment_term_id',cfg.id);
end $$;

alter function public.erp_create_sale(text,jsonb) rename to erp_create_sale_legacy_v070;
alter function private.pdv_process_sale(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) rename to pdv_process_sale_legacy_v070;

create function public.erp_create_sale(p_token text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare r jsonb;v_sale uuid;v_term jsonb:=coalesce(p_payload->'term','{}'::jsonb);v_is_term boolean:=coalesce(nullif(v_term->>'method',''),'') in ('boleto','crediario') or coalesce(v_term->>'payment_term_id','')<>'';v_customer uuid:=nullif(p_payload->>'customer_id','')::uuid;v_order uuid:=nullif(p_payload->>'sales_order_id','')::uuid;v_fin jsonb;
begin
  if v_is_term and v_customer is null then return jsonb_build_object('ok',false,'error','term_sale_requires_customer'); end if;
  r:=public.erp_create_sale_legacy_v070(p_token,p_payload); if not coalesce((r->>'ok')::boolean,false) then return r; end if; v_sale:=(r->>'sale_id')::uuid;
  if v_is_term then v_fin:=private.create_term_receivables(v_sale,v_customer,coalesce(nullif(r->>'paid','')::numeric,0),v_term,v_order); if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and customer_id=v_customer and status='open'; end if; return r||jsonb_build_object('financial_status','term','term',v_fin,'sales_order_id',v_order); end if;
  if coalesce(nullif(r->>'paid','')::numeric,0)<coalesce(nullif(r->>'total','')::numeric,0)-0.01 then raise exception 'term_required_for_unpaid_balance'; end if;
  delete from public.financial_entries where sale_id=v_sale and entry_type='receivable'; update public.sales set payment_condition='immediate',term_method=null,payment_term_id=null,term_installments=null,term_interest_percent=null,term_principal_amount=null,term_interest_amount=null,term_total_amount=null,sales_order_id=v_order where id=v_sale;
  if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and status='open'; end if; return r||jsonb_build_object('financial_status','not_applicable','sales_order_id',v_order);
end $$;

create function private.pdv_process_sale(p_device_id uuid,p_tenant_id uuid,p_company_id uuid,p_branch_id uuid,p_pos_register_id uuid,p_event_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare r jsonb;v_sale uuid;v_term jsonb:=coalesce(p_payload->'term','{}'::jsonb);v_is_term boolean:=coalesce(nullif(v_term->>'method',''),'') in ('boleto','crediario') or coalesce(v_term->>'payment_term_id','')<>'';v_customer uuid:=nullif(p_payload->>'customer_id','')::uuid;v_order uuid:=nullif(p_payload->>'sales_order_id','')::uuid;v_fin jsonb;
begin
  if v_is_term and v_customer is null then return jsonb_build_object('ok',false,'error','term_sale_requires_customer'); end if;
  r:=private.pdv_process_sale_legacy_v070(p_device_id,p_tenant_id,p_company_id,p_branch_id,p_pos_register_id,p_event_id,p_payload); if not coalesce((r->>'ok')::boolean,false) then return r; end if; v_sale:=(r->>'sale_id')::uuid;
  if v_is_term then v_fin:=private.create_term_receivables(v_sale,v_customer,coalesce(nullif(r->>'paid','')::numeric,0),v_term,v_order); if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and tenant_id=p_tenant_id and customer_id=v_customer and status='open'; end if; return r||jsonb_build_object('financial_status','term','term',v_fin,'sales_order_id',v_order); end if;
  if coalesce(nullif(r->>'paid','')::numeric,0)<coalesce(nullif(r->>'total','')::numeric,0)-0.01 then raise exception 'term_required_for_unpaid_balance'; end if;
  delete from public.financial_entries where sale_id=v_sale and entry_type='receivable'; update public.sales set payment_condition='immediate',term_method=null,payment_term_id=null,term_installments=null,term_interest_percent=null,term_principal_amount=null,term_interest_amount=null,term_total_amount=null,sales_order_id=v_order where id=v_sale;
  if v_order is not null then update public.sales_orders set status='converted',converted_sale_id=v_sale where id=v_order and tenant_id=p_tenant_id and status='open'; end if; return r||jsonb_build_object('financial_status','not_applicable','sales_order_id',v_order);
end $$;

create or replace function public.erp_payment_terms_list(p_token text) returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare v record;d jsonb;begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'method',t.method,'installments',t.installment_count,'first_due_days',t.first_due_days,'interval_days',t.interval_days,'interest_percent',t.interest_percent,'active',t.active) order by t.method,t.name),'[]'::jsonb) into d from public.sales_payment_terms t where t.tenant_id=v.tenant_id and t.company_id=v.company_id;return jsonb_build_object('ok',true,'data',d);end $$;

create or replace function public.erp_payment_term_save(p_token text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare v record;x uuid;m text;begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;m:=lower(coalesce(p_payload->>'method',''));if m not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','invalid_term_method');end if;x:=nullif(p_payload->>'id','')::uuid;if x is null then insert into public.sales_payment_terms(tenant_id,company_id,name,method,installment_count,first_due_days,interval_days,interest_percent,active) values(v.tenant_id,v.company_id,trim(p_payload->>'name'),m,greatest(coalesce(nullif(p_payload->>'installments','')::int,1),1),greatest(coalesce(nullif(p_payload->>'first_due_days','')::int,30),0),greatest(coalesce(nullif(p_payload->>'interval_days','')::int,30),1),greatest(coalesce(nullif(p_payload->>'interest_percent','')::numeric,0),0),coalesce((p_payload->>'active')::boolean,true)) returning id into x;else update public.sales_payment_terms set name=trim(p_payload->>'name'),method=m,installment_count=greatest(coalesce(nullif(p_payload->>'installments','')::int,1),1),first_due_days=greatest(coalesce(nullif(p_payload->>'first_due_days','')::int,30),0),interval_days=greatest(coalesce(nullif(p_payload->>'interval_days','')::int,30),1),interest_percent=greatest(coalesce(nullif(p_payload->>'interest_percent','')::numeric,0),0),active=coalesce((p_payload->>'active')::boolean,true) where id=x and tenant_id=v.tenant_id and company_id=v.company_id;end if;return jsonb_build_object('ok',true,'id',x);end $$;

create or replace function public.erp_sales_order_list(p_token text,p_search text default null) returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare v record;d jsonb;q text:='%'||lower(trim(coalesce(p_search,'')))||'%';begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'status',o.status,'customer_id',o.customer_id,'customer_name',c.name,'seller_user_id',o.seller_user_id,'seller_name',su.name,'payment_condition',o.payment_condition,'payment_method',o.payment_method,'payment_term_id',o.payment_term_id,'term_method',o.term_method,'installments',o.installment_count,'first_due_days',o.first_due_days,'interval_days',o.interval_days,'interest_percent',o.interest_percent,'subtotal',o.subtotal,'discount',o.discount,'surcharge',o.surcharge,'total',o.total,'notes',o.notes,'created_at',o.created_at,'updated_at',o.updated_at,'converted_sale_id',o.converted_sale_id,'item_count',(select count(*) from public.sales_order_items oi where oi.order_id=o.id)) order by o.updated_at desc),'[]'::jsonb) into d from public.sales_orders o join public.customers c on c.id=o.customer_id left join public.staff_users su on su.id=o.seller_user_id where o.tenant_id=v.tenant_id and o.company_id=v.company_id and (coalesce(trim(p_search),'')='' or o.number::text ilike q or lower(c.name) like q or lower(coalesce(o.notes,'')) like q);return jsonb_build_object('ok',true,'data',d);end $$;

create or replace function public.erp_sales_order_detail(p_token text,p_order uuid) returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare v record;o jsonb;begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;select jsonb_build_object('id',so.id,'number',so.number,'status',so.status,'customer_id',so.customer_id,'customer_name',c.name,'seller_user_id',so.seller_user_id,'price_table_id',so.price_table_id,'payment_condition',so.payment_condition,'payment_method',so.payment_method,'payment_term_id',so.payment_term_id,'term_method',so.term_method,'installments',so.installment_count,'first_due_days',so.first_due_days,'interval_days',so.interval_days,'interest_percent',so.interest_percent,'subtotal',so.subtotal,'discount',so.discount,'surcharge',so.surcharge,'total',so.total,'notes',so.notes,'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'product_code',p.product_code,'sku',i.sku,'name',i.description,'unit',i.unit,'quantity',i.quantity,'unit_price',i.unit_price,'discount',i.discount,'total',i.total) order by i.created_at) from public.sales_order_items i join public.products p on p.id=i.product_id where i.order_id=so.id),'[]'::jsonb)) into o from public.sales_orders so join public.customers c on c.id=so.customer_id where so.id=p_order and so.tenant_id=v.tenant_id and so.company_id=v.company_id;if o is null then return jsonb_build_object('ok',false,'error','sales_order_not_found');end if;return jsonb_build_object('ok',true,'order',o);end $$;

create or replace function public.erp_sales_order_save(p_token text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record;oid uuid;ono bigint;it jsonb;pid uuid;qty numeric;disc numeric;price numeric;line numeric;sub numeric:=0;sale_disc numeric:=greatest(coalesce(nullif(p_payload->>'discount','')::numeric,0),0);sur numeric:=greatest(coalesce(nullif(p_payload->>'surcharge','')::numeric,0),0);pt uuid;cond text;tm text;cfg public.sales_payment_terms%rowtype;cust uuid;seller uuid;
begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;cust:=nullif(p_payload->>'customer_id','')::uuid;if cust is null or not exists(select 1 from public.customers c where c.id=cust and c.tenant_id=v.tenant_id and c.active=true) then return jsonb_build_object('ok',false,'error','customer_required');end if;if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','sales_order_without_items');end if;seller:=nullif(p_payload->>'seller_user_id','')::uuid;if seller is not null and not exists(select 1 from public.staff_users s where s.id=seller and s.tenant_id=v.tenant_id and s.active=true) then seller:=null;end if;pt:=nullif(p_payload->>'price_table_id','')::uuid;if pt is null then select id into pt from public.price_tables where tenant_id=v.tenant_id and company_id=v.company_id and is_default=true and active=true limit 1;end if;cond:=lower(coalesce(nullif(p_payload->>'payment_condition',''),'immediate'));if cond not in ('immediate','term') then return jsonb_build_object('ok',false,'error','invalid_payment_condition');end if;if cond='term' then if nullif(p_payload->>'payment_term_id','') is not null then select * into cfg from public.sales_payment_terms where id=(p_payload->>'payment_term_id')::uuid and tenant_id=v.tenant_id and company_id=v.company_id and active=true;end if;tm:=lower(coalesce(nullif(p_payload->>'term_method',''),cfg.method));if tm not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','invalid_term_method');end if;end if;for it in select * from jsonb_array_elements(p_payload->'items') loop pid:=(it->>'product_id')::uuid;qty:=coalesce(nullif(it->>'quantity','')::numeric,0);disc:=greatest(coalesce(nullif(it->>'discount','')::numeric,0),0);if qty<=0 then return jsonb_build_object('ok',false,'error','invalid_quantity');end if;price:=private.resolve_effective_price(v.tenant_id,v.company_id,pid,pt,qty);if price is null then return jsonb_build_object('ok',false,'error','product_not_found');end if;if disc>qty*price then return jsonb_build_object('ok',false,'error','invalid_item_discount');end if;sub:=sub+(qty*price-disc);end loop;if sale_disc>sub then return jsonb_build_object('ok',false,'error','invalid_sale_discount');end if;oid:=nullif(p_payload->>'id','')::uuid;if oid is null then perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':sales_order'));select coalesce(max(number),0)+1 into ono from public.sales_orders where tenant_id=v.tenant_id;insert into public.sales_orders(tenant_id,company_id,branch_id,number,customer_id,seller_user_id,price_table_id,payment_condition,payment_method,payment_term_id,term_method,installment_count,first_due_days,interval_days,interest_percent,subtotal,discount,surcharge,total,notes,created_by) values(v.tenant_id,v.company_id,v.branch_id,ono,cust,seller,pt,cond,case when cond='immediate' then nullif(p_payload->>'payment_method','') else null end,cfg.id,case when cond='term' then tm else null end,case when cond='term' then coalesce(nullif(p_payload->>'installments','')::int,cfg.installment_count,1) else null end,case when cond='term' then coalesce(nullif(p_payload->>'first_due_days','')::int,cfg.first_due_days,30) else null end,case when cond='term' then coalesce(nullif(p_payload->>'interval_days','')::int,cfg.interval_days,30) else null end,case when cond='term' then coalesce(nullif(p_payload->>'interest_percent','')::numeric,cfg.interest_percent,0) else null end,sub,sale_disc,sur,sub-sale_disc+sur,nullif(p_payload->>'notes',''),v.user_id) returning id into oid;else update public.sales_orders set customer_id=cust,seller_user_id=seller,price_table_id=pt,payment_condition=cond,payment_method=case when cond='immediate' then nullif(p_payload->>'payment_method','') else null end,payment_term_id=cfg.id,term_method=case when cond='term' then tm else null end,installment_count=case when cond='term' then coalesce(nullif(p_payload->>'installments','')::int,cfg.installment_count,1) else null end,first_due_days=case when cond='term' then coalesce(nullif(p_payload->>'first_due_days','')::int,cfg.first_due_days,30) else null end,interval_days=case when cond='term' then coalesce(nullif(p_payload->>'interval_days','')::int,cfg.interval_days,30) else null end,interest_percent=case when cond='term' then coalesce(nullif(p_payload->>'interest_percent','')::numeric,cfg.interest_percent,0) else null end,subtotal=sub,discount=sale_disc,surcharge=sur,total=sub-sale_disc+sur,notes=nullif(p_payload->>'notes','') where id=oid and tenant_id=v.tenant_id and status='open';if not found then return jsonb_build_object('ok',false,'error','sales_order_not_editable');end if;delete from public.sales_order_items where order_id=oid;end if;for it in select * from jsonb_array_elements(p_payload->'items') loop pid:=(it->>'product_id')::uuid;qty:=(it->>'quantity')::numeric;disc:=greatest(coalesce(nullif(it->>'discount','')::numeric,0),0);price:=private.resolve_effective_price(v.tenant_id,v.company_id,pid,pt,qty);line:=qty*price-disc;insert into public.sales_order_items(tenant_id,order_id,product_id,sku,description,unit,quantity,unit_price,discount,total) select v.tenant_id,oid,p.id,p.sku,p.name,p.unit,qty,price,disc,line from public.products p where p.id=pid;end loop;select number into ono from public.sales_orders where id=oid;return jsonb_build_object('ok',true,'id',oid,'number',ono,'total',sub-sale_disc+sur);end $$;

create or replace function public.erp_sales_order_cancel(p_token text,p_order uuid) returns jsonb language plpgsql security definer set search_path='public','private' as $$ declare v record;begin select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;update public.sales_orders set status='cancelled' where id=p_order and tenant_id=v.tenant_id and company_id=v.company_id and status='open';if not found then return jsonb_build_object('ok',false,'error','sales_order_not_editable');end if;return jsonb_build_object('ok',true);end $$;

alter function public.pdv_pull_v6(text,timestamptz) rename to pdv_pull_v6_legacy_v070;
create function public.pdv_pull_v6(p_device_token text,p_since timestamptz default null) returns jsonb language plpgsql security definer set search_path='public','private' as $$
declare data jsonb;dev record;ord jsonb;terms jsonb;begin data:=public.pdv_pull_v6_legacy_v070(p_device_token,p_since);if not coalesce((data->>'ok')::boolean,false) then return data;end if;select * into dev from private.resolve_pdv_device(p_device_token);select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'status',o.status,'customer_id',o.customer_id,'customer_name',c.name,'seller_user_id',o.seller_user_id,'seller_name',su.name,'payment_condition',o.payment_condition,'payment_method',o.payment_method,'payment_term_id',o.payment_term_id,'term_method',o.term_method,'installments',o.installment_count,'first_due_days',o.first_due_days,'interval_days',o.interval_days,'interest_percent',o.interest_percent,'subtotal',o.subtotal,'discount',o.discount,'surcharge',o.surcharge,'total',o.total,'notes',o.notes,'updated_at',o.updated_at,'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_code',p.product_code,'sku',i.sku,'name',i.description,'unit',i.unit,'quantity',i.quantity,'unit_price',i.unit_price,'discount',i.discount,'total',i.total) order by i.created_at) from public.sales_order_items i join public.products p on p.id=i.product_id where i.order_id=o.id),'[]'::jsonb)) order by o.updated_at desc),'[]'::jsonb) into ord from public.sales_orders o join public.customers c on c.id=o.customer_id left join public.staff_users su on su.id=o.seller_user_id where o.tenant_id=dev.tenant_id and o.company_id=dev.company_id and (p_since is null or o.updated_at>p_since);select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'method',t.method,'installments',t.installment_count,'first_due_days',t.first_due_days,'interval_days',t.interval_days,'interest_percent',t.interest_percent,'active',t.active) order by t.method,t.name),'[]'::jsonb) into terms from public.sales_payment_terms t where t.tenant_id=dev.tenant_id and t.company_id=dev.company_id and t.active=true;data:=jsonb_set(data,'{sales_orders}',coalesce(ord,'[]'::jsonb),true);data:=jsonb_set(data,'{payment_terms}',coalesce(terms,'[]'::jsonb),true);return data;end $$;

-- Remove títulos históricos já quitados e criados automaticamente pelo fluxo antigo de vendas à vista.
delete from public.financial_entries fe using public.sales s
where fe.sale_id=s.id and fe.entry_type='receivable' and fe.status='paid' and coalesce(fe.metadata->>'origin','') in ('sale','pdv_desktop')
  and coalesce((select sum(p.amount) from public.payments p where p.sale_id=s.id and p.status='paid'),0)>=s.total-0.01;
