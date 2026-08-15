create or replace function public.erp_cnab_boleto_get(p_token text,p_remittance_item uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare
  v record;
  r record;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select
    ri.id remittance_item_id,ri.remittance_id,ri.financial_entry_id,ri.customer_id,ri.our_number,ri.our_number_dac,
    ri.document_number,ri.amount,ri.due_date,ri.barcode,ri.digitable_line,ri.status item_status,
    cfg.id config_id,cfg.bank_code,cfg.layout,cfg.agency,cfg.account_number,cfg.account_digit,cfg.wallet,cfg.species,cfg.acceptance,cfg.settings,
    rf.file_name remittance_file_name,rf.generated_at remittance_generated_at,fe.description,fe.issued_at,
    coalesce(nullif(co.trade_name,''),co.legal_name) beneficiary_name,
    coalesce(br.cnpj,bh.cnpj,co.cnpj) beneficiary_document,
    coalesce(br.street,bh.street,'') beneficiary_street,coalesce(br.number,bh.number,'') beneficiary_number,
    coalesce(br.complement,bh.complement,'') beneficiary_complement,coalesce(br.district,bh.district,'') beneficiary_district,
    coalesce(br.city,bh.city,'') beneficiary_city,coalesce(br.state,bh.state,'') beneficiary_state,
    coalesce(br.postal_code,bh.postal_code,'') beneficiary_postal_code,
    cu.name payer_name,cu.document payer_document,cu.street payer_street,cu.number payer_number,cu.complement payer_complement,
    cu.district payer_district,cu.city payer_city,cu.state payer_state,cu.postal_code payer_postal_code,
    exists(select 1 from public.bank_file_homologations h where h.test_remittance_item_id=ri.id) is_homologation_test
  into r
  from public.bank_cnab_remittance_items ri
  join public.bank_cnab_configs cfg on cfg.id=ri.config_id and cfg.tenant_id=ri.tenant_id
  join public.bank_cnab_remittance_files rf on rf.id=ri.remittance_id and rf.tenant_id=ri.tenant_id
  join public.financial_entries fe on fe.id=ri.financial_entry_id and fe.tenant_id=ri.tenant_id
  join public.companies co on co.id=ri.company_id and co.tenant_id=ri.tenant_id
  left join public.customers cu on cu.id=ri.customer_id and cu.tenant_id=ri.tenant_id
  left join public.branches br on br.id=coalesce(ri.branch_id,fe.branch_id,cfg.branch_id) and br.tenant_id=ri.tenant_id
  left join lateral (
    select x.* from public.branches x
    where x.tenant_id=ri.tenant_id and x.company_id=ri.company_id
    order by x.is_headquarters desc,x.created_at asc limit 1
  ) bh on true
  where ri.id=p_remittance_item and ri.tenant_id=v.tenant_id and ri.company_id=v.company_id
  limit 1;

  if r.remittance_item_id is null then return jsonb_build_object('ok',false,'error','boleto_not_found'); end if;
  if r.bank_code<>'341' then return jsonb_build_object('ok',false,'error','boleto_bank_not_supported','bank_code',r.bank_code); end if;
  if length(regexp_replace(coalesce(r.barcode,''),'\D','','g'))<>44 then return jsonb_build_object('ok',false,'error','boleto_barcode_invalid'); end if;

  return jsonb_build_object(
    'ok',true,
    'bank',jsonb_build_object('code','341','code_dv','7','code_display','341-7','name','Banco Itaú','layout',r.layout),
    'beneficiary',jsonb_build_object(
      'name',r.beneficiary_name,'document',r.beneficiary_document,'agency',r.agency,'account_number',r.account_number,
      'account_digit',r.account_digit,'code_display',r.agency||'/'||r.account_number||'-'||r.account_digit,
      'street',r.beneficiary_street,'number',r.beneficiary_number,'complement',r.beneficiary_complement,
      'district',r.beneficiary_district,'city',r.beneficiary_city,'state',r.beneficiary_state,'postal_code',r.beneficiary_postal_code
    ),
    'payer',jsonb_build_object(
      'name',r.payer_name,'document',r.payer_document,'street',r.payer_street,'number',r.payer_number,'complement',r.payer_complement,
      'district',r.payer_district,'city',r.payer_city,'state',r.payer_state,'postal_code',r.payer_postal_code
    ),
    'title',jsonb_build_object(
      'remittance_item_id',r.remittance_item_id,'remittance_id',r.remittance_id,'remittance_file_name',r.remittance_file_name,
      'financial_entry_id',r.financial_entry_id,'description',r.description,'document_number',r.document_number,
      'document_date',r.issued_at,'processing_date',r.remittance_generated_at::date,'due_date',r.due_date,'amount',r.amount,
      'currency','R$','wallet',r.wallet,'species_code',r.species,
      'species_label',coalesce(nullif(r.settings->>'document_species_label',''),case when r.species='01' then 'DM' else r.species end),
      'acceptance',r.acceptance,'our_number',r.our_number,'our_number_dac',r.our_number_dac,
      'our_number_display',r.wallet||'/'||r.our_number||'-'||r.our_number_dac,
      'barcode',r.barcode,'digitable_line',r.digitable_line,'status',r.item_status,'is_homologation_test',r.is_homologation_test
    ),
    'print',jsonb_build_object(
      'local_payment',coalesce(nullif(r.settings->>'local_payment',''),'Pague pelo aplicativo, internet ou em agências e correspondentes.'),
      'instructions',case when jsonb_typeof(r.settings->'boleto_instructions')='array' then r.settings->'boleto_instructions' else '[]'::jsonb end,
      'demonstrative',coalesce(r.settings->>'boleto_demonstrative',''),
      'show_payer_receipt',coalesce((r.settings->>'show_payer_receipt')::boolean,true),'model','itau_standard_a4'
    )
  );
end $$;

revoke all on function public.erp_cnab_boleto_get(text,uuid) from public;
grant execute on function public.erp_cnab_boleto_get(text,uuid) to anon,authenticated;
