insert into public.sales_payment_methods(tenant_id,company_id,code,name,category,active,sort_order,supports_card,supports_installments)
select c.tenant_id,c.id,'store_credit_voucher','Vale Crédito','immediate',true,65,false,false
from public.companies c
on conflict(company_id,code) do update set
  name=excluded.name,
  category=excluded.category,
  active=true,
  sort_order=excluded.sort_order,
  supports_card=false,
  supports_installments=false,
  updated_at=now();

create or replace function private.seed_store_credit_voucher_payment_method()
returns trigger
language plpgsql
security definer
set search_path to 'public','private'
as $function$
begin
  insert into public.sales_payment_methods(tenant_id,company_id,code,name,category,active,sort_order,supports_card,supports_installments)
  values(new.tenant_id,new.id,'store_credit_voucher','Vale Crédito','immediate',true,65,false,false)
  on conflict(company_id,code) do nothing;
  return new;
end;
$function$;

do $do$
begin
  if not exists(select 1 from pg_trigger where tgname='companies_seed_store_credit_voucher_payment_method') then
    create trigger companies_seed_store_credit_voucher_payment_method
    after insert on public.companies
    for each row execute function private.seed_store_credit_voucher_payment_method();
  end if;
end
$do$;

create or replace function private.cash_return_metrics(p_cash_id uuid,p_cutoff timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_cutoff timestamptz:=coalesce(p_cutoff,now());
  v_count integer:=0;
  v_total numeric:=0;
  v_customer_credit numeric:=0;
  v_voucher_issued numeric:=0;
  v_voucher_outstanding numeric:=0;
  v_voucher_used numeric:=0;
begin
  select count(*)::int,
         coalesce(sum(sr.total),0),
         coalesce(sum(case when sr.voucher_id is null then sr.total else 0 end),0),
         coalesce(sum(case when sr.voucher_id is not null then sr.total else 0 end),0),
         coalesce(sum(case when sr.voucher_id is not null then greatest(coalesce(sv.original_amount,0)-coalesce(sv.used_amount,0),0) else 0 end),0)
  into v_count,v_total,v_customer_credit,v_voucher_issued,v_voucher_outstanding
  from public.sale_returns sr
  join public.sales s on s.id=sr.sale_id
  left join public.store_credit_vouchers sv on sv.id=sr.voucher_id
  where s.cash_session_id=p_cash_id
    and sr.status='completed'
    and sr.created_at<=v_cutoff;

  select coalesce(sum(p.amount),0)
  into v_voucher_used
  from public.payments p
  join public.sales s on s.id=p.sale_id
  where s.cash_session_id=p_cash_id
    and p.status in ('paid','authorized')
    and p.method='store_credit_voucher'
    and p.created_at<=v_cutoff;

  return jsonb_build_object(
    'returns_count',v_count,
    'returns_total',v_total,
    'return_customer_credit_total',v_customer_credit,
    'return_voucher_issued_total',v_voucher_issued,
    'return_voucher_outstanding',v_voucher_outstanding,
    'voucher_used_total',v_voucher_used
  );
end;
$function$;

create or replace function public.erp_sale_returns_dashboard(
  p_token text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_status text default null,
  p_branch uuid default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_start timestamptz:=coalesce(p_start,date_trunc('month',now()));
  v_end timestamptz:=coalesce(p_end,now()+interval '1 day');
  v_data jsonb;
  v_summary jsonb;
  v_branches jsonb;
  v_search text:=lower(trim(coalesce(p_search,'')));
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  with base as (
    select
      sr.id return_id,sr.sale_id,s.number sale_number,sr.created_at,sr.status source_status,sr.reason,sr.refund_method,sr.total,
      s.branch_id,b.name branch,pr.id pos_id,pr.name pos,pr.code pos_code,
      sr.operator_user_id,op.name operator,sr.supervisor_user_id,sup.name supervisor,
      sr.customer_id,c.name customer_name,c.document customer_document,
      sr.guest_name,sr.guest_document,sr.voucher_id,
      sv.voucher_number,sv.original_amount voucher_original_amount,sv.used_amount voucher_used_amount,
      greatest(coalesce(sv.original_amount,0)-coalesce(sv.used_amount,0),0) voucher_remaining,
      sv.status voucher_status,sv.issued_at voucher_issued_at,
      case when sr.customer_id is not null then 'customer_credit' else 'store_credit_voucher' end credit_type,
      case
        when sr.status='cancelled' then 'cancelled'
        when sr.status<>'completed' then 'open'
        when sv.id is not null and greatest(sv.original_amount-sv.used_amount,0)>0.001 then 'open'
        else 'completed'
      end operational_status,
      coalesce((select count(*) from public.sale_return_items sri where sri.return_id=sr.id),0)::int items_count,
      exists(select 1 from public.fiscal_documents fd where fd.sale_id=s.id and fd.status='authorized') fiscal_sale_authorized,
      exists(select 1 from public.fiscal_documents fd where fd.sale_id=s.id and fd.request_payload->>'return_id'=sr.id::text and fd.status not in ('authorized','cancelled')) fiscal_followup_pending
    from public.sale_returns sr
    join public.sales s on s.id=sr.sale_id and s.tenant_id=v.tenant_id
    join public.branches b on b.id=s.branch_id
    left join public.cash_sessions cs on cs.id=s.cash_session_id
    left join public.pos_registers pr on pr.id=cs.pos_register_id
    left join public.staff_users op on op.id=sr.operator_user_id
    left join public.staff_users sup on sup.id=sr.supervisor_user_id
    left join public.customers c on c.id=sr.customer_id
    left join public.store_credit_vouchers sv on sv.id=sr.voucher_id
    where sr.tenant_id=v.tenant_id and sr.created_at>=v_start and sr.created_at<v_end
      and (p_branch is null or s.branch_id=p_branch)
  ), scoped as (
    select * from base x where v_search='' or
      x.sale_number::text ilike '%'||v_search||'%' or
      lower(coalesce(x.voucher_number,'')) like '%'||v_search||'%' or
      lower(coalesce(x.customer_name,'')) like '%'||v_search||'%' or
      lower(coalesce(x.customer_document,'')) like '%'||v_search||'%' or
      lower(coalesce(x.guest_name,'')) like '%'||v_search||'%' or
      lower(coalesce(x.guest_document,'')) like '%'||v_search||'%' or
      lower(coalesce(x.operator,'')) like '%'||v_search||'%'
  ), filtered as (
    select * from scoped where coalesce(nullif(p_status,''),'all')='all' or operational_status=p_status
  )
  select
    coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from filtered f),'[]'::jsonb),
    jsonb_build_object(
      'open',coalesce((select count(*) from scoped where operational_status='open'),0),
      'completed',coalesce((select count(*) from scoped where operational_status='completed'),0),
      'cancelled',coalesce((select count(*) from scoped where operational_status='cancelled'),0),
      'total_returned',coalesce((select sum(total) from scoped where source_status='completed'),0),
      'voucher_open_balance',coalesce((select sum(voucher_remaining) from scoped where voucher_id is not null and operational_status='open'),0),
      'voucher_issued_total',coalesce((select sum(total) from scoped where voucher_id is not null and source_status='completed'),0),
      'customer_credit_total',coalesce((select sum(total) from scoped where customer_id is not null and source_status='completed'),0)
    )
  into v_data,v_summary;

  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name),'[]'::jsonb)
  into v_branches from public.branches b where b.tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'data',v_data,'summary',v_summary,'branches',v_branches,'start',v_start,'end',v_end);
