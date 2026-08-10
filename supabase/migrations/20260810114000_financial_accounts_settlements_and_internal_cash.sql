alter table public.bank_accounts add column if not exists account_type text not null default 'bank';
alter table public.bank_accounts add column if not exists is_system boolean not null default false;
alter table public.bank_accounts add column if not exists opening_balance numeric(15,2) not null default 0;
alter table public.bank_accounts add column if not exists notes text;

do $$ begin
  alter table public.bank_accounts add constraint bank_accounts_account_type_check check (account_type in ('bank','internal_cash'));
exception when duplicate_object then null; end $$;

create unique index if not exists bank_accounts_internal_cash_company_uidx
  on public.bank_accounts(tenant_id,company_id)
  where account_type='internal_cash' and is_system=true;

alter table public.bank_transactions add column if not exists financial_entry_id uuid references public.financial_entries(id) on delete set null;
alter table public.bank_transactions add column if not exists cash_session_id uuid references public.cash_sessions(id) on delete set null;
alter table public.bank_transactions add column if not exists transfer_group_id uuid;
alter table public.bank_transactions add column if not exists payment_method text;
alter table public.bank_transactions add column if not exists origin_type text not null default 'manual';
alter table public.bank_transactions add column if not exists origin_id uuid;
alter table public.bank_transactions add column if not exists notes text;

create unique index if not exists bank_transactions_origin_uidx
  on public.bank_transactions(tenant_id,origin_type,origin_id)
  where origin_id is not null and origin_type in ('sale_payment','sale_payment_reversal','cash_movement','cash_movement_reversal','financial_settlement');

create table if not exists public.financial_settlements(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  financial_entry_id uuid not null references public.financial_entries(id) on delete cascade,
  amount numeric(15,2) not null check(amount>0),
  settled_at timestamptz not null default now(),
  payment_method text not null,
  destination_type text not null check(destination_type in ('bank_account','cash_session','store_credit')),
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_settlements_entry_idx on public.financial_settlements(financial_entry_id,settled_at desc);
create index if not exists financial_settlements_account_idx on public.financial_settlements(bank_account_id,settled_at desc);
create index if not exists financial_settlements_cash_idx on public.financial_settlements(cash_session_id,settled_at desc);

alter table public.financial_settlements enable row level security;
do $$ begin
  create policy financial_settlements_member_all on public.financial_settlements for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
exception when duplicate_object then null; end $$;

alter table public.cash_movements add column if not exists financial_entry_id uuid references public.financial_entries(id) on delete set null;
alter table public.cash_movements add column if not exists payment_method text;
alter table public.cash_movements drop constraint if exists cash_movements_movement_type_check;
alter table public.cash_movements add constraint cash_movements_movement_type_check check (movement_type in ('supply','withdrawal','sangria','expense','refund','receivable'));

create or replace function private.ensure_internal_cash_account(p_tenant uuid,p_company uuid,p_branch uuid default null)
returns uuid language plpgsql security definer set search_path=public,private,extensions as $$
declare v_id uuid;
begin
  select id into v_id from public.bank_accounts where tenant_id=p_tenant and company_id=p_company and account_type='internal_cash' and is_system=true order by created_at limit 1;
  if v_id is null then
    insert into public.bank_accounts(tenant_id,company_id,branch_id,name,active,account_type,is_system,opening_balance,notes)
    values(p_tenant,p_company,p_branch,'Caixa Interno',true,'internal_cash',true,0,'Conta sistêmica que consolida receitas e despesas em dinheiro.') returning id into v_id;
  end if;
  return v_id;
end $$;

insert into public.bank_accounts(tenant_id,company_id,branch_id,name,active,account_type,is_system,opening_balance,notes)
select c.tenant_id,c.id,(select b.id from public.branches b where b.company_id=c.id order by b.is_headquarters desc,b.created_at limit 1),'Caixa Interno',true,'internal_cash',true,0,'Conta sistêmica que consolida receitas e despesas em dinheiro.'
from public.companies c
where not exists(select 1 from public.bank_accounts ba where ba.tenant_id=c.tenant_id and ba.company_id=c.id and ba.account_type='internal_cash' and ba.is_system=true);

create or replace function private.customer_store_credit_balance(p_tenant uuid,p_customer uuid)
returns numeric language sql stable security definer set search_path=public,private as $$
  select coalesce(sum(case
    when entry_type='credit' and source_kind in ('sale_return','payment_reversal') then amount
    when entry_type='debit' and source_kind in ('sale_payment','financial_settlement') then -amount
    else 0 end),0)::numeric(15,2)
  from public.customer_store_credit_ledger
  where tenant_id=p_tenant and customer_id=p_customer
$$;

create or replace function private.bank_ledger_from_cash_payment()
returns trigger language plpgsql security definer set search_path=public,private,extensions as $$
declare s public.sales%rowtype; v_account uuid;
begin
  if new.sale_id is null or new.method<>'cash' then return new; end if;
  select * into s from public.sales where id=new.sale_id;
  if s.id is null then return new; end if;
  v_account:=private.ensure_internal_cash_account(new.tenant_id,s.company_id,s.branch_id);
  if new.status in ('paid','authorized') and (tg_op='INSERT' or old.status not in ('paid','authorized')) then
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes)
    values(new.tenant_id,v_account,coalesce(new.paid_at,s.completed_at,s.created_at,now())::date,'Venda em dinheiro #'||coalesce(s.number::text,s.id::text),new.amount,'credit',true,null,s.cash_session_id,'cash','sale_payment',new.id,'Gerado automaticamente pelo pagamento da venda.') on conflict do nothing;
  end if;
  if tg_op='UPDATE' and old.status in ('paid','authorized') and new.status in ('cancelled','refunded') then
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes)
    values(new.tenant_id,v_account,current_date,'Estorno de venda em dinheiro #'||coalesce(s.number::text,s.id::text),old.amount,'debit',true,null,s.cash_session_id,'cash','sale_payment_reversal',new.id,'Gerado automaticamente pelo estorno do pagamento da venda.') on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_bank_ledger_cash_payment on public.payments;
