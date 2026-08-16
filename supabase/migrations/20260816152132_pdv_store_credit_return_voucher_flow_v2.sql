alter table public.sale_returns add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.sale_returns add column if not exists guest_name text;
alter table public.sale_returns add column if not exists guest_document text;
alter table public.sale_returns add column if not exists voucher_id uuid;

create table if not exists public.store_credit_vouchers(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,company_id uuid references public.companies(id) on delete set null,branch_id uuid references public.branches(id) on delete set null,
  voucher_number text not null,original_amount numeric(15,2) not null check(original_amount>0),used_amount numeric(15,2) not null default 0 check(used_amount>=0),status text not null default 'active' check(status in ('active','redeemed','cancelled')),
  guest_name text,guest_document text,source_return_id uuid unique references public.sale_returns(id) on delete restrict,issued_at timestamptz not null default now(),updated_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,
  unique(tenant_id,voucher_number),check(used_amount<=original_amount+0.001)
);
create index if not exists idx_store_credit_vouchers_active on public.store_credit_vouchers(tenant_id,status,voucher_number);

create table if not exists public.store_credit_voucher_movements(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,voucher_id uuid not null references public.store_credit_vouchers(id) on delete cascade,
  entry_type text not null check(entry_type in ('issue','debit','reversal','cancel')),amount numeric(15,2) not null check(amount>0),source_kind text not null,source_id uuid not null,sale_id uuid references public.sales(id) on delete set null,
  notes text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(voucher_id,source_kind,source_id)
);

create or replace function private.store_credit_on_return() returns trigger language plpgsql security definer set search_path='public','private' as $$
declare s public.sales%rowtype; beneficiary uuid;
begin
 if new.status='completed' and new.refund_method='store_credit' and new.total>0 then
  select * into s from public.sales where id=new.sale_id; beneficiary:=coalesce(new.customer_id,s.customer_id);
  if beneficiary is not null then
   insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,return_id,notes,metadata)
   values(new.tenant_id,s.company_id,s.branch_id,beneficiary,'credit',new.total,'sale_return',new.id,s.id,new.id,'Crédito gerado por devolução da venda '||coalesce(s.number::text,s.id::text),jsonb_build_object('refund_method','store_credit','beneficiary_customer_id',beneficiary))
   on conflict(tenant_id,source_kind,source_id) do nothing;
   update public.customers set updated_at=now() where id=beneficiary;
  end if;
 end if; return new;
end $$;

create or replace function private.store_credit_voucher_payment_guard() returns trigger language plpgsql security definer set search_path='public','private' as $$
declare v public.store_credit_vouchers%rowtype; n text; remaining numeric;
begin
 if new.method<>'store_credit_voucher' then return new; end if;
 n:=upper(trim(coalesce(new.metadata->>'voucher_number',''))); if n='' then raise exception 'store_credit_voucher_number_required'; end if;
 select * into v from public.store_credit_vouchers where tenant_id=new.tenant_id and upper(voucher_number)=n for update;
 if v.id is null then raise exception 'store_credit_voucher_not_found'; end if; if v.status<>'active' then raise exception 'store_credit_voucher_not_active'; end if;
 remaining:=greatest(v.original_amount-v.used_amount,0); if new.amount<=0 or new.amount>remaining+0.001 then raise exception 'insufficient_store_credit_voucher'; end if;
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('voucher_id',v.id,'voucher_number',v.voucher_number,'voucher_balance_before',remaining); return new;
end $$;

