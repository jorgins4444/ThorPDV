-- Complete FK indexes for the finance management structure.

create index if not exists purchase_items_tenant_id_idx on public.purchase_items (tenant_id);
create index if not exists cost_centers_company_id_idx on public.cost_centers (company_id);
create index if not exists financial_categories_company_id_idx on public.financial_categories (company_id);
create index if not exists financial_chart_accounts_company_id_idx on public.financial_chart_accounts (company_id);
create index if not exists financial_settlements_bank_transaction_id_idx on public.financial_settlements (bank_transaction_id) where bank_transaction_id is not null;
create index if not exists financial_settlements_reversal_bank_transaction_id_idx on public.financial_settlements (reversal_bank_transaction_id) where reversal_bank_transaction_id is not null;