create trigger trg_bank_ledger_cash_payment after insert or update of status,method on public.payments for each row execute function private.bank_ledger_from_cash_payment();

create or replace function private.bank_ledger_from_cash_movement()
returns trigger language plpgsql security definer set search_path=public,private,extensions as $$
declare cs public.cash_sessions%rowtype; pr public.pos_registers%rowtype; br public.branches%rowtype; v_account uuid; v_dir text;
begin
  if new.financial_entry_id is not null then return new; end if;
  if new.movement_type not in ('expense','refund','receivable') then return new; end if;
  select * into cs from public.cash_sessions where id=new.cash_session_id;
  if cs.id is null then return new; end if;
  select * into pr from public.pos_registers where id=cs.pos_register_id;
  if pr.id is null then return new; end if;
  select * into br from public.branches where id=pr.branch_id;
  if br.id is null then return new; end if;
  v_account:=private.ensure_internal_cash_account(new.tenant_id,br.company_id,br.id);
  v_dir:=case when new.movement_type='receivable' then 'credit' else 'debit' end;
  insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes)
  values(new.tenant_id,v_account,new.created_at::date,case new.movement_type when 'expense' then 'Despesa em dinheiro' when 'refund' then 'Devolução em dinheiro' else 'Recebimento em dinheiro' end,new.amount,v_dir,true,null,new.cash_session_id,coalesce(new.payment_method,'cash'),'cash_movement',new.id,new.notes) on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_bank_ledger_cash_movement on public.cash_movements;
create trigger trg_bank_ledger_cash_movement after insert on public.cash_movements for each row execute function private.bank_ledger_from_cash_movement();

insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,cash_session_id,payment_method,origin_type,origin_id,notes)
select p.tenant_id,ba.id,coalesce(p.paid_at,s.completed_at,s.created_at,now())::date,'Venda em dinheiro #'||coalesce(s.number::text,s.id::text),p.amount,'credit',true,s.cash_session_id,'cash','sale_payment',p.id,'Histórico migrado automaticamente.'
from public.payments p join public.sales s on s.id=p.sale_id join public.bank_accounts ba on ba.tenant_id=p.tenant_id and ba.company_id=s.company_id and ba.account_type='internal_cash' and ba.is_system=true
where p.method='cash' and p.status in ('paid','authorized') and s.status<>'cancelled' on conflict do nothing;

insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,cash_session_id,payment_method,origin_type,origin_id,notes)
select cm.tenant_id,ba.id,cm.created_at::date,case cm.movement_type when 'expense' then 'Despesa em dinheiro' else 'Devolução em dinheiro' end,cm.amount,'debit',true,cm.cash_session_id,'cash','cash_movement',cm.id,cm.notes
from public.cash_movements cm join public.cash_sessions cs on cs.id=cm.cash_session_id join public.pos_registers pr on pr.id=cs.pos_register_id join public.branches br on br.id=pr.branch_id join public.bank_accounts ba on ba.tenant_id=cm.tenant_id and ba.company_id=br.company_id and ba.account_type='internal_cash' and ba.is_system=true
where cm.movement_type in ('expense','refund') and cm.financial_entry_id is null on conflict do nothing;

create or replace function public.erp_financial_accounts_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_accounts jsonb; v_transactions jsonb; v_cash jsonb; v_methods jsonb; v_summary jsonb;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_internal_cash_account(v.tenant_id,v.company_id,v.branch_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_system desc,x.name),'[]'::jsonb) into v_accounts from (
    select ba.id,ba.name,ba.bank_code,ba.agency,ba.account_number,ba.active,ba.account_type,ba.is_system,ba.opening_balance,ba.notes,ba.opening_balance+coalesce(sum(case when bt.direction='credit' then bt.amount else -bt.amount end),0) balance,coalesce(sum(bt.amount) filter(where bt.direction='credit'),0) credits,coalesce(sum(bt.amount) filter(where bt.direction='debit'),0) debits
    from public.bank_accounts ba left join public.bank_transactions bt on bt.bank_account_id=ba.id where ba.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) group by ba.id
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.transaction_date desc,x.created_at desc),'[]'::jsonb) into v_transactions from (
    select bt.id,bt.bank_account_id,ba.name account,ba.account_type,bt.transaction_date,bt.description,bt.amount,bt.direction,bt.external_id,bt.reconciled,bt.payment_method,bt.origin_type,bt.financial_entry_id,bt.cash_session_id,bt.transfer_group_id,bt.notes,bt.created_at,case when bt.direction='credit' then bt.amount else -bt.amount end signed_amount
    from public.bank_transactions bt join public.bank_accounts ba on ba.id=bt.bank_account_id where bt.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) order by bt.transaction_date desc,bt.created_at desc limit 500
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb) into v_cash from (
    select cs.id,cs.opened_at,cs.opening_amount,pr.name pos,pr.code pos_code,b.name branch,su.name operator,
      cs.opening_amount+coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash'),0)+coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('supply','receivable')),0)-coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria','expense','refund')),0) expected_cash
    from public.cash_sessions cs join public.pos_registers pr on pr.id=cs.pos_register_id join public.branches b on b.id=pr.branch_id left join public.staff_users su on su.id=cs.staff_user_id where cs.tenant_id=v.tenant_id and cs.status='open'
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('code',m.code,'name',m.name,'category',m.category,'supports_card',m.supports_card,'supports_installments',m.supports_installments) order by m.sort_order),'[]'::jsonb) into v_methods from public.sales_payment_methods m where m.tenant_id=v.tenant_id and m.company_id=v.company_id and m.active=true and m.code<>'term_sale';
  select jsonb_build_object('total_balance',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)),0),'internal_cash',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)) filter(where ba.account_type='internal_cash'),0),'bank_balance',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)) filter(where ba.account_type='bank'),0),'credits_today',coalesce(sum(tx.credits_today),0),'debits_today',coalesce(sum(tx.debits_today),0)) into v_summary
  from public.bank_accounts ba left join lateral (select coalesce(sum(case when direction='credit' then amount else -amount end),0) net,coalesce(sum(amount) filter(where direction='credit' and transaction_date=current_date),0) credits_today,coalesce(sum(amount) filter(where direction='debit' and transaction_date=current_date),0) debits_today from public.bank_transactions bt where bt.bank_account_id=ba.id) tx on true
  where ba.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) and ba.active=true;
  return jsonb_build_object('ok',true,'accounts',v_accounts,'transactions',v_transactions,'cash_sessions',v_cash,'payment_methods',v_methods,'summary',v_summary);
end $$;

