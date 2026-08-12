create or replace function public.erp_branch_list(p_token text)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;v_data jsonb;
begin
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.is_headquarters desc,x.name),'[]'::jsonb) into v_data from(
  select b.id,b.tenant_id,b.company_id,b.name,b.cnpj,b.is_headquarters,b.street,b.number,b.complement,b.district,b.city,b.state,b.postal_code,b.ibge_city_code,b.created_at,b.updated_at,bs.state_registration,bs.municipal_registration,bs.crt,bs.email,bs.phone,bs.contact,bs.responsible
  from public.branches b left join public.branch_settings bs on bs.branch_id=b.id where b.tenant_id=v.tenant_id
 )x;
 return jsonb_build_object('ok',true,'data',v_data);
end $$;
grant execute on function public.erp_branch_list(text) to anon,authenticated,service_role;

create or replace function public.erp_branch_profile_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,extensions as $$
declare v record;r jsonb;v_id uuid;
begin
 r:=public.erp_branch_save(p_token,p_payload);if not coalesce((r->>'ok')::boolean,false) then return r;end if;
 select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;v_id:=(r->>'id')::uuid;
 insert into public.branch_settings(branch_id,tenant_id,email,phone,state_registration,municipal_registration,crt,contact,responsible,updated_at)
 values(v_id,v.tenant_id,nullif(trim(coalesce(p_payload->>'email','')),''),nullif(trim(coalesce(p_payload->>'phone','')),''),nullif(trim(coalesce(p_payload->>'state_registration','')),''),nullif(trim(coalesce(p_payload->>'municipal_registration','')),''),nullif(trim(coalesce(p_payload->>'crt','')),''),nullif(trim(coalesce(p_payload->>'contact','')),''),nullif(trim(coalesce(p_payload->>'responsible','')),''),now())
 on conflict(branch_id) do update set email=case when p_payload?'email' then excluded.email else public.branch_settings.email end,phone=case when p_payload?'phone' then excluded.phone else public.branch_settings.phone end,state_registration=case when p_payload?'state_registration' then excluded.state_registration else public.branch_settings.state_registration end,municipal_registration=case when p_payload?'municipal_registration' then excluded.municipal_registration else public.branch_settings.municipal_registration end,crt=case when p_payload?'crt' then excluded.crt else public.branch_settings.crt end,contact=case when p_payload?'contact' then excluded.contact else public.branch_settings.contact end,responsible=case when p_payload?'responsible' then excluded.responsible else public.branch_settings.responsible end,updated_at=now();
 return r;
end $$;
grant execute on function public.erp_branch_profile_save(text,jsonb) to anon,authenticated,service_role;
