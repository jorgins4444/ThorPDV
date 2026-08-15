create or replace function public.erp_bank_homologation_customer_search(p_token text,p_query text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v record;
  q text:=trim(coalesce(p_query,''));
  qdigits text:=regexp_replace(coalesce(p_query,''),'\D','','g');
  items jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if length(q)<2 then return jsonb_build_object('ok',false,'error','customer_search_too_short'); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank_key,x.name),'[]'::jsonb) into items
  from (
    select c.id,c.name,c.document,c.street,c.number,c.complement,c.district,c.city,c.state,c.postal_code,
      case
        when qdigits<>'' and regexp_replace(coalesce(c.document,''),'\D','','g')=qdigits then 0
        when lower(c.name)=lower(q) then 1
        when lower(c.name) like lower(q)||'%' then 2
        else 3
      end rank_key,
      (
        length(regexp_replace(coalesce(c.document,''),'\D','','g')) in (11,14)
        and nullif(trim(coalesce(c.name,'')),'') is not null
        and nullif(trim(coalesce(c.street,'')),'') is not null
        and nullif(trim(coalesce(c.district,'')),'') is not null
        and nullif(trim(coalesce(c.city,'')),'') is not null
        and length(trim(coalesce(c.state,'')))=2
        and length(regexp_replace(coalesce(c.postal_code,''),'\D','','g'))=8
      ) as ready_for_cnab
    from public.customers c
    where c.tenant_id=v.tenant_id and c.active=true
      and (
        (qdigits<>'' and regexp_replace(coalesce(c.document,''),'\D','','g') like '%'||qdigits||'%')
        or lower(c.name) like '%'||lower(q)||'%'
      )
    order by rank_key,c.name
    limit 15
  ) x;

  return jsonb_build_object('ok',true,'customers',items,'query',q);
end
$function$;

create or replace function public.erp_bank_homologation_create_test_title(
  p_token text,
  p_config uuid,
  p_customer uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v record;
  h public.bank_file_homologations%rowtype;
  cfg public.bank_cnab_configs%rowtype;
  c public.customers%rowtype;
  entry_id uuid:=gen_random_uuid();
  due date:=current_date+7;
  old_entry uuid;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_amount is null or p_amount<=0 or p_amount>99999999999.99 then
    return jsonb_build_object('ok',false,'error','invalid_homologation_test_amount');
  end if;

  perform private.ensure_bank_file_homologation(p_config);
  select * into h from public.bank_file_homologations
   where config_id=p_config and tenant_id=v.tenant_id and company_id=v.company_id for update;
  if h.id is null then return jsonb_build_object('ok',false,'error','homologation_not_found'); end if;
  if h.status='approved' then return jsonb_build_object('ok',false,'error','homologation_already_approved'); end if;
  if h.test_remittance_id is not null then return jsonb_build_object('ok',false,'error','test_remittance_already_generated'); end if;

  select * into cfg from public.bank_cnab_configs
   where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;

  select * into c from public.customers where id=p_customer and tenant_id=v.tenant_id and active=true;
  if c.id is null then return jsonb_build_object('ok',false,'error','homologation_customer_not_found'); end if;
  if length(regexp_replace(coalesce(c.document,''),'\D','','g')) not in (11,14)
    or nullif(trim(coalesce(c.name,'')),'') is null
    or nullif(trim(coalesce(c.street,'')),'') is null
    or nullif(trim(coalesce(c.district,'')),'') is null
    or nullif(trim(coalesce(c.city,'')),'') is null
    or length(trim(coalesce(c.state,'')))<>2
    or length(regexp_replace(coalesce(c.postal_code,''),'\D','','g'))<>8
  then return jsonb_build_object('ok',false,'error','homologation_customer_data_incomplete'); end if;

  old_entry:=h.test_financial_entry_id;
  if old_entry is not null and not exists(
    select 1 from public.bank_cnab_remittance_items ri
    where ri.financial_entry_id=old_entry and ri.status not in ('rejected','cancelled')
  ) then
    update public.financial_entries
       set status='cancelled',updated_at=now()
     where id=old_entry and tenant_id=v.tenant_id and company_id=v.company_id
       and coalesce((metadata->>'homologation_test')::boolean,false)=true;
  end if;

  insert into public.financial_entries(
    id,tenant_id,company_id,branch_id,entry_type,status,description,amount,paid_amount,
    due_date,customer_id,metadata,issued_at,document_type
  ) values (
    entry_id,v.tenant_id,v.company_id,v.branch_id,'receivable','open',
    'Boleto teste - Homologação bancária',round(p_amount,2),0,due,c.id,
    jsonb_build_object(
      'term_method','boleto','homologation_test',true,'bank_homologation_id',h.id,
      'bank_config_id',cfg.id,'bank_code',cfg.bank_code,'layout',cfg.layout
    ),current_date,'boleto'
  );

  update public.bank_file_homologations set
    status='test_selected',current_step=4,test_financial_entry_id=entry_id,
    test_remittance_id=null,test_remittance_item_id=null,test_return_file_id=null,test_return_item_id=null,
    started_at=coalesce(started_at,now()),remittance_generated_at=null,remittance_sent_at=null,
    return_received_at=null,approved_at=null,last_error=null,
    audit=audit||jsonb_build_array(jsonb_build_object(
      'at',now(),'event','homologation_test_title_created','financial_entry_id',entry_id,
      'customer_id',c.id,'amount',round(p_amount,2),'due_date',due
    )),updated_at=now()
  where id=h.id;

  return jsonb_build_object(
    'ok',true,'financial_entry_id',entry_id,'customer_id',c.id,'customer',c.name,
    'document',c.document,'amount',round(p_amount,2),'due_date',due,'status','test_selected'
  );
end
$function$;

revoke all on function public.erp_bank_homologation_customer_search(text,text) from public;
revoke all on function public.erp_bank_homologation_create_test_title(text,uuid,uuid,numeric) from public;
grant execute on function public.erp_bank_homologation_customer_search(text,text) to authenticated,service_role;
grant execute on function public.erp_bank_homologation_create_test_title(text,uuid,uuid,numeric) to authenticated,service_role;
