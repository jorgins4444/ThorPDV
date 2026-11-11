-- ThorGestão: remoção lógica segura de terminais PDV.
-- Mantém vínculos fiscais e históricos. Requer sessão administrativa válida.
create or replace function public.erp_pdv_device_remove(p_device_id uuid, p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $$
declare v record; d public.pdv_devices%rowtype;
begin
 select * into v from private.resolve_temp_context(p_token);
 if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 if not private.management_has_permission(p_token,'all') and not private.management_has_permission(p_token,'pdv.manage') then
  return jsonb_build_object('ok',false,'error','permission_denied');
 end if;
 select * into d from public.pdv_devices where id=p_device_id and tenant_id=v.tenant_id for update;
 if d.id is null then return jsonb_build_object('ok',false,'error','device_not_found'); end if;
 if coalesce(d.config,'{}'::jsonb) ? 'removed_at' then return jsonb_build_object('ok',true,'removed',true,'already_removed',true); end if;
 update public.pdv_devices set status='blocked',
  config=coalesce(config,'{}'::jsonb)||jsonb_build_object('removed_at',now(),'removed_by',v.user_id),
  updated_at=now() where id=d.id;
 delete from private.pdv_device_credentials where device_id=d.id;
 return jsonb_build_object('ok',true,'removed',true,'device_id',d.id);
end $$;
revoke all on function public.erp_pdv_device_remove(uuid,text) from public;
grant execute on function public.erp_pdv_device_remove(uuid,text) to anon,authenticated,service_role;

-- Excluir terminais logicamente removidos da consulta existente sem perder o histórico.
-- A função erp_pdv_devices foi atualizada no banco para filtrar config ? 'removed_at'.
-- A função pdv_enroll foi atualizada no banco para limpar removed_at/removed_by ao reparear.
notify pgrst,'reload schema';