create or replace function public.erp_bank_account_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_id uuid:=nullif(p_payload->>'id','')::uuid; v_existing public.bank_accounts%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_id is null then
    if nullif(trim(p_payload->>'name'),'') is null then return jsonb_build_object('ok',false,'error','account_name_required'); end if;
    insert into public.bank_accounts(tenant_id,company_id,branch_id,name,bank_code,agency,account_number,active,account_type,is_system,opening_balance,notes)
    values(v.tenant_id,v.company_id,v.branch_id,trim(p_payload->>'name'),nullif(trim(p_payload->>'bank_code'),''),nullif(trim(p_payload->>'agency'),''),nullif(trim(p_payload->>'account_number'),''),coalesce((p_payload->>'active')::boolean,true),'bank',false,coalesce(nullif(p_payload->>'opening_balance','')::numeric,0),nullif(trim(p_payload->>'notes'),'')) returning id into v_id;
  else
    select * into v_existing from public.bank_accounts where id=v_id and tenant_id=v.tenant_id for update;
    if v_existing.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
    if v_existing.is_system then return jsonb_build_object('ok',false,'error','system_account_is_read_only'); end if;
    update public.bank_accounts set name=coalesce(nullif(trim(p_payload->>'name'),''),name),bank_code=coalesce(nullif(trim(p_payload->>'bank_code'),''),bank_code),agency=coalesce(nullif(trim(p_payload->>'agency'),''),agency),account_number=coalesce(nullif(trim(p_payload->>'account_number'),''),account_number),active=coalesce((p_payload->>'active')::boolean,active),notes=coalesce(p_payload->>'notes',notes),updated_at=now() where id=v_id;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.erp_bank_transaction_add(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_id uuid; v_account uuid:=nullif(p_payload->>'bank_account_id','')::uuid; v_direction text:=coalesce(nullif(p_payload->>'direction',''),'credit'); v_amount numeric:=abs(coalesce(nullif(p_payload->>'amount','')::numeric,0));
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_amount'); end if;
  if v_direction not in ('credit','debit') then return jsonb_build_object('ok',false,'error','invalid_direction'); end if;
  if not exists(select 1 from public.bank_accounts where id=v_account and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
  insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,external_id,reconciled,payment_method,origin_type,notes)
  values(v.tenant_id,v_account,coalesce(nullif(p_payload->>'transaction_date','')::date,current_date),coalesce(nullif(trim(p_payload->>'description'),''),'Lançamento manual'),v_amount,v_direction,nullif(trim(p_payload->>'external_id'),''),coalesce((p_payload->>'reconciled')::boolean,false),nullif(p_payload->>'payment_method',''),'manual',nullif(trim(p_payload->>'notes'),'')) returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.erp_bank_account_transfer(p_token text,p_source uuid,p_destination uuid,p_amount numeric,p_description text default null,p_transaction_date date default null)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_group uuid:=gen_random_uuid(); v_amount numeric:=abs(coalesce(p_amount,0)); v_src_balance numeric;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_source is null or p_destination is null or p_source=p_destination then return jsonb_build_object('ok',false,'error','invalid_transfer_accounts'); end if;
  if v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_amount'); end if;
  if not exists(select 1 from public.bank_accounts where id=p_source and tenant_id=v.tenant_id and active=true) or not exists(select 1 from public.bank_accounts where id=p_destination and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
  select ba.opening_balance+coalesce(sum(case when bt.direction='credit' then bt.amount else -bt.amount end),0) into v_src_balance from public.bank_accounts ba left join public.bank_transactions bt on bt.bank_account_id=ba.id where ba.id=p_source group by ba.id;
  if coalesce(v_src_balance,0)+0.001<v_amount then return jsonb_build_object('ok',false,'error','insufficient_account_balance','available',coalesce(v_src_balance,0)); end if;
  insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,transfer_group_id,origin_type,origin_id,notes) values(v.tenant_id,p_source,coalesce(p_transaction_date,current_date),coalesce(nullif(trim(p_description),''),'Transferência entre contas'),v_amount,'debit',true,v_group,'transfer_out',v_group,'Transferência interna');
  insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,transfer_group_id,origin_type,origin_id,notes) values(v.tenant_id,p_destination,coalesce(p_transaction_date,current_date),coalesce(nullif(trim(p_description),''),'Transferência entre contas'),v_amount,'credit',true,v_group,'transfer_in',v_group,'Transferência interna');
  return jsonb_build_object('ok',true,'transfer_group_id',v_group,'amount',v_amount);
end $$;

