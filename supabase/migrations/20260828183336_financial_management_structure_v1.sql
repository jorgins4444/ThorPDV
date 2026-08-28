-- ThorGestao financial management structure.
-- This migration mirrors the finance structure already applied to production on 2026-08-28.

create table if not exists public.financial_chart_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  parent_id uuid null references public.financial_chart_accounts(id) on delete restrict,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','cost','expense')),
  nature text not null check (nature in ('debit','credit')),
  posting boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, code)
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  entry_type text not null default 'payable' check (entry_type in ('payable','receivable','both')),
  default_chart_account_id uuid null references public.financial_chart_accounts(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, code)
);

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete restrict,
  code text not null,
  name text not null,
  description text null,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, code)
);

alter table public.financial_chart_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.cost_centers enable row level security;

create index if not exists financial_chart_accounts_parent_idx on public.financial_chart_accounts(parent_id);
create index if not exists financial_categories_account_idx on public.financial_categories(default_chart_account_id);
create index if not exists cost_centers_branch_idx on public.cost_centers(branch_id);

alter table public.financial_entries add column if not exists chart_account_id uuid null references public.financial_chart_accounts(id) on delete restrict;
alter table public.financial_entries add column if not exists financial_category_id uuid null references public.financial_categories(id) on delete restrict;
alter table public.financial_entries add column if not exists cost_center_id uuid null references public.cost_centers(id) on delete restrict;
create index if not exists financial_entries_chart_account_idx on public.financial_entries(chart_account_id);
create index if not exists financial_entries_category_idx on public.financial_entries(financial_category_id);
create index if not exists financial_entries_cost_center_idx on public.financial_entries(cost_center_id);

create or replace function private.ensure_financial_defaults(p_tenant uuid,p_company uuid,p_branch uuid default null)
returns void language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_parent uuid;
  v_branch_name text;
  v_cc_code text;
