-- Crédito em loja passa a ser o saldo disponível para devoluções e Crediário.
create or replace function private.customer_store_credit_balance(p_tenant uuid,p_customer uuid)
returns numeric language sql stable security definer set search_path='public','private' as $$
  select coalesce(sum(case when entry_type='credit' then amount when entry_type='debit' then -amount else 0 end),0)::numeric(15,2)
  from public.customer_store_credit_ledger where tenant_id=p_tenant and customer_id=p_customer
$$;

create or replace function private.enforce_crediario_store_credit()
returns trigger language plpgsql security definer set search_path='public','private' as $$
declare
  v_old_exposure numeric:=0; v_new_exposure numeric:=0; v_delta numeric:=0; v_balance numeric:=0;
  v_old_guarded boolean:=false; v_old_method text; v_new_method text;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_old_method:=lower(coalesce(nullif(old.metadata->>'term_method',''),old.document_type,''));
    v_old_guarded:=coalesce((old.metadata->>'store_credit_guarded')::boolean,false);
    if v_old_guarded and old.entry_type='receivable' and v_old_method='crediario' and old.status<>'cancelled' and old.customer_id is not null then v_old_exposure:=greatest(old.amount-old.paid_amount,0); end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_method:=lower(coalesce(nullif(new.metadata->>'term_method',''),new.document_type,''));
    if new.entry_type='receivable' and v_new_method='crediario' and new.status<>'cancelled' and new.customer_id is not null then
      if tg_op='INSERT' or v_old_guarded or (tg_op='UPDATE' and (v_old_method is distinct from 'crediario' or old.customer_id is distinct from new.customer_id)) then
        v_new_exposure:=greatest(new.amount-new.paid_amount,0);
        new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('store_credit_guarded',true);
      end if;
    end if;
  end if;
  if tg_op='INSERT' then
    if v_new_exposure>0 then
      perform pg_advisory_xact_lock(hashtext(new.tenant_id::text||':'||new.customer_id::text));
      v_balance:=private.customer_store_credit_balance(new.tenant_id,new.customer_id);
      if v_balance+0.001<v_new_exposure then raise exception 'insufficient_crediario_credit:available=%,required=%',v_balance,v_new_exposure; end if;
      insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata)
      values(new.tenant_id,new.company_id,new.branch_id,new.customer_id,'debit',v_new_exposure,'crediario_reserve',new.id,new.sale_id,'Reserva de crédito para Crediário: '||new.description,jsonb_build_object('financial_entry_id',new.id,'due_date',new.due_date));
    end if; return new;
  end if;
  if tg_op='DELETE' then
    if v_old_exposure>0 then insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(old.tenant_id,old.company_id,old.branch_id,old.customer_id,'credit',v_old_exposure,'crediario_release',gen_random_uuid(),old.sale_id,'Liberação de crédito por exclusão de Crediário: '||old.description,jsonb_build_object('financial_entry_id',old.id)); end if; return old;
  end if;
  if old.customer_id is distinct from new.customer_id and v_old_exposure>0 then insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(old.tenant_id,old.company_id,old.branch_id,old.customer_id,'credit',v_old_exposure,'crediario_release',gen_random_uuid(),old.sale_id,'Liberação de crédito por troca de cliente.',jsonb_build_object('financial_entry_id',old.id)); v_old_exposure:=0; end if;
  if old.customer_id is distinct from new.customer_id and v_new_exposure>0 then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text||':'||new.customer_id::text)); v_balance:=private.customer_store_credit_balance(new.tenant_id,new.customer_id);
    if v_balance+0.001<v_new_exposure then raise exception 'insufficient_crediario_credit:available=%,required=%',v_balance,v_new_exposure; end if;
    insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(new.tenant_id,new.company_id,new.branch_id,new.customer_id,'debit',v_new_exposure,'crediario_adjustment',gen_random_uuid(),new.sale_id,'Reserva de crédito após troca de cliente.',jsonb_build_object('financial_entry_id',new.id)); return new;
  end if;
  v_delta:=v_new_exposure-v_old_exposure;
  if v_delta>0.001 then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text||':'||new.customer_id::text)); v_balance:=private.customer_store_credit_balance(new.tenant_id,new.customer_id);
    if v_balance+0.001<v_delta then raise exception 'insufficient_crediario_credit:available=%,required=%',v_balance,v_delta; end if;
    insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(new.tenant_id,new.company_id,new.branch_id,new.customer_id,'debit',v_delta,'crediario_adjustment',gen_random_uuid(),new.sale_id,'Aumento da reserva de crédito do Crediário.',jsonb_build_object('financial_entry_id',new.id));
  elsif v_delta< -0.001 then
    insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,sale_id,notes,metadata) values(old.tenant_id,old.company_id,old.branch_id,old.customer_id,'credit',abs(v_delta),'crediario_release',gen_random_uuid(),old.sale_id,'Recomposição do crédito do Crediário.',jsonb_build_object('financial_entry_id',old.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_financial_entries_crediario_credit on public.financial_entries;
create trigger trg_financial_entries_crediario_credit before insert or update or delete on public.financial_entries for each row execute function private.enforce_crediario_store_credit();

-- Salvar cliente também pode ajustar o saldo disponível, sempre deixando trilha no razão.
create or replace function public.erp_party_save(p_token text,p_resource text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; v_id uuid; v_type text; v_doc text; v_target_credit numeric; v_current_credit numeric; v_delta numeric;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_resource not in ('customers','suppliers') then return jsonb_build_object('ok',false,'error','unsupported_resource'); end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  v_type:=case lower(coalesce(nullif(p_payload->>'type',''),case when p_resource='suppliers' then 'company' else 'individual' end)) when 'pf' then 'individual' when 'individual' then 'individual' when 'pj' then 'company' when 'company' then 'company' else 'individual' end;
  v_doc:=private.br_digits(p_payload->>'document');
  if v_doc<>'' then if v_type='individual' and not private.br_valid_cpf(v_doc) then return jsonb_build_object('ok',false,'error','invalid_cpf'); end if; if v_type='company' and not private.br_valid_cnpj(v_doc) then return jsonb_build_object('ok',false,'error','invalid_cnpj'); end if; end if;
  if p_resource='customers' then
    if v_id is null then
      insert into public.customers(tenant_id,company_id,type,name,trade_name,document,birth_date,email,phone,state_registration,postal_code,street,number,complement,district,city,state,ibge_city_code,active)
      values(v.tenant_id,v.company_id,v_type,p_payload->>'name',nullif(p_payload->>'trade_name',''),nullif(v_doc,''),case when v_type='individual' then nullif(p_payload->>'birth_date','')::date else null end,nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),nullif(p_payload->>'state_registration',''),nullif(private.br_digits(p_payload->>'postal_code'),''),nullif(p_payload->>'street',''),nullif(p_payload->>'number',''),nullif(p_payload->>'complement',''),nullif(p_payload->>'district',''),nullif(p_payload->>'city',''),nullif(p_payload->>'state',''),nullif(p_payload->>'ibge_city_code',''),coalesce((p_payload->>'active')::boolean,true)) returning id into v_id;
    else
      update public.customers set type=v_type,name=coalesce(nullif(p_payload->>'name',''),name),trade_name=case when p_payload?'trade_name' then nullif(p_payload->>'trade_name','') else trade_name end,document=case when p_payload?'document' then nullif(v_doc,'') else document end,birth_date=case when v_type='individual' then case when p_payload?'birth_date' then nullif(p_payload->>'birth_date','')::date else birth_date end else null end,email=case when p_payload?'email' then nullif(p_payload->>'email','') else email end,phone=case when p_payload?'phone' then nullif(p_payload->>'phone','') else phone end,state_registration=case when p_payload?'state_registration' then nullif(p_payload->>'state_registration','') else state_registration end,postal_code=case when p_payload?'postal_code' then nullif(private.br_digits(p_payload->>'postal_code'),'') else postal_code end,street=case when p_payload?'street' then nullif(p_payload->>'street','') else street end,number=case when p_payload?'number' then nullif(p_payload->>'number','') else number end,complement=case when p_payload?'complement' then nullif(p_payload->>'complement','') else complement end,district=case when p_payload?'district' then nullif(p_payload->>'district','') else district end,city=case when p_payload?'city' then nullif(p_payload->>'city','') else city end,state=case when p_payload?'state' then nullif(p_payload->>'state','') else state end,ibge_city_code=case when p_payload?'ibge_city_code' then nullif(p_payload->>'ibge_city_code','') else ibge_city_code end,active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=v_id and tenant_id=v.tenant_id;
    end if;
    if p_payload?'store_credit_balance' then
      v_target_credit:=coalesce(nullif(p_payload->>'store_credit_balance','')::numeric,0); if v_target_credit<0 then return jsonb_build_object('ok',false,'error','store_credit_cannot_be_negative'); end if;
      perform pg_advisory_xact_lock(hashtext(v.tenant_id::text||':'||v_id::text)); v_current_credit:=private.customer_store_credit_balance(v.tenant_id,v_id); v_delta:=round(v_target_credit-v_current_credit,2);
      if abs(v_delta)>0.001 then insert into public.customer_store_credit_ledger(tenant_id,company_id,branch_id,customer_id,entry_type,amount,source_kind,source_id,notes,metadata) values(v.tenant_id,v.company_id,v.branch_id,v_id,case when v_delta>0 then 'credit' else 'debit' end,abs(v_delta),'manual_adjustment',gen_random_uuid(),'Ajuste manual do Crédito em loja pelo Cadastro de Pessoas.',jsonb_build_object('previous_balance',v_current_credit,'target_balance',v_target_credit,'user_id',v.user_id)); end if;
    end if;
  else
    if v_id is null then insert into public.suppliers(tenant_id,company_id,type,name,trade_name,document,email,phone,state_registration,postal_code,street,number,complement,district,city,state,ibge_city_code,active) values(v.tenant_id,v.company_id,v_type,p_payload->>'name',nullif(p_payload->>'trade_name',''),nullif(v_doc,''),nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),nullif(p_payload->>'state_registration',''),nullif(private.br_digits(p_payload->>'postal_code'),''),nullif(p_payload->>'street',''),nullif(p_payload->>'number',''),nullif(p_payload->>'complement',''),nullif(p_payload->>'district',''),nullif(p_payload->>'city',''),nullif(p_payload->>'state',''),nullif(p_payload->>'ibge_city_code',''),coalesce((p_payload->>'active')::boolean,true)) returning id into v_id;
    else update public.suppliers set type=v_type,name=coalesce(nullif(p_payload->>'name',''),name),trade_name=case when p_payload?'trade_name' then nullif(p_payload->>'trade_name','') else trade_name end,document=case when p_payload?'document' then nullif(v_doc,'') else document end,email=case when p_payload?'email' then nullif(p_payload->>'email','') else email end,phone=case when p_payload?'phone' then nullif(p_payload->>'phone','') else phone end,state_registration=case when p_payload?'state_registration' then nullif(p_payload->>'state_registration','') else state_registration end,postal_code=case when p_payload?'postal_code' then nullif(private.br_digits(p_payload->>'postal_code'),'') else postal_code end,street=case when p_payload?'street' then nullif(p_payload->>'street','') else street end,number=case when p_payload?'number' then nullif(p_payload->>'number','') else number end,complement=case when p_payload?'complement' then nullif(p_payload->>'complement','') else complement end,district=case when p_payload?'district' then nullif(p_payload->>'district','') else district end,city=case when p_payload?'city' then nullif(p_payload->>'city','') else city end,state=case when p_payload?'state' then nullif(p_payload->>'state','') else state end,ibge_city_code=case when p_payload?'ibge_city_code' then nullif(p_payload->>'ibge_city_code','') else ibge_city_code end,active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=v_id and tenant_id=v.tenant_id; end if;
  end if;
  return jsonb_build_object('ok',true,'id',v_id,'store_credit_balance',case when p_resource='customers' then private.customer_store_credit_balance(v.tenant_id,v_id) else null end);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

create or replace function public.erp_receivable_create(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; v_customer public.customers%rowtype; v_id uuid:=gen_random_uuid(); v_doc text; v_amount numeric; v_issued date; v_due date; v_desc text; v_installment int; v_installments int;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_doc:=lower(trim(coalesce(p_payload->>'document_type',''))); if v_doc not in ('boleto','crediario') then return jsonb_build_object('ok',false,'error','invalid_document_type'); end if;
  v_amount:=coalesce(nullif(p_payload->>'amount','')::numeric,0); if v_amount<=0 then return jsonb_build_object('ok',false,'error','invalid_amount'); end if;
  v_issued:=coalesce(nullif(p_payload->>'issued_at','')::date,current_date); v_due:=nullif(p_payload->>'due_date','')::date; if v_due is null then return jsonb_build_object('ok',false,'error','due_date_required'); end if;
  v_desc:=trim(coalesce(p_payload->>'description','')); if length(v_desc)<3 then return jsonb_build_object('ok',false,'error','description_required'); end if;
  select * into v_customer from public.customers where id=nullif(p_payload->>'customer_id','')::uuid and tenant_id=v.tenant_id and active=true; if v_customer.id is null then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;
  v_installment:=greatest(coalesce(nullif(p_payload->>'installment','')::int,1),1); v_installments:=greatest(coalesce(nullif(p_payload->>'installments','')::int,v_installment),v_installment);
  insert into public.financial_entries(id,tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,due_date,customer_id,sale_id,metadata,issued_at,document_type)
  values(v_id,v.tenant_id,v.company_id,v.branch_id,'receivable','open',v_desc,round(v_amount,2),0,v_due,v_customer.id,null,jsonb_build_object('origin','manual_receivable','term_method',v_doc,'installment',v_installment,'installments',v_installments,'reference',nullif(p_payload->>'reference',''),'notes',nullif(p_payload->>'notes',''),'created_by',v.user_id),v_issued,v_doc);
  return jsonb_build_object('ok',true,'id',v_id,'document_type',v_doc,'amount',round(v_amount,2),'store_credit_balance',private.customer_store_credit_balance(v.tenant_id,v_customer.id));
exception when others then if sqlerrm like 'insufficient_crediario_credit:%' then return jsonb_build_object('ok',false,'error','insufficient_crediario_credit','detail',sqlerrm); end if; return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

-- Lista também títulos manuais, calcula Vencido em tempo real e prioriza atraso.
create or replace function public.erp_receivables_list(p_token text,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record; v_data jsonb; v_issued_from date:=nullif(p_filters->>'issued_from','')::date; v_issued_to date:=nullif(p_filters->>'issued_to','')::date; v_doc text:=nullif(lower(trim(p_filters->>'document_type')),''); v_customer uuid:=nullif(p_filters->>'customer_id','')::uuid; v_due_from date:=nullif(p_filters->>'due_from','')::date; v_due_to date:=nullif(p_filters->>'due_to','')::date; v_paid_from date:=nullif(p_filters->>'paid_from','')::date; v_paid_to date:=nullif(p_filters->>'paid_to','')::date; v_status text:=nullif(lower(trim(p_filters->>'status')),''); v_name text:=nullif(trim(p_filters->>'customer_name'),'');
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.priority,x.due_date asc nulls last,x.issued_at desc,x.created_at desc),'[]'::jsonb) into v_data from (
    select f.id,f.issued_at,coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) document_type,case when f.status in ('open','partial') and f.due_date<current_date then 'overdue' else f.status end status,f.description,f.amount,f.paid_amount,case when f.status='cancelled' then 0 else greatest(f.amount-f.paid_amount,0) end remaining,f.due_date,f.paid_at,f.customer_id,c.name customer,c.document customer_document,f.sale_id,s.number sale_number,coalesce(s.completed_at,s.created_at,f.created_at) operation_at,f.created_at,nullif(f.metadata->>'installment','')::int installment,nullif(f.metadata->>'installments','')::int installments,f.metadata->>'origin' origin,(f.metadata->>'origin'='manual_receivable') manual,case when f.status in ('open','partial') and f.due_date<current_date then 0 when f.status in ('open','partial') then 1 when f.status='paid' then 2 when f.status='cancelled' then 3 else 4 end priority
    from public.financial_entries f left join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id left join public.sales s on s.id=f.sale_id and s.tenant_id=f.tenant_id
    where f.tenant_id=v.tenant_id and f.entry_type='receivable' and ((f.metadata->>'origin'='manual_receivable') or (f.sale_id is not null and (f.metadata->>'origin'='sale_term' or s.payment_condition='term'))) and coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),'')) in ('boleto','crediario')
      and (v_issued_from is null or f.issued_at>=v_issued_from) and (v_issued_to is null or f.issued_at<=v_issued_to) and (v_doc is null or coalesce(nullif(f.metadata->>'term_method',''),nullif(s.term_method,''),nullif(lower(f.document_type),''))=v_doc) and (v_customer is null or f.customer_id=v_customer) and (v_name is null or coalesce(c.name,'') ilike '%'||v_name||'%') and (v_due_from is null or f.due_date>=v_due_from) and (v_due_to is null or f.due_date<=v_due_to) and (v_paid_from is null or f.paid_at::date>=v_paid_from) and (v_paid_to is null or f.paid_at::date<=v_paid_to)
      and (v_status is null or (v_status='overdue' and f.status in ('open','partial') and f.due_date<current_date) or (v_status='open' and f.status in ('open','partial') and (f.due_date is null or f.due_date>=current_date)) or (v_status='paid' and f.status='paid') or (v_status in ('cancelled','reversed') and f.status='cancelled')) limit 1000
  ) x;
  return jsonb_build_object('ok',true,'data',v_data);
end $$;
