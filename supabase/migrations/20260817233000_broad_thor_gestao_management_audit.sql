CREATE OR REPLACE FUNCTION private.resolve_temp_context(p_token text)
 RETURNS TABLE(user_id uuid, tenant_id uuid, company_id uuid, branch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_company_id uuid;
  v_branch_id uuid;
begin
  select s.user_id,c.tenant_id,c.company_id,c.branch_id
    into v_user_id,v_tenant_id,v_company_id,v_branch_id
  from private.temp_sessions s
  join private.temp_users u on u.id=s.user_id
  join private.temp_user_context c on c.user_id=s.user_id
  join public.tenant_licenses l on l.tenant_id=c.tenant_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.expires_at>now()
    and u.active=true
    and l.status in ('trial','active')
    and (l.expires_at is null or l.expires_at>now())
  limit 1;

  if v_user_id is null then return; end if;

  perform set_config('app.audit_actor_id',v_user_id::text,true);
  perform set_config('app.audit_actor_type','temp_user',true);
  perform set_config('app.audit_actor_name',private.audit_actor_display_name('temp_user',v_user_id),true);
  perform set_config('app.audit_tenant_id',v_tenant_id::text,true);
  perform set_config('app.audit_branch_id',coalesce(v_branch_id::text,''),true);

  user_id:=v_user_id;
  tenant_id:=v_tenant_id;
  company_id:=v_company_id;
  branch_id:=v_branch_id;
  return next;
end
$function$
;

CREATE OR REPLACE FUNCTION private.audit_redact_jsonb(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_type text;
  v_result jsonb;
begin
  if p_value is null then return '{}'::jsonb; end if;
  v_type:=jsonb_typeof(p_value);

  if v_type='object' then
    select coalesce(jsonb_object_agg(
      e.key,
      case
        when e.key ~* '(password|passwd|secret|token|api.?key|private.?key|certificate|credential|(^|_)pin($|_)|hash|xml|signature)'
          then '"[DADO PROTEGIDO]"'::jsonb
        else private.audit_redact_jsonb(e.value)
      end
    ),'{}'::jsonb)
    into v_result
    from jsonb_each(p_value) e;
    return v_result;
  elsif v_type='array' then
    select coalesce(jsonb_agg(private.audit_redact_jsonb(e.value)),'[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) e;
    return v_result;
  elsif v_type='string' and length(p_value#>>'{}')>2000 then
    return to_jsonb('[CONTEÚDO EXTENSO OMITIDO: '||length(p_value#>>'{}')||' caracteres]');
  end if;

  return p_value;
end
$function$
;

CREATE OR REPLACE FUNCTION private.audit_entity_label(p_table text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
select case p_table
  when 'access_profiles' then 'Perfil de acesso'
  when 'app_settings' then 'Configuração do sistema'
  when 'bank_accounts' then 'Conta bancária'
  when 'bank_account_integrations' then 'Integração bancária'
  when 'bank_billings' then 'Cobrança bancária'
  when 'branches' then 'Loja / filial'
  when 'branch_settings' then 'Configuração da filial'
  when 'branch_delivery_rates' then 'Taxa de entrega'
  when 'branch_payment_integrations' then 'Integração de pagamento'
  when 'branch_smartpos_terminals' then 'Terminal SmartPOS'
  when 'branch_tax_groups' then 'Grupo tributário da filial'
  when 'cash_sessions' then 'Sessão de caixa'
  when 'companies' then 'Empresa'
  when 'customers' then 'Cliente'
  when 'financial_entries' then 'Lançamento financeiro'
  when 'financial_settlements' then 'Baixa financeira'
  when 'fiscal_cfops' then 'CFOP'
  when 'fiscal_danfe_settings' then 'Configuração DANFE'
  when 'fiscal_documents' then 'Documento fiscal'
  when 'fiscal_pos_series' then 'Vínculo caixa/série fiscal'
  when 'fiscal_series' then 'Série fiscal'
  when 'fiscal_settings' then 'Configuração fiscal'
  when 'integration_configs' then 'Integração'
  when 'inventory_counts' then 'Inventário'
  when 'payment_transactions' then 'Transação de pagamento'
  when 'payments' then 'Pagamento'
  when 'pdv_devices' then 'Dispositivo PDV'
  when 'pos_registers' then 'Caixa / PDV'
  when 'price_adjustments' then 'Ajuste programado de preço'
  when 'price_tables' then 'Tabela de preços'
  when 'product_attributes' then 'Atributo de produto'
  when 'product_brands' then 'Marca'
  when 'product_categories' then 'Categoria'
  when 'product_classes' then 'Classe de produto'
  when 'product_groups' then 'Grupo de produto'
  when 'product_modifiers' then 'Modificador'
  when 'product_units' then 'Unidade de produto'
  when 'products' then 'Produto'
  when 'production_orders' then 'Ordem de produção'
  when 'promotions' then 'Promoção'
  when 'purchases' then 'Compra'
  when 'report_studio_workbooks' then 'Relatório personalizado'
  when 'sales_card_acquirer_settings' then 'Configuração de adquirente'
  when 'sales_card_brand_settings' then 'Configuração de bandeira'
  when 'sales_orders' then 'Pedido de venda'
  when 'sales_payment_methods' then 'Forma de pagamento'
  when 'sales_payment_terms' then 'Condição de pagamento'
  when 'staff_users' then 'Usuário administrativo'
  when 'stock_locations' then 'Local de estoque'
  when 'suppliers' then 'Fornecedor'
  when 'support_tickets' then 'Chamado de suporte'
  when 'tenant_members' then 'Membro da empresa'
  else initcap(replace(p_table,'_',' '))
end
$function$
;

CREATE OR REPLACE FUNCTION private.capture_generic_management_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth', 'pg_catalog'
AS $function$
declare
  v_old jsonb:=case when tg_op in ('UPDATE','DELETE') then private.audit_redact_jsonb(to_jsonb(old)) else '{}'::jsonb end;
  v_new jsonb:=case when tg_op in ('INSERT','UPDATE') then private.audit_redact_jsonb(to_jsonb(new)) else '{}'::jsonb end;
  v_before jsonb:='{}'::jsonb;
  v_after jsonb:='{}'::jsonb;
  v_row jsonb;
  v_changed text[];
  v_tenant uuid;
  v_branch uuid;
  v_entity uuid;
  v_sale uuid;
  v_actor uuid;
  v_actor_text text;
  v_actor_type text;
  v_actor_name text;
  v_label text;
  v_event_type text;
  v_title text;
  v_reason text;
  v_ignore text[]:=array['created_at','updated_at','synced_at','last_sync_at','recorded_at'];
begin
  v_row:=case when tg_op='DELETE' then v_old else v_new end;

  if tg_table_name='products' then
    v_old:=v_old-array['cost_price','sale_price'];
    v_new:=v_new-array['cost_price','sale_price'];
  end if;

  v_old:=v_old-v_ignore;
  v_new:=v_new-v_ignore;

  begin v_tenant:=nullif(v_row->>'tenant_id','')::uuid; exception when others then v_tenant:=null; end;
  if v_tenant is null then
    begin v_tenant:=nullif(current_setting('app.audit_tenant_id',true),'')::uuid; exception when others then v_tenant:=null; end;
  end if;
  if v_tenant is null then return coalesce(new,old); end if;

  begin v_branch:=nullif(v_row->>'branch_id','')::uuid; exception when others then v_branch:=null; end;
  if v_branch is null then
    begin v_branch:=nullif(current_setting('app.audit_branch_id',true),'')::uuid; exception when others then v_branch:=null; end;
  end if;
  begin v_entity:=nullif(v_row->>'id','')::uuid; exception when others then v_entity:=null; end;
  begin v_sale:=nullif(coalesce(v_row->>'sale_id',case when tg_table_name='sales' then v_row->>'id' end),'')::uuid; exception when others then v_sale:=null; end;

  if tg_op='UPDATE' then
    select coalesce(array_agg(k order by k),array[]::text[])
      into v_changed
    from jsonb_object_keys(v_old||v_new) k
    where v_old->k is distinct from v_new->k;
    if coalesce(array_length(v_changed,1),0)=0 then return new; end if;

    select coalesce(jsonb_object_agg(k,v_old->k),'{}'::jsonb),
           coalesce(jsonb_object_agg(k,v_new->k),'{}'::jsonb)
      into v_before,v_after
    from unnest(v_changed) k;
    v_event_type:='record_updated';
  elsif tg_op='INSERT' then
    v_after:=v_new;
    v_changed:=array(select jsonb_object_keys(v_new));
    v_event_type:='record_created';
  else
    v_before:=v_old;
    v_changed:=array(select jsonb_object_keys(v_old));
    v_event_type:='record_deleted';
  end if;

  v_actor_text:=nullif(current_setting('app.audit_actor_id',true),'');
  if v_actor_text is null then v_actor_text:=auth.uid()::text; end if;
  begin v_actor:=v_actor_text::uuid; exception when others then v_actor:=null; end;
  v_actor_type:=coalesce(nullif(current_setting('app.audit_actor_type',true),''),
    case when auth.uid() is not null then 'auth_user' else 'system' end);
  v_actor_name:=coalesce(
    nullif(current_setting('app.audit_actor_name',true),''),
    private.audit_actor_display_name(v_actor_type,v_actor),
    'Sistema'
  );

  v_label:=private.audit_entity_label(tg_table_name);
  v_title:=case tg_op
    when 'INSERT' then v_label||' cadastrado'
    when 'UPDATE' then v_label||' alterado'
    else v_label||' excluído'
  end;
  v_reason:=case tg_op
    when 'INSERT' then 'Novo registro cadastrado'
    when 'UPDATE' then 'Campos alterados: '||array_to_string(v_changed,', ')
    else 'Registro excluído'
  end||' • Responsável: '||v_actor_name;

  insert into public.management_audit_events(
    tenant_id,branch_id,event_type,severity,entity_type,entity_id,sale_id,
    title,reason,before_data,after_data,metadata
  ) values (
    v_tenant,v_branch,v_event_type,
    case when tg_op='DELETE' then 'attention' else 'info' end,
    tg_table_name,v_entity,v_sale,v_title,v_reason,v_before,v_after,
    jsonb_build_object(
      'source_type','thor_gestao',
      'source_table',tg_table_name,
      'operation',lower(tg_op),
      'changed_fields',to_jsonb(v_changed),
      'actor_type',v_actor_type,
      'actor_id',v_actor,
      'actor_name',v_actor_name
    )
  );

  return coalesce(new,old);
end
$function$
;

revoke all on function private.resolve_temp_context(text) from public;
grant execute on function private.resolve_temp_context(text) to anon,authenticated,service_role;
revoke all on function private.audit_redact_jsonb(jsonb) from public;
revoke all on function private.audit_entity_label(text) from public;
revoke all on function private.capture_generic_management_audit() from public;


do $installer$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
      )
      and c.relname <> all(array[
        'management_audit_events','cash_session_audit','product_history',
        'receivable_receipts','sale_returns','sales','supervisor_authorizations',
        'bank_billing_events','bank_webhook_events','fiscal_document_events',
        'pdv_sync_events','smartpos_payment_events','license_audit',
        'sales_management_audit','branch_config_history'
      ])
  loop
    execute format('drop trigger if exists trg_generic_management_audit on public.%I',r.relname);
    execute format(
      'create trigger trg_generic_management_audit after insert or update or delete on public.%I for each row execute function private.capture_generic_management_audit()',
      r.relname
    );
  end loop;
end
$installer$;
