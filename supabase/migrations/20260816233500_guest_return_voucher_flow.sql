-- Devoluções sem cliente cadastrado devem gerar Vale Crédito, não saldo em cadastro.
-- O crédito em customer_store_credit_ledger só é lançado quando há beneficiário customer_id.
create or replace function private.store_credit_on_return()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  s public.sales%rowtype;
  beneficiary uuid;
begin
  if new.status='completed' and new.refund_method='store_credit' and new.total>0 then
    select * into s from public.sales where id=new.sale_id;
    beneficiary:=coalesce(new.customer_id,s.customer_id);

    if beneficiary is not null then
      insert into public.customer_store_credit_ledger(
        tenant_id,company_id,branch_id,customer_id,entry_type,amount,
        source_kind,source_id,sale_id,return_id,notes,metadata
      ) values (
        new.tenant_id,s.company_id,s.branch_id,beneficiary,'credit',new.total,
        'sale_return',new.id,s.id,new.id,
        'Crédito gerado por devolução da venda '||coalesce(s.number::text,s.id::text),
        jsonb_build_object('refund_method','store_credit','beneficiary_customer_id',beneficiary)
      )
      on conflict(tenant_id,source_kind,source_id) do nothing;

      update public.customers set updated_at=now() where id=beneficiary;
    end if;
  end if;

  return new;
end
$function$;

comment on function private.store_credit_on_return() is
'Credita devolução no cadastro somente quando existe customer_id; devoluções de pessoa sem cadastro são materializadas por store_credit_vouchers.';
