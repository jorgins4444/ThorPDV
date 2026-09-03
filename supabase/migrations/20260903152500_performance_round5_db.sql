-- Quinta rodada de performance do ThorGestão.
-- Foco: joins mais frequentes do dashboard/estoque/fiscal e remoção de
-- avaliações RLS duplicadas, sem alterar as regras de acesso.

-- Dashboard e vendas: evita varreduras repetidas de itens/pagamentos quando
-- as tabelas crescerem e dá ao planner caminhos por tenant/filial/período.
create index if not exists sale_items_sale_id_idx
  on public.sale_items (sale_id);

create index if not exists sale_items_product_id_idx
  on public.sale_items (product_id);

create index if not exists payments_sale_id_idx
  on public.payments (sale_id);

create index if not exists payments_tenant_sale_status_method_idx
  on public.payments (tenant_id, sale_id, status, method);

create index if not exists sales_dashboard_tenant_completed_idx
  on public.sales (tenant_id, completed_at desc)
  where status in ('completed','paid','fiscalized');

create index if not exists sales_dashboard_tenant_branch_completed_idx
  on public.sales (tenant_id, branch_id, completed_at desc)
  where status in ('completed','paid','fiscalized');

create index if not exists sale_returns_tenant_created_idx
  on public.sale_returns (tenant_id, created_at desc, sale_id);

create index if not exists cash_movements_tenant_created_session_idx
  on public.cash_movements (tenant_id, created_at desc, cash_session_id);

-- Catálogo/precificação: cobre as FKs usadas nos joins de código de barras e
-- tabelas de preço, complementando os índices de busca criados na rodada 4.
create index if not exists product_barcodes_product_id_idx
  on public.product_barcodes (product_id);

create index if not exists price_table_items_product_id_idx
  on public.price_table_items (product_id);

-- Fiscal: cobre o resumo por período/filial e acelera a descoberta do último
-- número emitido por série. O índice parcial evita converter números inválidos.
create index if not exists fiscal_documents_tenant_branch_created_idx
  on public.fiscal_documents (tenant_id, branch_id, created_at desc);

create index if not exists fiscal_documents_tenant_created_status_idx
  on public.fiscal_documents (tenant_id, created_at desc, status);

create index if not exists fiscal_documents_series_number_idx
  on public.fiscal_documents
     (tenant_id, branch_id, document_type, series, ((number)::bigint) desc)
  where number ~ '^[0-9]+$';

-- O getter fiscal chama ensure_fiscal_defaults. Antes, cada simples leitura
-- executava dezenas de INSERT ... ON CONFLICT para os CFOPs e reescrevia as
-- séries mesmo quando nada havia mudado. Mantemos a auto-recuperação, porém
-- só gravamos quando o estado realmente precisa ser criado/atualizado.
create or replace function private.ensure_fiscal_defaults(
  p_tenant uuid,
  p_company uuid,
  p_branch uuid
)
returns void
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_fs public.fiscal_settings%rowtype;
  v_nfe integer := 1;
  v_nfce integer := 1;
  v_last bigint;
begin
  select * into v_fs
  from public.fiscal_settings
  where tenant_id = p_tenant;

  if coalesce(v_fs.nfe_series,'') ~ '^[0-9]+$' then
    v_nfe := greatest(1, least(999, v_fs.nfe_series::integer));
  end if;
  if coalesce(v_fs.nfce_series,'') ~ '^[0-9]+$' then
    v_nfce := greatest(1, least(999, v_fs.nfce_series::integer));
  end if;

  select coalesce(max(number::bigint),0)
    into v_last
  from public.fiscal_documents
  where tenant_id = p_tenant
    and branch_id = p_branch
    and document_type = 'nfe'
    and series = v_nfe::text
    and number ~ '^[0-9]+$';

  insert into public.fiscal_series(
    tenant_id,company_id,branch_id,document_type,series,label,last_number,is_default,active
  )
  values(
    p_tenant,p_company,p_branch,'nfe',v_nfe,'NF-e Série '||v_nfe,v_last,
    not exists(
      select 1 from public.fiscal_series
      where tenant_id=p_tenant and branch_id=p_branch
        and document_type='nfe' and is_default and active
    ),
    true
  )
  on conflict(tenant_id,branch_id,document_type,series) do nothing;

  update public.fiscal_series
     set last_number = v_last,
         updated_at = now()
   where tenant_id = p_tenant
     and branch_id = p_branch
     and document_type = 'nfe'
     and series = v_nfe::text
     and last_number < v_last;

  select coalesce(max(number::bigint),0)
    into v_last
  from public.fiscal_documents
  where tenant_id = p_tenant
    and branch_id = p_branch
    and document_type = 'nfce'
    and series = v_nfce::text
    and number ~ '^[0-9]+$';

  insert into public.fiscal_series(
    tenant_id,company_id,branch_id,document_type,series,label,last_number,is_default,active
  )
  values(
    p_tenant,p_company,p_branch,'nfce',v_nfce,'NFC-e Série '||v_nfce,v_last,
    not exists(
      select 1 from public.fiscal_series
      where tenant_id=p_tenant and branch_id=p_branch
        and document_type='nfce' and is_default and active
    ),
    true
  )
  on conflict(tenant_id,branch_id,document_type,series) do nothing;

  update public.fiscal_series
     set last_number = v_last,
         updated_at = now()
   where tenant_id = p_tenant
     and branch_id = p_branch
     and document_type = 'nfce'
     and series = v_nfce::text
     and last_number < v_last;

  insert into public.fiscal_danfe_settings(tenant_id,company_id,branch_id)
  values(p_tenant,p_company,p_branch)
  on conflict(tenant_id,branch_id) do nothing;

  -- Os CFOPs-padrão são imutáveis para o fluxo normal. Não faz sentido testar
  -- 41 conflitos em toda abertura de aba fiscal.
  if not exists(
    select 1 from public.fiscal_cfops where tenant_id = p_tenant limit 1
  ) then
    perform private.ensure_default_cfops(p_tenant);
  end if;
end
$function$;

-- Estas políticas eram pares literalmente idênticos (mesmos papéis, comando,
-- USING e WITH CHECK). Mantemos tenant_access e removemos apenas a cópia.
drop policy if exists tenant_access_pos_registers on public.pos_registers;
drop policy if exists tenant_access_price_tables on public.price_tables;
drop policy if exists tenant_access_product_classes on public.product_classes;
drop policy if exists tenant_access_product_groups on public.product_groups;
drop policy if exists tenant_access_product_modifiers on public.product_modifiers;
drop policy if exists tenant_access_promotions on public.promotions;
drop policy if exists tenant_access_support_tickets on public.support_tickets;
