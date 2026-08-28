-- Targeted finance/purchase indexes and safe profiles RLS optimization.

create index if not exists financial_entries_purchase_id_idx on public.financial_entries (purchase_id) where purchase_id is not null;
create index if not exists financial_entries_customer_id_idx on public.financial_entries (customer_id) where customer_id is not null;
create index if not exists financial_entries_supplier_id_idx on public.financial_entries (supplier_id) where supplier_id is not null;
create index if not exists financial_entries_sale_id_idx on public.financial_entries (sale_id) where sale_id is not null;
create index if not exists financial_entries_branch_id_idx on public.financial_entries (branch_id);
create index if not exists financial_entries_company_id_idx on public.financial_entries (company_id);
create index if not exists purchases_supplier_id_idx on public.purchases (supplier_id);
create index if not exists purchases_branch_id_idx on public.purchases (branch_id);
create index if not exists purchases_company_id_idx on public.purchases (company_id);
create index if not exists purchase_items_product_id_idx on public.purchase_items (product_id);
create index if not exists financial_settlements_tenant_id_idx on public.financial_settlements (tenant_id);
create index if not exists financial_settlements_branch_id_idx on public.financial_settlements (branch_id);
create index if not exists financial_settlements_company_id_idx on public.financial_settlements (company_id);

alter policy profiles_select_own on public.profiles
  using (id = (select auth.uid()));

alter policy profiles_update_own on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