begin
  if p_tenant is null or p_company is null then return; end if;

  insert into public.financial_chart_accounts(tenant_id,company_id,code,name,account_type,nature,posting)
  values
    (p_tenant,p_company,'1','Ativo','asset','debit',false),
    (p_tenant,p_company,'2','Passivo','liability','credit',false),
    (p_tenant,p_company,'3','Receitas','revenue','credit',false),
    (p_tenant,p_company,'4','Custos','cost','debit',false),
    (p_tenant,p_company,'5','Despesas','expense','debit',false)
  on conflict(tenant_id,company_id,code) do nothing;

  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'1.1','Disponibilidades','asset','debit',false)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='1.1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'1.1.01','Caixa e Bancos','asset','debit',true)
  on conflict(tenant_id,company_id,code) do nothing;

  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='2';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'2.1','Obrigações Operacionais','liability','credit',false)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='2.1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'2.1.01','Fornecedores e Obrigações','liability','credit',true)
  on conflict(tenant_id,company_id,code) do nothing;

  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='3';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'3.1','Receita Operacional','revenue','credit',false)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='3.1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'3.1.01','Receita de Vendas','revenue','credit',true)
  on conflict(tenant_id,company_id,code) do nothing;

  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='4';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'4.1','Custos das Mercadorias','cost','debit',false)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='4.1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values(p_tenant,p_company,v_parent,'4.1.01','Compras para Revenda / CMV Gerencial','cost','debit',true)
  on conflict(tenant_id,company_id,code) do nothing;

  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='5';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values
    (p_tenant,p_company,v_parent,'5.1','Despesas Administrativas','expense','debit',false),
    (p_tenant,p_company,v_parent,'5.2','Despesas Comerciais','expense','debit',false)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='5.1';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values
    (p_tenant,p_company,v_parent,'5.1.01','Despesas Administrativas Gerais','expense','debit',true),
    (p_tenant,p_company,v_parent,'5.1.02','Energia Elétrica','expense','debit',true),
    (p_tenant,p_company,v_parent,'5.1.03','Aluguel e Ocupação','expense','debit',true),
    (p_tenant,p_company,v_parent,'5.1.04','Telecomunicações e Internet','expense','debit',true),
    (p_tenant,p_company,v_parent,'5.1.05','Serviços, Taxas e Tarifas','expense','debit',true)
  on conflict(tenant_id,company_id,code) do nothing;
  select id into v_parent from public.financial_chart_accounts where tenant_id=p_tenant and company_id=p_company and code='5.2';
  insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting)
  values
    (p_tenant,p_company,v_parent,'5.2.01','Marketing e Vendas','expense','debit',true),
    (p_tenant,p_company,v_parent,'5.2.02','Comissões','expense','debit',true)
  on conflict(tenant_id,company_id,code) do nothing;

  insert into public.financial_categories(tenant_id,company_id,code,name,entry_type,default_chart_account_id)
  select p_tenant,p_company,x.code,x.name,x.entry_type,a.id
  from (values
    ('SALES','Receita de Vendas','receivable','3.1.01'),
    ('PURCHASE_RESALE','Compra de Mercadorias para Revenda','payable','4.1.01'),
    ('ADMIN_GENERAL','Despesas Administrativas Gerais','payable','5.1.01'),
    ('ENERGY','Energia Elétrica','payable','5.1.02'),
    ('RENT','Aluguel e Ocupação','payable','5.1.03'),
    ('TELECOM','Telecomunicações e Internet','payable','5.1.04'),
    ('SERVICES_FEES','Serviços, Taxas e Tarifas','payable','5.1.05'),
    ('MARKETING','Marketing e Vendas','payable','5.2.01'),
    ('COMMISSIONS','Comissões','payable','5.2.02')
  ) as x(code,name,entry_type,account_code)
  join public.financial_chart_accounts a on a.tenant_id=p_tenant and a.company_id=p_company and a.code=x.account_code
  on conflict(tenant_id,company_id,code) do nothing;

  insert into public.cost_centers(tenant_id,company_id,branch_id,code,name,description,is_default)
  values(p_tenant,p_company,null,'GERAL','Geral / Corporativo','Centro de custo geral para lançamentos sem filial específica.',true)
  on conflict(tenant_id,company_id,code) do nothing;

  if p_branch is not null then
    select name into v_branch_name from public.branches where id=p_branch and tenant_id=p_tenant and company_id=p_company;
    if v_branch_name is not null then
      v_cc_code:='FILIAL-'||upper(substr(replace(p_branch::text,'-',''),1,6));
      insert into public.cost_centers(tenant_id,company_id,branch_id,code,name,description,is_default)
      values(p_tenant,p_company,p_branch,v_cc_code,v_branch_name,'Centro de custo padrão da filial '||v_branch_name||'.',true)
      on conflict(tenant_id,company_id,code) do update set branch_id=excluded.branch_id,name=excluded.name,active=true,updated_at=now();
    end if;
  end if;
end;
$function$;

do $block$
declare r record;
begin
  for r in select c.tenant_id,c.id company_id,b.id branch_id from public.companies c left join public.branches b on b.company_id=c.id loop
    perform private.ensure_financial_defaults(r.tenant_id,r.company_id,r.branch_id);
  end loop;
end;
$block$;

update public.financial_entries f
set financial_category_id=c.id, chart_account_id=c.default_chart_account_id
from public.financial_categories c
where c.tenant_id=f.tenant_id and c.company_id=f.company_id
  and c.code=case when f.entry_type='receivable' then 'SALES' when f.purchase_id is not null then 'PURCHASE_RESALE' else 'ADMIN_GENERAL' end
  and (f.financial_category_id is null or f.chart_account_id is null);

update public.financial_entries f
set cost_center_id=coalesce(
  (select cc.id from public.cost_centers cc where cc.tenant_id=f.tenant_id and cc.company_id=f.company_id and cc.branch_id=f.branch_id and cc.active order by cc.is_default desc,cc.created_at limit 1),
  (select cc.id from public.cost_centers cc where cc.tenant_id=f.tenant_id and cc.company_id=f.company_id and cc.branch_id is null and cc.active order by cc.is_default desc,cc.created_at limit 1)
)
where f.cost_center_id is null;