create or replace function private.store_credit_voucher_payment_apply() returns trigger language plpgsql security definer set search_path='public','private' as $$
declare v public.store_credit_vouchers%rowtype; vid uuid; exists_move boolean;
begin
 if tg_op='INSERT' and new.method='store_credit_voucher' and new.status in ('paid','authorized') then
  vid:=nullif(new.metadata->>'voucher_id','')::uuid; if vid is null then return new; end if;
  select * into v from public.store_credit_vouchers where id=vid and tenant_id=new.tenant_id for update;
  select exists(select 1 from public.store_credit_voucher_movements where voucher_id=vid and source_kind='sale_payment' and source_id=new.id) into exists_move;
  if not exists_move then
   update public.store_credit_vouchers set used_amount=least(original_amount,used_amount+new.amount),status=case when used_amount+new.amount>=original_amount-0.001 then 'redeemed' else 'active' end,updated_at=now() where id=vid;
   insert into public.store_credit_voucher_movements(tenant_id,voucher_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(new.tenant_id,vid,'debit',new.amount,'sale_payment',new.id,new.sale_id,'Uso do Vale Crédito em venda',jsonb_build_object('payment_id',new.id));
  end if;
 elsif tg_op='UPDATE' and old.method='store_credit_voucher' and old.status in ('paid','authorized') and new.status in ('cancelled','refunded') then
  vid:=nullif(old.metadata->>'voucher_id','')::uuid; if vid is null then return new; end if;
  select exists(select 1 from public.store_credit_voucher_movements where voucher_id=vid and source_kind='payment_reversal' and source_id=new.id) into exists_move;
  if not exists_move then
   update public.store_credit_vouchers set used_amount=greatest(used_amount-old.amount,0),status='active',updated_at=now() where id=vid;
   insert into public.store_credit_voucher_movements(tenant_id,voucher_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(new.tenant_id,vid,'reversal',old.amount,'payment_reversal',new.id,new.sale_id,'Estorno de uso do Vale Crédito',jsonb_build_object('new_status',new.status));
  end if;
 end if; return new;
end $$;

drop trigger if exists payments_store_credit_voucher_guard on public.payments;
create trigger payments_store_credit_voucher_guard before insert on public.payments for each row execute function private.store_credit_voucher_payment_guard();
drop trigger if exists payments_store_credit_voucher_apply on public.payments;
create trigger payments_store_credit_voucher_apply after insert or update of status on public.payments for each row execute function private.store_credit_voucher_payment_apply();

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check(method=any(array['cash'::text,'pix'::text,'credit_card'::text,'debit_card'::text,'voucher'::text,'store_credit'::text,'store_credit_voucher'::text,'other'::text]));

create or replace function private.pdv_process_return(p_device_id uuid,p_tenant_id uuid,p_company_id uuid,p_branch_id uuid,p_pos_register_id uuid,p_event_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare
 v_return uuid; v_sale public.sales%rowtype; v_item jsonb; v_sale_item public.sale_items%rowtype; v_qty numeric; v_returned numeric; v_remaining numeric; v_unit_net numeric; v_line numeric; v_total numeric:=0;
 v_method text:=coalesce(nullif(p_payload->>'refund_method',''),'store_credit'); v_has_authorized_fiscal boolean:=false; v_operator uuid; v_supervisor uuid; v_prod_mode text;
 v_customer uuid; v_customer_row public.customers%rowtype; v_guest_name text; v_guest_document text; v_voucher_number text; v_voucher uuid;
begin
 select id into v_return from public.sale_returns where pdv_device_id=p_device_id and client_event_id=p_event_id limit 1;
 if v_return is not null then return (select jsonb_build_object('ok',true,'return_id',sr.id,'sale_id',sr.sale_id,'total',sr.total,'status',sr.status,'refund_method',sr.refund_method,'customer_id',sr.customer_id,'voucher_id',sr.voucher_id,'idempotent',true) from public.sale_returns sr where sr.id=v_return); end if;
 v_operator:=nullif(p_payload->>'operator_user_id','')::uuid; v_supervisor:=nullif(p_payload#>>'{supervisor_authorization,supervisor_user_id}','')::uuid;
 if v_operator is null then return jsonb_build_object('ok',false,'error','operator_required'); end if;
 if not private.pdv_action_allowed(p_tenant_id,p_branch_id,v_operator,'sale.return',v_supervisor) then return jsonb_build_object('ok',false,'error','return_not_authorized'); end if;
 if v_method<>'store_credit' then return jsonb_build_object('ok',false,'error','return_only_store_credit_allowed'); end if;
 if nullif(p_payload->>'sale_id','') is not null then select * into v_sale from public.sales where id=(p_payload->>'sale_id')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id;
 elsif nullif(p_payload->>'sale_client_event_id','') is not null then select * into v_sale from public.sales where pdv_device_id=p_device_id and client_event_id=(p_payload->>'sale_client_event_id')::uuid and tenant_id=p_tenant_id; end if;
 if v_sale.id is null then return jsonb_build_object('ok',false,'error','sale_not_found'); end if; if v_sale.status<>'completed' then return jsonb_build_object('ok',false,'error','sale_not_completed'); end if;
 if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','return_without_items'); end if;
 v_customer:=coalesce(v_sale.customer_id,nullif(p_payload->>'return_customer_id','')::uuid);
 if v_customer is not null then select * into v_customer_row from public.customers where id=v_customer and tenant_id=p_tenant_id and active=true; if v_customer_row.id is null then return jsonb_build_object('ok',false,'error','return_customer_not_found'); end if;
 else v_guest_name:=nullif(trim(p_payload->>'guest_name'),''); v_guest_document:=nullif(regexp_replace(coalesce(p_payload->>'guest_document',''),'\D','','g'),''); v_voucher_number:=upper(nullif(trim(p_payload->>'voucher_number'),'')); if v_voucher_number is null then return jsonb_build_object('ok',false,'error','store_credit_voucher_number_required'); end if; if v_guest_name is null and v_guest_document is null then return jsonb_build_object('ok',false,'error','return_customer_identification_required'); end if; end if;
 insert into public.sale_returns(tenant_id,sale_id,pdv_device_id,client_event_id,status,reason,refund_method,total,operator_user_id,supervisor_user_id,customer_id,guest_name,guest_document)
 values(p_tenant_id,v_sale.id,p_device_id,p_event_id,'completed',nullif(trim(p_payload->>'reason'),''),'store_credit',0,v_operator,v_supervisor,v_customer,v_guest_name,v_guest_document) returning id into v_return;
 for v_item in select * from jsonb_array_elements(p_payload->'items') loop
  if nullif(v_item->>'sale_item_id','') is not null then select * into v_sale_item from public.sale_items where id=(v_item->>'sale_item_id')::uuid and sale_id=v_sale.id and tenant_id=p_tenant_id; else select * into v_sale_item from public.sale_items where sale_id=v_sale.id and product_id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id order by created_at limit 1; end if;
  if v_sale_item.id is null then raise exception 'sale_item_not_found'; end if; v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0); if v_qty<=0 then raise exception 'invalid_return_quantity'; end if;
  select coalesce(sum(sri.quantity),0) into v_returned from public.sale_return_items sri join public.sale_returns sr on sr.id=sri.return_id where sri.sale_item_id=v_sale_item.id and sr.status='completed'; v_remaining:=v_sale_item.quantity-v_returned; if v_qty>v_remaining+0.0001 then raise exception 'return_quantity_exceeds_remaining'; end if;
  v_unit_net:=case when v_sale_item.quantity=0 then 0 else v_sale_item.total/v_sale_item.quantity end; v_line:=round(v_qty*v_unit_net,2); v_total:=v_total+v_line;
  insert into public.sale_return_items(tenant_id,return_id,sale_item_id,product_id,quantity,unit_price,total) values(p_tenant_id,v_return,v_sale_item.id,v_sale_item.product_id,v_qty,v_unit_net,v_line);
  if v_sale_item.product_id is not null then select production_mode into v_prod_mode from public.products where id=v_sale_item.product_id; if coalesce(v_prod_mode,'stock')<>'on_demand' then insert into public.stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,reference_type,reference_id,notes) values(p_tenant_id,p_branch_id,v_sale_item.product_id,'sale_return',abs(v_qty),'sale_return',v_return,'Devolução da venda '||v_sale.number); insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity,updated_at) values(p_tenant_id,p_branch_id,v_sale_item.product_id,abs(v_qty),0,now()) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now(); end if; end if;
 end loop;
 update public.sale_returns set total=v_total where id=v_return;
 if v_customer is null and v_total>0 then
  insert into public.store_credit_vouchers(tenant_id,company_id,branch_id,voucher_number,original_amount,used_amount,status,guest_name,guest_document,source_return_id,metadata) values(p_tenant_id,p_company_id,p_branch_id,v_voucher_number,v_total,0,'active',v_guest_name,v_guest_document,v_return,jsonb_build_object('sale_id',v_sale.id,'sale_number',v_sale.number,'device_id',p_device_id,'event_id',p_event_id)) returning id into v_voucher;
  insert into public.store_credit_voucher_movements(tenant_id,voucher_id,entry_type,amount,source_kind,source_id,notes,metadata) values(p_tenant_id,v_voucher,'issue',v_total,'sale_return',v_return,'Vale Crédito emitido por devolução da venda '||v_sale.number,jsonb_build_object('sale_id',v_sale.id)); update public.sale_returns set voucher_id=v_voucher where id=v_return;
 end if;
 insert into public.financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,paid_at,customer_id,sale_id,metadata) values(p_tenant_id,p_company_id,p_branch_id,'payable','paid','Devolução venda '||v_sale.number,v_total,v_total,current_date,now(),v_customer,v_sale.id,jsonb_build_object('origin','pdv_desktop_return','return_id',v_return,'refund_method','store_credit','voucher_id',v_voucher,'operator_user_id',v_operator,'supervisor_user_id',v_supervisor));
 select exists(select 1 from public.fiscal_documents where sale_id=v_sale.id and status='authorized') into v_has_authorized_fiscal;
 if v_has_authorized_fiscal then insert into public.fiscal_documents(tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,provider,request_payload) select p_tenant_id,p_company_id,p_branch_id,v_sale.id,'nfe',coalesce(fs.environment,'homologation'),'draft',coalesce(fs.nfe_series,'1'),fs.provider,jsonb_build_object('operation','sale_return','return_id',v_return,'source','pdv_desktop','requires_fiscal_review',true) from (select 1) x left join public.fiscal_settings fs on fs.tenant_id=p_tenant_id; end if;
 if v_supervisor is not null then insert into public.supervisor_authorizations(tenant_id,branch_id,pdv_device_id,sale_id,operator_user_id,supervisor_user_id,action,requested_value,reason,client_event_id,metadata) values(p_tenant_id,p_branch_id,p_device_id,v_sale.id,v_operator,v_supervisor,'return',v_total,nullif(p_payload->>'reason',''),p_event_id,jsonb_build_object('return_id',v_return)); end if;
 return jsonb_build_object('ok',true,'return_id',v_return,'sale_id',v_sale.id,'sale_number',v_sale.number,'total',v_total,'refund_method','store_credit','financial_status','paid','customer_id',v_customer,'customer_name',v_customer_row.name,'voucher_id',v_voucher,'voucher_number',v_voucher_number,'guest_name',v_guest_name,'guest_document',v_guest_document,'fiscal_followup_required',v_has_authorized_fiscal,'operator_user_id',v_operator,'supervisor_user_id',v_supervisor);
