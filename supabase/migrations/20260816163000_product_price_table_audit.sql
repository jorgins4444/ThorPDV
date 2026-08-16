-- Complementa o histórico de Preço com alterações em tabelas de preço e reajustes.

create or replace function private.audit_price_table_item_change()
returns trigger
language plpgsql
security definer
set search_path='public','private','auth'
as $$
declare
  v_tenant uuid;
  v_table_name text;
  v_is_default boolean;
  v_product_sale_price numeric;
  v_actor_type text;
  v_actor_id uuid;
  v_actor_name text;
  v_source_type text;
  v_source_label text;
  v_text text;
begin
  if old.price is not distinct from new.price then return new; end if;

  select pt.tenant_id,pt.name,coalesce(pt.is_default,false)
    into v_tenant,v_table_name,v_is_default
    from public.price_tables pt where pt.id=new.price_table_id;
  if v_tenant is null then return new; end if;

  -- Quando a tabela padrão foi sincronizada pelo próprio preço principal do produto,
  -- o trigger de products já registrou a mudança. Evita duplicidade no histórico.
  if v_is_default then
    select p.sale_price into v_product_sale_price from public.products p where p.id=new.product_id;
    if v_product_sale_price is not distinct from new.price
       and coalesce(nullif(current_setting('app.audit_source_type',true),''),'') not in ('price_table_manual','price_adjustment','scheduled_price_adjustment') then
      return new;
    end if;
  end if;

  v_actor_type:=nullif(current_setting('app.audit_actor_type',true),'');
  v_text:=nullif(current_setting('app.audit_actor_id',true),'');
  if v_text is not null then begin v_actor_id:=v_text::uuid; exception when others then v_actor_id:=null; end; end if;
  v_actor_name:=nullif(current_setting('app.audit_actor_name',true),'');
  v_source_type:=coalesce(nullif(current_setting('app.audit_source_type',true),''),'price_table_update');

  if v_actor_id is null and auth.uid() is not null then v_actor_type:='auth_user'; v_actor_id:=auth.uid(); end if;
  v_actor_type:=coalesce(v_actor_type,'system');
  v_actor_name:=coalesce(v_actor_name,private.audit_actor_display_name(v_actor_type,v_actor_id));

  v_source_label:=case v_source_type
    when 'price_table_manual' then 'Tabela de preço'
    when 'price_adjustment' then 'Reajuste de preços'
    when 'scheduled_price_adjustment' then 'Reajuste agendado'
    else 'Tabela de preço' end;

  insert into public.product_history(
    tenant_id,product_id,event_type,description,before_data,after_data,created_by,
    actor_type,actor_id,actor_name,source_type,metadata
  ) values(
    v_tenant,new.product_id,'Preço',
    'Tabela '||coalesce(nullif(v_table_name,''),'de preço')||': '||private.audit_money(old.price)||' → '||private.audit_money(new.price)||' • Origem: '||v_source_label,
    jsonb_build_object('price',old.price,'price_table_id',new.price_table_id,'price_table_name',v_table_name),
    jsonb_build_object('price',new.price,'price_table_id',new.price_table_id,'price_table_name',v_table_name),
    v_actor_id,v_actor_type,v_actor_id,v_actor_name,v_source_type,
    jsonb_build_object('price_table_id',new.price_table_id,'price_table_name',v_table_name,'is_default',v_is_default)
  );
  return new;
end $$;

drop trigger if exists trg_price_table_item_product_history on public.price_table_items;
create trigger trg_price_table_item_product_history
after update of price on public.price_table_items
for each row execute function private.audit_price_table_item_change();

create or replace function public.erp_price_table_set_item(p_token text,p_table_id uuid,p_product_id uuid,p_price numeric)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare v record; v_actor_name text; begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select nullif(u.email,'') into v_actor_name from private.temp_users u where u.id=v.user_id;
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_id',v.user_id::text,true);
  perform set_config('app.audit_actor_name',coalesce(v_actor_name,'Usuário ERP'),true);
  perform set_config('app.audit_source_type','price_table_manual',true);
  if not exists(select 1 from price_tables where id=p_table_id and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','price_table_not_found'); end if;
  if not exists(select 1 from products where id=p_product_id and tenant_id=v.tenant_id) then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
  if p_price<0 then return jsonb_build_object('ok',false,'error','invalid_price'); end if;
  insert into price_table_items(price_table_id,product_id,price) values(p_table_id,p_product_id,p_price)
  on conflict(price_table_id,product_id) do update set price=excluded.price;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.erp_execute_price_adjustment(p_token text,p_adjustment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare v record;a record;v_actor_name text;begin
  select * into v from private.resolve_temp_context(p_token);if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session');end if;
  select nullif(u.email,'') into v_actor_name from private.temp_users u where u.id=v.user_id;
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_id',v.user_id::text,true);
  perform set_config('app.audit_actor_name',coalesce(v_actor_name,'Usuário ERP'),true);
  perform set_config('app.audit_source_type','price_adjustment',true);
  select * into a from price_adjustments where id=p_adjustment_id and tenant_id=v.tenant_id and status in ('draft','scheduled') for update;
  if a.id is null then return jsonb_build_object('ok',false,'error','adjustment_not_executable');end if;
  if a.adjustment_type='percent' then update price_table_items set price=greatest(price*(1+a.adjustment_value/100),0) where price_table_id=a.price_table_id;
  else update price_table_items set price=greatest(price+a.adjustment_value,0) where price_table_id=a.price_table_id;end if;
  update price_adjustments set status='executed',executed_at=now() where id=a.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function private.apply_due_price_adjustments(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path='public','private'
as $$
declare a record;v_count integer:=0;begin
  perform set_config('app.audit_actor_type','system',true);
  perform set_config('app.audit_actor_name','Sistema (reajuste agendado)',true);
  perform set_config('app.audit_source_type','scheduled_price_adjustment',true);
  for a in select * from price_adjustments where tenant_id=p_tenant and status='scheduled' and execute_at is not null and execute_at<=now() for update loop
    if a.adjustment_type='percent' then
      update price_table_items set price=greatest(price*(1+a.adjustment_value/100),0) where price_table_id=a.price_table_id;
    else
      update price_table_items set price=greatest(price+a.adjustment_value,0) where price_table_id=a.price_table_id;
    end if;
    update price_adjustments set status='executed',executed_at=now() where id=a.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
