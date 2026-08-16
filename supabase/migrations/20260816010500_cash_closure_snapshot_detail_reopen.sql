alter table public.cash_session_audit
  add column if not exists snapshot jsonb;

create or replace function private.cash_closure_snapshot(
  p_cash_id uuid,
  p_cutoff timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_cutoff timestamptz:=coalesce(p_cutoff,now());
  v_opening numeric:=0;
  v_opened_at timestamptz;
  v_business_date date;
  v_sales_count integer:=0;
  v_sales_total numeric:=0;
  v_subtotal numeric:=0;
  v_discounts numeric:=0;
  v_surcharges numeric:=0;
  v_received numeric:=0;
  v_cash numeric:=0;
  v_supply numeric:=0;
  v_receivable numeric:=0;
  v_withdrawal numeric:=0;
  v_expense numeric:=0;
  v_refund numeric:=0;
  v_payments jsonb:='[]'::jsonb;
  v_movements jsonb:='[]'::jsonb;
  v_expected numeric:=0;
begin
  select coalesce(cs.opening_amount,0),cs.opened_at,cs.business_date
    into v_opening,v_opened_at,v_business_date
  from public.cash_sessions cs where cs.id=p_cash_id;
  if not found then return '{}'::jsonb; end if;

  select count(*)::int,
         coalesce(sum(s.total),0),
         coalesce(sum(s.subtotal),0),
         coalesce(sum(s.discount),0),
         coalesce(sum(s.surcharge),0)
    into v_sales_count,v_sales_total,v_subtotal,v_discounts,v_surcharges
  from public.sales s
  where s.cash_session_id=p_cash_id
    and coalesce(s.completed_at,s.created_at)<=v_cutoff
    and (s.completed_at is not null or s.status in ('completed','cancelled'))
    and (s.cancelled_at is null or s.cancelled_at>v_cutoff);

  with valid_sales as (
    select s.id
    from public.sales s
    where s.cash_session_id=p_cash_id
      and coalesce(s.completed_at,s.created_at)<=v_cutoff
      and (s.completed_at is not null or s.status in ('completed','cancelled'))
      and (s.cancelled_at is null or s.cancelled_at>v_cutoff)
  ), actual as (
    select p.method,count(*)::int payment_count,sum(p.amount)::numeric amount,
           sum(coalesce(p.tendered_amount,p.amount))::numeric tendered_amount,
           sum(coalesce(p.change_amount,0))::numeric change_amount
    from public.payments p join valid_sales s on s.id=p.sale_id
    where p.created_at<=v_cutoff and p.status in ('paid','authorized')
    group by p.method
  ), term as (
    select 'term_sale'::text method,count(*)::int payment_count,
           coalesce(sum(coalesce(s.term_principal_amount,greatest(s.total-coalesce((select sum(p.amount) from public.payments p where p.sale_id=s.id and p.status in ('paid','authorized') and p.created_at<=v_cutoff),0),0))),0)::numeric amount,
           null::numeric tendered_amount,0::numeric change_amount
    from public.sales s
    where s.cash_session_id=p_cash_id and s.payment_condition='term'
      and coalesce(s.completed_at,s.created_at)<=v_cutoff
      and (s.completed_at is not null or s.status in ('completed','cancelled'))
      and (s.cancelled_at is null or s.cancelled_at>v_cutoff)
  ), all_payments as (
    select * from actual
    union all
    select * from term where amount>0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'method',method,'amount',amount,'count',payment_count,'payment_count',payment_count,
           'tendered_amount',tendered_amount,'change_amount',change_amount,'status','paid'
         ) order by method),'[]'::jsonb),
         coalesce(sum(amount) filter(where method<>'term_sale'),0),
         coalesce(sum(amount) filter(where method='cash'),0)
    into v_payments,v_received,v_cash
  from all_payments;

  select coalesce(sum(cm.amount) filter(where cm.movement_type='supply'),0),
         coalesce(sum(cm.amount) filter(where cm.movement_type='receivable'),0),
         coalesce(sum(cm.amount) filter(where cm.movement_type in ('withdrawal','sangria')),0),
         coalesce(sum(cm.amount) filter(where cm.movement_type='expense'),0),
         coalesce(sum(cm.amount) filter(where cm.movement_type='refund'),0)
    into v_supply,v_receivable,v_withdrawal,v_expense,v_refund
  from public.cash_movements cm
  where cm.cash_session_id=p_cash_id and cm.created_at<=v_cutoff;

  select coalesce(jsonb_agg(jsonb_build_object('movement_type',x.movement_type,'amount',x.amount,'count',x.cnt) order by x.movement_type),'[]'::jsonb)
    into v_movements
  from (
    select cm.movement_type,sum(cm.amount)::numeric amount,count(*)::int cnt
    from public.cash_movements cm
    where cm.cash_session_id=p_cash_id and cm.created_at<=v_cutoff
    group by cm.movement_type
  ) x;

  v_expected:=v_opening+v_cash+v_supply+v_receivable-v_withdrawal-v_expense-v_refund;

  return jsonb_build_object(
    'source','server_snapshot','cash_session_id',p_cash_id,'cutoff',v_cutoff,
    'opened_at',v_opened_at,'business_date',v_business_date,'opening_amount',v_opening,
    'sales_count',v_sales_count,'sales_total',v_sales_total,'subtotal',v_subtotal,
    'discounts',v_discounts,'surcharges',v_surcharges,'payments',v_payments,
    'received_total',v_received,'cash_payments',v_cash,'cash_received',v_cash,
    'movements',v_movements,'supply',v_supply,'receivable_received',v_receivable,
    'withdrawal',v_withdrawal,'expense',v_expense,'refund',v_refund,'expected_cash',v_expected
  );