exception when others then if v_return is not null then delete from public.sale_returns where id=v_return; end if; return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

do $$ declare d text; begin
 select pg_get_functiondef('private.pdv_process_sale_legacy_v070(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into d;
 if position('store_credit_voucher' in d)=0 then d:=replace(d,$old$array['cash','pix','credit_card','debit_card','voucher','store_credit','other']$old$,$new$array['cash','pix','credit_card','debit_card','voucher','store_credit','store_credit_voucher','other']$new$); execute d; end if;
end $$;

do $$ declare d text; begin
 select pg_get_functiondef('public.pdv_pull(text,timestamp with time zone)'::regprocedure) into d;
 if position('v_vouchers jsonb' in d)=0 then
  d:=replace(d,'v_paycfg jsonb;','v_paycfg jsonb; v_vouchers jsonb;');
  d:=replace(d,$old$'updated_at',c.updated_at) order by c.name)$old$,$new$'updated_at',c.updated_at,'store_credit_balance',private.customer_store_credit_balance(c.tenant_id,c.id)) order by c.name)$new$);
  d:=replace(d,$old$ return jsonb_build_object('ok',true,'server_time',now()$old$,$new$ select coalesce(jsonb_agg(jsonb_build_object('id',sv.id,'voucher_number',sv.voucher_number,'original_amount',sv.original_amount,'used_amount',sv.used_amount,'remaining',greatest(sv.original_amount-sv.used_amount,0),'status',sv.status,'guest_name',sv.guest_name,'guest_document',sv.guest_document,'issued_at',sv.issued_at,'updated_at',sv.updated_at) order by sv.issued_at desc),'[]'::jsonb) into v_vouchers from public.store_credit_vouchers sv where sv.tenant_id=v.tenant_id and sv.company_id=v.company_id and sv.status='active' and sv.original_amount-sv.used_amount>0.001; return jsonb_build_object('ok',true,'server_time',now()$new$);
  d:=replace(d,$old$'payment_integrations',v_paycfg,'sales_history',v_sales$old$,$new$'payment_integrations',v_paycfg,'store_credit_vouchers',v_vouchers,'sales_history',v_sales$new$);
  execute d;
 end if;
end $$;
