create or replace function public.erp_purchase_xml_precheck(p_token text,p_access_key text)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $function$
declare
 v record;
 v_key text;
 v_purchase record;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then
  return jsonb_build_object('ok',false,'error','invalid_session');
 end if;

 v_key:=regexp_replace(coalesce(p_access_key,''),'\D','','g');
 if length(v_key)<>44 then
  return jsonb_build_object('ok',false,'error','invalid_nfe_access_key');
 end if;

 select p.id,p.number,p.document_number,p.issue_date,p.status
 into v_purchase
 from public.purchases p
 where p.tenant_id=v.tenant_id
   and p.nfe_access_key=v_key
 limit 1;

 if v_purchase.id is not null then
  return jsonb_build_object(
   'ok',true,
   'already_imported',true,
   'purchase_id',v_purchase.id,
   'purchase_number',v_purchase.number,
   'document_number',v_purchase.document_number,
   'issue_date',v_purchase.issue_date,
   'status',v_purchase.status,
   'nfe_access_key',v_key
  );
 end if;

 return jsonb_build_object('ok',true,'already_imported',false,'nfe_access_key',v_key);
end
$function$;
