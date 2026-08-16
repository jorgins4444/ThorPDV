-- Histórico transparente de Estoque e Preço no cadastro de produtos.
-- Registra responsável, origem, data/hora e valores antes/depois quando disponíveis.

alter table public.product_history
  add column if not exists actor_type text,
  add column if not exists actor_id uuid,
  add column if not exists actor_name text,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists product_history_type_created_idx
  on public.product_history(product_id,event_type,created_at desc);
create index if not exists product_history_actor_idx
  on public.product_history(tenant_id,actor_type,actor_id,created_at desc);
create unique index if not exists product_history_source_unique_idx
  on public.product_history(product_id,event_type,source_type,source_id)
  where source_id is not null;

alter table public.stock_movements drop constraint if exists stock_movements_actor_type_check;
alter table public.stock_movements add constraint stock_movements_actor_type_check
  check (actor_type is null or actor_type in ('auth_user','temp_user','staff_user','pdv_device','system'));

create or replace function private.audit_actor_display_name(p_actor_type text,p_actor_id uuid)
returns text
language plpgsql
stable
security definer
set search_path='public','private','auth'
as $$
declare v_name text;
begin
  if p_actor_id is null then return 'Sistema'; end if;

  if p_actor_type='staff_user' then
    select coalesce(nullif(s.name,''),nullif(s.email,'')) into v_name
      from public.staff_users s where s.id=p_actor_id;
  elsif p_actor_type='temp_user' then
    select nullif(u.email,'') into v_name from private.temp_users u where u.id=p_actor_id;
  elsif p_actor_type='auth_user' then
    select coalesce(nullif(p.full_name,''),nullif(p.email,'')) into v_name
      from public.profiles p where p.id=p_actor_id;
    if v_name is null then select nullif(u.email,'') into v_name from auth.users u where u.id=p_actor_id; end if;
  elsif p_actor_type='pdv_device' then
    select coalesce(nullif(d.name,''),nullif(d.hostname,''),'Dispositivo PDV') into v_name
      from public.pdv_devices d where d.id=p_actor_id;
  end if;

  if v_name is null then
    select coalesce(nullif(s.name,''),nullif(s.email,'')) into v_name from public.staff_users s where s.id=p_actor_id;
  end if;
  if v_name is null then
    select nullif(u.email,'') into v_name from private.temp_users u where u.id=p_actor_id;
  end if;
  if v_name is null then
    select coalesce(nullif(p.full_name,''),nullif(p.email,'')) into v_name from public.profiles p where p.id=p_actor_id;
  end if;
  return coalesce(v_name,'Sistema');
end $$;

create or replace function private.audit_money(p_value numeric)
returns text language sql immutable as $$
  select 'R$ '||replace(to_char(coalesce(p_value,0),'FM999999999990.00'),'.',',')
$$;

create or replace function private.audit_qty(p_value numeric)
returns text language sql immutable as $$
  select replace(to_char(coalesce(p_value,0),'FM999999999990.###'),'.',',')
$$;

create or replace function private.enrich_product_history_actor()
returns trigger
language plpgsql
security definer
set search_path='public','private','auth'
as $$
begin
  new.actor_id:=coalesce(new.actor_id,new.created_by);

  if new.actor_type is null and new.actor_id is not null then
    if exists(select 1 from public.staff_users s where s.id=new.actor_id) then new.actor_type:='staff_user';
    elsif exists(select 1 from private.temp_users u where u.id=new.actor_id) then new.actor_type:='temp_user';
    elsif exists(select 1 from auth.users u where u.id=new.actor_id) then new.actor_type:='auth_user';
    elsif exists(select 1 from public.pdv_devices d where d.id=new.actor_id) then new.actor_type:='pdv_device';
    else new.actor_type:='system'; end if;
  end if;

  new.actor_type:=coalesce(new.actor_type,'system');
  new.actor_name:=coalesce(nullif(new.actor_name,''),private.audit_actor_display_name(new.actor_type,new.actor_id));

  if coalesce(new.description,'') not ilike '%Responsável:%' then
    new.description:=trim(coalesce(new.description,''))||case when coalesce(new.actor_name,'')<>'' then ' • Responsável: '||new.actor_name else '' end;
  end if;
  return new;
end $$;

drop trigger if exists trg_enrich_product_history_actor on public.product_history;
create trigger trg_enrich_product_history_actor
before insert or update of created_by,actor_type,actor_id,actor_name on public.product_history
for each row execute function private.enrich_product_history_actor();

