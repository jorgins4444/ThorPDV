create or replace function private.resolve_temp_staff_user(p_temp_user uuid,p_tenant uuid,p_branch uuid default null)
returns uuid language sql stable security definer set search_path='public','private' as $$
  select su.id from private.temp_users tu join public.staff_users su on su.tenant_id=p_tenant and su.active=true and lower(trim(su.email))=lower(trim(tu.email))
  where tu.id=p_temp_user and tu.active=true and (p_branch is null or su.branch_id is null or su.branch_id=p_branch)
  order by case when su.branch_id=p_branch then 0 else 1 end,su.updated_at desc limit 1
$$;

create or replace function public.erp_user_cash_get(p_token text) returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record;v_staff uuid;cs record;v_payments jsonb;v_expected numeric;v_sales numeric;v_received numeric;v_cash numeric;begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 v_staff:=private.resolve_temp_staff_user(v.user_id,v.tenant_id,v.branch_id);if v_staff is null then return jsonb_build_object('ok',false,'error','pdv_operator_not_linked');end if;
 select c.id,c.status,c.opening_amount,c.opened_at,c.business_date,c.pos_register_id,p.name pos,p.code pos_code,b.name branch,su.name operator into cs
 from public.cash_sessions c join public.pos_registers p on p.id=c.pos_register_id join public.branches b on b.id=p.branch_id left join public.staff_users su on su.id=c.staff_user_id
 where c.tenant_id=v.tenant_id and c.staff_user_id=v_staff and c.status='open' order by c.opened_at desc limit 1;
 if cs.id is null then return jsonb_build_object('ok',true,'has_open_cash',false,'staff_user_id',v_staff,'operator',(select name from public.staff_users where id=v_staff));end if;
 select coalesce(sum(s.total),0) into v_sales from public.sales s where s.cash_session_id=cs.id and s.status='completed';
 select coalesce(sum(p.amount),0) into v_received from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized');
 select coalesce(sum(p.amount),0) into v_cash from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash';
 select cs.opening_amount+coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash'),0)+coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('supply','receivable')),0)-coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria','expense','refund')),0) into v_expected;
 select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount) order by x.method),'[]'::jsonb) into v_payments from (select p.method,sum(p.amount) amount from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') group by p.method)x;
 return jsonb_build_object('ok',true,'has_open_cash',true,'staff_user_id',v_staff,'cash',jsonb_build_object('id',cs.id,'status',cs.status,'opening_amount',cs.opening_amount,'opened_at',cs.opened_at,'business_date',cs.business_date,'pos_register_id',cs.pos_register_id,'pos',cs.pos,'pos_code',cs.pos_code,'branch',cs.branch,'operator',cs.operator,'sales_total',v_sales,'received_total',v_received,'cash_received',v_cash,'expected_cash',v_expected,'is_current_business_day',cs.business_date=private.pdv_business_date(now()),'payments',v_payments));end $$;

create or replace function public.erp_user_cash_close(p_token text,p_closing numeric,p_notes text default null) returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record;v_staff uuid;v_cash uuid;v_expected numeric;v_diff numeric;begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 v_staff:=private.resolve_temp_staff_user(v.user_id,v.tenant_id,v.branch_id);if v_staff is null then return jsonb_build_object('ok',false,'error','pdv_operator_not_linked');end if;
 select cs.id,cs.opening_amount+coalesce((select sum(p.amount) from public.payments p join public.sales s on s.id=p.sale_id where s.cash_session_id=cs.id and s.status='completed' and p.status in ('paid','authorized') and p.method='cash'),0)+coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('supply','receivable')),0)-coalesce((select sum(amount) from public.cash_movements where cash_session_id=cs.id and movement_type in ('withdrawal','sangria','expense','refund')),0) into v_cash,v_expected from public.cash_sessions cs where cs.tenant_id=v.tenant_id and cs.staff_user_id=v_staff and cs.status='open' order by cs.opened_at desc limit 1 for update;
 if v_cash is null then return jsonb_build_object('ok',false,'error','user_cash_not_open');end if;v_diff:=greatest(coalesce(p_closing,0),0)-v_expected;
 update public.cash_sessions set status='closed',closing_amount=greatest(coalesce(p_closing,0),0),closed_at=now(),notes=concat_ws(E'\n',notes,p_notes,'Fechamento pelo ThorGestão','Esperado: '||v_expected::text,'Diferença: '||v_diff::text) where id=v_cash;
 return jsonb_build_object('ok',true,'cash_id',v_cash,'expected',v_expected,'closing',greatest(coalesce(p_closing,0),0),'difference',v_diff);end $$;

create or replace function public.erp_cash_open(p_token text,p_pos_id uuid,p_opening numeric default 0) returns jsonb language plpgsql security definer set search_path='public','private','extensions' as $$
declare v record;v_id uuid;v_staff uuid;begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 if not exists(select 1 from public.pos_registers where id=p_pos_id and tenant_id=v.tenant_id and active=true) then return jsonb_build_object('ok',false,'error','pos_not_found');end if;
 v_staff:=private.resolve_temp_staff_user(v.user_id,v.tenant_id,v.branch_id);if v_staff is null then return jsonb_build_object('ok',false,'error','pdv_operator_not_linked');end if;
 if exists(select 1 from public.cash_sessions where staff_user_id=v_staff and tenant_id=v.tenant_id and status='open') then return jsonb_build_object('ok',false,'error','cash_user_already_open');end if;
 if exists(select 1 from public.cash_sessions where pos_register_id=p_pos_id and status='open') then return jsonb_build_object('ok',false,'error','cash_already_open');end if;
 insert into public.cash_sessions(tenant_id,pos_register_id,staff_user_id,status,opening_amount) values(v.tenant_id,p_pos_id,v_staff,'open',greatest(coalesce(p_opening,0),0)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'staff_user_id',v_staff);end $$;

grant execute on function public.erp_user_cash_get(text) to anon,authenticated,service_role;
grant execute on function public.erp_user_cash_close(text,numeric,text) to anon,authenticated,service_role;