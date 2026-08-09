do $do$
declare
  v_def text;
  v_before text;
begin
  v_def := pg_get_functiondef('public.erp_save(text,text,jsonb)'::regprocedure);

  v_before := v_def;
  v_def := replace(
    v_def,
    $old$coalesce(p_payload->>'type','PF'),p_payload->>'name'$old$,
    $new$case lower(coalesce(nullif(p_payload->>'type',''),'individual')) when 'pf' then 'individual' when 'individual' then 'individual' when 'pessoa_fisica' then 'individual' when 'pj' then 'company' when 'company' then 'company' when 'pessoa_juridica' then 'company' else 'individual' end,p_payload->>'name'$new$
  );
  if v_def = v_before then raise exception 'customer insert type normalization patch not applied'; end if;

  v_before := v_def;
  v_def := replace(
    v_def,
    $old$update customers set type=coalesce(p_payload->>'type',type),name=coalesce(p_payload->>'name',name)$old$,
    $new$update customers set type=case when p_payload?'type' then case lower(coalesce(nullif(p_payload->>'type',''),type)) when 'pf' then 'individual' when 'individual' then 'individual' when 'pessoa_fisica' then 'individual' when 'pj' then 'company' when 'company' then 'company' when 'pessoa_juridica' then 'company' else type end else type end,name=coalesce(p_payload->>'name',name)$new$
  );
  if v_def = v_before then raise exception 'customer update type normalization patch not applied'; end if;
  execute v_def;

  v_def := pg_get_functiondef('public.erp_list(text,text,text)'::regprocedure);
  v_before := v_def;
  v_def := replace(
    v_def,
    'select id,name,document,type,email,phone,city,state,active,created_at from customers',
    'select id,name,document,case type when ''individual'' then ''PF'' when ''company'' then ''PJ'' else type end type,email,phone,city,state,active,created_at from customers'
  );
  if v_def = v_before then raise exception 'customer list type compatibility patch not applied'; end if;
  execute v_def;
end
$do$;