end;
$$;

create or replace function private.cash_session_audit_fill_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_cutoff timestamptz;
  v_base jsonb;
  v_prior jsonb;
  v_expected numeric;
  v_closing numeric;
begin
  v_cutoff:=case when new.action='management_reopen' then new.previous_closed_at else coalesce(new.new_closed_at,new.previous_closed_at,new.created_at,now()) end;
  if new.action in ('management_reopen','management_correct') then
    select a.snapshot into v_prior
    from public.cash_session_audit a
    where a.cash_session_id=new.cash_session_id
      and a.action in ('management_close','management_correct')
      and coalesce(a.new_closed_at,a.previous_closed_at)=coalesce(new.previous_closed_at,new.new_closed_at)
      and a.snapshot is not null
    order by a.created_at desc limit 1;
  end if;
  v_base:=coalesce(v_prior,private.cash_closure_snapshot(new.cash_session_id,v_cutoff),'{}'::jsonb)||coalesce(new.snapshot,'{}'::jsonb);
  v_expected:=coalesce(new.expected_cash,(v_base->>'expected_cash')::numeric,0);
  v_closing:=case when new.action='management_reopen' then new.previous_closing_amount else coalesce(new.new_closing_amount,new.previous_closing_amount) end;
  new.snapshot:=v_base||jsonb_build_object(
    'closed_at',v_cutoff,'expected_cash',v_expected,'closing_amount',v_closing,
    'difference',case when v_closing is null then null else v_closing-v_expected end
  );
  return new;
end;
$$;

drop trigger if exists trg_cash_session_audit_fill_snapshot on public.cash_session_audit;
create trigger trg_cash_session_audit_fill_snapshot
before insert on public.cash_session_audit
for each row execute function private.cash_session_audit_fill_snapshot();

update public.cash_session_audit a
set snapshot=(private.cash_closure_snapshot(
      a.cash_session_id,
      case when a.action='management_reopen' then a.previous_closed_at else coalesce(a.new_closed_at,a.previous_closed_at,a.created_at) end
    )||jsonb_build_object(
      'closed_at',case when a.action='management_reopen' then a.previous_closed_at else coalesce(a.new_closed_at,a.previous_closed_at,a.created_at) end,
      'expected_cash',coalesce(a.expected_cash,(private.cash_closure_snapshot(a.cash_session_id,coalesce(a.new_closed_at,a.previous_closed_at,a.created_at))->>'expected_cash')::numeric,0),
      'closing_amount',case when a.action='management_reopen' then a.previous_closing_amount else coalesce(a.new_closing_amount,a.previous_closing_amount) end,
      'difference',case
        when (case when a.action='management_reopen' then a.previous_closing_amount else coalesce(a.new_closing_amount,a.previous_closing_amount) end) is null then null
        else (case when a.action='management_reopen' then a.previous_closing_amount else coalesce(a.new_closing_amount,a.previous_closing_amount) end)
             -coalesce(a.expected_cash,(private.cash_closure_snapshot(a.cash_session_id,coalesce(a.new_closed_at,a.previous_closed_at,a.created_at))->>'expected_cash')::numeric,0)
      end
    ))
where a.snapshot is null;

