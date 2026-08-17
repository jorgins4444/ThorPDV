do $migration$
declare
  v_def text;
  v_updated text;
begin
  v_def := pg_get_functiondef(
    'public.erp_management_audit_list(text,date,date,uuid,uuid,text,text)'::regprocedure
  );

  v_updated := replace(
    v_def,
    'e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,e.metadata,e.occurred_at,',
    $needle$e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,
      case
        when coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,'')) is not null
          then jsonb_set(
            coalesce(e.metadata,'{}'::jsonb),
            '{actor_name}',
            to_jsonb(coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''))),
            true
          )
        else e.metadata
      end metadata,
      e.occurred_at,$needle$
  );

  v_updated := replace(
    v_updated,
    'e.sale_id,e.title,e.reason,',
    $needle$e.sale_id,e.title,
      case
        when coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,'')) is not null
          then replace(
            e.reason,
            'Responsável: Usuário ERP',
            'Responsável: '||coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''))
          )
        else e.reason
      end reason,$needle$
  );

  if v_updated = v_def then
    raise exception 'erp_management_audit_list definition pattern not found';
  end if;

  execute v_updated;
end
$migration$;

revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text)
  to anon, authenticated, service_role;