end;
$function$;

create or replace function public.erp_sale_return_detail(p_token text,p_return uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  v_return jsonb;
  v_items jsonb;
  v_movements jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select jsonb_build_object(
    'id',sr.id,'sale_id',sr.sale_id,'sale_number',s.number,'sale_total',s.total,'created_at',sr.created_at,
    'status',sr.status,'reason',sr.reason,'refund_method',sr.refund_method,'total',sr.total,
    'branch_id',s.branch_id,'branch',b.name,'pos',pr.name,'pos_code',pr.code,
    'operator_user_id',sr.operator_user_id,'operator',op.name,'supervisor_user_id',sr.supervisor_user_id,'supervisor',sup.name,
    'customer_id',sr.customer_id,'customer_name',c.name,'customer_document',c.document,
    'guest_name',sr.guest_name,'guest_document',sr.guest_document,
    'voucher_id',sr.voucher_id,'voucher_number',sv.voucher_number,'voucher_original_amount',sv.original_amount,
    'voucher_used_amount',sv.used_amount,'voucher_remaining',greatest(coalesce(sv.original_amount,0)-coalesce(sv.used_amount,0),0),
    'voucher_status',sv.status,'voucher_issued_at',sv.issued_at,
    'credit_type',case when sr.customer_id is not null then 'customer_credit' else 'store_credit_voucher' end,
    'operational_status',case when sr.status='cancelled' then 'cancelled' when sr.status<>'completed' then 'open' when sv.id is not null and greatest(sv.original_amount-sv.used_amount,0)>0.001 then 'open' else 'completed' end
  ) into v_return
  from public.sale_returns sr
  join public.sales s on s.id=sr.sale_id
  join public.branches b on b.id=s.branch_id
  left join public.cash_sessions cs on cs.id=s.cash_session_id
  left join public.pos_registers pr on pr.id=cs.pos_register_id
  left join public.staff_users op on op.id=sr.operator_user_id
  left join public.staff_users sup on sup.id=sr.supervisor_user_id
  left join public.customers c on c.id=sr.customer_id
  left join public.store_credit_vouchers sv on sv.id=sr.voucher_id
  where sr.id=p_return and sr.tenant_id=v.tenant_id;

  if v_return is null then return jsonb_build_object('ok',false,'error','return_not_found'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ri.id,'sale_item_id',ri.sale_item_id,'product_id',ri.product_id,'sku',si.sku,'description',si.description,'unit',si.unit,
    'quantity',ri.quantity,'unit_price',ri.unit_price,'total',ri.total
  ) order by ri.created_at,ri.id),'[]'::jsonb)
  into v_items
  from public.sale_return_items ri
  left join public.sale_items si on si.id=ri.sale_item_id
  where ri.return_id=p_return and ri.tenant_id=v.tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'entry_type',m.entry_type,'amount',m.amount,'source_kind',m.source_kind,'sale_id',m.sale_id,
    'sale_number',s.number,'notes',m.notes,'created_at',m.created_at
  ) order by m.created_at desc),'[]'::jsonb)
  into v_movements
  from public.store_credit_voucher_movements m
  left join public.sales s on s.id=m.sale_id
  where m.tenant_id=v.tenant_id and m.voucher_id=nullif(v_return->>'voucher_id','')::uuid;

  return jsonb_build_object('ok',true,'return',v_return,'items',v_items,'voucher_movements',v_movements);
