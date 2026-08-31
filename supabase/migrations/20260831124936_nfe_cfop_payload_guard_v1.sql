create or replace function private.validate_nfe_cfop_payload()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v_emitter_state text;
  v_recipient_state text;
  v_prefix text;
  v_item jsonb;
  v_cfop text;
  v_idx integer:=0;
begin
  if new.document_type<>'nfe' then return new; end if;
  if not (new.request_payload ? 'operation') or jsonb_typeof(new.request_payload->'items')<>'array' then return new; end if;
  select upper(coalesce(state,'')) into v_emitter_state from public.branches where id=new.branch_id and tenant_id=new.tenant_id;
  v_recipient_state:=upper(coalesce(nullif(new.request_payload#>>'{recipient,state}',''),nullif(new.request_payload#>>'{customer,state}',''),''));
  if v_recipient_state='' then raise exception 'NF-e: UF do destinatário não informada para validação do CFOP'; end if;
  if v_recipient_state='EX' then v_prefix:='7';
  elsif v_recipient_state=v_emitter_state then v_prefix:='5';
  else v_prefix:='6'; end if;
  for v_item in select value from jsonb_array_elements(new.request_payload->'items') loop
    v_idx:=v_idx+1;
    v_cfop:=regexp_replace(coalesce(nullif(v_item->>'cfop',''),nullif(v_item#>>'{fiscal_snapshot,cfop}',''),''),'\D','','g');
    if v_cfop !~ '^[0-9]{4}$' then raise exception 'NF-e: item % sem CFOP válido',v_idx; end if;
    if left(v_cfop,1)<>v_prefix then raise exception 'NF-e: CFOP % do item % incompatível com o destino da operação (esperado grupo %.xxx)',v_cfop,v_idx,v_prefix; end if;
    if not exists(select 1 from public.fiscal_cfops c where c.tenant_id=new.tenant_id and c.code=v_cfop and c.active) then
      raise exception 'NF-e: CFOP % do item % não está ativo no cadastro geral',v_cfop,v_idx;
    end if;
  end loop;
  return new;
end
$function$;

drop trigger if exists trg_validate_nfe_cfop_payload on public.fiscal_documents;
create trigger trg_validate_nfe_cfop_payload
before insert or update of request_payload on public.fiscal_documents
for each row execute function private.validate_nfe_cfop_payload();