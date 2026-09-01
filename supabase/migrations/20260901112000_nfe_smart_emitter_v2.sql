-- ThorGestao NF-e smart emitter v2
-- Amplia o motor de CFOP para considerar tipo de operação e tipo fiscal do produto.
-- Também mantém Natureza da Operação opcional na UI e persiste referências fiscais.

alter table public.fiscal_cfop_rules add column if not exists operation_type text null;
alter table public.fiscal_cfop_rules add column if not exists product_type text null;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fiscal_cfop_rules_operation_type_chk') THEN
    ALTER TABLE public.fiscal_cfop_rules ADD CONSTRAINT fiscal_cfop_rules_operation_type_chk
      CHECK (operation_type is null or operation_type in ('sale','return','transfer','shipment','return_shipment','bonus','sample','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fiscal_cfop_rules_product_type_chk') THEN
    ALTER TABLE public.fiscal_cfop_rules ADD CONSTRAINT fiscal_cfop_rules_product_type_chk
      CHECK (product_type is null or product_type in ('resale','finished_product','raw_material','intermediate_product','packaging','use_consumption','fixed_asset','service','other'));
  END IF;
END $$;

create index if not exists idx_fiscal_cfop_rules_smart_match
  on public.fiscal_cfop_rules(tenant_id,active,destination_scope,operation_type,product_type,priority);

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
    select r.id,r.name,r.operation_type,r.product_type,r.purpose,r.presence,r.destination_scope,r.consumer_final,r.indicator_ie,r.priority,r.active,
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
  v record; v_id uuid; v_cfop uuid; v_code text; v_name text; v_scope text; v_operation text; v_product_type text;
  v_purpose text; v_presence text; v_ie text; v_final boolean; v_priority integer; v_active boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  begin v_id:=nullif(p_payload->>'id','')::uuid; exception when others then v_id:=null; end;
  begin v_cfop:=(p_payload->>'cfop_id')::uuid; exception when others then return jsonb_build_object('ok',false,'error','invalid_cfop'); end;
  v_name:=btrim(coalesce(p_payload->>'name',''));
  v_scope:=coalesce(p_payload->>'destination_scope','');
  v_operation:=nullif(p_payload->>'operation_type','');
  v_product_type:=nullif(p_payload->>'product_type','');
  v_purpose:=nullif(p_payload->>'purpose','');
  v_presence:=nullif(p_payload->>'presence','');
  v_ie:=nullif(p_payload->>'indicator_ie','');
  v_final:=case when p_payload ? 'consumer_final' and p_payload->>'consumer_final' not in ('','any') then (p_payload->>'consumer_final')::boolean else null end;
  v_priority:=coalesce(nullif(p_payload->>'priority','')::integer,100);
  v_active:=coalesce((p_payload->>'active')::boolean,true);

  if length(v_name)<3 then return jsonb_build_object('ok',false,'error','invalid_rule_name'); end if;
  if v_scope not in ('internal','interstate','foreign') then return jsonb_build_object('ok',false,'error','invalid_destination_scope'); end if;
  if v_operation is not null and v_operation not in ('sale','return','transfer','shipment','return_shipment','bonus','sample','other') then return jsonb_build_object('ok',false,'error','invalid_operation_type'); end if;
  if v_product_type is not null and v_product_type not in ('resale','finished_product','raw_material','intermediate_product','packaging','use_consumption','fixed_asset','service','other') then return jsonb_build_object('ok',false,'error','invalid_product_type'); end if;
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
    insert into public.fiscal_cfop_rules(tenant_id,name,operation_type,product_type,purpose,presence,destination_scope,consumer_final,indicator_ie,cfop_id,priority,active)
    values(v.tenant_id,v_name,v_operation,v_product_type,v_purpose,v_presence,v_scope,v_final,v_ie,v_cfop,v_priority,v_active) returning id into v_id;
  else
    update public.fiscal_cfop_rules set name=v_name,operation_type=v_operation,product_type=v_product_type,purpose=v_purpose,presence=v_presence,
      destination_scope=v_scope,consumer_final=v_final,indicator_ie=v_ie,cfop_id=v_cfop,priority=v_priority,active=v_active,updated_at=now()
    where id=v_id and tenant_id=v.tenant_id returning id into v_id;
    if v_id is null then return jsonb_build_object('ok',false,'error','rule_not_found'); end if;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end
$function$;

-- Mantém compatibilidade com o resolvedor já usado pelas vendas. Regras específicas de
-- operação "sale" são consideradas; regras de outros tipos nunca vazam para uma venda.
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
    and (r.operation_type is null or r.operation_type='sale')
    and r.product_type is null
    and (r.purpose is null or r.purpose=p_purpose)
    and (r.presence is null or r.presence=p_presence)
    and (r.consumer_final is null or r.consumer_final=p_consumer_final)
    and (r.indicator_ie is null or r.indicator_ie=p_indicator_ie)
  order by r.priority asc,
    ((r.operation_type is not null)::int+(r.purpose is not null)::int+(r.presence is not null)::int+(r.consumer_final is not null)::int+(r.indicator_ie is not null)::int) desc,
    r.created_at asc
  limit 1;
  if found then
    return jsonb_build_object('cfop',v_rule.cfop_code,'cfop_name',v_rule.cfop_name,'source','rule','rule_id',v_rule.id,'rule_name',v_rule.name,
      'reason',format('Regra %s · venda · %s',v_rule.name,case v_scope when 'internal' then 'mesma UF' when 'interstate' then 'outra UF' else 'exterior' end),'destination_scope',v_scope);
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

-- Wrapper v2: a Natureza pode vir vazia da interface; o servidor deriva um valor seguro.
-- Também persiste documentos fiscais referenciados no payload do rascunho.
create or replace function public.erp_nfe_manual_draft_create_v2(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_operation jsonb:=coalesce(p_payload->'operation','{}'::jsonb);
  v_operation_type text:=coalesce(nullif(p_payload#>>'{operation,operation_type}',''),'sale');
  v_purpose text:=coalesce(nullif(p_payload#>>'{operation,purpose}',''),'1');
  v_nature text:=nullif(btrim(coalesce(p_payload#>>'{operation,nature_operation}','')),'');
  v_references jsonb:=coalesce(p_payload->'references','[]'::jsonb);
  v_result jsonb;
  v_doc uuid;
  v_ref jsonb;
begin
  if v_operation_type not in ('sale','return','transfer','shipment','return_shipment','bonus','sample','other') then
    return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',jsonb_build_array('Tipo de operação da NF-e inválido'),'ready_to_send',false);
  end if;

  if v_nature is null then
    v_nature:=case
      when v_purpose='4' or v_operation_type='return' then 'DEVOLUÇÃO DE MERCADORIA'
      when v_operation_type='transfer' then 'TRANSFERÊNCIA DE MERCADORIA'
      when v_operation_type='shipment' then 'REMESSA DE MERCADORIA'
      when v_operation_type='return_shipment' then 'RETORNO DE MERCADORIA'
      when v_operation_type='bonus' then 'BONIFICAÇÃO DE MERCADORIA'
      when v_operation_type='sample' then 'REMESSA DE AMOSTRA GRÁTIS'
      when v_operation_type='other' then 'OUTRAS OPERAÇÕES'
      else 'VENDA DE MERCADORIA'
    end;
  end if;
  v_operation:=jsonb_set(v_operation,'{nature_operation}',to_jsonb(v_nature),true);
  v_payload:=jsonb_set(v_payload,'{operation}',v_operation,true);

  if jsonb_typeof(v_references) is distinct from 'array' then
    return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',jsonb_build_array('Referências fiscais inválidas'),'ready_to_send',false);
  end if;
  for v_ref in select value from jsonb_array_elements(v_references) loop
    if coalesce(v_ref->>'type','')='nfe' and length(regexp_replace(coalesce(v_ref->>'value',''),'\D','','g'))<>44 then
      return jsonb_build_object('ok',false,'error','fiscal_preflight_failed','validation_errors',jsonb_build_array('Chave de NF-e/NFC-e/CF-e referenciada deve possuir 44 dígitos'),'ready_to_send',false);
    end if;
  end loop;

  v_result:=public.erp_nfe_manual_draft_create(p_token,v_payload);
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;

  begin v_doc:=(v_result->>'id')::uuid; exception when others then v_doc:=null; end;
  if v_doc is not null then
    update public.fiscal_documents
      set request_payload=jsonb_set(request_payload,'{references}',v_references,true),updated_at=now()
    where id=v_doc;
  end if;
  return v_result||jsonb_build_object('nature_operation',v_nature,'nature_operation_auto',nullif(btrim(coalesce(p_payload#>>'{operation,nature_operation}','')),'') is null,'references_count',jsonb_array_length(v_references));
end
$function$;

-- Regras iniciais seguras para os cenários clássicos de venda. Só são criadas quando
-- o catálogo do próprio tenant contém o CFOP correspondente e não existe regra igual.
insert into public.fiscal_cfop_rules(tenant_id,name,operation_type,product_type,purpose,destination_scope,cfop_id,priority,active)
select c.tenant_id,'Venda revenda interna','sale','resale','1','internal',c.id,40,true
from public.fiscal_cfops c
where c.code='5102' and c.active
  and not exists(select 1 from public.fiscal_cfop_rules r where r.tenant_id=c.tenant_id and r.operation_type='sale' and r.product_type='resale' and r.destination_scope='internal' and r.purpose='1');

insert into public.fiscal_cfop_rules(tenant_id,name,operation_type,product_type,purpose,destination_scope,cfop_id,priority,active)
select c.tenant_id,'Venda revenda interestadual','sale','resale','1','interstate',c.id,40,true
from public.fiscal_cfops c
where c.code='6102' and c.active
  and not exists(select 1 from public.fiscal_cfop_rules r where r.tenant_id=c.tenant_id and r.operation_type='sale' and r.product_type='resale' and r.destination_scope='interstate' and r.purpose='1');

insert into public.fiscal_cfop_rules(tenant_id,name,operation_type,product_type,purpose,destination_scope,cfop_id,priority,active)
select c.tenant_id,'Venda produção própria interna','sale','finished_product','1','internal',c.id,40,true
from public.fiscal_cfops c
where c.code='5101' and c.active
  and not exists(select 1 from public.fiscal_cfop_rules r where r.tenant_id=c.tenant_id and r.operation_type='sale' and r.product_type='finished_product' and r.destination_scope='internal' and r.purpose='1');

insert into public.fiscal_cfop_rules(tenant_id,name,operation_type,product_type,purpose,destination_scope,cfop_id,priority,active)
select c.tenant_id,'Venda produção própria interestadual','sale','finished_product','1','interstate',c.id,40,true
from public.fiscal_cfops c
where c.code='6101' and c.active
  and not exists(select 1 from public.fiscal_cfop_rules r where r.tenant_id=c.tenant_id and r.operation_type='sale' and r.product_type='finished_product' and r.destination_scope='interstate' and r.purpose='1');
