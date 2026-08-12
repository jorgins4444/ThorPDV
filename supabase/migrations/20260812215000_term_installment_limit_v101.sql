-- ThorPDV v0.8.21 / Venda a Prazo v101
-- O campo installment_count do plano é o limite máximo que o operador pode
-- selecionar no PDV. O cliente nunca deve conseguir financiar acima do limite
-- definido no ThorGestão, mesmo com payload adulterado.

create or replace function private.enforce_sale_term_installment_limit()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_max integer;
  v_active boolean;
begin
  if new.payment_term_id is null or new.term_installments is null then
    return new;
  end if;

  select t.installment_count, t.active
    into v_max, v_active
  from public.sales_payment_terms t
  where t.id = new.payment_term_id
    and t.tenant_id = new.tenant_id
  limit 1;

  if v_max is null or coalesce(v_active,false) is false then
    raise exception 'payment_term_not_available';
  end if;

  if new.term_installments < 1 or new.term_installments > v_max then
    raise exception 'term_installment_exceeds_config';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sales_term_installment_limit on public.sales;
create trigger trg_sales_term_installment_limit
before insert or update of payment_term_id, term_installments
on public.sales
for each row
execute function private.enforce_sale_term_installment_limit();