-- Amplia a normalização de autor dos movimentos: sessão ERP, operador do PDV,
-- vendedor da venda, usuário autenticado, dispositivo ou sistema.
create or replace function private.normalize_stock_movement_actor()
returns trigger
language plpgsql
security definer
set search_path='public','private','auth'
as $$
declare
  v_actor_type text;
  v_actor_id uuid;
  v_text text;
  v_staff uuid;
  v_auth uuid;
  v_device uuid;
begin
  if new.created_by is not null then
    if exists(select 1 from auth.users u where u.id=new.created_by) then
      new.actor_type:=coalesce(new.actor_type,'auth_user');
      new.actor_id:=coalesce(new.actor_id,new.created_by);
    else
      new.actor_id:=coalesce(new.actor_id,new.created_by);
      if new.actor_type is null then
        new.actor_type:=case
          when exists(select 1 from public.staff_users s where s.id=new.created_by) then 'staff_user'
          when exists(select 1 from private.temp_users u where u.id=new.created_by) then 'temp_user'
          when exists(select 1 from public.pdv_devices d where d.id=new.created_by) then 'pdv_device'
          else 'system' end;
      end if;
      new.created_by:=null;
    end if;
  end if;

  if new.actor_id is null and new.reference_type='sale_return' and new.reference_id is not null then
    select sr.operator_user_id into v_staff from public.sale_returns sr where sr.id=new.reference_id;
    if v_staff is not null then new.actor_type:='staff_user'; new.actor_id:=v_staff; end if;
  end if;

  if new.actor_id is null and new.reference_type in ('sale','sale_cancel') and new.reference_id is not null then
    select s.seller_user_id,s.created_by,s.pdv_device_id into v_staff,v_auth,v_device
      from public.sales s where s.id=new.reference_id;
    if v_staff is not null then new.actor_type:='staff_user'; new.actor_id:=v_staff;
    elsif v_auth is not null then new.actor_type:='auth_user'; new.actor_id:=v_auth;
    elsif v_device is not null then new.actor_type:='pdv_device'; new.actor_id:=v_device; end if;
  end if;

  if new.actor_id is null then
    v_actor_type:=nullif(current_setting('app.audit_actor_type',true),'');
    v_text:=nullif(current_setting('app.audit_actor_id',true),'');
    if v_text is not null then
      begin v_actor_id:=v_text::uuid; exception when others then v_actor_id:=null; end;
    end if;
    if v_actor_id is not null then
      new.actor_type:=coalesce(v_actor_type,'system');
      new.actor_id:=v_actor_id;
    end if;
  end if;

  new.actor_type:=coalesce(new.actor_type,'system');
  return new;
end $$;

drop trigger if exists trg_normalize_stock_movement_actor on public.stock_movements;
create trigger trg_normalize_stock_movement_actor
before insert or update of created_by,actor_type,actor_id,reference_type,reference_id on public.stock_movements
for each row execute function private.normalize_stock_movement_actor();

create or replace function private.audit_stock_movement_to_product_history()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $$
declare
  v_unit text:='UN';
  v_branch text;
  v_actor_name text;
  v_source_label text;
  v_event_label text;
  v_description text;
  v_before numeric;
  v_after numeric;
  v_known_balance boolean:=false;