create or replace function public.erp_financial_settle(p_token text,p_entry_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; fe public.financial_entries%rowtype; ba public.bank_accounts%rowtype; cs public.cash_sessions%rowtype; v_remaining numeric; v_amount numeric; v_method text:=nullif(p_payload->>'payment_method',''); v_destination text:=nullif(p_payload->>'destination_type',''); v_account uuid:=nullif(p_payload->>'bank_account_id','')::uuid; v_cash uuid:=nullif(p_payload->>'cash_session_id','')::uuid; v_settlement uuid:=gen_random_uuid(); v_bank_tx uuid; v_internal uuid; v_cm uuid; v_settled_at timestamptz:=coalesce(nullif(p_payload->>'settled_at','')::timestamptz,now()); v_balance numeric;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into fe from public.financial_entries where id=p_entry_id and tenant_id=v.tenant_id for update;
  if fe.id is null or fe.status='cancelled' then return jsonb_build_object('ok',false,'error','financial_entry_not_found'); end if;
  v_remaining:=greatest(fe.amount-fe.paid_amount,0); v_amount:=coalesce(nullif(p_payload->>'amount','')::numeric,v_remaining);
  if v_amount<=0 or v_amount>v_remaining+0.001 then return jsonb_build_object('ok',false,'error','invalid_settlement_amount','remaining',v_remaining); end if;
  if v_method is null or v_method='term_sale' or not exists(select 1 from public.sales_payment_methods m where m.tenant_id=v.tenant_id and m.company_id=fe.company_id and m.code=v_method and m.active=true) then return jsonb_build_object('ok',false,'error','invalid_payment_method'); end if;
  if v_method='store_credit' then
    if fe.entry_type<>'receivable' or fe.customer_id is null then return jsonb_build_object('ok',false,'error','store_credit_requires_customer'); end if;
    perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':'||fe.customer_id::text)); v_balance:=private.customer_store_credit_balance(v.tenant_id,fe.customer_id);
    if v_balance+0.001<v_amount then return jsonb_build_object('ok',false,'error','insufficient_store_credit','available',v_balance); end if; v_destination:='store_credit';
  elsif v_destination='cash_session' then
    if v_method<>'cash' then return jsonb_build_object('ok',false,'error','cash_session_requires_cash_payment'); end if;
    select * into cs from public.cash_sessions where id=v_cash and tenant_id=v.tenant_id and status='open' for update; if cs.id is null then return jsonb_build_object('ok',false,'error','cash_not_open'); end if;
  elsif v_destination='bank_account' then
    select * into ba from public.bank_accounts where id=v_account and tenant_id=v.tenant_id and active=true for update; if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
    if ba.account_type='internal_cash' and v_method<>'cash' then return jsonb_build_object('ok',false,'error','internal_cash_requires_cash_payment'); end if;
  else return jsonb_build_object('ok',false,'error','destination_required'); end if;
  insert into public.financial_settlements(id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,bank_account_id,cash_session_id,notes,metadata)
  values(v_settlement,v.tenant_id,fe.company_id,fe.branch_id,fe.id,v_amount,v_settled_at,v_method,v_destination,case when v_destination='bank_account' then v_account else null end,case when v_destination='cash_session' then v_cash else null end,nullif(trim(p_payload->>'notes'),''),jsonb_build_object('entry_type',fe.entry_type,'document_type',fe.document_type));
  if v_method='store_credit' then
    insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(v.tenant_id,fe.company_id,fe.branch_id,fe.customer_id,'debit',v_amount,'financial_settlement',v_settlement,fe.sale_id,'Uso de crédito da loja na quitação de '||fe.description,jsonb_build_object('financial_entry_id',fe.id)) on conflict(tenant_id,source_kind,source_id) do nothing;
  elsif v_destination='cash_session' then
    insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,notes,financial_entry_id,payment_method) values(v.tenant_id,v_cash,case when fe.entry_type='receivable' then 'receivable' else 'expense' end,v_amount,'Liquidação financeira: '||fe.description,fe.id,'cash') returning id into v_cm;
    v_internal:=private.ensure_internal_cash_account(v.tenant_id,fe.company_id,fe.branch_id);
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,cash_session_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,v_internal,v_settled_at::date,fe.description,v_amount,case when fe.entry_type='receivable' then 'credit' else 'debit' end,true,fe.id,v_cash,'cash','financial_settlement',v_settlement,'Liquidação vinculada ao caixa do dia.') returning id into v_bank_tx;
  else
    insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,reconciled,financial_entry_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,v_account,v_settled_at::date,fe.description,v_amount,case when fe.entry_type='receivable' then 'credit' else 'debit' end,true,fe.id,v_method,'financial_settlement',v_settlement,'Liquidação vinculada diretamente ao título financeiro.') returning id into v_bank_tx;
  end if;
  update public.financial_settlements set bank_transaction_id=v_bank_tx where id=v_settlement;
  update public.financial_entries set paid_amount=least(amount,paid_amount+v_amount),status=case when paid_amount+v_amount>=amount-0.001 then 'paid' else 'partial' end,paid_at=case when paid_amount+v_amount>=amount-0.001 then v_settled_at else paid_at end,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method',v_method,'last_destination_type',v_destination,'last_settlement_id',v_settlement) where id=fe.id;
  return jsonb_build_object('ok',true,'settlement_id',v_settlement,'amount',v_amount,'remaining',greatest(v_remaining-v_amount,0),'status',case when v_remaining-v_amount<=0.001 then 'paid' else 'partial' end,'bank_transaction_id',v_bank_tx);
