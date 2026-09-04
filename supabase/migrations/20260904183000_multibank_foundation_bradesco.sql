-- Fundação multibanco para cobrança bancária por arquivo.
-- Mantém a implementação Itaú existente e adiciona cadastro bancário genérico,
-- catálogo versionado de layouts e pré-configuração Bradesco baseada nos manuais oficiais.

alter table public.bank_accounts add column if not exists agency_digit text;
alter table public.bank_accounts add column if not exists account_digit text;
alter table public.bank_accounts add column if not exists wallet text;
alter table public.bank_accounts add column if not exists agreement text;
alter table public.bank_accounts add column if not exists beneficiary_code text;
alter table public.bank_accounts add column if not exists default_layout text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='bank_accounts_default_layout_check') then
    alter table public.bank_accounts add constraint bank_accounts_default_layout_check
      check (default_layout is null or default_layout in ('cnab240','cnab400'));
  end if;
end $$;

create or replace function public.erp_bank_account_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record;
  v_id uuid:=nullif(p_payload->>'id','')::uuid;
  v_existing public.bank_accounts%rowtype;
  v_layout text:=nullif(lower(trim(coalesce(p_payload->>'default_layout',''))),'');
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_layout is not null and v_layout not in ('cnab240','cnab400') then
    return jsonb_build_object('ok',false,'error','invalid_cnab_layout');
  end if;

  if v_id is null then
    if nullif(trim(p_payload->>'name'),'') is null then return jsonb_build_object('ok',false,'error','account_name_required'); end if;
    insert into public.bank_accounts(
      tenant_id,company_id,branch_id,name,bank_code,agency,agency_digit,account_number,account_digit,
      wallet,agreement,beneficiary_code,default_layout,active,account_type,is_system,opening_balance,notes
    ) values(
      v.tenant_id,v.company_id,v.branch_id,trim(p_payload->>'name'),nullif(trim(p_payload->>'bank_code'),''),
      nullif(trim(p_payload->>'agency'),''),nullif(trim(p_payload->>'agency_digit'),''),
      nullif(trim(p_payload->>'account_number'),''),nullif(trim(p_payload->>'account_digit'),''),
      nullif(trim(p_payload->>'wallet'),''),nullif(trim(p_payload->>'agreement'),''),nullif(trim(p_payload->>'beneficiary_code'),''),v_layout,
      coalesce((p_payload->>'active')::boolean,true),'bank',false,coalesce(nullif(p_payload->>'opening_balance','')::numeric,0),nullif(trim(p_payload->>'notes'),'')
    ) returning id into v_id;
  else
    select * into v_existing from public.bank_accounts where id=v_id and tenant_id=v.tenant_id for update;
    if v_existing.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
    if v_existing.is_system then return jsonb_build_object('ok',false,'error','system_account_is_read_only'); end if;
    update public.bank_accounts set
      name=coalesce(nullif(trim(p_payload->>'name'),''),name),
      bank_code=coalesce(nullif(trim(p_payload->>'bank_code'),''),bank_code),
      agency=coalesce(nullif(trim(p_payload->>'agency'),''),agency),
      agency_digit=coalesce(nullif(trim(p_payload->>'agency_digit'),''),agency_digit),
      account_number=coalesce(nullif(trim(p_payload->>'account_number'),''),account_number),
      account_digit=coalesce(nullif(trim(p_payload->>'account_digit'),''),account_digit),
      wallet=coalesce(nullif(trim(p_payload->>'wallet'),''),wallet),
      agreement=coalesce(nullif(trim(p_payload->>'agreement'),''),agreement),
      beneficiary_code=coalesce(nullif(trim(p_payload->>'beneficiary_code'),''),beneficiary_code),
      default_layout=coalesce(v_layout,default_layout),
      active=coalesce((p_payload->>'active')::boolean,active),
      notes=coalesce(p_payload->>'notes',notes),updated_at=now()
    where id=v_id;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.erp_bank_catalog(p_token text)
