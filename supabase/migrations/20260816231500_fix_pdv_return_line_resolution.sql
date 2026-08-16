create or replace function private.pdv_process_return(p_device_id uuid, p_tenant_id uuid, p_company_id uuid, p_branch_id uuid, p_pos_register_id uuid, p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
 v_return uuid; v_sale public.sales%rowtype; v_item jsonb; v_sale_item public.sale_items%rowtype; v_qty numeric; v_returned numeric; v_remaining numeric; v_unit_net numeric; v_line numeric; v_total numeric:=0;
 v_method text:=coalesce(nullif(p_payload->>'refund_method',''),'store_credit'); v_has_authorized_fiscal boolean:=false; v_operator uuid; v_supervisor uuid; v_prod_mode text;
 v_customer uuid; v_customer_row public.customers%rowtype; v_guest_name text; v_guest_document text; v_voucher_number text; v_voucher uuid;
 v_line_index integer; v_match_count integer;
begin
 select id into v_return from public.sale_returns where pdv_device_id=p_device_id and client_event_id=p_event_id limit 1;
 if v_return is not null then return (select jsonb_build_object('ok',true,'return_id',sr.id,'sale_id',sr.sale_id,'total',sr.total,'status',sr.status,'refund_method',sr.refund_method,'customer_id',sr.customer_id,'voucher_id',sr.voucher_id,'idempotent',true) from public.sale_returns sr where sr.id=v_return); end if;
 v_operator:=nullif(p_payload->>'operator_user_id','')::uuid; v_supervisor:=nullif(p_payload#>>'{supervisor_authorization,supervisor_user_id}','')::uuid;
 if v_operator is null then return jsonb_build_object('ok',false,'error','operator_required'); end if;
 if not private.pdv_action_allowed(p_tenant_id,p_branch_id,v_operator,'sale.return',v_supervisor) then return jsonb_build_object('ok',false,'error','return_not_authorized'); end if;
 if v_method<>'store_credit' then return jsonb_build_object('ok',false,'error','return_only_store_credit_allowed'); end if;
 if nullif(p_payload->>'sale_id','') is not null then select * into v_sale from public.sales where id=(p_payload->>'sale_id')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id;
 elsif nullif(p_payload->>'sale_client_event_id','') is not null then select * into v_sale from public.sales where pdv_device_id=p_device_id and client_event_id=(p_payload->>'sale_client_event_id')::uuid and tenant_id=p_tenant_id; end if;
 if v_sale.id is null then return jsonb_build_object('ok',false,'error','sale_not_found'); end if;
 if v_sale.status<>'completed' then return jsonb_build_object('ok',false,'error','sale_not_completed'); end if;
 if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then return jsonb_build_object('ok',false,'error','return_without_items'); end if;
 v_customer:=coalesce(v_sale.customer_id,nullif(p_payload->>'return_customer_id','')::uuid);
 if v_customer is not null then
  select * into v_customer_row from public.customers where id=v_customer and tenant_id=p_tenant_id and active=true;
  if v_customer_row.id is null then return jsonb_build_object('ok',false,'error','return_customer_not_found'); end if;
 else
  v_guest_name:=nullif(trim(p_payload->>'guest_name'),'');
  v_guest_document:=nullif(regexp_replace(coalesce(p_payload->>'guest_document',''),'\D','','g'),'');
  v_voucher_number:=upper(nullif(trim(p_payload->>'voucher_number'),''));
  if v_voucher_number is null then return jsonb_build_object('ok',false,'error','store_credit_voucher_number_required'); end if;
  if v_guest_name is null and v_guest_document is null then return jsonb_build_object('ok',false,'error','return_customer_identification_required'); end if;
 end if;
 insert into public.sale_returns(tenant_id,sale_id,pdv_device_id,client_event_id,status,reason,refund_method,total,operator_user_id,supervisor_user_id,customer_id,guest_name,guest_document)
 values(p_tenant_id,v_sale.id,p_device_id,p_event_id,'completed',nullif(trim(p_payload->>'reason'),''),'store_credit',0,v_operator,v_supervisor,v_customer,v_guest_name,v_guest_document) returning id into v_return;
 for v_item in select * from jsonb_array_elements(p_payload->'items') loop
  v_sale_item:=null;
  if nullif(v_item->>'sale_item_id','') is not null then
    select * into v_sale_item from public.sale_items where id=(v_item->>'sale_item_id')::uuid and sale_id=v_sale.id and tenant_id=p_tenant_id;
  elsif nullif(v_item->>'line_index','') is not null then
    v_line_index:=greatest((v_item->>'line_index')::integer,0);
    select * into v_sale_item from public.sale_items where sale_id=v_sale.id and tenant_id=p_tenant_id order by created_at,id offset v_line_index limit 1;
    if v_sale_item.id is not null and nullif(v_item->>'product_id','') is not null and v_sale_item.product_id is distinct from (v_item->>'product_id')::uuid then raise exception 'return_item_line_mismatch'; end if;
  else
    if nullif(v_item->>'product_id','') is null then raise exception 'sale_item_not_found'; end if;
    select count(*) into v_match_count from public.sale_items where sale_id=v_sale.id and product_id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id;
    if v_match_count>1 then raise exception 'return_item_ambiguous'; end if;
    select * into v_sale_item from public.sale_items where sale_id=v_sale.id and product_id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id order by created_at,id limit 1;
  end if;
  if v_sale_item.id is null then raise exception 'sale_item_not_found'; end if;
  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  if v_qty<=0 then raise exception 'invalid_return_quantity'; end if;
  select coalesce(sum(sri.quantity),0) into v_returned from public.sale_return_items sri join public.sale_returns sr on sr.id=sri.return_id where sri.sale_item_id=v_sale_item.id and sr.status='completed';
  v_remaining:=v_sale_item.quantity-v_returned;
  if v_qty>v_remaining+0.0001 then raise exception 'return_quantity_exceeds_remaining'; end if;
  v_unit_net:=case when v_sale_item.quantity=0 then 0 else v_sale_item.total/v_sale_item.quantity end;
  v_line:=round(v_qty*v_unit_net,2); v_total:=v_total+v_line;
  insert into public.sale_return_items(tenant_id,return_id,sale_item_id,product_id,quantity,unit_price,total) values(p_tenant_id,v_return,v_sale_item.id,v_sale_item.product_id,v_qty,v_unit_net,v_line);
  if v_sale_item.product_id is not null then
   select production_mode into v_prod_mode from public.products where id=v_sale_item.product_id;
   if coalesce(v_prod_mode,'stock')<>'on_demand' then
    insert into public.stock_movements(tenant_id,branch_id,product_id,movement_type,quantity,reference_type,reference_id,notes) values(p_tenant_id,p_branch_id,v_sale_item.product_id,'sale_return',abs(v_qty),'sale_return',v_return,'Devolução da venda '||v_sale.number);
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity,updated_at) values(p_tenant_id,p_branch_id,v_sale_item.product_id,abs(v_qty),0,now()) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
   end if;
  end if;
 end loop;
 update public.sale_returns set total=v_total where id=v_return;
 if v_customer is null and v_total>0 then
  insert into public.store_credit_vouchers(tenant_id,company_id,branch_id,voucher_number,original_amount,used_amount,status,guest_name,guest_document,source_return_id,metadata) values(p_tenant_id,p_company_id,p_branch_id,v_voucher_number,v_total,0,'active',v_guest_name,v_guest_document,v_return,jsonb_build_object('sale_id',v_sale.id,'sale_number',v_sale.number,'device_id',p_device_id,'event_id',p_event_id)) returning id into v_voucher;
  insert into public.store_credit_voucher_movements(tenant_id,voucher_id,entry_type,amount,source_kind,source_id,notes,metadata) values(p_tenant_id,v_voucher,'issue',v_total,'sale_return',v_return,'Vale Crédito emitido por devolução da venda '||v_sale.number,jsonb_build_object('sale_id',v_sale.id));
  update public.sale_returns set voucher_id=v_voucher where id=v_return;
 end if;
 insert into public.financial_entries(tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,paid_at,customer_id,sale_id,metadata) values(p_tenant_id,p_company_id,p_branch_id,'payable','paid','Devolução venda '||v_sale.number,v_total,v_total,current_date,now(),v_customer,v_sale.id,jsonb_build_object('origin','pdv_desktop_return','return_id',v_return,'refund_method','store_credit','voucher_id',v_voucher,'operator_user_id',v_operator,'supervisor_user_id',v_supervisor));
 select exists(select 1 from public.fiscal_documents where sale_id=v_sale.id and status='authorized') into v_has_authorized_fiscal;
 if v_has_authorized_fiscal then insert into public.fiscal_documents(tenant_id,company_id,branch_id,sale_id,document_type,environment,status,series,provider,request_payload) select p_tenant_id,p_company_id,p_branch_id,v_sale.id,'nfe',coalesce(fs.environment,'homologation'),'draft',coalesce(fs.nfe_series,'1'),fs.provider,jsonb_build_object('operation','sale_return','return_id',v_return,'source','pdv_desktop','requires_fiscal_review',true) from (select 1) x left join public.fiscal_settings fs on fs.tenant_id=p_tenant_id; end if;
 if v_supervisor is not null then insert into public.supervisor_authorizations(tenant_id,branch_id,pdv_device_id,sale_id,operator_user_id,supervisor_user_id,action,requested_value,reason,client_event_id,metadata) values(p_tenant_id,p_branch_id,p_device_id,v_sale.id,v_operator,v_supervisor,'return',v_total,nullif(p_payload->>'reason',''),p_event_id,jsonb_build_object('return_id',v_return)); end if;
 return jsonb_build_object('ok',true,'return_id',v_return,'sale_id',v_sale.id,'sale_number',v_sale.number,'total',v_total,'refund_method','store_credit','financial_status','paid','customer_id',v_customer,'customer_name',v_customer_row.name,'voucher_id',v_voucher,'voucher_number',v_voucher_number,'guest_name',v_guest_name,'guest_document',v_guest_document,'fiscal_followup_required',v_has_authorized_fiscal,'operator_user_id',v_operator,'supervisor_user_id',v_supervisor);
exception when others then
 if v_return is not null then delete from public.sale_returns where id=v_return; end if;
 return jsonb_build_object('ok',false,'error',sqlerrm);
end
$function$;