begin
  select coalesce(nullif(p.unit,''),'UN') into v_unit from public.products p where p.id=new.product_id;
  select b.name into v_branch from public.branches b where b.id=new.branch_id;
  v_actor_name:=private.audit_actor_display_name(coalesce(new.actor_type,'system'),new.actor_id);

  v_source_label:=case coalesce(new.reference_type,'')
    when 'sale_return' then 'Devolução da venda'
    when 'sale' then 'Venda'
    when 'sale_cancel' then 'Cancelamento de venda'
    when 'manual' then 'Movimentação manual'
    when 'transfer' then 'Transferência'
    when 'product_stock' then 'Cadastro do produto'
    when 'purchase' then 'Compra/entrada'
    when 'production' then 'Produção'
    else coalesce(nullif(new.reference_type,''),'Sistema') end;

  v_event_label:=case new.movement_type
    when 'in' then 'Entrada de estoque'
    when 'out' then 'Saída de estoque'
    when 'adjustment' then 'Ajuste de estoque'
    when 'loss' then 'Perda de estoque'
    when 'transfer_in' then 'Transferência recebida'
    when 'transfer_out' then 'Transferência enviada'
    when 'sale' then 'Baixa por venda'
    when 'sale_cancel' then 'Estorno de venda'
    when 'sale_return' then 'Devolução retornou ao estoque'
    when 'production_consumption' then 'Consumo em produção'
    when 'production_output' then 'Entrada por produção'
    when 'production_cancel_return' then 'Estorno de produção'
    when 'production_adjustment' then 'Ajuste de produção'
    else 'Movimentação de estoque' end;

  if coalesce(new.reference_type,'') in ('manual','sale_return','transfer','product_stock') then
    select coalesce(i.quantity,0) into v_before
      from public.inventory_balances i
      where i.tenant_id=new.tenant_id and i.branch_id=new.branch_id and i.product_id=new.product_id;
    v_before:=coalesce(v_before,0);
    v_after:=v_before+coalesce(new.quantity,0);
    v_known_balance:=true;
  end if;

  if v_known_balance then
    v_description:=v_event_label||': '||private.audit_qty(v_before)||' → '||private.audit_qty(v_after)||' '||v_unit||
      ' ('||case when new.quantity>=0 then '+' else '' end||private.audit_qty(new.quantity)||')';
  else
    v_description:=v_event_label||': '||case when new.quantity>=0 then '+' else '' end||private.audit_qty(new.quantity)||' '||v_unit;
  end if;
  v_description:=v_description||' • Origem: '||v_source_label;
  if coalesce(v_branch,'')<>'' then v_description:=v_description||' • Filial: '||v_branch; end if;

  insert into public.product_history(
    tenant_id,product_id,event_type,description,before_data,after_data,created_by,created_at,
    actor_type,actor_id,actor_name,source_type,source_id,metadata
  ) values(
    new.tenant_id,new.product_id,'Estoque',v_description,
    jsonb_build_object('stock',case when v_known_balance then v_before else null end,'movement_type',new.movement_type,'branch_id',new.branch_id,'stock_location_id',new.stock_location_id),
    jsonb_build_object('stock',case when v_known_balance then v_after else null end,'delta',new.quantity,'movement_type',new.movement_type,'branch_id',new.branch_id,'stock_location_id',new.stock_location_id),
    new.actor_id,coalesce(new.created_at,now()),coalesce(new.actor_type,'system'),new.actor_id,v_actor_name,'stock_movement',new.id,
    jsonb_build_object('reference_type',new.reference_type,'reference_id',new.reference_id,'unit_cost',new.unit_cost,'notes',new.notes)
  ) on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_stock_movement_product_history on public.stock_movements;
create trigger trg_stock_movement_product_history
after insert on public.stock_movements
for each row execute function private.audit_stock_movement_to_product_history();

create or replace function private.audit_product_price_change()
returns trigger
language plpgsql
security definer
set search_path='public','private','auth'
as $$
declare
  v_actor_type text;
  v_actor_id uuid;
  v_actor_name text;
  v_source_type text;
  v_source_label text;
  v_text text;
  v_description text;
begin
  if old.sale_price is not distinct from new.sale_price and old.cost_price is not distinct from new.cost_price then return new; end if;

  v_actor_type:=nullif(current_setting('app.audit_actor_type',true),'');
  v_text:=nullif(current_setting('app.audit_actor_id',true),'');
  if v_text is not null then begin v_actor_id:=v_text::uuid; exception when others then v_actor_id:=null; end; end if;
  v_actor_name:=nullif(current_setting('app.audit_actor_name',true),'');
  v_source_type:=coalesce(nullif(current_setting('app.audit_source_type',true),''),'product_update');

  if v_actor_id is null and auth.uid() is not null then v_actor_type:='auth_user'; v_actor_id:=auth.uid(); end if;
  v_actor_type:=coalesce(v_actor_type,'system');
  v_actor_name:=coalesce(v_actor_name,private.audit_actor_display_name(v_actor_type,v_actor_id));
  v_source_label:=case v_source_type
    when 'product_master' then 'Cadastro de produtos'
    when 'product_studio' then 'Cadastro de produtos'
    when 'bulk_price' then 'Alteração de preços em lote'
    else 'Alteração de produto' end;

  if old.cost_price is distinct from new.cost_price and old.sale_price is distinct from new.sale_price then
    v_description:='Preço de custo: '||private.audit_money(old.cost_price)||' → '||private.audit_money(new.cost_price)||
      ' | Preço de venda: '||private.audit_money(old.sale_price)||' → '||private.audit_money(new.sale_price);
  elsif old.sale_price is distinct from new.sale_price then
    v_description:='Preço de venda: '||private.audit_money(old.sale_price)||' → '||private.audit_money(new.sale_price);
  else
    v_description:='Preço de custo: '||private.audit_money(old.cost_price)||' → '||private.audit_money(new.cost_price);
  end if;
  v_description:=v_description||' • Origem: '||v_source_label;

  insert into public.product_history(
    tenant_id,product_id,event_type,description,before_data,after_data,created_by,actor_type,actor_id,actor_name,source_type,metadata
  ) values(
    new.tenant_id,new.id,'Preço',v_description,
    jsonb_build_object('cost_price',old.cost_price,'sale_price',old.sale_price),
    jsonb_build_object('cost_price',new.cost_price,'sale_price',new.sale_price),
    v_actor_id,v_actor_type,v_actor_id,v_actor_name,v_source_type,
    jsonb_build_object('changed_fields',jsonb_build_array(
      case when old.cost_price is distinct from new.cost_price then 'cost_price' end,
      case when old.sale_price is distinct from new.sale_price then 'sale_price' end
    ))
  );
  return new;
