create table if not exists public.fiscal_cfop_rules(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  purpose text null,
  presence text null,
  destination_scope text not null,
  consumer_final boolean null,
  indicator_ie text null,
  cfop_id uuid not null references public.fiscal_cfops(id) on delete restrict,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_cfop_rules_purpose_chk check (purpose is null or purpose in ('1','2','3','4')),
  constraint fiscal_cfop_rules_presence_chk check (presence is null or presence in ('0','1','2','3','5','9')),
  constraint fiscal_cfop_rules_scope_chk check (destination_scope in ('internal','interstate','foreign')),
  constraint fiscal_cfop_rules_ie_chk check (indicator_ie is null or indicator_ie in ('1','2','9')),
  constraint fiscal_cfop_rules_priority_chk check (priority between 1 and 999)
);
create index if not exists idx_fiscal_cfop_rules_match on public.fiscal_cfop_rules(tenant_id,active,destination_scope,priority);
alter table public.fiscal_cfop_rules enable row level security;

create or replace function public.erp_fiscal_cfop_rules_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; v_data jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.priority,x.name),'[]'::jsonb) into v_data
  from (
    select r.id,r.name,r.purpose,r.presence,r.destination_scope,r.consumer_final,r.indicator_ie,r.priority,r.active,
           r.cfop_id,c.code cfop_code,c.name cfop_name,c.active cfop_active
    from public.fiscal_cfop_rules r
    join public.fiscal_cfops c on c.id=r.cfop_id and c.tenant_id=r.tenant_id
    where r.tenant_id=v.tenant_id
  ) x;
  return jsonb_build_object('ok',true,'data',v_data);
end
$function$;

