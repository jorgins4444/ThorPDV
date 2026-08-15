create or replace function public.erp_cnab_remittance_boleto_items(p_token text,p_remittance uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare v record; rf public.bank_cnab_remittance_files%rowtype; items jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into rf from public.bank_cnab_remittance_files where id=p_remittance and tenant_id=v.tenant_id and company_id=v.company_id;
  if rf.id is null then return jsonb_build_object('ok',false,'error','remittance_not_found'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.line_number),'[]'::jsonb) into items
  from (
    select ri.id,ri.line_number,ri.financial_entry_id,ri.our_number,ri.our_number_dac,ri.document_number,ri.amount,ri.due_date,ri.status,
      c.name customer,c.document customer_document
    from public.bank_cnab_remittance_items ri
    left join public.customers c on c.id=ri.customer_id and c.tenant_id=ri.tenant_id
    where ri.remittance_id=rf.id and ri.tenant_id=v.tenant_id and ri.company_id=v.company_id
  ) x;
  return jsonb_build_object('ok',true,'remittance',jsonb_build_object('id',rf.id,'file_name',rf.file_name,'layout',rf.layout,'status',rf.status,'generated_at',rf.generated_at,'record_count',rf.record_count,'total_amount',rf.total_amount),'items',items);
end $$;
revoke all on function public.erp_cnab_remittance_boleto_items(text,uuid) from public;
grant execute on function public.erp_cnab_remittance_boleto_items(text,uuid) to anon,authenticated;