end $$;

drop trigger if exists trg_product_price_history on public.products;
create trigger trg_product_price_history
after update of cost_price,sale_price on public.products
for each row execute function private.audit_product_price_change();

-- O cadastro mestre usa sessão temporária. Colocamos o ator no contexto da transação
-- para que o trigger de preço consiga identificar exatamente quem fez a alteração.
create or replace function public.erp_product_save_v4(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private'
as $$
declare r jsonb; v record; v_code bigint; v_is_new boolean; v_actor_name text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select nullif(u.email,'') into v_actor_name from private.temp_users u where u.id=v.user_id;
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_id',v.user_id::text,true);
  perform set_config('app.audit_actor_name',coalesce(v_actor_name,'Usuário ERP'),true);
  perform set_config('app.audit_source_type','product_master',true);

  v_is_new:=nullif(p_payload->>'id','') is null;
  r:=public.erp_product_save_v3(p_token,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  select product_code into v_code from public.products where id=(r->>'id')::uuid and tenant_id=v.tenant_id;
  update public.products
     set fractioned=case when coalesce(label_scale,false) then true else fractioned end,
         is_weighable=case when coalesce(label_scale,false) then true else is_weighable end,
         sku=case when v_is_new then v_code::text else sku end,
         updated_at=now()
   where id=(r->>'id')::uuid and tenant_id=v.tenant_id;
  return r||jsonb_build_object('product_code',v_code,'sku',(select sku from public.products where id=(r->>'id')::uuid));
end $$;

-- A movimentação manual também recebe o usuário da sessão para a auditoria.
create or replace function public.erp_stock_move(p_token text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','private','extensions'
as $$
declare
  v record; v_product uuid; v_qty numeric; v_signed numeric; v_type text; v_location uuid; v_destination_location uuid; v_destination_branch uuid; v_source_branch uuid; v_available numeric; v_unit_cost numeric; v_notes text; v_transfer_id uuid:=gen_random_uuid(); v_actor_name text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select nullif(u.email,'') into v_actor_name from private.temp_users u where u.id=v.user_id;
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_id',v.user_id::text,true);
  perform set_config('app.audit_actor_name',coalesce(v_actor_name,'Usuário ERP'),true);
  perform set_config('app.audit_source_type','stock_manual',true);

  v_product:=nullif(p_payload->>'product_id','')::uuid; v_signed:=coalesce(nullif(p_payload->>'quantity','')::numeric,0); v_qty:=abs(v_signed); v_type:=coalesce(p_payload->>'movement_type','adjustment');
  v_location:=nullif(p_payload->>'stock_location_id','')::uuid; v_destination_location:=nullif(p_payload->>'destination_stock_location_id','')::uuid; v_destination_branch:=nullif(p_payload->>'destination_branch_id','')::uuid; v_unit_cost:=nullif(p_payload->>'unit_cost','')::numeric; v_notes:=nullif(p_payload->>'notes','');
  if v_product is null or v_qty<=0 then return jsonb_build_object('ok',false,'error','invalid_stock_movement'); end if;
  if v_location is null then select id into v_location from public.stock_locations where tenant_id=v.tenant_id and branch_id=v.branch_id and is_default and active limit 1; end if;
  select branch_id into v_source_branch from public.stock_locations where id=v_location and tenant_id=v.tenant_id and company_id=v.company_id and active;
  if v_source_branch is null then return jsonb_build_object('ok',false,'error','stock_location_not_found'); end if;
  select coalesce(quantity-reserved_quantity,0) into v_available from public.stock_location_balances where stock_location_id=v_location and product_id=v_product;
  v_available:=coalesce(v_available,0);

  if (v_type in ('out','loss') or (v_type='adjustment' and v_signed<0)) and v_available<v_qty then return jsonb_build_object('ok',false,'error','insufficient_stock_at_location','available',v_available,'requested',v_qty); end if;

  if v_type='transfer' then
    if v_destination_location is null and v_destination_branch is not null then select id into v_destination_location from public.stock_locations where tenant_id=v.tenant_id and branch_id=v_destination_branch and is_default and active limit 1; end if;
    if v_destination_location is null then return jsonb_build_object('ok',false,'error','destination_stock_location_required'); end if;
    select branch_id into v_destination_branch from public.stock_locations where id=v_destination_location and tenant_id=v.tenant_id and company_id=v.company_id and active;
    if v_destination_branch is null or v_destination_location=v_location then return jsonb_build_object('ok',false,'error','invalid_destination_stock_location'); end if;
    if v_available<v_qty then return jsonb_build_object('ok',false,'error','insufficient_stock_at_location','available',v_available,'requested',v_qty); end if;
    insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v_source_branch,v_location,v_product,'transfer_out',-v_qty,v_unit_cost,'transfer',v_transfer_id,v_notes);
    insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes) values(v.tenant_id,v_destination_branch,v_destination_location,v_product,'transfer_in',v_qty,v_unit_cost,'transfer',v_transfer_id,v_notes);
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_source_branch,v_product,-v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
    insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_destination_branch,v_product,v_qty,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
    return jsonb_build_object('ok',true,'transfer_id',v_transfer_id,'source_stock_location_id',v_location,'destination_stock_location_id',v_destination_location);
  end if;

  v_signed:=case when v_type in ('out','loss') then -v_qty when v_type='adjustment' then v_signed else v_qty end;
  insert into public.stock_movements(tenant_id,branch_id,stock_location_id,product_id,movement_type,quantity,unit_cost,reference_type,notes) values(v.tenant_id,v_source_branch,v_location,v_product,v_type,v_signed,v_unit_cost,'manual',v_notes);
  insert into public.inventory_balances(tenant_id,branch_id,product_id,quantity,reserved_quantity) values(v.tenant_id,v_source_branch,v_product,v_signed,0) on conflict(tenant_id,branch_id,product_id) do update set quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=now();
  return jsonb_build_object('ok',true,'product_id',v_product,'stock_location_id',v_location);
end $$;

-- Melhora a autoria dos movimentos antigos de devolução e venda quando a origem permite inferência segura.
update public.stock_movements sm
set actor_type='staff_user',actor_id=sr.operator_user_id
from public.sale_returns sr
where sm.actor_id is null and sm.reference_type='sale_return' and sm.reference_id=sr.id and sr.operator_user_id is not null;

update public.stock_movements sm
set actor_type='staff_user',actor_id=s.seller_user_id
from public.sales s
where sm.actor_id is null and sm.reference_type in ('sale','sale_cancel') and sm.reference_id=s.id and s.seller_user_id is not null;

-- Completa autoria dos históricos já existentes.
update public.product_history h
set actor_id=coalesce(h.actor_id,h.created_by)
where h.actor_id is null and h.created_by is not null;

update public.product_history h
set actor_type=case
  when exists(select 1 from public.staff_users s where s.id=h.actor_id) then 'staff_user'
  when exists(select 1 from private.temp_users u where u.id=h.actor_id) then 'temp_user'
  when exists(select 1 from auth.users u where u.id=h.actor_id) then 'auth_user'
  when exists(select 1 from public.pdv_devices d where d.id=h.actor_id) then 'pdv_device'
  else 'system' end
where h.actor_type is null;

update public.product_history h
set actor_name=private.audit_actor_display_name(coalesce(h.actor_type,'system'),h.actor_id)
where coalesce(h.actor_name,'')='';

-- Converte alterações de preço antigas que já estavam guardadas em before_data/after_data
-- em eventos explícitos de Preço, preservando o evento geral original.
insert into public.product_history(
  tenant_id,product_id,event_type,description,before_data,after_data,created_by,created_at,
  actor_type,actor_id,actor_name,source_type,source_id,metadata
)
select h.tenant_id,h.product_id,'Preço',
  case
    when (h.before_data->>'cost_price') is distinct from (h.after_data->>'cost_price') and (h.before_data->>'sale_price') is distinct from (h.after_data->>'sale_price') then
      'Preço de custo: '||private.audit_money(coalesce(nullif(h.before_data->>'cost_price','')::numeric,0))||' → '||private.audit_money(coalesce(nullif(h.after_data->>'cost_price','')::numeric,0))||
      ' | Preço de venda: '||private.audit_money(coalesce(nullif(h.before_data->>'sale_price','')::numeric,0))||' → '||private.audit_money(coalesce(nullif(h.after_data->>'sale_price','')::numeric,0))||' • Origem: Histórico anterior'
    when (h.before_data->>'sale_price') is distinct from (h.after_data->>'sale_price') then
      'Preço de venda: '||private.audit_money(coalesce(nullif(h.before_data->>'sale_price','')::numeric,0))||' → '||private.audit_money(coalesce(nullif(h.after_data->>'sale_price','')::numeric,0))||' • Origem: Histórico anterior'
    else
      'Preço de custo: '||private.audit_money(coalesce(nullif(h.before_data->>'cost_price','')::numeric,0))||' → '||private.audit_money(coalesce(nullif(h.after_data->>'cost_price','')::numeric,0))||' • Origem: Histórico anterior'
  end,
  jsonb_build_object('cost_price',h.before_data->'cost_price','sale_price',h.before_data->'sale_price'),
  jsonb_build_object('cost_price',h.after_data->'cost_price','sale_price',h.after_data->'sale_price'),
  h.created_by,h.created_at,h.actor_type,h.actor_id,h.actor_name,'product_history',h.id,jsonb_build_object('backfilled',true)
from public.product_history h
where h.event_type in ('updated','created')
  and h.before_data is not null and h.after_data is not null
  and ((h.before_data->>'cost_price') is distinct from (h.after_data->>'cost_price') or (h.before_data->>'sale_price') is distinct from (h.after_data->>'sale_price'))
on conflict do nothing;

-- Traz os movimentos de estoque já existentes para a aba Histórico.
insert into public.product_history(
  tenant_id,product_id,event_type,description,before_data,after_data,created_by,created_at,
  actor_type,actor_id,actor_name,source_type,source_id,metadata
)
select sm.tenant_id,sm.product_id,'Estoque',
  (case sm.movement_type
    when 'sale_return' then 'Devolução retornou ao estoque'
    when 'sale' then 'Baixa por venda'
    when 'sale_cancel' then 'Estorno de venda'
    when 'in' then 'Entrada de estoque'
    when 'out' then 'Saída de estoque'
    when 'adjustment' then 'Ajuste de estoque'
    when 'loss' then 'Perda de estoque'
    when 'transfer_in' then 'Transferência recebida'
    when 'transfer_out' then 'Transferência enviada'
    else 'Movimentação de estoque' end)||': '||case when sm.quantity>=0 then '+' else '' end||private.audit_qty(sm.quantity)||' '||coalesce(nullif(p.unit,''),'UN')||
    ' • Origem: '||coalesce(nullif(sm.reference_type,''),'Histórico anterior'),
  jsonb_build_object('movement_type',sm.movement_type,'branch_id',sm.branch_id,'stock_location_id',sm.stock_location_id),
  jsonb_build_object('delta',sm.quantity,'movement_type',sm.movement_type,'branch_id',sm.branch_id,'stock_location_id',sm.stock_location_id),
  sm.actor_id,sm.created_at,coalesce(sm.actor_type,'system'),sm.actor_id,
  private.audit_actor_display_name(coalesce(sm.actor_type,'system'),sm.actor_id),'stock_movement',sm.id,
  jsonb_build_object('reference_type',sm.reference_type,'reference_id',sm.reference_id,'unit_cost',sm.unit_cost,'notes',sm.notes,'backfilled',true)
from public.stock_movements sm
join public.products p on p.id=sm.product_id
where not exists(
  select 1 from public.product_history h
  where h.product_id=sm.product_id and h.event_type='Estoque' and h.source_type='stock_movement' and h.source_id=sm.id
)
on conflict do nothing;
