-- ThorPDV 0.8.22 / Venda a Prazo v102
-- A quantidade selecionada no PDV passa a ser a quantidade efetivamente
-- gerada no Contas a Receber, respeitando o limite máximo do ThorGestão.

create or replace function private.create_term_receivables(
  p_sale_id uuid,
  p_customer_id uuid,
  p_paid numeric,
  p_term jsonb,
  p_sales_order_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  s public.sales%rowtype;
  cfg public.sales_payment_terms%rowtype;
  v_method text;
  v_count int;
  v_max_count int;
  v_first int;
  v_interval int;
  v_rate numeric;
  v_principal numeric;
  v_interest numeric;
  v_financed numeric;
  v_base_due date;
  v_each numeric;
  v_amount numeric;
  v_inserted numeric:=0;
  i int;
begin
  select * into s from public.sales where id=p_sale_id for update;
  if s.id is null then raise exception 'sale_not_found'; end if;
  if p_customer_id is null then raise exception 'term_sale_requires_customer'; end if;
  if coalesce(p_term->>'payment_term_id','')='' then raise exception 'payment_term_required'; end if;

  select * into cfg from public.sales_payment_terms
  where id=(p_term->>'payment_term_id')::uuid
    and tenant_id=s.tenant_id and company_id=s.company_id and active=true;
  if cfg.id is null then raise exception 'payment_term_not_found_or_inactive'; end if;

  v_method:=cfg.method;
  v_max_count:=cfg.installment_count;
  v_count:=coalesce(nullif(p_term->>'installments','')::int,v_max_count);
  v_first:=cfg.first_due_days;
  v_interval:=cfg.interval_days;
  v_rate:=greatest(cfg.interest_percent,0);

  if v_method not in ('boleto','crediario') then raise exception 'invalid_term_method'; end if;
  if v_max_count<1 or v_max_count>60 then raise exception 'invalid_installment_count'; end if;
  if v_count<1 or v_count>v_max_count then raise exception 'term_installment_exceeds_config'; end if;
  if v_first<0 or v_first>3650 or v_interval<1 or v_interval>365 then raise exception 'invalid_term_schedule'; end if;

  v_principal:=greatest(round((s.total-coalesce(p_paid,0))::numeric,2),0);
  if v_principal<=0 then raise exception 'term_sale_has_no_financed_balance'; end if;
  v_interest:=round(v_principal*v_rate/100,2);
  v_financed:=v_principal+v_interest;
  v_each:=round(v_financed/v_count,2);
  v_base_due:=coalesce(s.completed_at,s.created_at,now())::date;

  delete from public.financial_entries where sale_id=s.id and entry_type='receivable';
  for i in 1..v_count loop
    v_amount:=case when i=v_count then round(v_financed-v_inserted,2) else v_each end;
    insert into public.financial_entries(
      tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,customer_id,sale_id,metadata
    ) values(
      s.tenant_id,s.company_id,s.branch_id,'receivable','open',
      'Venda a prazo '||s.number||' - parcela '||i||'/'||v_count,
      v_amount,0,v_base_due+v_first+((i-1)*v_interval),p_customer_id,s.id,
      jsonb_build_object(
        'origin','sale_term',
        'term_method',v_method,
        'installment',i,
        'installments',v_count,
        'configured_installment_limit',v_max_count,
        'interest_percent',v_rate,
        'principal_total',v_principal,
        'interest_total',v_interest,
        'sales_order_id',p_sales_order_id,
        'payment_term_id',cfg.id
      )
    );
    v_inserted:=v_inserted+v_amount;
  end loop;

  update public.sales set
    payment_condition='term',
    term_method=v_method,
    payment_term_id=cfg.id,
    term_installments=v_count,
    term_interest_percent=v_rate,
    term_principal_amount=v_principal,
    term_interest_amount=v_interest,
    term_total_amount=v_financed,
    sales_order_id=coalesce(p_sales_order_id,sales_order_id)
  where id=s.id;

  return jsonb_build_object(
    'method',v_method,
    'installments',v_count,
    'configured_installment_limit',v_max_count,
    'principal',v_principal,
    'interest',v_interest,
    'financed_total',v_financed,
    'first_due_days',v_first,
    'interval_days',v_interval,
    'payment_term_id',cfg.id
  );
end
$$;
