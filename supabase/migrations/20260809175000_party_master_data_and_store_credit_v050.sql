-- ThorPDV 0.5.0 — cadastros completos de clientes/fornecedores e crédito em loja.

alter table public.customers add column if not exists birth_date date;
alter table public.customers add column if not exists trade_name text;

alter table public.suppliers add column if not exists type text not null default 'company';
alter table public.suppliers add column if not exists trade_name text;
alter table public.suppliers add column if not exists street text;
alter table public.suppliers add column if not exists number text;
alter table public.suppliers add column if not exists complement text;
alter table public.suppliers add column if not exists district text;
alter table public.suppliers add column if not exists city text;
alter table public.suppliers add column if not exists state char(2);
alter table public.suppliers add column if not exists postal_code text;
alter table public.suppliers add column if not exists ibge_city_code text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='suppliers_type_check' and conrelid='public.suppliers'::regclass
  ) then
    alter table public.suppliers add constraint suppliers_type_check check (type in ('individual','company'));
  end if;
end $$;

create or replace function private.br_digits(p_value text)
returns text language sql immutable
as $$ select regexp_replace(coalesce(p_value,''),'\D','','g') $$;

create or replace function private.br_valid_cpf(p_value text)
returns boolean language plpgsql immutable
as $$
declare d text:=private.br_digits(p_value); s int; digit int; i int;
begin
  if length(d)<>11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s:=0;
  for i in 1..9 loop s:=s+(substr(d,i,1)::int)*(11-i); end loop;
  digit:=(s*10)%11; if digit=10 then digit:=0; end if;
  if digit<>substr(d,10,1)::int then return false; end if;
  s:=0;
  for i in 1..10 loop s:=s+(substr(d,i,1)::int)*(12-i); end loop;
  digit:=(s*10)%11; if digit=10 then digit:=0; end if;
  return digit=substr(d,11,1)::int;
end $$;

create or replace function private.br_valid_cnpj(p_value text)
returns boolean language plpgsql immutable
as $$
declare
  d text:=private.br_digits(p_value);
  weights1 int[]:=array[5,4,3,2,9,8,7,6,5,4,3,2];
  weights2 int[]:=array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int:=0; r int; digit int; i int;
begin
  if length(d)<>14 or d ~ '^(\d)\1{13}$' then return false; end if;
  for i in 1..12 loop s:=s+(substr(d,i,1)::int)*weights1[i]; end loop;
  r:=s%11; digit:=case when r<2 then 0 else 11-r end;
  if digit<>substr(d,13,1)::int then return false; end if;
  s:=0;
  for i in 1..13 loop s:=s+(substr(d,i,1)::int)*weights2[i]; end loop;
  r:=s%11; digit:=case when r<2 then 0 else 11-r end;
  return digit=substr(d,14,1)::int;
end $$;

create or replace function private.br_validate_party_row()
returns trigger language plpgsql
as $$
declare d text; cep text;
begin
  if new.type is null or new.type not in ('individual','company') then new.type:='individual'; end if;
  d:=private.br_digits(new.document);
  if d<>'' then
    if new.type='individual' and not private.br_valid_cpf(d) then raise exception 'invalid_cpf'; end if;
    if new.type='company' and not private.br_valid_cnpj(d) then raise exception 'invalid_cnpj'; end if;
    new.document:=d;
  else
    new.document:=null;
  end if;
  cep:=private.br_digits(new.postal_code);
  if cep<>'' and length(cep)<>8 then raise exception 'invalid_cep'; end if;
  new.postal_code:=nullif(cep,'');
  new.state:=nullif(upper(trim(coalesce(new.state,''))), '');
  if tg_table_name='customers' and new.type='company' then new.birth_date:=null; end if;
  return new;
end $$;

drop trigger if exists customers_br_validate on public.customers;
create trigger customers_br_validate
before insert or update on public.customers
for each row execute function private.br_validate_party_row();

drop trigger if exists suppliers_br_validate on public.suppliers;
create trigger suppliers_br_validate
before insert or update on public.suppliers
for each row execute function private.br_validate_party_row();

create table if not exists public.customer_store_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  entry_type text not null check (entry_type in ('credit','debit')),
  amount numeric(15,2) not null check (amount>0),
  source_kind text not null,
  source_id uuid not null,
  sale_id uuid references public.sales(id) on delete set null,
  return_id uuid references public.sale_returns(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(tenant_id,source_kind,source_id)
);

