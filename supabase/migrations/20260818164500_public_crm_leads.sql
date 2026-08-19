-- Public lead capture for ThorGestao and restricted ThorControl CRM.
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 2 and 160),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  owner_name text not null check (char_length(owner_name) between 2 and 120),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  business_niche text not null check (char_length(business_niche) between 2 and 100),
  email text not null check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  plan text not null check (plan in ('basic','intermediate','advanced')),
  status text not null default 'new' check (status in ('new','contacted','proposal','won','lost')),
  notes text not null default '',
  source text not null default 'public_website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_leads_created_at_idx on public.crm_leads(created_at desc);
create index if not exists crm_leads_status_idx on public.crm_leads(status,created_at desc);
create index if not exists crm_leads_cnpj_idx on public.crm_leads(cnpj);
alter table public.crm_leads enable row level security;
revoke all on public.crm_leads from anon,authenticated;
grant insert on public.crm_leads to anon,authenticated;
drop policy if exists crm_leads_public_insert on public.crm_leads;
create policy crm_leads_public_insert on public.crm_leads for insert to anon,authenticated
with check(source='public_website' and status='new' and notes='');

create or replace function public.control_crm_leads(p_token text) returns jsonb
language plpgsql security definer set search_path=public,private,extensions as $$
declare v_admin uuid;v_rows jsonb;v_summary jsonb;
begin
 v_admin:=private.resolve_platform_admin(p_token);
 if v_admin is null then return jsonb_build_object('ok',false,'error','unauthorized');end if;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc),'[]'::jsonb) into v_rows from public.crm_leads l;
 select jsonb_build_object('total',count(*),'new',count(*) filter(where status='new'),'contacted',count(*) filter(where status='contacted'),'proposal',count(*) filter(where status='proposal'),'won',count(*) filter(where status='won')) into v_summary from public.crm_leads;
 return jsonb_build_object('ok',true,'leads',v_rows,'summary',v_summary);
end $$;

create or replace function public.control_crm_update_lead(p_token text,p_id uuid,p_status text,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=public,private,extensions as $$
declare v_admin uuid;
begin
 v_admin:=private.resolve_platform_admin(p_token);
 if v_admin is null then return jsonb_build_object('ok',false,'error','unauthorized');end if;
 if p_status not in ('new','contacted','proposal','won','lost') then return jsonb_build_object('ok',false,'error','invalid_status');end if;
 update public.crm_leads set status=p_status,notes=left(coalesce(p_notes,''),2000),updated_at=now() where id=p_id;
 if not found then return jsonb_build_object('ok',false,'error','not_found');end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.control_crm_leads(text) from public;
revoke all on function public.control_crm_update_lead(text,uuid,text,text) from public;
grant execute on function public.control_crm_leads(text) to anon,authenticated;
grant execute on function public.control_crm_update_lead(text,uuid,text,text) to anon,authenticated;