create or replace function public.erp_financial_structure_get(p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; v_accounts jsonb; v_categories jsonb; v_cost_centers jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.code),'[]'::jsonb) into v_accounts from (
    select a.id,a.code,a.name,a.account_type,a.nature,a.posting,a.active,a.parent_id,p.code parent_code,p.name parent_name,a.created_at
    from public.financial_chart_accounts a left join public.financial_chart_accounts p on p.id=a.parent_id
    where a.tenant_id=v.tenant_id and a.company_id=v.company_id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_categories from (
    select c.id,c.code,c.name,c.entry_type,c.active,c.default_chart_account_id,a.code account_code,a.name account_name,a.account_type
    from public.financial_categories c left join public.financial_chart_accounts a on a.id=c.default_chart_account_id
    where c.tenant_id=v.tenant_id and c.company_id=v.company_id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.branch nulls first,x.name),'[]'::jsonb) into v_cost_centers from (
    select cc.id,cc.code,cc.name,cc.description,cc.branch_id,b.name branch,cc.is_default,cc.active,cc.created_at
    from public.cost_centers cc left join public.branches b on b.id=cc.branch_id
    where cc.tenant_id=v.tenant_id and cc.company_id=v.company_id
  ) x;
  return jsonb_build_object('ok',true,'accounts',v_accounts,'categories',v_categories,'cost_centers',v_cost_centers);
end;
$function$;

create or replace function public.erp_financial_structure_save(p_token text,p_resource text,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record; v_id uuid:=nullif(p_payload->>'id','')::uuid; v_parent uuid; v_account uuid; v_branch uuid;
  v_code text:=upper(trim(coalesce(p_payload->>'code',''))); v_name text:=trim(coalesce(p_payload->>'name',''));
  v_type text; v_nature text; v_entry_type text; v_posting boolean; v_active boolean; v_default boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);
  if length(v_code)<1 or length(v_name)<2 then return jsonb_build_object('ok',false,'error','code_and_name_required'); end if;
  v_active:=coalesce(nullif(p_payload->>'active','')::boolean,true);
  if p_resource in ('account','accounts','chart_account') then
    v_type:=lower(coalesce(nullif(p_payload->>'account_type',''),'expense'));
    v_nature:=lower(coalesce(nullif(p_payload->>'nature',''),case when v_type in ('liability','equity','revenue') then 'credit' else 'debit' end));
    v_posting:=coalesce(nullif(p_payload->>'posting','')::boolean,true);
    v_parent:=nullif(p_payload->>'parent_id','')::uuid;
    if v_type not in ('asset','liability','equity','revenue','cost','expense') or v_nature not in ('debit','credit') then return jsonb_build_object('ok',false,'error','invalid_account_type'); end if;
    if v_parent is not null and not exists(select 1 from public.financial_chart_accounts where id=v_parent and tenant_id=v.tenant_id and company_id=v.company_id) then return jsonb_build_object('ok',false,'error','invalid_parent_account'); end if;
    if v_id is null then
      insert into public.financial_chart_accounts(tenant_id,company_id,parent_id,code,name,account_type,nature,posting,active)
      values(v.tenant_id,v.company_id,v_parent,v_code,v_name,v_type,v_nature,v_posting,v_active) returning id into v_id;
    else
      if v_parent=v_id then return jsonb_build_object('ok',false,'error','account_cannot_parent_itself'); end if;
      update public.financial_chart_accounts set parent_id=v_parent,code=v_code,name=v_name,account_type=v_type,nature=v_nature,posting=v_posting,active=v_active,updated_at=now()
      where id=v_id and tenant_id=v.tenant_id and company_id=v.company_id;
      if not found then return jsonb_build_object('ok',false,'error','account_not_found'); end if;
    end if;
  elsif p_resource in ('category','categories') then
    v_entry_type:=lower(coalesce(nullif(p_payload->>'entry_type',''),'payable'));
    v_account:=nullif(p_payload->>'default_chart_account_id','')::uuid;
    if v_entry_type not in ('payable','receivable','both') then return jsonb_build_object('ok',false,'error','invalid_category_type'); end if;
    if v_account is not null and not exists(select 1 from public.financial_chart_accounts where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and posting=true) then return jsonb_build_object('ok',false,'error','posting_account_required'); end if;
    if v_id is null then
      insert into public.financial_categories(tenant_id,company_id,code,name,entry_type,default_chart_account_id,active)
      values(v.tenant_id,v.company_id,v_code,v_name,v_entry_type,v_account,v_active) returning id into v_id;
    else
      update public.financial_categories set code=v_code,name=v_name,entry_type=v_entry_type,default_chart_account_id=v_account,active=v_active,updated_at=now()
      where id=v_id and tenant_id=v.tenant_id and company_id=v.company_id;
      if not found then return jsonb_build_object('ok',false,'error','category_not_found'); end if;
    end if;
  elsif p_resource in ('cost_center','cost_centers') then
    v_branch:=nullif(p_payload->>'branch_id','')::uuid;
    v_default:=coalesce(nullif(p_payload->>'is_default','')::boolean,false);
    if v_branch is not null and not exists(select 1 from public.branches where id=v_branch and tenant_id=v.tenant_id and company_id=v.company_id) then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
    if v_default then
      update public.cost_centers set is_default=false,updated_at=now() where tenant_id=v.tenant_id and company_id=v.company_id and coalesce(branch_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(v_branch,'00000000-0000-0000-0000-000000000000'::uuid) and (v_id is null or id<>v_id);
    end if;
    if v_id is null then
      insert into public.cost_centers(tenant_id,company_id,branch_id,code,name,description,is_default,active)
      values(v.tenant_id,v.company_id,v_branch,v_code,v_name,nullif(trim(p_payload->>'description'),''),v_default,v_active) returning id into v_id;
    else
      update public.cost_centers set branch_id=v_branch,code=v_code,name=v_name,description=nullif(trim(p_payload->>'description'),''),is_default=v_default,active=v_active,updated_at=now()
      where id=v_id and tenant_id=v.tenant_id and company_id=v.company_id;
      if not found then return jsonb_build_object('ok',false,'error','cost_center_not_found'); end if;
    end if;
  else
    return jsonb_build_object('ok',false,'error','unsupported_resource');
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then return jsonb_build_object('ok',false,'error','duplicate_code');
end;
$function$;

create or replace function public.erp_payables_list(p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date nulls last,x.created_at desc),'[]'::jsonb) into v_data from (
    select f.id,f.entry_type,f.status,f.description,f.amount,f.paid_amount,f.due_date,f.paid_at,f.supplier_id,s.name supplier,
           f.branch_id,b.name branch,f.purchase_id,f.document_type,f.metadata,
           f.financial_category_id,c.code category_code,c.name category,
           f.chart_account_id,a.code account_code,a.name account,a.account_type,
           f.cost_center_id,cc.code cost_center_code,cc.name cost_center,f.created_at
    from public.financial_entries f
    left join public.suppliers s on s.id=f.supplier_id
    left join public.branches b on b.id=f.branch_id
    left join public.financial_categories c on c.id=f.financial_category_id
    left join public.financial_chart_accounts a on a.id=f.chart_account_id
    left join public.cost_centers cc on cc.id=f.cost_center_id
    where f.tenant_id=v.tenant_id and f.company_id=v.company_id and f.entry_type='payable'
    limit 500
  ) x;
  return jsonb_build_object('ok',true,'data',v_data);