create index if not exists idx_store_credit_customer_created
on public.customer_store_credit_ledger(tenant_id,customer_id,created_at desc);

alter table public.customer_store_credit_ledger enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_store_credit_ledger' and policyname='store_credit_member_all'
  ) then
    create policy store_credit_member_all on public.customer_store_credit_ledger
    for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
  end if;
end $$;

create or replace function private.customer_store_credit_balance(p_tenant uuid,p_customer uuid)
returns numeric language sql stable security definer set search_path='public','private'
as $$
  select coalesce(sum(case when entry_type='credit' then amount else -amount end),0)::numeric(15,2)
  from public.customer_store_credit_ledger
  where tenant_id=p_tenant and customer_id=p_customer
$$;

create or replace function private.store_credit_on_return()
returns trigger language plpgsql security definer set search_path='public','private'
as $$
declare s public.sales%rowtype;
begin
  if new.status='completed' and new.refund_method='store_credit' and new.total>0 then
    select * into s from public.sales where id=new.sale_id;
    if s.customer_id is null then raise exception 'store_credit_requires_customer'; end if;
    insert into public.customer_store_credit_ledger(
      tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,return_id,notes,metadata
    ) values(
      new.tenant_id,s.company_id,s.branch_id,s.customer_id,'credit',new.total,'sale_return',new.id,s.id,new.id,
      'Crédito gerado por devolução da venda '||coalesce(s.number::text,s.id::text),jsonb_build_object('refund_method','store_credit')
    ) on conflict(tenant_id,source_kind,source_id) do nothing;
    update public.customers set updated_at=now() where id=s.customer_id;
  end if;
  return new;
end $$;

drop trigger if exists sale_return_store_credit on public.sale_returns;
create trigger sale_return_store_credit
after insert or update of total,status,refund_method on public.sale_returns
for each row execute function private.store_credit_on_return();

create or replace function private.store_credit_on_payment()
returns trigger language plpgsql security definer set search_path='public','private'
as $$
declare s public.sales%rowtype; bal numeric;
begin
  if new.method='store_credit' and new.status='paid'
     and (tg_op='INSERT' or old.status is distinct from 'paid' or old.method is distinct from 'store_credit') then
    select * into s from public.sales where id=new.sale_id;
    if s.customer_id is null then raise exception 'store_credit_requires_customer'; end if;
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text||':'||s.customer_id::text));
    bal:=private.customer_store_credit_balance(new.tenant_id,s.customer_id);
    if bal+0.001<new.amount then raise exception 'insufficient_store_credit'; end if;
    insert into public.customer_store_credit_ledger(
      tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,payment_id,notes,metadata
    ) values(
      new.tenant_id,s.company_id,s.branch_id,s.customer_id,'debit',new.amount,'sale_payment',new.id,s.id,new.id,
      'Uso de crédito em loja na venda '||coalesce(s.number::text,s.id::text),jsonb_build_object('payment_method','store_credit')
    ) on conflict(tenant_id,source_kind,source_id) do nothing;
    update public.customers set updated_at=now() where id=s.customer_id;
  end if;
  if tg_op='UPDATE' and old.method='store_credit' and old.status='paid' and new.status in ('cancelled','refunded') then
    select * into s from public.sales where id=new.sale_id;
    if s.customer_id is not null then
      insert into public.customer_store_credit_ledger(
        tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,payment_id,notes,metadata
      ) values(
        new.tenant_id,s.company_id,s.branch_id,s.customer_id,'credit',old.amount,'payment_reversal',new.id,s.id,new.id,
        'Estorno de crédito em loja da venda '||coalesce(s.number::text,s.id::text),jsonb_build_object('new_status',new.status)
      ) on conflict(tenant_id,source_kind,source_id) do nothing;
      update public.customers set updated_at=now() where id=s.customer_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payment_store_credit on public.payments;
create trigger payment_store_credit
after insert or update of status,method on public.payments
for each row execute function private.store_credit_on_payment();

