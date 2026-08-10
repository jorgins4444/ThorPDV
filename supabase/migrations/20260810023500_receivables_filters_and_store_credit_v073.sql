alter table public.financial_entries add column if not exists issued_at date;
alter table public.financial_entries add column if not exists document_type text;

update public.financial_entries f
set issued_at=coalesce(f.issued_at,coalesce((select coalesce(s.completed_at,s.created_at)::date from public.sales s where s.id=f.sale_id),f.created_at::date)),
    document_type=coalesce(nullif(f.document_type,''),
      case
        when f.metadata->>'term_method'='boleto' then 'boleto'
        when f.metadata->>'term_method'='crediario' then 'crediario'
        when f.metadata->>'origin'='sale_term' then coalesce(nullif(f.metadata->>'term_method',''),'crediario')
        when f.metadata->>'origin'='pdv_desktop_return' then 'devolucao'
        when f.sale_id is not null and f.entry_type='receivable' then 'venda'
        else 'manual'
      end)
where f.issued_at is null or f.document_type is null or f.document_type='';

alter table public.financial_entries alter column issued_at set default current_date;
alter table public.financial_entries alter column issued_at set not null;
alter table public.financial_entries alter column document_type set default 'manual';
alter table public.financial_entries alter column document_type set not null;

create index if not exists idx_financial_entries_receivable_filters
on public.financial_entries(tenant_id,entry_type,issued_at,document_type,customer_id,due_date,paid_at,status);

create or replace function private.financial_entry_defaults_v073()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $$
begin
  if new.issued_at is null then
    if new.sale_id is not null then
      select coalesce(s.completed_at,s.created_at)::date into new.issued_at from public.sales s where s.id=new.sale_id;
    end if;
    new.issued_at:=coalesce(new.issued_at,current_date);
  end if;
  if nullif(new.document_type,'') is null then
    new.document_type:=case
      when new.metadata->>'term_method'='boleto' then 'boleto'
      when new.metadata->>'term_method'='crediario' then 'crediario'
      when new.metadata->>'origin'='sale_term' then coalesce(nullif(new.metadata->>'term_method',''),'crediario')
      when new.metadata->>'origin'='pdv_desktop_return' then 'devolucao'
      when new.sale_id is not null and new.entry_type='receivable' then 'venda'
      else 'manual'
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_financial_entry_defaults_v073 on public.financial_entries;
create trigger trg_financial_entry_defaults_v073
before insert or update on public.financial_entries
for each row execute function private.financial_entry_defaults_v073();

create or replace function private.customer_store_credit_balance(p_tenant uuid,p_customer uuid)
returns numeric
language sql
stable security definer
set search_path='public','private'
as $$
  select coalesce(sum(case
    when entry_type='credit' and source_kind in ('sale_return','payment_reversal') then amount
    when entry_type='debit' and source_kind='sale_payment' then -amount
    else 0 end),0)::numeric(15,2)
  from public.customer_store_credit_ledger
  where tenant_id=p_tenant and customer_id=p_customer
$$;

create or replace function public.erp_receivables_list(p_token text,p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record;
  v_data jsonb;
  v_issued_from date:=nullif(p_filters->>'issued_from','')::date;
  v_issued_to date:=nullif(p_filters->>'issued_to','')::date;
  v_doc text:=nullif(lower(trim(p_filters->>'document_type')),'');
  v_customer uuid:=nullif(p_filters->>'customer_id','')::uuid;
  v_due_from date:=nullif(p_filters->>'due_from','')::date;
  v_due_to date:=nullif(p_filters->>'due_to','')::date;
  v_paid_from date:=nullif(p_filters->>'paid_from','')::date;
  v_paid_to date:=nullif(p_filters->>'paid_to','')::date;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.issued_at desc,x.due_date desc nulls last,x.created_at desc),'[]'::jsonb)
  into v_data
  from (
    select f.id,f.issued_at,f.document_type,f.status,f.description,f.amount,f.paid_amount,
           f.due_date,f.paid_at,f.customer_id,c.name customer,f.sale_id,f.created_at,
           nullif(f.metadata->>'installment','')::int installment,
           nullif(f.metadata->>'installments','')::int installments
    from public.financial_entries f
    left join public.customers c on c.id=f.customer_id
    where f.tenant_id=v.tenant_id and f.entry_type='receivable'
      and (v_issued_from is null or f.issued_at>=v_issued_from)
      and (v_issued_to is null or f.issued_at<=v_issued_to)
      and (v_doc is null or lower(f.document_type)=v_doc)
      and (v_customer is null or f.customer_id=v_customer)
      and (v_due_from is null or f.due_date>=v_due_from)
      and (v_due_to is null or f.due_date<=v_due_to)
      and (v_paid_from is null or f.paid_at::date>=v_paid_from)
      and (v_paid_to is null or f.paid_at::date<=v_paid_to)
    limit 1000
  ) x;

  return jsonb_build_object('ok',true,'data',v_data);
end $$;

grant execute on function public.erp_receivables_list(text,jsonb) to anon,authenticated,service_role;
