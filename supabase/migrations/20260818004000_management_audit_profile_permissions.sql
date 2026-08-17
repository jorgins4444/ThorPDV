-- Mantém administradores e supervisores já existentes com acesso ao módulo,
-- enquanto perfis operacionais continuam sem visualizar dados gerenciais.
update public.access_profiles
set permissions=jsonb_set(
      coalesce(permissions,'{}'::jsonb),
      '{audit}',
      jsonb_build_object('view',true,'details',true,'technical',true,'export',true),
      true
    ),
    updated_at=now()
where active=true
  and (
    scope='ADM'
    or lower(name) like '%administrador%'
    or lower(name) like '%supervisor%'
  )
  and not coalesce((permissions->>'all')::boolean,false);