create or replace function public.erp_party_save(p_token text,p_resource text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions'
as $$
declare v record; v_id uuid; v_type text; v_doc text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_resource not in ('customers','suppliers') then return jsonb_build_object('ok',false,'error','unsupported_resource'); end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  v_type:=case lower(coalesce(nullif(p_payload->>'type',''),case when p_resource='suppliers' then 'company' else 'individual' end))
    when 'pf' then 'individual' when 'individual' then 'individual'
    when 'pj' then 'company' when 'company' then 'company' else 'individual' end;
  v_doc:=private.br_digits(p_payload->>'document');
  if v_doc<>'' then
    if v_type='individual' and not private.br_valid_cpf(v_doc) then return jsonb_build_object('ok',false,'error','invalid_cpf'); end if;
    if v_type='company' and not private.br_valid_cnpj(v_doc) then return jsonb_build_object('ok',false,'error','invalid_cnpj'); end if;
  end if;

  if p_resource='customers' then
    if v_id is null then
      insert into public.customers(
        tenant_id,company_id,type,name,trade_name,document,birth_date,email,phone,state_registration,
        postal_code,street,number,complement,district,city,state,ibge_city_code,active
      ) values(
        v.tenant_id,v.company_id,v_type,p_payload->>'name',nullif(p_payload->>'trade_name',''),nullif(v_doc,''),
        case when v_type='individual' then nullif(p_payload->>'birth_date','')::date else null end,
        nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),nullif(p_payload->>'state_registration',''),
        nullif(private.br_digits(p_payload->>'postal_code'),''),nullif(p_payload->>'street',''),nullif(p_payload->>'number',''),
        nullif(p_payload->>'complement',''),nullif(p_payload->>'district',''),nullif(p_payload->>'city',''),
        nullif(p_payload->>'state',''),nullif(p_payload->>'ibge_city_code',''),coalesce((p_payload->>'active')::boolean,true)
      ) returning id into v_id;
    else
      update public.customers set
        type=v_type,
        name=coalesce(nullif(p_payload->>'name',''),name),
        trade_name=case when p_payload?'trade_name' then nullif(p_payload->>'trade_name','') else trade_name end,
        document=case when p_payload?'document' then nullif(v_doc,'') else document end,
        birth_date=case when v_type='individual' then case when p_payload?'birth_date' then nullif(p_payload->>'birth_date','')::date else birth_date end else null end,
        email=case when p_payload?'email' then nullif(p_payload->>'email','') else email end,
        phone=case when p_payload?'phone' then nullif(p_payload->>'phone','') else phone end,
        state_registration=case when p_payload?'state_registration' then nullif(p_payload->>'state_registration','') else state_registration end,
        postal_code=case when p_payload?'postal_code' then nullif(private.br_digits(p_payload->>'postal_code'),'') else postal_code end,
        street=case when p_payload?'street' then nullif(p_payload->>'street','') else street end,
        number=case when p_payload?'number' then nullif(p_payload->>'number','') else number end,
        complement=case when p_payload?'complement' then nullif(p_payload->>'complement','') else complement end,
        district=case when p_payload?'district' then nullif(p_payload->>'district','') else district end,
        city=case when p_payload?'city' then nullif(p_payload->>'city','') else city end,
        state=case when p_payload?'state' then nullif(p_payload->>'state','') else state end,
        ibge_city_code=case when p_payload?'ibge_city_code' then nullif(p_payload->>'ibge_city_code','') else ibge_city_code end,
        active=coalesce((p_payload->>'active')::boolean,active),updated_at=now()
      where id=v_id and tenant_id=v.tenant_id;
    end if;
  else
    if v_id is null then
      insert into public.suppliers(
        tenant_id,company_id,type,name,trade_name,document,email,phone,state_registration,postal_code,
        street,number,complement,district,city,state,ibge_city_code,active
      ) values(
        v.tenant_id,v.company_id,v_type,p_payload->>'name',nullif(p_payload->>'trade_name',''),nullif(v_doc,''),
        nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),nullif(p_payload->>'state_registration',''),
        nullif(private.br_digits(p_payload->>'postal_code'),''),nullif(p_payload->>'street',''),nullif(p_payload->>'number',''),
        nullif(p_payload->>'complement',''),nullif(p_payload->>'district',''),nullif(p_payload->>'city',''),
        nullif(p_payload->>'state',''),nullif(p_payload->>'ibge_city_code',''),coalesce((p_payload->>'active')::boolean,true)
      ) returning id into v_id;
    else
      update public.suppliers set
        type=v_type,
        name=coalesce(nullif(p_payload->>'name',''),name),
        trade_name=case when p_payload?'trade_name' then nullif(p_payload->>'trade_name','') else trade_name end,
        document=case when p_payload?'document' then nullif(v_doc,'') else document end,
        email=case when p_payload?'email' then nullif(p_payload->>'email','') else email end,
        phone=case when p_payload?'phone' then nullif(p_payload->>'phone','') else phone end,
        state_registration=case when p_payload?'state_registration' then nullif(p_payload->>'state_registration','') else state_registration end,
        postal_code=case when p_payload?'postal_code' then nullif(private.br_digits(p_payload->>'postal_code'),'') else postal_code end,
        street=case when p_payload?'street' then nullif(p_payload->>'street','') else street end,
        number=case when p_payload?'number' then nullif(p_payload->>'number','') else number end,
        complement=case when p_payload?'complement' then nullif(p_payload->>'complement','') else complement end,
        district=case when p_payload?'district' then nullif(p_payload->>'district','') else district end,
        city=case when p_payload?'city' then nullif(p_payload->>'city','') else city end,
        state=case when p_payload?'state' then nullif(p_payload->>'state','') else state end,
        ibge_city_code=case when p_payload?'ibge_city_code' then nullif(p_payload->>'ibge_city_code','') else ibge_city_code end,
        active=coalesce((p_payload->>'active')::boolean,active),updated_at=now()
      where id=v_id and tenant_id=v.tenant_id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end $$;