returns jsonb language plpgsql security definer
set search_path to 'public','private'
as $$
declare v record; models jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.bank_code,x.layout,x.version),'[]'::jsonb) into models
  from (
    select id,bank_code,bank_name,layout,version,record_length,source_name,source_url,active
    from public.bank_file_layout_models where active=true
  ) x;
  return jsonb_build_object('ok',true,'models',models);
end $$;

-- BRADESCO 237 · CNAB 240 · manual oficial versão Dezembro/2024.
insert into public.bank_file_layout_models(
  bank_code,bank_name,layout,version,record_length,source_name,source_url,remittance_model,return_model,active
) values(
  '237','Bradesco','cnab240','084/042-dez-2024',240,
  'Bradesco - Manual de Procedimentos Operacionais para Troca de Arquivos 240 Posições - Versão 04 Dezembro/2024',
  'https://assets.bradesco/content/dam/portal-bradesco/assets/pessoajuridica/pdf/MPO-Troca-Arquivos-Layout-240P.pdf',
  '[
    {"record":"file_header","type":"0","label":"Header de Arquivo","fields":[
      {"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"237"},
      {"key":"lot","label":"Lote","start":4,"end":7,"type":"numeric","default":"0000"},
      {"key":"record_type","label":"Tipo de Registro","start":8,"end":8,"default":"0"},
      {"key":"company_document","label":"CNPJ Empresa","start":18,"end":31,"type":"numeric","source":"company.document"},
      {"key":"agreement","label":"Convênio / Código Empresa","start":33,"end":52,"source":"billing.agreement"},
      {"key":"agency","label":"Agência","start":53,"end":57,"type":"numeric","source":"account.agency"},
      {"key":"agency_digit","label":"DV Agência","start":58,"end":58,"source":"account.agency_digit"},
      {"key":"account","label":"Conta","start":59,"end":70,"type":"numeric","source":"account.number"},
      {"key":"account_digit","label":"DV Conta","start":71,"end":71,"source":"account.digit"},
      {"key":"company_name","label":"Nome Empresa","start":73,"end":102,"source":"company.name"},
      {"key":"bank_name","label":"Nome Banco","start":103,"end":132,"default":"BANCO BRADESCO S.A."},
      {"key":"file_code","label":"Remessa/Retorno","start":143,"end":143,"default":"1"},
      {"key":"generation_date","label":"Data Geração","start":144,"end":151,"format":"DDMMYYYY"},
      {"key":"generation_time","label":"Hora Geração","start":152,"end":157,"format":"HHMMSS"},
      {"key":"sequence","label":"NSA","start":158,"end":163,"type":"numeric"},
      {"key":"layout_file","label":"Versão Layout Arquivo","start":164,"end":166,"default":"084"}
    ]},
    {"record":"lot_header","type":"1","label":"Header de Lote","fields":[
      {"key":"operation","label":"Operação","start":9,"end":9,"default":"R"},
      {"key":"service","label":"Serviço","start":10,"end":11,"default":"01"},
      {"key":"layout_lot","label":"Versão Layout Lote","start":14,"end":16,"default":"042"},
      {"key":"company_document","label":"CNPJ Empresa","start":19,"end":33,"type":"numeric"},
      {"key":"agreement","label":"Convênio / Código Empresa","start":34,"end":53},
      {"key":"agency","label":"Agência","start":54,"end":58,"type":"numeric"},
      {"key":"agency_digit","label":"DV Agência","start":59,"end":59},
      {"key":"account","label":"Conta","start":60,"end":71,"type":"numeric"},
      {"key":"account_digit","label":"DV Conta","start":72,"end":72},
      {"key":"company_name","label":"Nome Empresa","start":74,"end":103},
      {"key":"remittance_sequence","label":"Sequência Remessa/Retorno","start":184,"end":191,"type":"numeric"}
    ]},
    {"record":"detail_p","type":"3","segment":"P","label":"Detalhe Segmento P","fields":[
      {"key":"occurrence","label":"Código Movimento","start":16,"end":17,"default":"01"},
      {"key":"agency","label":"Agência","start":18,"end":22,"type":"numeric"},
      {"key":"agency_digit","label":"DV Agência","start":23,"end":23},
      {"key":"account","label":"Conta","start":24,"end":35,"type":"numeric"},
      {"key":"account_digit","label":"DV Conta","start":36,"end":36},
      {"key":"our_number","label":"Nosso Número","start":46,"end":56,"type":"numeric"},
      {"key":"our_number_digit","label":"DV Nosso Número","start":57,"end":57},
      {"key":"wallet_code","label":"Código Carteira","start":58,"end":58},
      {"key":"document","label":"Seu Número","start":63,"end":77},
      {"key":"due_date","label":"Vencimento","start":78,"end":85,"format":"DDMMYYYY"},
      {"key":"amount","label":"Valor Título","start":86,"end":100,"type":"numeric2"},
      {"key":"species","label":"Espécie","start":107,"end":108},
      {"key":"acceptance","label":"Aceite","start":109,"end":109},
      {"key":"issue_date","label":"Data Emissão","start":110,"end":117,"format":"DDMMYYYY"}
    ]},
    {"record":"detail_q","type":"3","segment":"Q","label":"Detalhe Segmento Q","fields":[
      {"key":"payer_type","label":"Tipo Inscrição Pagador","start":18,"end":18},
      {"key":"payer_document","label":"CPF/CNPJ Pagador","start":19,"end":33,"type":"numeric"},
      {"key":"payer_name","label":"Nome Pagador","start":34,"end":73},
      {"key":"payer_address","label":"Endereço","start":74,"end":113},
      {"key":"district","label":"Bairro","start":114,"end":128},
      {"key":"postal_code","label":"CEP","start":129,"end":136,"type":"numeric"},
      {"key":"city","label":"Cidade","start":137,"end":151},
      {"key":"state","label":"UF","start":152,"end":153}
    ]},
    {"record":"lot_trailer","type":"5","label":"Trailer de Lote","fields":[
      {"key":"record_count","label":"Quantidade Registros","start":18,"end":23,"type":"numeric"}
    ]},
    {"record":"file_trailer","type":"9","label":"Trailer de Arquivo","fields":[
      {"key":"lot_count","label":"Quantidade Lotes","start":18,"end":23,"type":"numeric"},
      {"key":"record_count","label":"Quantidade Registros","start":24,"end":29,"type":"numeric"}
    ]}
  ]'::jsonb,
  '[
    {"record":"detail_t","type":"3","segment":"T","label":"Retorno Segmento T","fields":[
      {"key":"occurrence","label":"Código Movimento","start":16,"end":17},
      {"key":"agency","label":"Agência","start":18,"end":22},
      {"key":"agency_digit","label":"DV Agência","start":23,"end":23},
      {"key":"account","label":"Conta","start":24,"end":35},
      {"key":"account_digit","label":"DV Conta","start":36,"end":36},
      {"key":"our_number","label":"Nosso Número","start":38,"end":57},
      {"key":"wallet","label":"Carteira","start":58,"end":58},
      {"key":"document","label":"Seu Número","start":59,"end":73},
      {"key":"due_date","label":"Vencimento","start":74,"end":81,"format":"DDMMYYYY"},
      {"key":"title_amount","label":"Valor Título","start":82,"end":96,"type":"numeric2"},
      {"key":"company_use","label":"Uso Empresa","start":106,"end":130},
      {"key":"payer_document","label":"CPF/CNPJ Pagador","start":133,"end":148},
      {"key":"payer_name","label":"Nome Pagador","start":149,"end":188},
      {"key":"bank_fee","label":"Tarifa","start":199,"end":213,"type":"numeric2"},
      {"key":"errors","label":"Motivos Ocorrência","start":214,"end":223}
    ]},
    {"record":"detail_u","type":"3","segment":"U","label":"Retorno Segmento U","fields":[
      {"key":"occurrence","label":"Código Movimento","start":16,"end":17},
      {"key":"interest","label":"Juros/Multa","start":18,"end":32,"type":"numeric2"},
      {"key":"discount","label":"Desconto","start":33,"end":47,"type":"numeric2"},
      {"key":"rebate","label":"Abatimento","start":48,"end":62,"type":"numeric2"},
      {"key":"iof","label":"IOF","start":63,"end":77,"type":"numeric2"},
      {"key":"paid_amount","label":"Valor Pago","start":78,"end":92,"type":"numeric2"},
      {"key":"net_amount","label":"Valor Líquido","start":93,"end":107,"type":"numeric2"},
      {"key":"other_expenses","label":"Outras Despesas","start":108,"end":122,"type":"numeric2"},
      {"key":"other_credits","label":"Outros Créditos","start":123,"end":137,"type":"numeric2"},
      {"key":"occurrence_date","label":"Data Ocorrência","start":138,"end":145,"format":"DDMMYYYY"},
      {"key":"credit_date","label":"Data Crédito","start":146,"end":153,"format":"DDMMYYYY"}
    ]}
  ]'::jsonb,
  true
)
on conflict(bank_code,layout,version) do update set
  bank_name=excluded.bank_name,record_length=excluded.record_length,source_name=excluded.source_name,source_url=excluded.source_url,
  remittance_model=excluded.remittance_model,return_model=excluded.return_model,active=true,updated_at=now();