end;
$function$;

create or replace function public.pdv_pull_v10(p_device_token text,p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  dev record;
  vouchers jsonb;
begin
  data:=public.pdv_pull_v9(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into dev from private.resolve_pdv_device(p_device_token);
  if dev.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sv.id,'voucher_number',sv.voucher_number,'original_amount',sv.original_amount,'used_amount',sv.used_amount,
    'remaining',greatest(sv.original_amount-sv.used_amount,0),'status',sv.status,'guest_name',sv.guest_name,'guest_document',sv.guest_document,
    'issued_at',sv.issued_at,'updated_at',sv.updated_at,'return_id',sr.id,'return_status',sr.status,'return_reason',sr.reason,
    'sale_id',s.id,'sale_number',s.number,
    'metadata',coalesce(sv.metadata,'{}'::jsonb)||jsonb_build_object(
      'sale_id',s.id,'sale_number',s.number,'return_id',sr.id,'return_reason',sr.reason,
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'sale_item_id',ri.sale_item_id,'product_id',ri.product_id,'sku',si.sku,'name',si.description,'unit',si.unit,
        'quantity',ri.quantity,'unit_price',ri.unit_price,'total',ri.total
      ) order by ri.created_at,ri.id) from public.sale_return_items ri left join public.sale_items si on si.id=ri.sale_item_id where ri.return_id=sr.id),'[]'::jsonb)
    )
  ) order by sv.issued_at desc),'[]'::jsonb)
  into vouchers
  from public.store_credit_vouchers sv
  left join public.sale_returns sr on sr.id=sv.source_return_id
  left join public.sales s on s.id=sr.sale_id
  where sv.tenant_id=dev.tenant_id and (sv.company_id=dev.company_id or sv.company_id is null)
    and sv.status='active' and sv.original_amount-sv.used_amount>0.001;

  data:=jsonb_set(data,'{store_credit_vouchers}',coalesce(vouchers,'[]'::jsonb),true);
  return data;
