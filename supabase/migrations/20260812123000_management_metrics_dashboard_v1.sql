-- ThorGestao management metrics v1
-- Unifies commercial dates, sales validity and management profitability metrics.

alter function public.erp_report_v2(text,text,date,date,uuid,jsonb)
  set timezone to 'America/Fortaleza';

alter function public.erp_report_v3(text,text,date,date,uuid,jsonb)
  set timezone to 'America/Fortaleza';

create or replace function public.erp_dashboard(
  p_token text,
  p_start date default null,
  p_end date default null,
  p_branch uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
set timezone to 'America/Fortaleza'
as $function$
declare
  v record;
  v_start date := coalesce(p_start,current_date);
  v_end date := coalesce(p_end,current_date);
  v_days integer;
  v_prev_start date;
  v_prev_end date;
  v_sales jsonb;
  v_prev_sales jsonb;
  v_fin jsonb;
  v_stock jsonb;
  v_people jsonb;
  v_equipment jsonb;
  v_alerts jsonb;
  v_top jsonb;
  v_payments jsonb;
  v_hourly jsonb;
  v_branches_sales jsonb;
  v_branches jsonb;
  v_trend jsonb;
  v_comparison jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if v_end < v_start then
    return jsonb_build_object('ok',false,'error','invalid_period');
  end if;

  if p_branch is not null and not exists(
    select 1 from public.branches where id=p_branch and tenant_id=v.tenant_id
  ) then
    return jsonb_build_object('ok',false,'error','invalid_branch');
  end if;

  v_days := (v_end-v_start)+1;
  v_prev_end := v_start-1;
  v_prev_start := v_prev_end-(v_days-1);

  with
  cur_sales as (
    select s.*
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
  ),
  cur_returns as (
    select sr.*,s.branch_id
    from public.sale_returns sr
    join public.sales s on s.id=sr.sale_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
  ),
  sold_cost as (
    select coalesce(sum(si.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) amount
    from public.sale_items si
    join cur_sales s on s.id=si.sale_id
    left join public.products p on p.id=si.product_id
  ),
  returned_cost as (
    select coalesce(sum(sri.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) amount
    from public.sale_return_items sri
    join cur_returns sr on sr.id=sri.return_id
    left join public.sale_items si on si.id=sri.sale_item_id
    left join public.products p on p.id=sri.product_id
  ),
  sale_totals as (
    select
      coalesce(sum(s.total),0) gross,
      coalesce(sum(s.total) filter(where s.channel='pdv'),0) pdv,
      count(*)::int count,
      coalesce(sum(s.discount),0) discounts,
      coalesce(sum(s.surcharge),0) surcharges
    from cur_sales s
  ),
  return_totals as (
    select coalesce(sum(sr.total),0) returns from cur_returns sr
  ),
  cancellation_totals as (
    select coalesce(sum(s.total),0) cancelled
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status='cancelled'
      and coalesce(s.cancelled_at,s.completed_at,s.created_at)::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
  )
  select jsonb_build_object(
    'gross',st.gross,
    'pdv',st.pdv,
    'count',st.count,
    'cancelled',ct.cancelled,
    'returns',rt.returns,
    'net',st.gross-rt.returns,
    'discounts',st.discounts,
    'surcharges',st.surcharges,
    'cmv',sc.amount-rc.amount,
    'gross_profit',(st.gross-rt.returns)-(sc.amount-rc.amount),
    'gross_margin',case when (st.gross-rt.returns)=0 then 0 else ((st.gross-rt.returns)-(sc.amount-rc.amount))/(st.gross-rt.returns)*100 end,
    'avg_ticket',case when st.count=0 then 0 else (st.gross-rt.returns)/st.count end
  )
  into v_sales
  from sale_totals st
  cross join return_totals rt
  cross join sold_cost sc
  cross join returned_cost rc
  cross join cancellation_totals ct;

  with
  prev_sales as (
    select s.*
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_prev_start and v_prev_end
      and (p_branch is null or s.branch_id=p_branch)
  ),
  prev_returns as (
    select sr.*
    from public.sale_returns sr
    join public.sales s on s.id=sr.sale_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_prev_start and v_prev_end
      and (p_branch is null or s.branch_id=p_branch)
  ),
  sold_cost as (
    select coalesce(sum(si.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) amount
    from public.sale_items si
    join prev_sales s on s.id=si.sale_id
    left join public.products p on p.id=si.product_id
  ),
  returned_cost as (
    select coalesce(sum(sri.quantity*coalesce(si.cost_snapshot,p.cost_price,0)),0) amount
    from public.sale_return_items sri
    join prev_returns sr on sr.id=sri.return_id
    left join public.sale_items si on si.id=sri.sale_item_id
    left join public.products p on p.id=sri.product_id
  ),
  st as (
    select coalesce(sum(total),0) gross,count(*)::int count from prev_sales
  ),
  rt as (
    select coalesce(sum(total),0) returns from prev_returns
  )
  select jsonb_build_object(
    'gross',st.gross,
    'count',st.count,
    'returns',rt.returns,
    'net',st.gross-rt.returns,
    'cmv',sc.amount-rc.amount,
    'gross_profit',(st.gross-rt.returns)-(sc.amount-rc.amount),
    'gross_margin',case when (st.gross-rt.returns)=0 then 0 else ((st.gross-rt.returns)-(sc.amount-rc.amount))/(st.gross-rt.returns)*100 end,
    'avg_ticket',case when st.count=0 then 0 else (st.gross-rt.returns)/st.count end
  )
  into v_prev_sales
  from st cross join rt cross join sold_cost sc cross join returned_cost rc;

  v_comparison := jsonb_build_object(
    'previous_start',v_prev_start,
    'previous_end',v_prev_end,
    'previous',v_prev_sales,
    'net_pct',case
      when coalesce((v_prev_sales->>'net')::numeric,0)=0 then null
      else (((v_sales->>'net')::numeric-(v_prev_sales->>'net')::numeric)/abs((v_prev_sales->>'net')::numeric))*100 end,
    'gross_profit_pct',case
      when coalesce((v_prev_sales->>'gross_profit')::numeric,0)=0 then null
      else (((v_sales->>'gross_profit')::numeric-(v_prev_sales->>'gross_profit')::numeric)/abs((v_prev_sales->>'gross_profit')::numeric))*100 end,
    'count_pct',case
      when coalesce((v_prev_sales->>'count')::numeric,0)=0 then null
      else (((v_sales->>'count')::numeric-(v_prev_sales->>'count')::numeric)/abs((v_prev_sales->>'count')::numeric))*100 end,
    'ticket_pct',case
      when coalesce((v_prev_sales->>'avg_ticket')::numeric,0)=0 then null
      else (((v_sales->>'avg_ticket')::numeric-(v_prev_sales->>'avg_ticket')::numeric)/abs((v_prev_sales->>'avg_ticket')::numeric))*100 end
  );

  select jsonb_build_object(
    'receivable_today',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='receivable' and due_date=current_date and status not in ('paid','cancelled')),0),
    'payable_today',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='payable' and due_date=current_date and status not in ('paid','cancelled')),0),
    'receivable_open',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='receivable' and status not in ('paid','cancelled')),0),
    'payable_open',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='payable' and status not in ('paid','cancelled')),0),
    'overdue',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='receivable' and due_date<current_date and status not in ('paid','cancelled')),0),
    'next7',coalesce(sum(greatest(amount-paid_amount,0)) filter(where entry_type='receivable' and due_date>current_date and due_date<=current_date+7 and status not in ('paid','cancelled')),0),
    'scope','current_position'
  )
  into v_fin
  from public.financial_entries
  where tenant_id=v.tenant_id and (p_branch is null or branch_id=p_branch);

  with balances as (
    select p.id,p.minimum_stock,p.cost_price,
           coalesce(sum(i.quantity-i.reserved_quantity),0) qty
    from public.products p
    left join public.inventory_balances i
      on i.product_id=p.id and i.tenant_id=v.tenant_id
      and (p_branch is null or i.branch_id=p_branch)
    where p.tenant_id=v.tenant_id and p.active=true
    group by p.id
  )
  select jsonb_build_object(
    'items',coalesce(sum(qty),0),
    'low',count(*) filter(where qty>0 and qty<=minimum_stock),
    'zero',count(*) filter(where qty<=0),
    'value',coalesce(sum(qty*cost_price),0),
    'products',count(*),
    'scope','current_position'
  )
  into v_stock
  from balances;

  select jsonb_build_object(
    'customers',(select count(*) from public.customers where tenant_id=v.tenant_id and active=true),
    'suppliers',(select count(*) from public.suppliers where tenant_id=v.tenant_id and active=true),
    'users_pdv',(select count(*) from public.staff_users u join public.access_profiles p on p.id=u.profile_id where u.tenant_id=v.tenant_id and u.active=true and p.scope='PDV' and (p_branch is null or u.branch_id=p_branch)),
    'users_adm',(select count(*) from public.staff_users u join public.access_profiles p on p.id=u.profile_id where u.tenant_id=v.tenant_id and u.active=true and p.scope='ADM' and (p_branch is null or u.branch_id=p_branch)),
    'scope',case when p_branch is null then 'tenant' else 'branch_where_available' end
  )
  into v_people;

  select jsonb_build_object(
    'pdvs',(select count(*) from public.pos_registers where tenant_id=v.tenant_id and active=true and (p_branch is null or branch_id=p_branch)),
    'cash_open',(select count(*) from public.cash_sessions cs join public.pos_registers pr on pr.id=cs.pos_register_id where cs.tenant_id=v.tenant_id and cs.status='open' and (p_branch is null or pr.branch_id=p_branch)),
    'scope','current_position'
  )
  into v_equipment;

  select jsonb_build_object(
    'fiscal_rejected',(select count(*) from public.fiscal_documents fd where fd.tenant_id=v.tenant_id and fd.status in ('rejected','error','transmission_error') and fd.created_at::date between v_start and v_end and (p_branch is null or fd.branch_id=p_branch)),
    'fiscal_open',(select count(*) from public.fiscal_documents fd where fd.tenant_id=v.tenant_id and fd.status in ('rejected','error','transmission_error') and (p_branch is null or fd.branch_id=p_branch)),
    'stock_low',coalesce((v_stock->>'low')::int,0),
    'finance_overdue',(select count(*) from public.financial_entries f where f.tenant_id=v.tenant_id and f.entry_type='receivable' and f.due_date<current_date and f.status not in ('paid','cancelled') and (p_branch is null or f.branch_id=p_branch)),
    'tickets_open',(select count(*) from public.support_tickets where tenant_id=v.tenant_id and status in ('open','in_progress')),
    'tickets_scope','tenant'
  )
  into v_alerts;

  with ledger as (
    select si.product_id,si.quantity qty,si.total revenue
    from public.sale_items si
    join public.sales s on s.id=si.sale_id
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    union all
    select sri.product_id,-sri.quantity,-sri.total
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id=sri.return_id
    join public.sales s on s.id=sr.sale_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.revenue desc),'[]'::jsonb)
  into v_top
  from (
    select p.name product,sum(l.qty) quantity,sum(l.revenue) revenue
    from ledger l
    left join public.products p on p.id=l.product_id
    group by p.id,p.name
    having sum(l.revenue)>0
    order by revenue desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb)
  into v_payments
  from (
    select p.method,sum(p.amount) total,count(*)::int quantity
    from public.payments p
    join public.sales s on s.id=p.sale_id
    where p.tenant_id=v.tenant_id
      and p.status in ('paid','authorized')
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by p.method
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.report_hour),'[]'::jsonb)
  into v_hourly
  from (
    select extract(hour from s.completed_at)::int report_hour,
           sum(s.total) total,count(*)::int quantity
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  ) x;

  with ledger as (
    select s.branch_id,s.total revenue,1 sale_count
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    union all
    select s.branch_id,-sr.total,0
    from public.sale_returns sr
    join public.sales s on s.id=sr.sale_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb)
  into v_branches_sales
  from (
    select b.name branch,sum(l.revenue) total,sum(l.sale_count)::int quantity
    from ledger l join public.branches b on b.id=l.branch_id
    group by b.id,b.name
  ) x;

  with days as (
    select g::date report_day
    from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') g
  ),
  sd as (
    select s.completed_at::date report_day,sum(s.total) revenue
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  ),
  rd as (
    select sr.created_at::date report_day,sum(sr.total) returns
    from public.sale_returns sr
    join public.sales s on s.id=sr.sale_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  ),
  cd as (
    select s.completed_at::date report_day,
           sum(si.quantity*coalesce(si.cost_snapshot,p.cost_price,0)) cost
    from public.sale_items si
    join public.sales s on s.id=si.sale_id
    left join public.products p on p.id=si.product_id
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  ),
  rcd as (
    select sr.created_at::date report_day,
           sum(sri.quantity*coalesce(si.cost_snapshot,p.cost_price,0)) cost
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id=sri.return_id
    join public.sales s on s.id=sr.sale_id
    left join public.sale_items si on si.id=sri.sale_item_id
    left join public.products p on p.id=sri.product_id
    where sr.tenant_id=v.tenant_id
      and coalesce(sr.status,'completed') not in ('cancelled','rejected')
      and sr.created_at::date between v_start and v_end
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'report_day',d.report_day,
    'net_revenue',coalesce(sd.revenue,0)-coalesce(rd.returns,0),
    'cmv',coalesce(cd.cost,0)-coalesce(rcd.cost,0),
    'gross_profit',(coalesce(sd.revenue,0)-coalesce(rd.returns,0))-(coalesce(cd.cost,0)-coalesce(rcd.cost,0))
  ) order by d.report_day),'[]'::jsonb)
  into v_trend
  from days d
  left join sd using(report_day)
  left join rd using(report_day)
  left join cd using(report_day)
  left join rcd using(report_day);

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by is_headquarters desc,name),'[]'::jsonb)
  into v_branches
  from public.branches
  where tenant_id=v.tenant_id;

  return jsonb_build_object(
    'ok',true,
    'start',v_start,
    'end',v_end,
    'timezone','America/Fortaleza',
    'generated_at',now(),
    'sales',v_sales,
    'comparison',v_comparison,
    'finance',v_fin,
    'stock',v_stock,
    'people',v_people,
    'equipment',v_equipment,
    'alerts',v_alerts,
    'top_products',v_top,
    'payments',v_payments,
    'hourly',v_hourly,
    'branch_sales',v_branches_sales,
    'trend',v_trend,
    'branches',v_branches,
    'profitability_note','Lucro bruto gerencial: receita liquida menos CMV. Nao inclui ainda taxas financeiras, impostos efetivos e todas as despesas operacionais.'
  );
end;
$function$;