-- BRADESCO 237 · CNAB 400 · manual oficial versão Agosto/2022.
insert into public.bank_file_layout_models(
  bank_code,bank_name,layout,version,record_length,source_name,source_url,remittance_model,return_model,active
) values(
  '237','Bradesco','cnab400','agosto-2022',400,
  'Bradesco - Layout de Cobrança 400 Posições - Agosto/2022',
  'https://banco.bradesco/assets/pessoajuridica/pdf/4008-524-0121-layout-cobranca-versao-portugues.pdf',
  '[
    {"record":"header","type":"0","label":"Header Remessa","fields":[
      {"key":"record_type","label":"Tipo Registro","start":1,"end":1,"default":"0"},
      {"key":"operation","label":"Arquivo Remessa","start":2,"end":2,"default":"1"},
      {"key":"remittance_literal","label":"Literal Remessa","start":3,"end":9,"default":"REMESSA"},
      {"key":"service_code","label":"Código Serviço","start":10,"end":11,"default":"01"},
      {"key":"service_literal","label":"Serviço","start":12,"end":26,"default":"COBRANCA"},
      {"key":"beneficiary_code","label":"Código Empresa Bradesco","start":27,"end":46,"type":"numeric"},
      {"key":"company_name","label":"Nome Empresa","start":47,"end":76},
      {"key":"bank_code","label":"Código Banco","start":77,"end":79,"default":"237"},
      {"key":"bank_name","label":"Nome Banco","start":80,"end":94,"default":"BRADESCO"},
      {"key":"generation_date","label":"Data Geração","start":95,"end":100,"format":"DDMMYY"},
      {"key":"system","label":"Sistema","start":109,"end":110,"default":"MX"},
      {"key":"remittance_sequence","label":"Sequencial Remessa","start":111,"end":117,"type":"numeric"},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric","default":"000001"}
    ]},
    {"record":"detail","type":"1","label":"Transação Tipo 1","fields":[
      {"key":"beneficiary_identification","label":"Identificação Empresa no Banco","start":21,"end":37},
      {"key":"company_use","label":"Controle Participante","start":38,"end":62},
      {"key":"bank_code","label":"Banco","start":63,"end":65,"default":"237"},
      {"key":"fine_indicator","label":"Indicador Multa","start":66,"end":66},
      {"key":"fine_percent","label":"Percentual Multa","start":67,"end":70,"type":"numeric2"},
      {"key":"our_number","label":"Nosso Número","start":71,"end":81,"type":"numeric"},
      {"key":"our_number_digit","label":"DV Nosso Número","start":82,"end":82},
      {"key":"issue_condition","label":"Emissão Boleto","start":93,"end":93},
      {"key":"occurrence","label":"Código Ocorrência","start":109,"end":110},
      {"key":"document","label":"Seu Número","start":111,"end":120},
      {"key":"due_date","label":"Vencimento","start":121,"end":126,"format":"DDMMYY"},
      {"key":"amount","label":"Valor Título","start":127,"end":139,"type":"numeric2"},
      {"key":"species","label":"Espécie","start":148,"end":149},
      {"key":"payer_document","label":"CPF/CNPJ Pagador","start":221,"end":234},
      {"key":"payer_name","label":"Nome Pagador","start":235,"end":274},
      {"key":"payer_address","label":"Endereço Pagador","start":275,"end":314},
      {"key":"postal_code","label":"CEP","start":327,"end":334},
      {"key":"beneficiary_final","label":"Beneficiário Final / Mensagem","start":335,"end":394},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}
    ]},
    {"record":"trailer","type":"9","label":"Trailer Remessa","fields":[
      {"key":"record_type","label":"Tipo Registro","start":1,"end":1,"default":"9"},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}
    ]}
  ]'::jsonb,
  '[
    {"record":"header","type":"0","label":"Header Retorno","fields":[
      {"key":"record_type","label":"Tipo Registro","start":1,"end":1,"default":"0"},
      {"key":"return_code","label":"Arquivo Retorno","start":2,"end":2,"default":"2"},
      {"key":"return_literal","label":"Literal Retorno","start":3,"end":9,"default":"RETORNO"},
      {"key":"service_code","label":"Código Serviço","start":10,"end":11,"default":"01"},
      {"key":"beneficiary_code","label":"Código Empresa","start":27,"end":46},
      {"key":"company_name","label":"Nome Empresa","start":47,"end":76},
      {"key":"bank_code","label":"Código Banco","start":77,"end":79,"default":"237"},
      {"key":"generation_date","label":"Data Arquivo","start":95,"end":100,"format":"DDMMYY"},
      {"key":"bank_notice","label":"Aviso Bancário","start":109,"end":113},
      {"key":"credit_date","label":"Data Crédito","start":380,"end":385,"format":"DDMMYY"},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400}
    ]},
    {"record":"detail","type":"1","label":"Transação Retorno Tipo 1","fields":[
      {"key":"company_use","label":"Controle Participante","start":38,"end":62},
      {"key":"our_number","label":"Nosso Número Remessa","start":71,"end":82},
      {"key":"wallet","label":"Carteira","start":108,"end":108},
      {"key":"occurrence","label":"Código Ocorrência","start":109,"end":110},
      {"key":"occurrence_date","label":"Data Ocorrência","start":111,"end":116,"format":"DDMMYY"},
      {"key":"document","label":"Seu Número","start":117,"end":126},
      {"key":"confirmed_our_number","label":"Nosso Número Confirmado","start":127,"end":146},
      {"key":"due_date","label":"Vencimento","start":147,"end":152,"format":"DDMMYY"},
      {"key":"title_amount","label":"Valor Título","start":153,"end":165,"type":"numeric2"},
      {"key":"bank_fee","label":"Despesa Cobrança","start":176,"end":188,"type":"numeric2"},
      {"key":"other_expenses","label":"Outras Despesas","start":189,"end":201,"type":"numeric2"},
      {"key":"iof","label":"IOF","start":215,"end":227,"type":"numeric2"},
      {"key":"rebate","label":"Abatimento","start":228,"end":240,"type":"numeric2"},
      {"key":"discount","label":"Desconto","start":241,"end":253,"type":"numeric2"},
      {"key":"paid_amount","label":"Valor Pago","start":254,"end":266,"type":"numeric2"},
      {"key":"interest","label":"Juros Mora","start":267,"end":279,"type":"numeric2"},
      {"key":"other_credits","label":"Outros Créditos","start":280,"end":292,"type":"numeric2"},
      {"key":"occurrence_reasons","label":"Motivos Ocorrência","start":319,"end":328},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400}
    ]},
    {"record":"trailer","type":"9","label":"Trailer Retorno","fields":[
      {"key":"record_type","label":"Tipo Registro","start":1,"end":1,"default":"9"},
      {"key":"sequence","label":"Sequencial Registro","start":395,"end":400}
    ]}
  ]'::jsonb,
  true
)
on conflict(bank_code,layout,version) do update set
  bank_name=excluded.bank_name,record_length=excluded.record_length,source_name=excluded.source_name,source_url=excluded.source_url,
  remittance_model=excluded.remittance_model,return_model=excluded.return_model,active=true,updated_at=now();

