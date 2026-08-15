create table if not exists public.bank_cnab_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  bank_code text not null default '341',
  layout text not null default 'cnab400' check (layout in ('cnab400')),
  agency text not null,
  account_number text not null,
  account_digit text not null,
  wallet text not null default '109',
  species text not null default '01',
  acceptance text not null default 'N' check (acceptance in ('A','N')),
  remittance_sequence bigint not null default 0,
  our_number_sequence bigint not null default 0,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, bank_account_id, layout)
);

create table if not exists public.bank_cnab_remittance_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  config_id uuid not null references public.bank_cnab_configs(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  layout text not null default 'cnab400',
  file_sequence bigint not null,
  file_name text not null,
  file_hash text,
  raw_content text,
  status text not null default 'generated' check (status in ('generated','sent','processed','cancelled')),
  record_count integer not null default 0,
  total_amount numeric(18,2) not null default 0,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(config_id,file_sequence)
);

create table if not exists public.bank_cnab_remittance_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  config_id uuid not null references public.bank_cnab_configs(id) on delete restrict,
  remittance_id uuid not null references public.bank_cnab_remittance_files(id) on delete cascade,
  financial_entry_id uuid not null references public.financial_entries(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  line_number integer not null,
  company_use text not null,
  our_number text not null,
  our_number_dac text not null,
  document_number text not null,
  amount numeric(18,2) not null,
  due_date date not null,
  barcode text not null,
  digitable_line text not null,
  status text not null default 'generated' check (status in ('generated','accepted','rejected','partial','paid','cancelled')),
  rejection_code text,
  rejection_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(remittance_id,financial_entry_id),
  unique(config_id,our_number)
);

create table if not exists public.bank_cnab_return_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  config_id uuid not null references public.bank_cnab_configs(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  layout text not null default 'cnab400',
  file_name text not null,
  file_hash text not null,
  bank_file_sequence text,
  generated_date date,
  credit_date date,
  status text not null default 'processing' check (status in ('processing','processed','processed_with_errors','rejected')),
  record_count integer not null default 0,
  processed_count integer not null default 0,
  matched_count integer not null default 0,
  paid_count integer not null default 0,
  error_count integer not null default 0,
  raw_content text not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(tenant_id,file_hash)
);

create table if not exists public.bank_cnab_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  return_file_id uuid not null references public.bank_cnab_return_files(id) on delete cascade,
  remittance_item_id uuid references public.bank_cnab_remittance_items(id) on delete set null,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  line_number integer not null,
  company_use text,
  wallet text,
  our_number text,
  occurrence_code text not null,
  occurrence_date date,
  document_number text,
  due_date date,
  title_amount numeric(18,2),
  bank_fee numeric(18,2),
  iof numeric(18,2),
  rebate numeric(18,2),
  discount numeric(18,2),
  principal_amount numeric(18,2),
  interest_amount numeric(18,2),
  other_credits numeric(18,2),
  credit_date date,
  liquidation_code text,
  error_codes text,
  raw_line text not null,
  status text not null default 'received' check (status in ('received','accepted','rejected','partial','paid','cancelled','ignored','unmatched','error')),
  financial_settlement_id uuid references public.financial_settlements(id) on delete set null,
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(return_file_id,line_number)
);

create index if not exists bank_cnab_remittance_items_entry_idx on public.bank_cnab_remittance_items(tenant_id,financial_entry_id,status);
create index if not exists bank_cnab_remittance_items_company_use_idx on public.bank_cnab_remittance_items(config_id,company_use);
create index if not exists bank_cnab_return_items_match_idx on public.bank_cnab_return_items(tenant_id,our_number,occurrence_code);
create index if not exists bank_cnab_return_files_imported_idx on public.bank_cnab_return_files(tenant_id,imported_at desc);

alter table public.bank_cnab_configs enable row level security;
alter table public.bank_cnab_remittance_files enable row level security;
alter table public.bank_cnab_remittance_items enable row level security;
alter table public.bank_cnab_return_files enable row level security;
alter table public.bank_cnab_return_items enable row level security;

