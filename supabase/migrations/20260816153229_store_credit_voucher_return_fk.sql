do $$ begin
  if not exists(select 1 from pg_constraint where conname='sale_returns_voucher_id_fkey') then
    alter table public.sale_returns
      add constraint sale_returns_voucher_id_fkey
      foreign key(voucher_id) references public.store_credit_vouchers(id) on delete set null;
  end if;
end $$;
