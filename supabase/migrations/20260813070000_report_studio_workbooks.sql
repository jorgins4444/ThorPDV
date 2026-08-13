-- ThorGestão Report Studio
-- Workbooks pessoais com múltiplas fontes de relatório, comparativos e layout persistente.

create table if not exists public.report_studio_workbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  layout jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_studio_name_len check (char_length(trim(name)) between 1 and 80),
  unique (tenant_id,user_id,name)
);

create index if not exists idx_report_studio_workbooks_user
  on public.report_studio_workbooks(tenant_id,user_id,updated_at desc);

alter table public.report_studio_workbooks enable row level security;
revoke all on public.report_studio_workbooks from anon,authenticated;

create or replace function public.erp_report_studio_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare v record; result jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'name',w.name,'is_default',w.is_default,'updated_at',w.updated_at
  ) order by w.is_default desc,w.updated_at desc),'[]'::jsonb)
  into result
  from public.report_studio_workbooks w
  where w.tenant_id=v.tenant_id and w.user_id=v.user_id;
  return jsonb_build_object('ok',true,'workbooks',result);
end $$;

grant execute on function public.erp_report_studio_list(text) to anon,authenticated,service_role;

create or replace function public.erp_report_studio_get(p_token text,p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare v record; w public.report_studio_workbooks%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_id is null then
    select * into w from public.report_studio_workbooks
    where tenant_id=v.tenant_id and user_id=v.user_id
    order by is_default desc,updated_at desc limit 1;
  else
    select * into w from public.report_studio_workbooks
    where id=p_id and tenant_id=v.tenant_id and user_id=v.user_id limit 1;
  end if;
  if w.id is null then return jsonb_build_object('ok',true,'workbook',null); end if;
  return jsonb_build_object('ok',true,'workbook',jsonb_build_object(
    'id',w.id,'name',w.name,'layout',w.layout,'settings',w.settings,
    'is_default',w.is_default,'created_at',w.created_at,'updated_at',w.updated_at
  ));
end $$;

grant execute on function public.erp_report_studio_get(text,uuid) to anon,authenticated,service_role;

create or replace function public.erp_report_studio_save(
  p_token text,
  p_id uuid,
  p_name text,
  p_layout jsonb,
  p_settings jsonb default '{}'::jsonb,
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare v record; wid uuid; clean_name text:=trim(coalesce(p_name,''));
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if char_length(clean_name) not between 1 and 80 then return jsonb_build_object('ok',false,'error','invalid_name'); end if;
  if jsonb_typeof(coalesce(p_layout,'[]'::jsonb))<>'array' then return jsonb_build_object('ok',false,'error','invalid_layout'); end if;
  if jsonb_typeof(coalesce(p_settings,'{}'::jsonb))<>'object' then return jsonb_build_object('ok',false,'error','invalid_settings'); end if;

  if p_is_default then
    update public.report_studio_workbooks set is_default=false
    where tenant_id=v.tenant_id and user_id=v.user_id;
  end if;

  if p_id is null then
    insert into public.report_studio_workbooks(tenant_id,user_id,name,layout,settings,is_default)
    values(v.tenant_id,v.user_id,clean_name,coalesce(p_layout,'[]'::jsonb),coalesce(p_settings,'{}'::jsonb),p_is_default)
    on conflict(tenant_id,user_id,name) do update
      set layout=excluded.layout,settings=excluded.settings,is_default=excluded.is_default,updated_at=now()
    returning id into wid;
  else
    update public.report_studio_workbooks
    set name=clean_name,layout=coalesce(p_layout,'[]'::jsonb),settings=coalesce(p_settings,'{}'::jsonb),is_default=p_is_default,updated_at=now()
    where id=p_id and tenant_id=v.tenant_id and user_id=v.user_id
    returning id into wid;
    if wid is null then return jsonb_build_object('ok',false,'error','workbook_not_found'); end if;
  end if;

  return jsonb_build_object('ok',true,'id',wid,'saved_at',now());
end $$;

grant execute on function public.erp_report_studio_save(text,uuid,text,jsonb,jsonb,boolean) to anon,authenticated,service_role;

create or replace function public.erp_report_studio_delete(p_token text,p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare v record; affected int;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  delete from public.report_studio_workbooks
  where id=p_id and tenant_id=v.tenant_id and user_id=v.user_id;
  get diagnostics affected=row_count;
  return jsonb_build_object('ok',affected>0,'deleted',affected>0);
end $$;

grant execute on function public.erp_report_studio_delete(text,uuid) to anon,authenticated,service_role;
