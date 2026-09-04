create or replace function public.erp_financial_accounts_data(p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $$
declare v record; v_accounts jsonb; v_transactions jsonb; v_cash jsonb; v_methods jsonb; v_summary jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  perform private.ensure_internal_cash_account(v.tenant_id,v.company_id,v.branch_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_system desc,x.name),'[]'::jsonb) into v_accounts from (
    select ba.id,ba.name,ba.bank_code,ba.agency,ba.agency_digit,ba.account_number,ba.account_digit,
      ba.wallet,ba.agreement,ba.beneficiary_code,ba.default_layout,
      ba.active,ba.account_type,ba.is_system,ba.opening_balance,ba.notes,
      ba.opening_balance+coalesce(sum(case when bt.direction='credit' then bt.amount else -bt.amount end),0) balance,
      coalesce(sum(bt.amount) filter(where bt.direction='credit'),0) credits,
      coalesce(sum(bt.amount) filter(where bt.direction='debit'),0) debits
    from public.bank_accounts ba left join public.bank_transactions bt on bt.bank_account_id=ba.id
    where ba.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null)
    group by ba.id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.transaction_date desc,x.created_at desc),'[]'::jsonb) into v_transactions from (
    select bt.id,bt.bank_account_id,ba.name account,ba.account_type,bt.transaction_date,bt.description,bt.amount,bt.direction,bt.external_id,bt.reconciled,
      bt.payment_method,bt.origin_type,bt.financial_entry_id,bt.cash_session_id,bt.transfer_group_id,bt.notes,bt.created_at,
      case when bt.direction='credit' then bt.amount else -bt.amount end signed_amount
    from public.bank_transactions bt join public.bank_accounts ba on ba.id=bt.bank_account_id
    where bt.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null)
    order by bt.transaction_date desc,bt.created_at desc limit 500
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb) into v_cash from (
    select cs.id,cs.opened_at,cs.opening_amount,pr.name pos,pr.code pos_code,b.name branch,su.name operator,
      cs.opening_amount
      +coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash'),0)
      +coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('supply','receivable')),0)
      -coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria','expense','refund')),0) expected_cash
    from public.cash_sessions cs join public.pos_registers pr on pr.id=cs.pos_register_id join public.branches b on b.id=pr.branch_id left join public.staff_users su on su.id=cs.staff_user_id
    where cs.tenant_id=v.tenant_id and cs.status='open'
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('code',m.code,'name',m.name,'category',m.category,'supports_card',m.supports_card,'supports_installments',m.supports_installments) order by m.sort_order),'[]'::jsonb)
    into v_methods from public.sales_payment_methods m
   where m.tenant_id=v.tenant_id and m.company_id=v.company_id and m.active=true and m.code<>'term_sale';

  select jsonb_build_object(
    'total_balance',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)),0),
    'internal_cash',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)) filter(where ba.account_type='internal_cash'),0),
    'bank_balance',coalesce(sum(ba.opening_balance+coalesce(tx.net,0)) filter(where ba.account_type='bank'),0),
    'credits_today',coalesce(sum(tx.credits_today),0),
    'debits_today',coalesce(sum(tx.debits_today),0)
  ) into v_summary
  from public.bank_accounts ba
  left join lateral (
    select coalesce(sum(case when direction='credit' then amount else -amount end),0) net,
           coalesce(sum(amount) filter(where direction='credit' and transaction_date=current_date),0) credits_today,
           coalesce(sum(amount) filter(where direction='debit' and transaction_date=current_date),0) debits_today
    from public.bank_transactions bt where bt.bank_account_id=ba.id
  ) tx on true
  where ba.tenant_id=v.tenant_id and (ba.company_id=v.company_id or ba.company_id is null) and ba.active=true;

  return jsonb_build_object('ok',true,'accounts',v_accounts,'transactions',v_transactions,'cash_sessions',v_cash,'payment_methods',v_methods,'summary',v_summary);
end $$;