-- Configurador multibanco. O Itaú continua delegado para as rotinas já homologadas.
-- O Bradesco entra como pré-configuração e permanece bloqueado para geração produtiva
-- até o arquivo de teste passar pelo Validador Universal e pela homologação da conta.
create or replace function public.erp_cnab_config_save_v2(
  p_token text,p_bank_account uuid,p_layout text,p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; ba public.bank_accounts%rowtype; co public.companies%rowtype; cfg public.bank_cnab_configs%rowtype;
  bank text; layout_name text:=lower(trim(coalesce(p_layout,'')));
  ag text; ag_digit text; acct text; acct_digit text; wallet_value text; agreement_value text; beneficiary_value text;
  species_value text; acceptance_value text; initial_our bigint; ready boolean;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if layout_name not in ('cnab240','cnab400') then return jsonb_build_object('ok',false,'error','invalid_cnab_layout'); end if;
  select * into ba from public.bank_accounts where id=p_bank_account and tenant_id=v.tenant_id and active=true and account_type='bank';
  if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
  bank:=lpad(regexp_replace(coalesce(ba.bank_code,''),'\D','','g'),3,'0');

  if bank='341' then
    if layout_name='cnab240' then return public.erp_cnab240_config_save(p_token,p_bank_account,p_payload); end if;
    return public.erp_cnab400_config_save(p_token,p_bank_account,p_payload);
  end if;
  if bank<>'237' then return jsonb_build_object('ok',false,'error','bank_cnab_not_enabled_yet','bank_code',bank); end if;

  select * into co from public.companies where id=v.company_id and tenant_id=v.tenant_id;
  if co.id is null or length(regexp_replace(coalesce(co.cnpj,''),'\D','','g'))<>14 then
    return jsonb_build_object('ok',false,'error','company_cnpj_required');
  end if;

  ag:=regexp_replace(coalesce(nullif(p_payload->>'agency',''),ba.agency,''),'\D','','g');
  ag_digit:=upper(regexp_replace(coalesce(nullif(p_payload->>'agency_digit',''),ba.agency_digit,''),'[^0-9A-Z]','','g'));
  acct:=regexp_replace(coalesce(nullif(p_payload->>'account_number',''),ba.account_number,''),'\D','','g');
  acct_digit:=upper(regexp_replace(coalesce(nullif(p_payload->>'account_digit',''),ba.account_digit,''),'[^0-9A-Z]','','g'));
  wallet_value:=regexp_replace(coalesce(nullif(p_payload->>'wallet',''),ba.wallet,''),'\D','','g');
  agreement_value:=regexp_replace(coalesce(nullif(p_payload->>'agreement',''),ba.agreement,''),'\D','','g');
  beneficiary_value:=regexp_replace(coalesce(nullif(p_payload->>'beneficiary_code',''),ba.beneficiary_code,''),'\D','','g');
  species_value:=regexp_replace(coalesce(nullif(p_payload->>'species',''),'01'),'\D','','g');
  acceptance_value:=upper(coalesce(nullif(p_payload->>'acceptance',''),'N'));
  initial_our:=greatest(coalesce(nullif(p_payload->>'initial_our_number','')::bigint,0),0);

  if length(ag) not between 1 and 5 then return jsonb_build_object('ok',false,'error','bradesco_agency_invalid'); end if;
  if length(ag_digit)>1 then return jsonb_build_object('ok',false,'error','bradesco_agency_digit_invalid'); end if;
  if length(acct) not between 1 and 12 then return jsonb_build_object('ok',false,'error','bradesco_account_invalid'); end if;
  if length(acct_digit)<>1 then return jsonb_build_object('ok',false,'error','bradesco_account_digit_required'); end if;
  if length(wallet_value) not between 1 and 3 then return jsonb_build_object('ok',false,'error','bradesco_wallet_required'); end if;
  if length(beneficiary_value)>20 then return jsonb_build_object('ok',false,'error','bradesco_beneficiary_code_too_long'); end if;
  if length(species_value)<>2 then return jsonb_build_object('ok',false,'error','cnab_species_invalid'); end if;
  if acceptance_value not in ('A','N') then return jsonb_build_object('ok',false,'error','cnab_acceptance_invalid'); end if;
  if initial_our>99999999999 then return jsonb_build_object('ok',false,'error','cnab_our_number_out_of_range'); end if;

  ready:=(length(ag)=4 and length(acct)=7 and length(acct_digit)=1 and length(wallet_value)=2 and length(beneficiary_value) between 1 and 20);

  insert into public.bank_cnab_configs(
    tenant_id,company_id,branch_id,bank_account_id,bank_code,layout,agency,account_number,account_digit,
    wallet,species,acceptance,our_number_sequence,active,settings
  ) values(
    v.tenant_id,v.company_id,v.branch_id,ba.id,'237',layout_name,ag,acct,acct_digit,wallet_value,species_value,acceptance_value,
    initial_our,coalesce((p_payload->>'active')::boolean,true),
    jsonb_build_object(
      'bank_name','BRADESCO','agency_digit',ag_digit,'agreement',agreement_value,'beneficiary_code',beneficiary_value,
      'manual_version',case when layout_name='cnab240' then '084/042 - Dezembro/2024' else 'Agosto/2022' end,
      'manual_url',case when layout_name='cnab240' then 'https://assets.bradesco/content/dam/portal-bradesco/assets/pessoajuridica/pdf/MPO-Troca-Arquivos-Layout-240P.pdf' else 'https://banco.bradesco/assets/pessoajuridica/pdf/4008-524-0121-layout-cobranca-versao-portugues.pdf' end,
      'validator_url','https://wspf.bradesco.com.br/wsValidadorUniversal/validadorgeral',
      'generation_ready',false,'preconfiguration_complete',ready,'implementation_stage','official_model_preconfigured'
    )
  )
  on conflict(tenant_id,bank_account_id,layout) do update set
    company_id=excluded.company_id,branch_id=excluded.branch_id,bank_code='237',agency=excluded.agency,
    account_number=excluded.account_number,account_digit=excluded.account_digit,wallet=excluded.wallet,
    species=excluded.species,acceptance=excluded.acceptance,
    our_number_sequence=case when public.bank_cnab_configs.our_number_sequence=0 and initial_our>0 then initial_our else public.bank_cnab_configs.our_number_sequence end,
    active=excluded.active,settings=excluded.settings,updated_at=now()
  returning * into cfg;

  update public.bank_accounts set bank_code='237',agency=ag,agency_digit=ag_digit,account_number=acct,account_digit=acct_digit,
    wallet=wallet_value,agreement=agreement_value,beneficiary_code=beneficiary_value,default_layout=layout_name,updated_at=now()
  where id=ba.id;

  return jsonb_build_object(
    'ok',true,'config_id',cfg.id,'bank_code','237','bank_name','Bradesco','layout',layout_name,
    'preconfigured',true,'generation_ready',false,'requires_homologation',true,'official_model_ready',true,
    'validator_url','https://wspf.bradesco.com.br/wsValidadorUniversal/validadorgeral'
  );
end $$;