create or replace function public.pdv_cash_closure_snapshot_save(
  p_device_token text,
  p_cash_session_id uuid,
  p_reconciliation jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  v_cs public.cash_sessions%rowtype;
  v_audit_id uuid;
  v_expected numeric;
begin
  select * into v from private.resolve_pdv_device(p_device_token);
  if v.device_id is null then return jsonb_build_object('ok',false,'error','invalid_device'); end if;
  select * into v_cs from public.cash_sessions
  where id=p_cash_session_id and tenant_id=v.tenant_id and pos_register_id=v.pos_register_id;
  if v_cs.id is null then return jsonb_build_object('ok',false,'error','cash_not_found'); end if;
  select a.id,coalesce(a.expected_cash,(a.snapshot->>'expected_cash')::numeric,0)
    into v_audit_id,v_expected
  from public.cash_session_audit a
  where a.cash_session_id=v_cs.id and a.action='management_close'
    and coalesce(a.new_closed_at,a.created_at)<=coalesce(v_cs.closed_at,now())+interval '2 seconds'
  order by a.created_at desc limit 1;
  if v_audit_id is null then return jsonb_build_object('ok',false,'error','closure_audit_not_found'); end if;
  update public.cash_session_audit
  set snapshot=coalesce(snapshot,'{}'::jsonb)||coalesce(p_reconciliation,'{}'::jsonb)||jsonb_build_object(
      'cash_session_id',v_cs.id,'closed_at',v_cs.closed_at,'closing_amount',v_cs.closing_amount,
      'expected_cash',v_expected,'difference',coalesce(v_cs.closing_amount,0)-v_expected
    )
  where id=v_audit_id;
  return jsonb_build_object('ok',true,'audit_id',v_audit_id);
end;
$$;

create or replace function public.erp_cash_closure_history(
  p_token text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_operator uuid default null,
  p_branch uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  v_start timestamptz:=coalesce(p_start,date_trunc('day',now()));
  v_end timestamptz:=coalesce(p_end,date_trunc('day',now())+interval '1 day');
  v_data jsonb;
  v_can_correct boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_can_correct:=private.management_has_permission(p_token,'cash.correct_closure');
  with session_meta as (
    select cs.id,cs.status,cs.business_date,cs.opening_amount,cs.closing_amount,cs.opened_at,cs.closed_at,cs.notes,cs.staff_user_id,
           pr.id pos_id,pr.name pos,pr.code pos_code,pr.branch_id,b.name branch,su.name operator
    from public.cash_sessions cs
    join public.pos_registers pr on pr.id=cs.pos_register_id
    join public.branches b on b.id=pr.branch_id
    left join public.staff_users su on su.id=cs.staff_user_id
    where cs.tenant_id=v.tenant_id
      and (p_branch is null or pr.branch_id=p_branch)
      and (p_operator is null or cs.staff_user_id=p_operator)
  ), current_closed as (
    select m.*,a.id closure_audit_id,
           coalesce(a.snapshot,private.cash_closure_snapshot(m.id,m.closed_at)) snap,
           null::timestamptz reopened_at,null::text reopen_reason,'current'::text record_state
    from session_meta m
    left join lateral (
      select x.* from public.cash_session_audit x
      where x.cash_session_id=m.id and x.action in ('management_close','management_correct')
        and coalesce(x.new_closed_at,x.previous_closed_at)=m.closed_at
      order by x.created_at desc limit 1
    ) a on true
    where m.status='closed' and m.closed_at>=v_start and m.closed_at<v_end
  ), reopened as (
    select m.*,a.id closure_audit_id,
           coalesce(a.snapshot,private.cash_closure_snapshot(m.id,a.previous_closed_at)) snap,
           a.created_at reopened_at,a.reason reopen_reason,'reopened'::text record_state
    from public.cash_session_audit a join session_meta m on m.id=a.cash_session_id
    where a.action='management_reopen' and a.previous_closed_at>=v_start and a.previous_closed_at<v_end
  ), candidates as (
    select * from current_closed union all select * from reopened
  ), shaped as (
    select c.id cash_session_id,c.closure_audit_id,c.pos_id,c.pos,c.pos_code,c.branch_id,c.branch,c.operator,c.staff_user_id operator_id,
           c.business_date,c.opened_at,
           case when c.record_state='reopened' then (c.snap->>'closed_at')::timestamptz else c.closed_at end closed_at,
           coalesce((c.snap->>'opening_amount')::numeric,c.opening_amount,0) opening_amount,
           extract(epoch from ((case when c.record_state='reopened' then (c.snap->>'closed_at')::timestamptz else c.closed_at end)-c.opened_at))/60 duration_minutes,
           coalesce((c.snap->>'sales_count')::numeric,0)::int sales_count,
           coalesce((c.snap->>'subtotal')::numeric,0) subtotal,
           coalesce((c.snap->>'discounts')::numeric,0) discounts,
           coalesce((c.snap->>'surcharges')::numeric,0) surcharges,
           coalesce((c.snap->>'sales_total')::numeric,0) sales_total,
           coalesce((c.snap->>'received_total')::numeric,0) received_total,
           coalesce((c.snap->>'cash_received')::numeric,(c.snap->>'cash_payments')::numeric,0) cash_received,
           coalesce((c.snap->>'supply')::numeric,0) supply,
           coalesce((c.snap->>'receivable_received')::numeric,0) receivable_received,
           coalesce((c.snap->>'withdrawal')::numeric,0) withdrawal,
           coalesce((c.snap->>'expense')::numeric,0) expense,
           coalesce((c.snap->>'refund')::numeric,0) refund,
           coalesce((c.snap->>'expected_cash')::numeric,0) expected_cash,
           coalesce((c.snap->>'closing_amount')::numeric,c.closing_amount,0) closing_amount,
           coalesce((c.snap->>'difference')::numeric,coalesce((c.snap->>'closing_amount')::numeric,c.closing_amount,0)-coalesce((c.snap->>'expected_cash')::numeric,0)) difference,
           (select count(*) from public.cash_session_audit ca where ca.cash_session_id=c.id and ca.action='management_correct') correction_count,
           (select max(ca.created_at) from public.cash_session_audit ca where ca.cash_session_id=c.id and ca.action='management_correct') last_correction_at,
           c.notes,c.reopened_at,c.reopen_reason,c.record_state
    from candidates c
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.closed_at desc),'[]'::jsonb) into v_data from shaped s;
  return jsonb_build_object('ok',true,'data',v_data,'start',v_start,'end',v_end,
    'can_correct',v_can_correct,'can_reopen',v_can_correct,'permission','cash.correct_closure');
end;
$$;

create or replace function public.erp_cash_closure_detail_v2(
  p_token text,
  p_cash_id uuid,
  p_closure_audit_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  v_cs public.cash_sessions%rowtype;
  v_a public.cash_session_audit%rowtype;
  v_cutoff timestamptz;
  v_snapshot jsonb;
  v_session jsonb;
  v_payments jsonb;
  v_movements jsonb;
  v_sales jsonb;
  v_audit jsonb;
  v_fiscal jsonb;
  v_can boolean;
  v_record_state text:='current';
  v_closing numeric;
  v_expected numeric;
  v_status text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into v_cs from public.cash_sessions where id=p_cash_id and tenant_id=v.tenant_id;
  if v_cs.id is null then return jsonb_build_object('ok',false,'error','cash_not_found'); end if;
  v_can:=private.management_has_permission(p_token,'cash.correct_closure');
  if p_closure_audit_id is not null then
    select * into v_a from public.cash_session_audit
    where id=p_closure_audit_id and cash_session_id=p_cash_id and tenant_id=v.tenant_id;
    if v_a.id is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;
    if v_a.action='management_reopen' then
      v_cutoff:=v_a.previous_closed_at; v_record_state:='reopened'; v_closing:=v_a.previous_closing_amount;
    else
      v_cutoff:=coalesce(v_a.new_closed_at,v_a.previous_closed_at); v_closing:=coalesce(v_a.new_closing_amount,v_a.previous_closing_amount);
    end if;
    v_snapshot:=coalesce(v_a.snapshot,private.cash_closure_snapshot(p_cash_id,v_cutoff));
  else
    v_cutoff:=v_cs.closed_at; v_closing:=v_cs.closing_amount;
    if v_cutoff is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;
    select * into v_a from public.cash_session_audit
    where cash_session_id=p_cash_id and tenant_id=v.tenant_id
      and action in ('management_close','management_correct')
      and coalesce(new_closed_at,previous_closed_at)=v_cutoff
    order by created_at desc limit 1;
    v_snapshot:=coalesce(v_a.snapshot,private.cash_closure_snapshot(p_cash_id,v_cutoff));
  end if;
  if v_cutoff is null then return jsonb_build_object('ok',false,'error','closure_not_found'); end if;
  v_expected:=coalesce((v_snapshot->>'expected_cash')::numeric,v_a.expected_cash,0);
  v_closing:=coalesce((v_snapshot->>'closing_amount')::numeric,v_closing,0);
  v_status:=case when v_record_state='reopened' then 'reopened' else 'closed' end;
  select to_jsonb(x)||v_snapshot||jsonb_build_object(
      'id',v_cs.id,'status',v_status,'record_state',v_record_state,
      'closure_audit_id',p_closure_audit_id,'closed_at',v_cutoff,
      'closing_amount',v_closing,'expected_cash',v_expected,'difference',v_closing-v_expected,
      'duration_minutes',extract(epoch from (v_cutoff-v_cs.opened_at))/60,
      'reopened_at',case when v_record_state='reopened' then v_a.created_at else null end,
      'reopen_reason',case when v_record_state='reopened' then v_a.reason else null end
    ) into v_session
  from (
    select v_cs.id,v_cs.business_date,v_cs.opening_amount,v_cs.opened_at,v_cs.notes,v_cs.staff_user_id operator_id,
           su.name operator,su.email operator_email,pr.id pos_id,pr.name pos,pr.code pos_code,
           b.id branch_id,b.name branch,b.cnpj branch_cnpj
    from public.pos_registers pr join public.branches b on b.id=pr.branch_id
    left join public.staff_users su on su.id=v_cs.staff_user_id
    where pr.id=v_cs.pos_register_id
  ) x;
  v_payments:=coalesce(v_snapshot->'payments','[]'::jsonb);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_movements
  from (
    select cm.id,cm.created_at,cm.movement_type,cm.amount,cm.payment_method,cm.notes,cm.financial_entry_id
    from public.cash_movements cm where cm.cash_session_id=p_cash_id and cm.created_at<=v_cutoff
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) into v_sales
  from (
    select s.id,s.number,
           case when s.cancelled_at is not null and s.cancelled_at<=v_cutoff then 'cancelled'
                when s.completed_at is not null and s.completed_at<=v_cutoff then 'completed' else s.status end status,
           s.subtotal,s.discount,s.surcharge,s.total,s.payment_condition,s.consumer_document,
           coalesce(s.completed_at,s.created_at) occurred_at,s.cancelled_at,su.name operator,
           fd.id fiscal_document_id,fd.document_type,fd.status fiscal_status,fd.series fiscal_series,fd.number fiscal_number,
           fd.access_key,fd.protocol,fd.cancellation_protocol,fd.rejection_code,fd.rejection_message
    from public.sales s
    left join public.staff_users su on su.id=s.staff_user_id
    left join lateral (select f.* from public.fiscal_documents f where f.sale_id=s.id and f.created_at<=v_cutoff order by f.created_at desc limit 1) fd on true
    where s.cash_session_id=p_cash_id and coalesce(s.completed_at,s.created_at)<=v_cutoff
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_audit
  from (
    select a.id,a.action,a.previous_status,a.new_status,a.previous_closing_amount,a.new_closing_amount,
           a.previous_closed_at,a.new_closed_at,a.expected_cash,a.reason,a.actor_user_id,a.actor_email,a.source,a.created_at,
           case a.action when 'management_close' then 'Fechamento' when 'management_reopen' then 'Reabertura' when 'management_correct' then 'Correção do fechamento' else a.action end action_label
    from public.cash_session_audit a where a.cash_session_id=p_cash_id
  ) x;
  select jsonb_build_object(
    'total',count(fd.id),'authorized',count(fd.id) filter(where fd.status='authorized'),
    'cancelled',count(fd.id) filter(where fd.status='cancelled'),'rejected',count(fd.id) filter(where fd.status='rejected'),
    'pending',count(fd.id) filter(where fd.status not in ('authorized','cancelled','rejected')),
    'nfe',count(fd.id) filter(where fd.document_type='nfe'),'nfce',count(fd.id) filter(where fd.document_type='nfce')
  ) into v_fiscal
  from public.fiscal_documents fd join public.sales s on s.id=fd.sale_id
  where s.cash_session_id=p_cash_id and coalesce(s.completed_at,s.created_at)<=v_cutoff and fd.created_at<=v_cutoff;
  return jsonb_build_object(
    'ok',true,'session',v_session,'payments',v_payments,'movements',v_movements,'sales',v_sales,
    'audit',v_audit,'fiscal',v_fiscal,'snapshot',v_snapshot,
    'can_correct',v_can and v_record_state='current' and v_cs.status='closed' and v_cs.closed_at=v_cutoff,
    'can_reopen',v_can and v_record_state='current' and v_cs.status='closed' and v_cs.closed_at=v_cutoff,
    'permission','cash.correct_closure'
  );
end;
$$;