end;
$function$;

create or replace function public.erp_payable_create(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record; v_id uuid; v_supplier uuid:=nullif(p_payload->>'supplier_id','')::uuid; v_category uuid:=nullif(p_payload->>'financial_category_id','')::uuid;
  v_account uuid:=nullif(p_payload->>'chart_account_id','')::uuid; v_cc uuid:=nullif(p_payload->>'cost_center_id','')::uuid; v_amount numeric:=coalesce(nullif(p_payload->>'amount','')::numeric,0);
  v_description text:=trim(coalesce(p_payload->>'description','')); v_due date:=coalesce(nullif(p_payload->>'due_date','')::date,current_date);
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_financial_defaults(v.tenant_id,v.company_id,v.branch_id);
  if length(v_description)<2 or v_amount<=0 then return jsonb_build_object('ok',false,'error','description_and_amount_required'); end if;
  if v_supplier is not null and not exists(select 1 from public.suppliers where id=v_supplier and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','supplier_not_found'); end if;
  if v_category is null then select id into v_category from public.financial_categories where tenant_id=v.tenant_id and company_id=v.company_id and code='ADMIN_GENERAL'; end if;
  if not exists(select 1 from public.financial_categories where id=v_category and tenant_id=v.tenant_id and company_id=v.company_id and active and entry_type in ('payable','both')) then return jsonb_build_object('ok',false,'error','invalid_financial_category'); end if;
  if v_account is null then select default_chart_account_id into v_account from public.financial_categories where id=v_category; end if;
  if not exists(select 1 from public.financial_chart_accounts where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and active and posting) then return jsonb_build_object('ok',false,'error','invalid_chart_account'); end if;
  if v_cc is null then
    select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id=v.branch_id and active order by is_default desc,created_at limit 1;
    if v_cc is null then select id into v_cc from public.cost_centers where tenant_id=v.tenant_id and company_id=v.company_id and branch_id is null and active order by is_default desc,created_at limit 1; end if;
  end if;
  if v_cc is not null and not exists(select 1 from public.cost_centers where id=v_cc and tenant_id=v.tenant_id and company_id=v.company_id and active) then return jsonb_build_object('ok',false,'error','invalid_cost_center'); end if;
  insert into public.financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,supplier_id,document_type,metadata,financial_category_id,chart_account_id,cost_center_id)
  values(v.tenant_id,v.company_id,v.branch_id,'payable','open',v_description,v_amount,0,v_due,v_supplier,'manual',jsonb_build_object('origin','manual_payable'),v_category,v_account,v_cc)
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end;
$function$;

create or replace function public.erp_financial_entry_classify(p_token text,p_entry_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; f public.financial_entries%rowtype; v_category uuid:=nullif(p_payload->>'financial_category_id','')::uuid; v_account uuid:=nullif(p_payload->>'chart_account_id','')::uuid; v_cc uuid:=nullif(p_payload->>'cost_center_id','')::uuid;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into f from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id and company_id=v.company_id for update;
  if f.id is null then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  if v_category is not null and not exists(select 1 from public.financial_categories where id=v_category and tenant_id=v.tenant_id and company_id=v.company_id and active and entry_type in (f.entry_type,'both')) then return jsonb_build_object('ok',false,'error','invalid_financial_category'); end if;
  if v_account is null and v_category is not null then select default_chart_account_id into v_account from public.financial_categories where id=v_category; end if;
  if v_account is not null and not exists(select 1 from public.financial_chart_accounts where id=v_account and tenant_id=v.tenant_id and company_id=v.company_id and active and posting) then return jsonb_build_object('ok',false,'error','invalid_chart_account'); end if;
  if v_cc is not null and not exists(select 1 from public.cost_centers where id=v_cc and tenant_id=v.tenant_id and company_id=v.company_id and active) then return jsonb_build_object('ok',false,'error','invalid_cost_center'); end if;
  update public.financial_entries set financial_category_id=coalesce(v_category,financial_category_id),chart_account_id=coalesce(v_account,chart_account_id),cost_center_id=coalesce(v_cc,cost_center_id),updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('classification_updated_at',now()) where id=f.id;
  return jsonb_build_object('ok',true,'id',f.id);
end;
$function$;

create or replace function public.erp_financial_management_report(p_token text,p_report text,p_start date default null,p_end date default null,p_branch uuid default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
set "TimeZone" to 'America/Fortaleza'
as $function$
declare v record;v_start date;v_end date:=coalesce(p_end,current_date);v_data jsonb:='[]'::jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  v_start:=coalesce(p_start,v_end-30);
  if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','invalid_branch'); end if;
  if p_report='expenses_by_category' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total_amount desc),'[]'::jsonb) into v_data from (
      select coalesce(c.code,'SEM-CAT') category_code,coalesce(c.name,'Sem categoria') category,coalesce(a.code,'—') account_code,coalesce(a.name,'Não classificada') account,
             count(*)::int entries,sum(f.amount) total_amount,sum(f.paid_amount) paid_amount,sum(greatest(f.amount-f.paid_amount,0)) open_amount
      from public.financial_entries f left join public.financial_categories c on c.id=f.financial_category_id left join public.financial_chart_accounts a on a.id=f.chart_account_id
      where f.tenant_id=v.tenant_id and f.entry_type='payable' and f.status<>'cancelled' and f.created_at::date between v_start and v_end and (p_branch is null or f.branch_id=p_branch)
      group by c.code,c.name,a.code,a.name
    ) x;
  elsif p_report='cost_center_expenses' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total_amount desc),'[]'::jsonb) into v_data from (
      select coalesce(cc.code,'SEM-CC') cost_center_code,coalesce(cc.name,'Sem centro de custo') cost_center,coalesce(b.name,'Corporativo') branch,
             count(*)::int entries,sum(f.amount) total_amount,sum(f.paid_amount) paid_amount,sum(greatest(f.amount-f.paid_amount,0)) open_amount
      from public.financial_entries f left join public.cost_centers cc on cc.id=f.cost_center_id left join public.branches b on b.id=cc.branch_id
      where f.tenant_id=v.tenant_id and f.entry_type='payable' and f.status<>'cancelled' and f.created_at::date between v_start and v_end and (p_branch is null or f.branch_id=p_branch)
      group by cc.code,cc.name,b.name
    ) x;
  elsif p_report='chart_account_ledger' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.account_code,x.entry_type),'[]'::jsonb) into v_data from (
      select coalesce(a.code,'SEM-CONTA') account_code,coalesce(a.name,'Sem conta') account,coalesce(a.account_type,'unknown') account_type,f.entry_type,
             count(*)::int entries,sum(f.amount) total_amount,sum(f.paid_amount) settled_amount,sum(greatest(f.amount-f.paid_amount,0)) open_amount
      from public.financial_entries f left join public.financial_chart_accounts a on a.id=f.chart_account_id
      where f.tenant_id=v.tenant_id and f.status<>'cancelled' and f.created_at::date between v_start and v_end and (p_branch is null or f.branch_id=p_branch)
      group by a.code,a.name,a.account_type,f.entry_type
    ) x;
  elsif p_report='dre_managerial' then
    with sales_totals as (
      select coalesce(sum(s.subtotal),0) gross_sales,coalesce(sum(s.discount),0) discounts,coalesce(sum(s.surcharge),0) surcharges,coalesce(sum(s.total),0) net_sales
      from public.sales s where s.tenant_id=v.tenant_id and s.status in ('completed','paid','fiscalized') and s.completed_at::date between v_start and v_end and (p_branch is null or s.branch_id=p_branch)
    ), returns_totals as (
      select coalesce(sum(sr.total),0) returns_total,coalesce(sum(sri.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) returned_cost
      from public.sale_returns sr join public.sales s on s.id=sr.sale_id join public.sale_return_items sri on sri.return_id=sr.id left join public.sale_items si on si.id=sri.sale_item_id left join public.products p on p.id=sri.product_id
      where sr.tenant_id=v.tenant_id and coalesce(sr.status,'completed') not in ('cancelled','rejected') and sr.created_at::date between v_start and v_end and (p_branch is null or s.branch_id=p_branch)
    ), costs as (
      select coalesce(sum(si.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) sold_cost from public.sale_items si join public.sales s on s.id=si.sale_id left join public.products p on p.id=si.product_id
      where s.tenant_id=v.tenant_id and s.status in ('completed','paid','fiscalized') and s.completed_at::date between v_start and v_end and (p_branch is null or s.branch_id=p_branch)
    ), expense_accounts as (
      select coalesce(a.code,'5.9.99') code,coalesce(a.name,c.name,'Despesas não classificadas') name,sum(f.amount) amount
      from public.financial_entries f left join public.financial_chart_accounts a on a.id=f.chart_account_id left join public.financial_categories c on c.id=f.financial_category_id
      where f.tenant_id=v.tenant_id and f.entry_type='payable' and f.purchase_id is null and f.status<>'cancelled' and f.created_at::date between v_start and v_end and (p_branch is null or f.branch_id=p_branch)
      group by a.code,a.name,c.name
    ), vals as (
      select st.gross_sales,rt.returns_total,st.discounts,st.surcharges,st.net_sales-rt.returns_total net_revenue,c.sold_cost-rt.returned_cost cmv,coalesce((select sum(amount) from expense_accounts),0) operating_expenses
      from sales_totals st cross join returns_totals rt cross join costs c
    ), fixed_rows as (
      select 1::numeric ord,'RECEITAS' section,'Receita bruta de vendas' account,gross_sales amount,case when gross_sales=0 then 0 else 100 end percent_revenue from vals union all
      select 2,'DEDUÇÕES','(-) Devoluções',-returns_total,case when gross_sales=0 then 0 else -returns_total/gross_sales*100 end from vals union all
      select 3,'DEDUÇÕES','(-) Descontos',-discounts,case when gross_sales=0 then 0 else -discounts/gross_sales*100 end from vals union all
      select 4,'RECEITAS','(+) Acréscimos',surcharges,case when gross_sales=0 then 0 else surcharges/gross_sales*100 end from vals union all
      select 5,'RESULTADO','Receita líquida',net_revenue,case when gross_sales=0 then 0 else net_revenue/gross_sales*100 end from vals union all
      select 6,'CUSTOS','(-) CMV',-cmv,case when net_revenue=0 then 0 else -cmv/net_revenue*100 end from vals union all
      select 7,'RESULTADO','Lucro bruto',net_revenue-cmv,case when net_revenue=0 then 0 else (net_revenue-cmv)/net_revenue*100 end from vals
    ), detail_expenses as (
      select 8+(row_number() over(order by code,name)::numeric/100) ord,'DESPESAS' section,'(-) '||code||' · '||name account,-amount amount,case when v.net_revenue=0 then 0 else -amount/v.net_revenue*100 end percent_revenue
      from expense_accounts cross join vals v
    ), ending as (
      select 8.90::numeric ord,'DESPESAS' section,'Total de despesas operacionais' account,-operating_expenses amount,case when net_revenue=0 then 0 else -operating_expenses/net_revenue*100 end percent_revenue from vals union all
      select 9,'RESULTADO','Resultado operacional gerencial',net_revenue-cmv-operating_expenses,case when net_revenue=0 then 0 else (net_revenue-cmv-operating_expenses)/net_revenue*100 end from vals
    ), rows as (select * from fixed_rows union all select * from detail_expenses union all select * from ending)
    select coalesce(jsonb_agg(to_jsonb(x) order by x.ord),'[]'::jsonb) into v_data from rows x;
  else
    return jsonb_build_object('ok',false,'error','unsupported_financial_report');
  end if;
  return jsonb_build_object('ok',true,'report',p_report,'data',v_data,'start',v_start,'end',v_end,'branch',p_branch);
end;
$function$;

create or replace function public.erp_report_v4(p_token text,p_report text,p_start date default null,p_end date default null,p_branch uuid default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
set "TimeZone" to 'America/Fortaleza'
as $function$
declare v record;v_data jsonb:='[]'::jsonb;v_start date;v_end date:=coalesce(p_end,current_date);
begin
  if p_report in ('dre_managerial','expenses_by_category','cost_center_expenses','chart_account_ledger') then
    return public.erp_financial_management_report(p_token,p_report,p_start,p_end,p_branch,p_filters);
  end if;
  if p_report<>'seller_commission' then return public.erp_report_v3(p_token,p_report,p_start,p_end,p_branch,p_filters); end if;
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  if p_branch is not null and not exists(select 1 from public.branches where id=p_branch and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','invalid_branch');end if;
  v_start:=coalesce(p_start,v_end-30);
  with returns_by_sale as (select sr.sale_id,sum(sr.total) return_total from public.sale_returns sr where sr.tenant_id=v.tenant_id and coalesce(sr.status,'completed') not in ('cancelled','rejected') group by sr.sale_id)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.commission_amount desc,x.revenue desc),'[]'::jsonb) into v_data from (
    select coalesce(u.name,'Sem vendedor') seller,b.name branch,coalesce(u.commission_percent,0) commission_percent,count(*)::int sales_count,sum(s.total) gross_revenue,sum(coalesce(r.return_total,0)) returns_total,sum(s.total-coalesce(r.return_total,0)) revenue,sum(s.discount) discounts,sum(s.total-coalesce(r.return_total,0))*coalesce(u.commission_percent,0)/100 commission_amount
    from public.sales s left join public.staff_users u on u.id=coalesce(s.seller_user_id,s.staff_user_id) left join public.branches b on b.id=s.branch_id left join returns_by_sale r on r.sale_id=s.id
    where s.tenant_id=v.tenant_id and s.status in ('completed','paid','fiscalized') and s.completed_at::date between v_start and v_end and (p_branch is null or s.branch_id=p_branch)
    group by u.id,u.name,u.commission_percent,b.name
  ) x;
  return jsonb_build_object('ok',true,'report',p_report,'data',v_data,'start',v_start,'end',v_end,'branch',p_branch);
end;
$function$;
