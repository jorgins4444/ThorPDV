do $do$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='erp_cnab400_return_import'
  limit 1;

  if v_oid is null then
    raise exception 'erp_cnab400_return_import not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_old := $q$parsed:=private.cnab400_parse_return(p_content); hdr:=coalesce(parsed->'header','{}'::jsonb);
  if coalesce(hdr->>'bank_code','')<>'341' then return jsonb_build_object('ok',false,'error','return_not_itau_cnab400','bank_code',hdr->>'bank_code'); end if;$q$;
  v_new := $q$parsed:=private.cnab400_parse_return(p_content); hdr:=coalesce(parsed->'header','{}'::jsonb);
  if coalesce(hdr->>'bank_code','')<>'341' then
    return jsonb_build_object('ok',false,'error','return_not_itau_cnab400','bank_code',hdr->>'bank_code');
  end if;
  if coalesce(hdr->>'operation','')<>'2'
     or upper(coalesce(hdr->>'literal',''))<>'RETORNO'
     or coalesce(hdr->>'service_code','')<>'01' then
    return jsonb_build_object(
      'ok',false,
      'error','cnab400_file_is_not_return',
      'operation',hdr->>'operation',
      'literal',hdr->>'literal',
      'service_code',hdr->>'service_code',
      'detected_type',case
        when coalesce(hdr->>'operation','')='1' or upper(coalesce(hdr->>'literal',''))='REMESSA' then 'remittance'
        else 'unknown'
      end
    );
  end if;$q$;

  if position(v_old in v_def)=0 then
    raise exception 'target import guard block not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end $do$;
