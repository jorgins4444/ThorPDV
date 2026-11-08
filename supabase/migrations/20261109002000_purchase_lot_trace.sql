-- Consulta de rastreabilidade: compras e NF-e que abasteceram cada lote.
create or replace function public.erp_purchase_lot_trace(p_token text)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
as $$
declare v record;v_data jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_data
 from (
  select l.id as lot_id,
  coalesce((
   select jsonb_agg(jsonb_build_object(
     'purchase_id',pu.id,'purchase_number',pu.number,
     'nfe_number',pu.document_number,'nfe_access_key',pu.nfe_access_key,
     'issue_date',pu.issue_date,'supplier',su.name,
     'source_item_no',pi.source_item_no,'received_quantity',plr.received_quantity
   ) order by pu.issue_date desc,pu.id)
   from public.purchase_lot_receipts plr
   join public.purchases pu on pu.id=plr.purchase_id and pu.tenant_id=v.tenant_id
   join public.purchase_items pi on pi.id=plr.purchase_item_id and pi.purchase_id=pu.id
   left join public.suppliers su on su.id=pu.supplier_id and su.tenant_id=v.tenant_id
   where plr.lot_id=l.id and plr.tenant_id=v.tenant_id and plr.branch_id=v.branch_id
  ),'[]'::jsonb) as purchases
  from public.product_expiry_lots l
  where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id
  order by l.created_at desc limit 2000
 ) x;
 return jsonb_build_object('ok',true,'traces',v_data);
end $$;
revoke all on function public.erp_purchase_lot_trace(text) from public;
grant execute on function public.erp_purchase_lot_trace(text) to anon,authenticated,service_role;
