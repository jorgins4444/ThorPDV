-- ThorGestão Dashboard Studio
-- Preferências persistentes por usuário e feed de vendas por minuto para atualização quase em tempo real.

create table if not exists public.dashboard_user_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  layout jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,user_id)
);

alter table public.dashboard_user_preferences enable row level security;
revoke all on public.dashboard_user_preferences from anon,authenticated;

create or replace function public.erp_dashboard_preferences_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  p public.dashboard_user_preferences%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into p
  from public.dashboard_user_preferences
  where tenant_id=v.tenant_id and user_id=v.user_id
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'layout',coalesce(p.layout,'[]'::jsonb),
    'settings',coalesce(p.settings,'{}'::jsonb),
    'updated_at',p.updated_at
  );
end $$;

grant execute on function public.erp_dashboard_preferences_get(text) to anon,authenticated,service_role;

create or replace function public.erp_dashboard_preferences_save(p_token text,p_layout jsonb,p_settings jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v record;
  v_layout jsonb:=coalesce(p_layout,'[]'::jsonb);
  v_settings jsonb:=coalesce(p_settings,'{}'::jsonb);
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if jsonb_typeof(v_layout)<>'array' then return jsonb_build_object('ok',false,'error','invalid_dashboard_layout'); end if;
  if jsonb_typeof(v_settings)<>'object' then return jsonb_build_object('ok',false,'error','invalid_dashboard_settings'); end if;

  insert into public.dashboard_user_preferences(tenant_id,user_id,layout,settings,updated_at)
  values(v.tenant_id,v.user_id,v_layout,v_settings,now())
  on conflict(tenant_id,user_id) do update
    set layout=excluded.layout,settings=excluded.settings,updated_at=now();

  return jsonb_build_object('ok',true,'saved_at',now());
end $$;

grant execute on function public.erp_dashboard_preferences_save(text,jsonb,jsonb) to anon,authenticated,service_role;

create or replace function public.erp_dashboard_studio(
  p_token text,
  p_start date default null::date,
  p_end date default null::date,
  p_branch uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
set timezone='America/Fortaleza'
as $$
declare
  v record;
  v_base jsonb;
  v_minute jsonb;
  v_now timestamptz:=now();
begin
  v_base:=public.erp_dashboard(p_token,p_start,p_end,p_branch);
  if coalesce((v_base->>'ok')::boolean,false)=false then return v_base; end if;

  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  with minute_axis as (
    select g as report_minute
    from generate_series(
      date_trunc('minute',v_now)-interval '59 minutes',
      date_trunc('minute',v_now),
      interval '1 minute'
    ) g
  ), sales_by_minute as (
    select date_trunc('minute',s.completed_at) report_minute,
           sum(s.total) total,
           count(*)::int quantity
    from public.sales s
    where s.tenant_id=v.tenant_id
      and s.status in ('completed','paid','fiscalized')
      and s.completed_at>=date_trunc('minute',v_now)-interval '59 minutes'
      and s.completed_at<date_trunc('minute',v_now)+interval '1 minute'
      and (p_branch is null or s.branch_id=p_branch)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'report_minute',a.report_minute,
    'total',coalesce(s.total,0),
    'quantity',coalesce(s.quantity,0)
  ) order by a.report_minute),'[]'::jsonb)
  into v_minute
  from minute_axis a
  left join sales_by_minute s using(report_minute);

  v_base:=jsonb_set(
    v_base,
    '{sales}',
    coalesce(v_base->'sales','{}'::jsonb)||jsonb_build_object(
      'net_profit',null,
      'net_profit_available',false,
      'net_profit_note','Lucro líquido ainda não auditável: faltam snapshots confiáveis de impostos, taxas financeiras, comissões e despesas por competência.'
    ),
    true
  );

  return v_base || jsonb_build_object(
    'minute',v_minute,
    'dashboard_capabilities',jsonb_build_object(
      'personal_layout',true,
      'drag_reorder',true,
      'resize_cards',true,
      'visual_type_switch',true,
      'custom_colors',true,
      'refresh_options_seconds',jsonb_build_array(0,15,30,60,300,900,3600),
      'minute_window',60,
      'net_profit_available',false
    )
  );
end $$;

grant execute on function public.erp_dashboard_studio(text,date,date,uuid) to anon,authenticated,service_role;
