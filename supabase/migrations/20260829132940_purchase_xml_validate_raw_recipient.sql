create or replace function private.validate_purchase_nfe_recipient()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $function$
declare
  v_expected text;
  v_raw text;
  v_dest text;
  v_doc xml;
begin
  if coalesce(new.source,'manual') <> 'nfe_xml' then
    return new;
  end if;

  select regexp_replace(coalesce(b.cnpj,''),'\D','','g')
    into v_expected
  from public.branches b
  where b.id=new.branch_id and b.tenant_id=new.tenant_id;

  if coalesce(v_expected,'')='' then
    raise exception 'branch_cnpj_not_configured';
  end if;

  v_raw:=coalesce(new.xml_metadata->>'raw_xml','');
  if v_raw='' then
    raise exception 'nfe_raw_xml_required';
  end if;

  begin
    v_doc:=xmlparse(document v_raw);
  exception when others then
    raise exception 'invalid_nfe_xml';
  end;

  v_dest:=coalesce((xpath('//*[local-name()="dest"]/*[local-name()="CNPJ"]/text()',v_doc))[1]::text,'');
  v_dest:=regexp_replace(v_dest,'\D','','g');

  if length(v_dest)<>14 then
    raise exception 'invalid_destination_cnpj';
  end if;

  if v_dest<>v_expected then
    raise exception 'nfe_destination_mismatch';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_validate_purchase_nfe_recipient on public.purchases;
create trigger trg_validate_purchase_nfe_recipient
before insert or update of source,branch_id,xml_metadata
on public.purchases
for each row
execute function private.validate_purchase_nfe_recipient();