end $$;

create or replace function public.erp_receivables_list(p_token text,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record; v_data jsonb; v_issued_from date:=nullif(p_filters->>'issued_from','')::date; v_issued_to date:=nullif(p_filters->>'issued_to','')::date; v_doc text:=nullif(lower(trim(p_filters->>'document_type')),''); v_customer uuid:=nullif(p_filters->>'customer_id','')::uuid; v_due_from date:=nullif(p_filters->>'due_from','')::date; v_due_to date:=nullif(p_filters->>'due_to','')::date; v_paid_from date:=nullif(p_filters->>'paid_from','')::date; v_paid_to date:=nullif(p_filters->>'paid_to','')::date;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.issued_at desc,x.due_date desc nulls last,x.created_at desc),'[]'::jsonb) into v_data from (
    select f.id,f.issued_at,f.document_type,f.status,f.description,f.amount,f.paid_amount,greatest(f.amount-f.paid_amount,0) remaining,f.due_date,f.paid_at,f.customer_id,c.name customer,f.sale_id,f.created_at,nullif(f.metadata->>'installment','')::int installment,nullif(f.metadata->>'installments','')::int installments,case when f.customer_id is not null then private.customer_store_credit_balance(f.tenant_id,f.customer_id) else 0 end store_credit_balance,coalesce((select count(*) from public.financial_settlements fs where fs.financial_entry_id=f.id),0) settlements_count,(select fs.payment_method from public.financial_settlements fs where fs.financial_entry_id=f.id order by fs.settled_at desc limit 1) last_payment_method,(select fs.destination_type from public.financial_settlements fs where fs.financial_entry_id=f.id order by fs.settled_at desc limit 1) last_destination_type
    from public.financial_entries f left join public.customers c on c.id=f.customer_id where f.tenant_id=v.tenant_id and f.entry_type='receivable' and (v_issued_from is null or f.issued_at>=v_issued_from) and (v_issued_to is null or f.issued_at<=v_issued_to) and (v_doc is null or lower(f.document_type)=v_doc) and (v_customer is null or f.customer_id=v_customer) and (v_due_from is null or f.due_date>=v_due_from) and (v_due_to is null or f.due_date<=v_due_to) and (v_paid_from is null or f.paid_at::date>=v_paid_from) and (v_paid_to is null or f.paid_at::date<=v_paid_to) limit 1000
  ) x;
  return jsonb_build_object('ok',true,'data',v_data);
end $$;

