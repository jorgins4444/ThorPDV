-- Etapas 1/2: recibos vinculados à NF-e e cadastro transacional de lotes.
create table if not exists public.purchase_lot_receipts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete cascade,
 purchase_id uuid not null references public.purchases(id) on delete cascade,
 purchase_item_id uuid not null references public.purchase_items(id) on delete cascade,
 lot_id uuid not null references public.product_expiry_lots(id) on delete restrict,
 received_quantity numeric(15,4) not null check(received_quantity>0),
 created_at timestamptz not null default now(),
 unique(purchase_item_id,lot_id)
);
create index if not exists purchase_lot_receipts_purchase_idx on public.purchase_lot_receipts(tenant_id,purchase_id);
create index if not exists purchase_lot_receipts_lot_idx on public.purchase_lot_receipts(lot_id);
alter table public.purchase_lot_receipts enable row level security;
revoke all on public.purchase_lot_receipts from anon,authenticated;

create or replace function public.erp_purchase_xml_import_with_lots(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path=public,private,extensions
set timezone='America/Fortaleza'
as $$
declare
 v record; v_result jsonb; v_entries jsonb:=coalesce(p_payload->'lot_entries','[]'::jsonb);
 v_purchase uuid; v_entry jsonb; v_source_no int; v_pi record;
 v_lot text; v_expiry date; v_quantity numeric(15,4); v_lot_id uuid;
 v_added int:=0;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 if jsonb_typeof(v_entries)<>'array' then return jsonb_build_object('ok',false,'error','invalid_lot_entries'); end if;
 if jsonb_array_length(v_entries)>0 and not private.management_has_permission(p_token,'stock.adjust') then
  return jsonb_build_object('ok',false,'error','permission_denied');
 end if;
 -- A NF-e e todos os lotes são confirmados numa única transação.
 -- Qualquer falha na vinculação reverte a entrada, estoque e financeiro.
 begin
  v_result:=public.erp_purchase_xml_import(p_token,p_payload);
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
  v_purchase:=(v_result->>'purchase_id')::uuid;
  if v_purchase is null then raise exception 'missing_purchase_id'; end if;
  for v_entry in select value from jsonb_array_elements(v_entries) loop
   v_source_no:=nullif(v_entry->>'source_item_no','')::integer;
   v_lot:=btrim(coalesce(v_entry->>'lot_number',''));
   v_expiry:=nullif(v_entry->>'expiry_date','')::date;
   v_quantity:=nullif(v_entry->>'quantity','')::numeric;
   if v_source_no is null or v_lot='' or length(v_lot)>100 or v_expiry is null or v_quantity is null or v_quantity<=0
   then raise exception 'invalid_lot_fields'; end if;
   select pi.id,pi.product_id,pi.quantity into v_pi
   from public.purchase_items pi where pi.tenant_id=v.tenant_id and pi.purchase_id=v_purchase
   and pi.source_item_no=v_source_no;
   if v_pi.id is null then raise exception 'purchase_item_not_found'; end if;
   if (select coalesce(sum(received_quantity),0) from public.purchase_lot_receipts where purchase_item_id=v_pi.id)+v_quantity>v_pi.quantity+0.0001
   then raise exception 'lot_quantity_exceeds_purchase_item'; end if;
   insert into public.product_expiry_lots(tenant_id,branch_id,product_id,lot_number,expiry_date,quantity)
   values(v.tenant_id,v.branch_id,v_pi.product_id,v_lot,v_expiry,v_quantity)
   on conflict(branch_id,product_id,lot_number,expiry_date)
   do update set quantity=public.product_expiry_lots.quantity+excluded.quantity,updated_at=now()
   returning id into v_lot_id;
   insert into public.purchase_lot_receipts(tenant_id,branch_id,purchase_id,purchase_item_id,lot_id,received_quantity)
   values(v.tenant_id,v.branch_id,v_purchase,v_pi.id,v_lot_id,v_quantity)
   on conflict(purchase_item_id,lot_id)
   do update set received_quantity=public.purchase_lot_receipts.received_quantity+excluded.received_quantity;
   v_added:=v_added+1;
  end loop;
  return v_result||jsonb_build_object('lots_registered',v_added);
 exception when others then
  return jsonb_build_object('ok',false,'error','purchase_lot_import_failed','detail',sqlerrm);
 end;
end $$;
revoke all on function public.erp_purchase_xml_import_with_lots(text,jsonb) from public;
grant execute on function public.erp_purchase_xml_import_with_lots(text,jsonb) to anon,authenticated,service_role;