create or replace function public.erp_party_list(p_token text,p_resource text,p_search text default null)
returns jsonb language plpgsql security definer set search_path='public','private','extensions'
as $$
declare v record; data jsonb; q text:='%'||coalesce(trim(p_search),'')||'%';
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_resource='customers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into data from (
      select c.id,c.name,c.trade_name,c.document,case c.type when 'individual' then 'PF' else 'PJ' end type,
        c.birth_date,c.email,c.phone,c.state_registration,c.postal_code,c.street,c.number,c.complement,c.district,c.city,
        c.state,c.ibge_city_code,c.active,c.created_at,private.customer_store_credit_balance(c.tenant_id,c.id) store_credit_balance
      from public.customers c
      where c.tenant_id=v.tenant_id and (
        p_search is null or c.name ilike q or coalesce(c.trade_name,'') ilike q or coalesce(c.document,'') ilike q
        or coalesce(c.email,'') ilike q or coalesce(c.phone,'') ilike q
      ) limit 250
    ) x;
  elsif p_resource='suppliers' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into data from (
      select s.id,s.name,s.trade_name,s.document,case s.type when 'individual' then 'PF' else 'PJ' end type,
        s.email,s.phone,s.state_registration,s.postal_code,s.street,s.number,s.complement,s.district,s.city,s.state,
        s.ibge_city_code,s.active,s.created_at
      from public.suppliers s
      where s.tenant_id=v.tenant_id and (
        p_search is null or s.name ilike q or coalesce(s.trade_name,'') ilike q or coalesce(s.document,'') ilike q
        or coalesce(s.email,'') ilike q or coalesce(s.phone,'') ilike q
      ) limit 250
    ) x;
  else
    return jsonb_build_object('ok',false,'error','unsupported_resource');
  end if;
  return jsonb_build_object('ok',true,'data',data);
end $$;

create or replace function public.pdv_pull_v5(p_device_token text,p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path='public','private'
as $$
declare data jsonb; dev record; customers jsonb;
begin
  data:=public.pdv_pull_v4(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into dev from private.resolve_pdv_device(p_device_token);
  select coalesce(jsonb_agg(
    c.obj || jsonb_build_object(
      'type',p.type,'trade_name',p.trade_name,'birth_date',p.birth_date,'state_registration',p.state_registration,
      'postal_code',p.postal_code,'street',p.street,'number',p.number,'complement',p.complement,'district',p.district,
      'city',p.city,'state',p.state,'ibge_city_code',p.ibge_city_code,
      'store_credit_balance',private.customer_store_credit_balance(dev.tenant_id,p.id)
    ) order by coalesce(c.obj->>'name',p.name)
  ),'[]'::jsonb) into customers
  from jsonb_array_elements(coalesce(data->'customers','[]'::jsonb)) c(obj)
  left join public.customers p on p.id=(c.obj->>'id')::uuid and p.tenant_id=dev.tenant_id;
  data:=jsonb_set(data,'{customers}',coalesce(customers,'[]'::jsonb),true);
  return data;
end $$;