create or replace function public.erp_reconciliation_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_accounts jsonb;v_transactions jsonb;v_entries jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if; perform private.ensure_internal_cash_account(v.tenant_id,v.company_id,v.branch_id);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.is_system desc,x.name),'[]'::jsonb) into v_accounts from (select ba.id,ba.name,ba.bank_code,ba.agency,ba.account_number,ba.active,ba.account_type,ba.is_system,ba.opening_balance,ba.opening_balance+coalesce(sum(case when bt.direction='credit' then bt.amount else -bt.amount end),0) balance from public.bank_accounts ba left join public.bank_transactions bt on bt.bank_account_id=ba.id where ba.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) group by ba.id) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.transaction_date desc,x.created_at desc),'[]'::jsonb) into v_transactions from (select bt.id,bt.bank_account_id,ba.name account,ba.account_type,bt.transaction_date,bt.description,bt.amount,bt.direction,bt.external_id,bt.reconciled,bt.payment_method,bt.origin_type,coalesce((select sum(rm.matched_amount) from public.reconciliation_matches rm where rm.bank_transaction_id=bt.id),0) matched,bt.created_at from public.bank_transactions bt join public.bank_accounts ba on ba.id=bt.bank_account_id where bt.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) limit 500) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date),'[]'::jsonb) into v_entries from (select f.id,f.entry_type,f.description,f.amount,f.paid_amount,(f.amount-f.paid_amount) remaining,f.due_date,f.status,coalesce(c.name,s.name) party from public.financial_entries f left join public.customers c on c.id=f.customer_id left join public.suppliers s on s.id=f.supplier_id where f.tenant_id=v.tenant_id and f.status not in('paid','cancelled') order by f.due_date limit 500) x;
 return jsonb_build_object('ok',true,'accounts',v_accounts,'transactions',v_transactions,'entries',v_entries);
end $$;

create or replace function public.erp_cash_close(p_token text,p_cash_id uuid,p_closing numeric,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_expected numeric;v_diff numeric;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  select cs.opening_amount+coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash'),0)+coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('supply','receivable')),0)-coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria','expense','refund')),0) into v_expected from public.cash_sessions cs where cs.id=p_cash_id and cs.tenant_id=v.tenant_id and cs.status='open' for update;
  if v_expected is null then return jsonb_build_object('ok',false,'error','cash_not_open');end if;v_diff:=p_closing-v_expected;
  update public.cash_sessions set status='closed',closing_amount=p_closing,closed_at=now(),notes=concat_ws(E'\n',p_notes,'Esperado: '||v_expected::text,'Diferença: '||v_diff::text) where id=p_cash_id;
  return jsonb_build_object('ok',true,'expected',v_expected,'closing',p_closing,'difference',v_diff);
end $$;

create or replace function public.erp_cash_management_close(p_token text,p_cash_id uuid,p_closing numeric,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_cs public.cash_sessions%rowtype;v_expected numeric;v_diff numeric;v_email text;v_cash numeric;v_supply numeric;v_receivable numeric;v_withdrawal numeric;v_expense numeric;v_refund numeric;
begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if; if p_closing is null or p_closing<0 then return jsonb_build_object('ok',false,'error','invalid_closing_amount');end if;
  select * into v_cs from public.cash_sessions where id=p_cash_id and tenant_id=v.tenant_id for update;if v_cs.id is null or v_cs.status<>'open' then return jsonb_build_object('ok',false,'error','cash_not_open');end if; select email into v_email from private.temp_users where id=v.user_id;
  select coalesce(sum(p.amount),0) into v_cash from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=p_cash_id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash';
  select coalesce(sum(amount) filter(where movement_type='supply'),0),coalesce(sum(amount) filter(where movement_type='receivable'),0),coalesce(sum(amount) filter(where movement_type in ('withdrawal','sangria')),0),coalesce(sum(amount) filter(where movement_type='expense'),0),coalesce(sum(amount) filter(where movement_type='refund'),0) into v_supply,v_receivable,v_withdrawal,v_expense,v_refund from public.cash_movements where cash_session_id=p_cash_id;
  v_expected:=v_cs.opening_amount+v_cash+v_supply+v_receivable-v_withdrawal-v_expense-v_refund;v_diff:=p_closing-v_expected;
  insert into public.cash_session_audit(tenant_id,cash_session_id,action,previous_status,new_status,previous_closing_amount,new_closing_amount,previous_closed_at,new_closed_at,expected_cash,reason,actor_user_id,actor_email) values(v.tenant_id,p_cash_id,'management_close',v_cs.status,'closed',v_cs.closing_amount,p_closing,v_cs.closed_at,now(),v_expected,p_notes,v.user_id,v_email);
  update public.cash_sessions set status='closed',closing_amount=p_closing,closed_at=now(),notes=concat_ws(E'\n',notes,p_notes,'Fechado pelo Gestão. Esperado: '||v_expected::text||' Diferença: '||v_diff::text) where id=p_cash_id;
  return jsonb_build_object('ok',true,'expected',v_expected,'closing',p_closing,'difference',v_diff);
end $$;