create or replace function private.cnab_clean_text(p_value text,p_length integer)
returns text language sql immutable as $$
  select left(regexp_replace(translate(upper(coalesce(p_value,'')),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','AAAAAEEEEIIIIOOOOOUUUUCN'),'[^A-Z0-9 .,/&-]',' ','g'),greatest(p_length,0))
$$;

create or replace function private.cnab_mod10_dac(p_digits text)
returns integer language plpgsql immutable as $$
declare i integer; w integer:=2; d integer; prod integer; total integer:=0; r integer; out_dac integer;
begin
  if p_digits is null or p_digits !~ '^[0-9]+$' then raise exception 'cnab_mod10_requires_digits'; end if;
  for i in reverse length(p_digits)..1 loop
    d:=substr(p_digits,i,1)::integer; prod:=d*w; total:=total+(prod/10)+(prod%10); w:=case when w=2 then 1 else 2 end;
  end loop;
  r:=total%10; out_dac:=10-r; if out_dac=10 then out_dac:=0; end if; return out_dac;
end $$;

create or replace function private.itau_cnab_nosso_numero_dac(p_agency text,p_account text,p_wallet text,p_our_number text)
returns integer language sql immutable as $$ select private.cnab_mod10_dac(p_agency||p_account||p_wallet||p_our_number) $$;

create or replace function private.cnab_due_factor(p_due date)
returns integer language plpgsql immutable as $$
declare days_count integer;
begin
  if p_due is null then raise exception 'due_date_required'; end if;
  if p_due>=date '2025-02-22' then days_count:=p_due-date '2025-02-22'; return 1000+(days_count%9000); end if;
  days_count:=p_due-date '1997-10-07'; if days_count<0 then raise exception 'due_date_out_of_range'; end if; return days_count%10000;
end $$;

create or replace function private.itau_cnab_barcode_dac(p_without_dac text)
returns integer language plpgsql immutable as $$
declare i integer; w integer:=2; total integer:=0; r integer; d integer; out_dac integer;
begin
  if p_without_dac is null or length(p_without_dac)<>43 or p_without_dac !~ '^[0-9]{43}$' then raise exception 'barcode_requires_43_digits'; end if;
  for i in reverse 43..1 loop d:=substr(p_without_dac,i,1)::integer; total:=total+d*w; w:=w+1; if w>9 then w:=2; end if; end loop;
  r:=total%11; out_dac:=11-r; if out_dac in (0,1,10,11) then out_dac:=1; end if; return out_dac;
end $$;

create or replace function private.itau_cnab_barcode(p_agency text,p_account text,p_account_digit text,p_wallet text,p_our_number text,p_due date,p_amount numeric)
returns text language plpgsql immutable as $$
declare n_dac integer; factor text; cents text; free_field text; body text; general_dac integer;
begin
  n_dac:=private.itau_cnab_nosso_numero_dac(p_agency,p_account,p_wallet,p_our_number); factor:=lpad(private.cnab_due_factor(p_due)::text,4,'0'); cents:=lpad(round(p_amount*100)::bigint::text,10,'0');
  if length(cents)>10 then raise exception 'amount_exceeds_barcode_limit'; end if;
  free_field:=p_wallet||p_our_number||n_dac::text||p_agency||p_account||p_account_digit||'000'; body:='3419'||factor||cents||free_field; general_dac:=private.itau_cnab_barcode_dac(body);
  return '3419'||general_dac::text||factor||cents||free_field;
end $$;

create or replace function private.itau_cnab_digitable_line(p_agency text,p_account text,p_account_digit text,p_wallet text,p_our_number text,p_due date,p_amount numeric)
returns text language plpgsql immutable as $$
declare n_dac integer; barcode text; f1 text; f2 text; f3 text; d1 integer; d2 integer; d3 integer; factor text; cents text;
begin
  n_dac:=private.itau_cnab_nosso_numero_dac(p_agency,p_account,p_wallet,p_our_number); barcode:=private.itau_cnab_barcode(p_agency,p_account,p_account_digit,p_wallet,p_our_number,p_due,p_amount);
  f1:='3419'||p_wallet||substr(p_our_number,1,2); f2:=substr(p_our_number,3,6)||n_dac::text||substr(p_agency,1,3); f3:=substr(p_agency,4,1)||p_account||p_account_digit||'000';
  d1:=private.cnab_mod10_dac(f1); d2:=private.cnab_mod10_dac(f2); d3:=private.cnab_mod10_dac(f3); factor:=lpad(private.cnab_due_factor(p_due)::text,4,'0'); cents:=lpad(round(p_amount*100)::bigint::text,10,'0');
  return substr(f1,1,5)||'.'||substr(f1,6)||d1::text||' '||substr(f2,1,5)||'.'||substr(f2,6)||d2::text||' '||substr(f3,1,5)||'.'||substr(f3,6)||d3::text||' '||substr(barcode,5,1)||' '||factor||cents;
end $$;

create or replace function private.cnab_ddmmyy_date(p_value text)
returns date language plpgsql immutable as $$
declare s text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g'); y integer;
begin
  if length(s)<>6 or s='000000' then return null; end if; y:=substr(s,5,2)::integer; return make_date(case when y>=80 then 1900+y else 2000+y end,substr(s,3,2)::integer,substr(s,1,2)::integer);
exception when others then return null;
end $$;

create or replace function private.cnab400_parse_return(p_content text)
returns jsonb language plpgsql stable as $$
declare lines text[]; ln text; idx integer:=0; header jsonb:='{}'::jsonb; details jsonb:='[]'::jsonb; n text; val numeric;
begin
  lines:=regexp_split_to_array(replace(coalesce(p_content,''),E'\r',''),E'\n');
  foreach ln in array lines loop
    if ln='' then continue; end if; idx:=idx+1;
    if length(ln)<>400 then details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type',substr(ln,1,1),'invalid_length',length(ln),'raw_line',ln)); continue; end if;
    if substr(ln,1,1)='0' then
      header:=jsonb_build_object('record_type','0','operation',substr(ln,2,1),'literal',trim(substr(ln,3,7)),'service_code',substr(ln,10,2),'service',trim(substr(ln,12,15)),'company_name',trim(substr(ln,47,30)),'bank_code',substr(ln,77,3),'bank_name',trim(substr(ln,80,15)),'generation_date',private.cnab_ddmmyy_date(substr(ln,95,6)),'bank_file_sequence',trim(substr(ln,109,5)),'credit_date',private.cnab_ddmmyy_date(substr(ln,114,6)));
    elsif substr(ln,1,1)='1' then
      n:=regexp_replace(substr(ln,153,13),'[^0-9]','','g'); val:=case when n='' then null else n::numeric/100 end;
      details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type','1','company_use',rtrim(substr(ln,38,25)),'wallet',substr(ln,83,3),'our_number',substr(ln,86,8),'our_number_confirmed',substr(ln,127,8),'occurrence_code',substr(ln,109,2),'occurrence_date',private.cnab_ddmmyy_date(substr(ln,111,6)),'document_number',rtrim(substr(ln,117,10)),'due_date',private.cnab_ddmmyy_date(substr(ln,147,6)),'title_amount',val,'bank_fee',nullif(regexp_replace(substr(ln,176,13),'[^0-9]','','g'),'')::numeric/100,'iof',nullif(regexp_replace(substr(ln,215,13),'[^0-9]','','g'),'')::numeric/100,'rebate',nullif(regexp_replace(substr(ln,228,13),'[^0-9]','','g'),'')::numeric/100,'discount',nullif(regexp_replace(substr(ln,241,13),'[^0-9]','','g'),'')::numeric/100,'principal_amount',nullif(regexp_replace(substr(ln,254,13),'[^0-9]','','g'),'')::numeric/100,'interest_amount',nullif(regexp_replace(substr(ln,267,13),'[^0-9]','','g'),'')::numeric/100,'other_credits',nullif(regexp_replace(substr(ln,280,13),'[^0-9]','','g'),'')::numeric/100,'credit_date',private.cnab_ddmmyy_date(substr(ln,296,6)),'error_codes',trim(substr(ln,378,8)),'liquidation_code',substr(ln,393,2),'raw_line',ln));
    end if;
  end loop;
  return jsonb_build_object('ok',true,'header',header,'details',details,'record_count',idx);
end $$;

update public.bank_account_integrations set active=false,updated_at=now() where product='bolecode_pix' and active=true;
