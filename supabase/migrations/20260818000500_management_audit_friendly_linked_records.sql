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
  when 'customers' then 'Cliente' when 'customer_store_credit_ledger' then 'Saldo de crediário do cliente'
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

CREATE OR REPLACE FUNCTION public.erp_management_audit_list(p_token text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_branch uuid DEFAULT NULL::uuid, p_operator uuid DEFAULT NULL::uuid, p_event_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v record;
  v_data jsonb;
  v_summary jsonb;
  v_branches jsonb;
  v_operators jsonb;
  v_start timestamptz:=coalesce(p_start,current_date-30)::timestamptz;
  v_end timestamptz:=(coalesce(p_end,current_date)+1)::timestamptz;
  v_query text:='%'||coalesce(trim(p_search),'')||'%';
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_end-v_start>interval '370 days' then return jsonb_build_object('ok',false,'error','audit_period_too_large'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) into v_data
  from (
    select e.id,e.event_type,e.severity,e.entity_type source_entity_type,private.audit_entity_label(e.entity_type) entity_type,e.entity_id,e.sale_id,private.audit_entity_label(e.entity_type) entity_label,coalesce(nullif(ec.name,''),private.audit_entity_display_name(e.before_data,e.after_data,e.metadata)) entity_name,case when e.entity_type='customer_store_credit_ledger' then 'Saldo de crediário registrado' else e.title end title,
      case
        when coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,'')) is not null
          then replace(
            e.reason,
            'Responsável: Usuário ERP',
            'Responsável: '||coalesce(nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''))
          )
        else e.reason
      end reason,
      e.amount_before,e.amount_after,e.amount_delta,e.before_data,e.after_data,
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
      e.occurred_at,
      e.branch_id,b.name branch_name,e.operator_user_id,coalesce(nullif(o.name,''),nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''),'Sistema') operator_name,
      coalesce(nullif(o.name,''),nullif(o.email,''),nullif(eus.name,''),nullif(eus.email,''),nullif(eu.email,''),nullif(e.metadata->>'actor_name',''),'Sistema') responsible_name,
      coalesce(nullif(o.email,''),nullif(eus.email,''),nullif(eu.email,'')) responsible_email,
      e.supervisor_user_id,su.name supervisor_name,e.device_id,d.name device_name,
      sa.number sale_number
    from public.management_audit_events e
    left join public.branches b on b.id=e.branch_id left join public.customers ec on ec.tenant_id=e.tenant_id and ec.id=case when e.entity_type='customer_store_credit_ledger' and coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then coalesce(e.after_data->>'customer_id',e.before_data->>'customer_id')::uuid else null end
    left join public.staff_users o on o.id=e.operator_user_id
    left join private.temp_users eu on eu.id=case
      when coalesce(e.metadata->>'actor_type','')='temp_user'
       and coalesce(e.metadata->>'actor_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (e.metadata->>'actor_id')::uuid else null end
    left join private.temp_user_context euc
      on euc.user_id=eu.id and euc.tenant_id=e.tenant_id
    left join public.staff_users eus
      on eus.tenant_id=e.tenant_id
     and encode(extensions.digest(lower(trim(eus.email)),'sha256'),'hex')=eu.email_hash
    left join public.staff_users su on su.id=e.supervisor_user_id
    left join public.pdv_devices d on d.id=e.device_id
    left join public.sales sa on sa.id=e.sale_id
    where e.tenant_id=v.tenant_id
      and e.occurred_at>=v_start and e.occurred_at<v_end
      and (p_branch is null or e.branch_id=p_branch)
      and (p_operator is null or e.operator_user_id=p_operator)
      and (p_event_type is null or e.event_type=p_event_type)
      and (p_search is null or e.title ilike v_query or coalesce(e.reason,'') ilike v_query
        or coalesce(o.name,'') ilike v_query or coalesce(o.email,'') ilike v_query
        or coalesce(eus.name,'') ilike v_query or coalesce(eus.email,'') ilike v_query
        or coalesce(eu.email,'') ilike v_query or coalesce(su.name,'') ilike v_query
        or coalesce(sa.number::text,'') ilike v_query or coalesce(private.audit_entity_display_name(e.before_data,e.after_data,e.metadata),'') ilike v_query or coalesce(ec.name,'') ilike v_query)
    order by e.occurred_at desc limit 500
  ) x;

  select jsonb_build_object(
    'total_events',count(*),
    'critical_events',count(*) filter(where severity='critical'),
    'authorizations',count(*) filter(where event_type='manager_authorization'),
    'financial_impact',coalesce(sum(abs(amount_delta)) filter(where event_type not in ('receivable_received')),0)
  ) into v_summary
  from public.management_audit_events e
  where e.tenant_id=v.tenant_id and e.occurred_at>=v_start and e.occurred_at<v_end
    and (p_branch is null or e.branch_id=p_branch)
    and (p_operator is null or e.operator_user_id=p_operator)
    and (p_event_type is null or e.event_type=p_event_type);

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_branches
  from public.branches where tenant_id=v.tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_operators
  from public.staff_users where tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'data',v_data,'summary',v_summary,'branches',v_branches,'operators',v_operators);
end
$function$
;

revoke all on function private.audit_entity_label(text) from public;
revoke all on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) from public;
grant execute on function public.erp_management_audit_list(text,date,date,uuid,uuid,text,text) to anon,authenticated,service_role;
