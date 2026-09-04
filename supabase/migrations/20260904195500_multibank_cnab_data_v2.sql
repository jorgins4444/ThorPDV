create or replace function public.erp_cnab_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare v record; accounts jsonb; configs jsonb; receivables jsonb; remittances jsonb; returns jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into accounts
  from (
    select b.id,b.name,b.bank_code,b.agency,b.agency_digit,b.account_number,b.account_digit,b.wallet,
      b.agreement,b.beneficiary_code,b.default_layout,b.active
    from public.bank_accounts b
    where b.tenant_id=v.tenant_id and b.account_type='bank' and b.active=true
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.account_name,x.layout),'[]'::jsonb) into configs
  from (
    select c.*,b.name account_name,b.agency_digit,b.agreement,b.beneficiary_code,b.default_layout,
      case c.bank_code when '341' then 'Itaú' when '237' then 'Bradesco' when '001' then 'Banco do Brasil' when '104' then 'CAIXA' when '033' then 'Santander' else coalesce(c.settings->>'bank_name','Banco '||c.bank_code) end bank_name
    from public.bank_cnab_configs c
    join public.bank_accounts b on b.id=c.bank_account_id
    where c.tenant_id=v.tenant_id and c.company_id=v.company_id
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date,x.created_at),'[]'::jsonb) into receivables
  from (
    select f.id,f.description,f.amount,f.paid_amount,greatest(f.amount-f.paid_amount,0) remaining,
      f.due_date,f.issued_at,f.status,f.customer_id,c.name customer,c.document,c.street,c.number,
      c.complement,c.district,c.city,c.state,c.postal_code,f.created_at,
      exists(select 1 from public.bank_cnab_remittance_items ri where ri.tenant_id=v.tenant_id and ri.financial_entry_id=f.id and ri.status not in ('rejected','cancelled')) remitted,
      case
        when c.id is null then 'Cliente não encontrado'
        when length(regexp_replace(coalesce(c.document,''),'\D','','g')) not in (11,14) then 'CPF/CNPJ do cliente inválido'
        when nullif(trim(coalesce(c.name,'')),'') is null then 'Nome do cliente ausente'
        when nullif(trim(coalesce(c.street,'')),'') is null then 'Endereço do cliente ausente'
        when nullif(trim(coalesce(c.district,'')),'') is null then 'Bairro do cliente ausente'
        when nullif(trim(coalesce(c.city,'')),'') is null then 'Cidade do cliente ausente'
        when length(trim(coalesce(c.state,'')))<>2 then 'UF do cliente inválida'
        when length(regexp_replace(coalesce(c.postal_code,''),'\D','','g'))<>8 then 'CEP do cliente inválido'
        else null end validation_error
    from public.financial_entries f
    left join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id
    where f.tenant_id=v.tenant_id and f.company_id=v.company_id
      and f.entry_type='receivable' and f.status in ('open','partial','overdue')
      and greatest(f.amount-f.paid_amount,0)>0
      and lower(coalesce(nullif(f.metadata->>'term_method',''),f.document_type,'')) in ('boleto','bank_slip')
    limit 1000
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.generated_at desc),'[]'::jsonb) into remittances
  from (
    select rf.id,rf.config_id,rf.bank_account_id,b.name account,c.bank_code,
      case c.bank_code when '341' then 'Itaú' when '237' then 'Bradesco' when '001' then 'Banco do Brasil' when '104' then 'CAIXA' when '033' then 'Santander' else 'Banco '||c.bank_code end bank_name,
      rf.layout,rf.file_sequence,rf.file_name,rf.status,rf.record_count,rf.total_amount,rf.generated_at,rf.sent_at
    from public.bank_cnab_remittance_files rf
    join public.bank_accounts b on b.id=rf.bank_account_id
    join public.bank_cnab_configs c on c.id=rf.config_id
    where rf.tenant_id=v.tenant_id and rf.company_id=v.company_id
    order by rf.generated_at desc limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.imported_at desc),'[]'::jsonb) into returns
  from (
    select r.id,r.config_id,r.bank_account_id,b.name account,c.bank_code,
      case c.bank_code when '341' then 'Itaú' when '237' then 'Bradesco' when '001' then 'Banco do Brasil' when '104' then 'CAIXA' when '033' then 'Santander' else 'Banco '||c.bank_code end bank_name,
      r.layout,r.file_name,r.bank_file_sequence,r.generated_date,r.credit_date,r.status,r.record_count,r.processed_count,r.matched_count,r.paid_count,r.error_count,r.imported_at
    from public.bank_cnab_return_files r
    join public.bank_accounts b on b.id=r.bank_account_id
    join public.bank_cnab_configs c on c.id=r.config_id
    where r.tenant_id=v.tenant_id and r.company_id=v.company_id
    order by r.imported_at desc limit 100
  ) x;

  return jsonb_build_object('ok',true,'accounts',accounts,'configs',configs,'receivables',receivables,'remittances',remittances,'returns',returns,'layouts',jsonb_build_array('cnab400','cnab240'));
end $$;