end;
$function$;

create or replace function public.pdv_cash_preview_v3(p_device_token text,p_cash_open_event_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  data jsonb;
  metrics jsonb;
  cash_id uuid;
begin
  data:=public.pdv_cash_preview_v2(p_device_token,p_cash_open_event_id);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  cash_id:=nullif(data->>'cash_session_id','')::uuid;
  metrics:=private.cash_return_metrics(cash_id,coalesce(nullif(data->>'closed_at','')::timestamptz,now()));
  return data||metrics;
end;
$function$;

create or replace function public.erp_sales_cash_dashboard_v3(
  p_token text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_operator uuid default null,
  p_branch uuid default null,
  p_cash_status text default null,
  p_operation_filter text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  data jsonb;
  v record;
  v_start timestamptz:=coalesce(p_start,date_trunc('day',now()));
  v_end timestamptz:=coalesce(p_end,date_trunc('day',now())+interval '1 day');
  v_returns jsonb;
  v_ops jsonb;
  v_count integer:=0;
  v_total numeric:=0;
begin
  data:=public.erp_sales_cash_dashboard_v2(p_token,p_start,p_end,p_operator,p_branch,p_cash_status,p_operation_filter);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into v from private.resolve_temp_context(p_token);

  select coalesce(jsonb_agg(jsonb_build_object(
    'op_key','return:'||sr.id::text,'cash_session_id',s.cash_session_id,'sale_id',s.id,'return_id',sr.id,
    'occurred_at',sr.created_at,'op_type','return','description','Devolução venda #'||s.number::text,'amount',sr.total,
    'pos',pr.name,'branch',b.name,'operator',coalesce(op.name,su.name),'operator_id',coalesce(sr.operator_user_id,s.staff_user_id),
    'operation_state',case when sr.status='cancelled' then 'cancelled' else 'realized' end,
    'fiscal_document_id',fd.id,'document_type',fd.document_type,'fiscal_status',fd.status,
    'fiscal_pending',coalesce(fd.status not in ('authorized','cancelled'),false),
    'credit_type',case when sr.voucher_id is null then 'customer_credit' else 'store_credit_voucher' end,
    'voucher_number',sv.voucher_number
  ) order by sr.created_at desc),'[]'::jsonb),count(*)::int,coalesce(sum(sr.total),0)
  into v_returns,v_count,v_total
  from public.sale_returns sr
  join public.sales s on s.id=sr.sale_id and s.tenant_id=v.tenant_id
  left join public.cash_sessions cs on cs.id=s.cash_session_id
  left join public.pos_registers pr on pr.id=cs.pos_register_id
  left join public.branches b on b.id=s.branch_id
  left join public.staff_users op on op.id=sr.operator_user_id
  left join public.staff_users su on su.id=s.staff_user_id
  left join public.store_credit_vouchers sv on sv.id=sr.voucher_id
  left join lateral (select f.id,f.document_type,f.status from public.fiscal_documents f where f.sale_id=s.id order by f.created_at desc limit 1) fd on true
  where sr.created_at>=v_start and sr.created_at<v_end
    and (p_branch is null or s.branch_id=p_branch)
    and (p_operator is null or sr.operator_user_id=p_operator or s.staff_user_id=p_operator)
    and (coalesce(nullif(p_operation_filter,''),'all')='all' or (case when sr.status='cancelled' then 'cancelled' else 'realized' end)=p_operation_filter);

  select coalesce(jsonb_agg(x.obj order by coalesce((x.obj->>'occurred_at')::timestamptz,'epoch'::timestamptz) desc),'[]'::jsonb)
  into v_ops
  from (
    select value obj from jsonb_array_elements(coalesce(data->'operations','[]'::jsonb))
    union all
    select value obj from jsonb_array_elements(coalesce(v_returns,'[]'::jsonb))
  ) x;

  data:=jsonb_set(data,'{operations}',v_ops,true);
  data:=jsonb_set(data,'{summary}',coalesce(data->'summary','{}'::jsonb)||jsonb_build_object('returns_count',v_count,'returns_total',v_total),true);
  return data;
end;
$function$;

create or replace function public.erp_cash_closure_history_v2(
  p_token text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_operator uuid default null,
  p_branch uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  data jsonb;
  enriched jsonb;
begin
  data:=public.erp_cash_closure_history(p_token,p_start,p_end,p_operator,p_branch);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select coalesce(jsonb_agg(x.obj||private.cash_return_metrics(
    nullif(x.obj->>'cash_session_id','')::uuid,
    coalesce(nullif(x.obj->>'closed_at','')::timestamptz,now())
  ) order by nullif(x.obj->>'closed_at','')::timestamptz desc),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(data->'data','[]'::jsonb)) x(obj);
  return jsonb_set(data,'{data}',coalesce(enriched,'[]'::jsonb),true);
end;
$function$;

create or replace function public.erp_cash_closure_detail_v3(p_token text,p_cash_id uuid,p_closure_audit_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  data jsonb;
  v record;
  cutoff timestamptz;
  metrics jsonb;
  returns_data jsonb;
begin
  data:=public.erp_cash_closure_detail_v2(p_token,p_cash_id,p_closure_audit_id);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;
  select * into v from private.resolve_temp_context(p_token);
  cutoff:=coalesce(nullif(data#>>'{session,closed_at}','')::timestamptz,now());
  metrics:=private.cash_return_metrics(p_cash_id,cutoff);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sr.id,'sale_id',sr.sale_id,'sale_number',s.number,'created_at',sr.created_at,'status',sr.status,'reason',sr.reason,'total',sr.total,
    'operator',op.name,'customer_name',c.name,'guest_name',sr.guest_name,'guest_document',sr.guest_document,
    'credit_type',case when sr.voucher_id is null then 'customer_credit' else 'store_credit_voucher' end,
    'voucher_number',sv.voucher_number,'voucher_status',sv.status,'voucher_original_amount',sv.original_amount,'voucher_used_amount',sv.used_amount,
    'voucher_remaining',greatest(coalesce(sv.original_amount,0)-coalesce(sv.used_amount,0),0),
    'items',coalesce((select jsonb_agg(jsonb_build_object('sku',si.sku,'description',si.description,'unit',si.unit,'quantity',ri.quantity,'unit_price',ri.unit_price,'total',ri.total) order by ri.created_at,ri.id) from public.sale_return_items ri left join public.sale_items si on si.id=ri.sale_item_id where ri.return_id=sr.id),'[]'::jsonb)
  ) order by sr.created_at desc),'[]'::jsonb)
  into returns_data
  from public.sale_returns sr
  join public.sales s on s.id=sr.sale_id
  left join public.staff_users op on op.id=sr.operator_user_id
  left join public.customers c on c.id=sr.customer_id
  left join public.store_credit_vouchers sv on sv.id=sr.voucher_id
  where sr.tenant_id=v.tenant_id and s.cash_session_id=p_cash_id and sr.created_at<=cutoff;

  data:=jsonb_set(data,'{session}',coalesce(data->'session','{}'::jsonb)||metrics,true);
  data:=jsonb_set(data,'{snapshot}',coalesce(data->'snapshot','{}'::jsonb)||metrics,true);
  data:=jsonb_set(data,'{returns}',coalesce(returns_data,'[]'::jsonb),true);
  return data;
end;
$function$;