create or replace function public.erp_fiscal_cfop_rule_save(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record; v_id uuid; v_cfop uuid; v_code text; v_name text; v_scope text; v_purpose text; v_presence text; v_ie text; v_final boolean; v_priority integer; v_active boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  begin v_id:=nullif(p_payload->>'id','')::uuid; exception when others then v_id:=null; end;
  begin v_cfop:=(p_payload->>'cfop_id')::uuid; exception when others then return jsonb_build_object('ok',false,'error','invalid_cfop'); end;
  v_name:=btrim(coalesce(p_payload->>'name',''));
  v_scope:=coalesce(p_payload->>'destination_scope','');
  v_purpose:=nullif(p_payload->>'purpose','');
  v_presence:=nullif(p_payload->>'presence','');
  v_ie:=nullif(p_payload->>'indicator_ie','');
  v_final:=case when p_payload ? 'consumer_final' and p_payload->>'consumer_final' not in ('','any') then (p_payload->>'consumer_final')::boolean else null end;
  v_priority:=coalesce(nullif(p_payload->>'priority','')::integer,100);
  v_active:=coalesce((p_payload->>'active')::boolean,true);
  if length(v_name)<3 then return jsonb_build_object('ok',false,'error','invalid_rule_name'); end if;
  if v_scope not in ('internal','interstate','foreign') then return jsonb_build_object('ok',false,'error','invalid_destination_scope'); end if;
  if v_purpose is not null and v_purpose not in ('1','2','3','4') then return jsonb_build_object('ok',false,'error','invalid_purpose'); end if;
  if v_presence is not null and v_presence not in ('0','1','2','3','5','9') then return jsonb_build_object('ok',false,'error','invalid_presence'); end if;
  if v_ie is not null and v_ie not in ('1','2','9') then return jsonb_build_object('ok',false,'error','invalid_indicator_ie'); end if;
  if v_priority not between 1 and 999 then return jsonb_build_object('ok',false,'error','invalid_priority'); end if;
  select code into v_code from public.fiscal_cfops where id=v_cfop and tenant_id=v.tenant_id and active;
  if v_code is null then return jsonb_build_object('ok',false,'error','invalid_cfop'); end if;
  if (v_scope='internal' and left(v_code,1)<>'5') or (v_scope='interstate' and left(v_code,1)<>'6') or (v_scope='foreign' and left(v_code,1)<>'7') then
    return jsonb_build_object('ok',false,'error','cfop_scope_mismatch','cfop',v_code,'destination_scope',v_scope);
  end if;
  if v_id is null then
    insert into public.fiscal_cfop_rules(tenant_id,name,purpose,presence,destination_scope,consumer_final,indicator_ie,cfop_id,priority,active)
    values(v.tenant_id,v_name,v_purpose,v_presence,v_scope,v_final,v_ie,v_cfop,v_priority,v_active) returning id into v_id;
  else
    update public.fiscal_cfop_rules set name=v_name,purpose=v_purpose,presence=v_presence,destination_scope=v_scope,consumer_final=v_final,indicator_ie=v_ie,cfop_id=v_cfop,priority=v_priority,active=v_active,updated_at=now()
    where id=v_id and tenant_id=v.tenant_id returning id into v_id;
    if v_id is null then return jsonb_build_object('ok',false,'error','rule_not_found'); end if;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end
$function$;

create or replace function private.resolve_nfe_cfop(
  p_tenant uuid,
  p_product_cfop text,
  p_purpose text,
  p_presence text,
  p_emitter_state text,
  p_recipient_state text,
  p_consumer_final boolean,
  p_indicator_ie text
) returns jsonb
language plpgsql
stable
set search_path to 'public','private','extensions'
as $function$
declare
  v_scope text; v_prefix text; v_rule record; v_product text:=regexp_replace(coalesce(p_product_cfop,''),'\D','','g'); v_code text;
begin
  if upper(coalesce(p_recipient_state,''))='EX' then v_scope:='foreign'; v_prefix:='7';
  elsif upper(coalesce(p_emitter_state,''))<>'' and upper(coalesce(p_recipient_state,''))=upper(coalesce(p_emitter_state,'')) then v_scope:='internal'; v_prefix:='5';
  elsif upper(coalesce(p_recipient_state,''))<>'' then v_scope:='interstate'; v_prefix:='6';
  else return jsonb_build_object('cfop',null,'source','none','reason','UF do destinatário não informada','destination_scope',null); end if;

  select r.*,c.code cfop_code,c.name cfop_name into v_rule
  from public.fiscal_cfop_rules r join public.fiscal_cfops c on c.id=r.cfop_id
  where r.tenant_id=p_tenant and r.active and c.active and r.destination_scope=v_scope
    and (r.purpose is null or r.purpose=p_purpose)
    and (r.presence is null or r.presence=p_presence)
    and (r.consumer_final is null or r.consumer_final=p_consumer_final)
    and (r.indicator_ie is null or r.indicator_ie=p_indicator_ie)
  order by r.priority asc,
    ((r.purpose is not null)::int+(r.presence is not null)::int+(r.consumer_final is not null)::int+(r.indicator_ie is not null)::int) desc,
    r.created_at asc
  limit 1;
  if found then
    return jsonb_build_object('cfop',v_rule.cfop_code,'cfop_name',v_rule.cfop_name,'source','rule','rule_id',v_rule.id,'rule_name',v_rule.name,'reason',format('Regra %s · %s',v_rule.name,case v_scope when 'internal' then 'mesma UF' when 'interstate' then 'outra UF' else 'exterior' end),'destination_scope',v_scope);
  end if;

  if v_product ~ '^[0-9]{4}$' then
    select code into v_code from public.fiscal_cfops where tenant_id=p_tenant and active and code=v_product and left(code,1)=v_prefix limit 1;
    if v_code is not null then return jsonb_build_object('cfop',v_code,'source','product_default','reason','CFOP padrão do produto compatível com o destino','destination_scope',v_scope); end if;
    select code into v_code from public.fiscal_cfops where tenant_id=p_tenant and active and code=(v_prefix||substr(v_product,2,3)) limit 1;
    if v_code is not null then return jsonb_build_object('cfop',v_code,'source','counterpart','reason',format('CFOP equivalente do catálogo para %s',case v_scope when 'internal' then 'operação interna' when 'interstate' then 'operação interestadual' else 'exportação' end),'destination_scope',v_scope); end if;
  end if;
  return jsonb_build_object('cfop',null,'source','none','reason','Nenhuma regra automática ou CFOP equivalente foi encontrado','destination_scope',v_scope);
end
$function$;

create or replace function public.erp_fiscal_cfop_resolve(p_token text,p_product_cfop text,p_purpose text,p_presence text,p_recipient_state text,p_consumer_final boolean,p_indicator_ie text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare v record; b public.branches%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into b from public.branches where id=v.branch_id and tenant_id=v.tenant_id;
  return jsonb_build_object('ok',true,'data',private.resolve_nfe_cfop(v.tenant_id,p_product_cfop,p_purpose,p_presence,b.state,p_recipient_state,p_consumer_final,p_indicator_ie));
end
$function$;