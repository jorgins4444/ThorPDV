-- CAIXA Econômica Federal (104) - modelos oficiais de cobrança CNAB.
-- Fontes oficiais CAIXA/SIGCB:
-- CNAB 240: 67.118 v031 micro (remessa arquivo 107 / lote 067; retorno arquivo 047).
-- CNAB 400: 67.126 v029 micro - maio/2024.
-- Esta migration implanta os modelos e a configuração de homologação.
-- Geração/parser operacional CAIXA permanecem bloqueados até o adaptador específico ser homologado.

insert into public.bank_file_layout_models(
  bank_code,bank_name,layout,version,record_length,source_name,source_url,
  remittance_model,return_model,active,updated_at
)
values
(
  '104','CAIXA Econômica Federal','cnab240','107/067-remessa-047-retorno-v031',240,
  'CAIXA - Leiaute de Arquivo Eletrônico Padrão CNAB 240 - Cobrança Bancária CAIXA - SIGCB - 67.118 v031 micro',
  'https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_240.pdf',
  $json$[{"record":"file_header","type":"0","label":"Header de Arquivo Remessa","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"lot","label":"Código do Lote","start":4,"end":7,"type":"numeric","default":"0000"},{"key":"record_type","label":"Tipo de Registro","start":8,"end":8,"type":"numeric","default":"0"},{"key":"beneficiary_type","label":"Tipo de Inscrição do Beneficiário","start":18,"end":18,"type":"numeric","source":"company.document_type"},{"key":"beneficiary_document","label":"CPF/CNPJ do Beneficiário","start":19,"end":32,"type":"numeric","source":"company.document"},{"key":"agency","label":"Agência Mantenedora","start":53,"end":57,"type":"numeric","source":"account.agency"},{"key":"agency_digit","label":"DV Agência","start":58,"end":58,"source":"account.agency_digit"},{"key":"beneficiary_code","label":"Código do Beneficiário","start":59,"end":65,"type":"numeric","source":"billing.beneficiary_code"},{"key":"company_name","label":"Nome da Empresa","start":73,"end":102,"source":"company.name"},{"key":"bank_name","label":"Nome do Banco","start":103,"end":132,"default":"CAIXA ECONOMICA FEDERAL"},{"key":"file_code","label":"Remessa/Retorno","start":143,"end":143,"type":"numeric","default":"1"},{"key":"generation_date","label":"Data de Geração","start":144,"end":151,"format":"DDMMYYYY"},{"key":"generation_time","label":"Hora de Geração","start":152,"end":157,"format":"HHMMSS"},{"key":"sequence","label":"NSA","start":158,"end":163,"type":"numeric"},{"key":"layout_file","label":"Versão Layout Arquivo","start":164,"end":166,"type":"numeric","default":"107"},{"key":"test_indicator","label":"Situação da Remessa","start":192,"end":211,"default":"REMESSA-TESTE"}]},{"record":"lot_header","type":"1","label":"Header de Lote Remessa","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"lot","label":"Lote de Serviço","start":4,"end":7,"type":"numeric"},{"key":"record_type","label":"Tipo de Registro","start":8,"end":8,"type":"numeric","default":"1"},{"key":"operation","label":"Tipo de Operação","start":9,"end":9,"default":"R"},{"key":"service","label":"Tipo de Serviço","start":10,"end":11,"type":"numeric","default":"01"},{"key":"layout_lot","label":"Versão Layout Lote","start":14,"end":16,"type":"numeric","default":"067"},{"key":"beneficiary_type","label":"Tipo Inscrição Beneficiário","start":18,"end":18,"type":"numeric"},{"key":"beneficiary_document","label":"CPF/CNPJ Beneficiário","start":19,"end":33,"type":"numeric"},{"key":"beneficiary_code","label":"Código do Beneficiário","start":34,"end":40,"type":"numeric","source":"billing.beneficiary_code"},{"key":"company_name","label":"Nome da Empresa","start":74,"end":103,"source":"company.name"}]},{"record":"detail_p","type":"3","segment":"P","label":"Detalhe Segmento P - Dados do Título","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"segment","label":"Segmento","start":14,"end":14,"default":"P"},{"key":"occurrence","label":"Código de Movimento","start":16,"end":17,"type":"numeric","default":"01"},{"key":"agency","label":"Agência Mantenedora","start":18,"end":22,"type":"numeric","source":"account.agency"},{"key":"agency_digit","label":"DV Agência","start":23,"end":23,"source":"account.agency_digit"},{"key":"beneficiary_code","label":"Código do Beneficiário","start":24,"end":30,"type":"numeric","source":"billing.beneficiary_code"},{"key":"our_number_modality","label":"Modalidade Nosso Número","start":41,"end":42,"type":"numeric","source":"billing.modality"},{"key":"our_number","label":"Identificação do Título no Banco","start":43,"end":57,"type":"numeric","source":"billing.our_number"},{"key":"wallet","label":"Código da Carteira","start":58,"end":58,"type":"numeric","default":"1"},{"key":"registration_form","label":"Forma de Cadastramento","start":59,"end":59,"type":"numeric","default":"1"},{"key":"document_type","label":"Tipo de Documento","start":60,"end":60,"default":"2"},{"key":"document","label":"Seu Número","start":63,"end":73,"source":"receivable.document"},{"key":"due_date","label":"Vencimento","start":78,"end":85,"format":"DDMMYYYY"},{"key":"amount","label":"Valor do Título","start":86,"end":100,"type":"numeric2"},{"key":"species","label":"Espécie","start":107,"end":108,"type":"numeric","source":"billing.species"},{"key":"acceptance","label":"Aceite","start":109,"end":109,"source":"billing.acceptance"}]},{"record":"detail_q","type":"3","segment":"Q","label":"Detalhe Segmento Q - Pagador","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"segment","label":"Segmento","start":14,"end":14,"default":"Q"},{"key":"occurrence","label":"Código de Movimento","start":16,"end":17,"type":"numeric","default":"01"},{"key":"payer_type","label":"Tipo Inscrição Pagador","start":18,"end":18,"type":"numeric"},{"key":"payer_document","label":"CPF/CNPJ Pagador","start":19,"end":33,"type":"numeric"},{"key":"payer_name","label":"Nome Pagador","start":34,"end":73},{"key":"payer_address","label":"Endereço Pagador","start":74,"end":113},{"key":"district","label":"Bairro","start":114,"end":128},{"key":"postal_code","label":"CEP","start":129,"end":136,"type":"numeric"},{"key":"city","label":"Cidade","start":137,"end":151},{"key":"state","label":"UF","start":152,"end":153}]},{"record":"lot_trailer","type":"5","label":"Trailer de Lote","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"record_type","label":"Tipo de Registro","start":8,"end":8,"type":"numeric","default":"5"},{"key":"record_count","label":"Quantidade de Registros","start":18,"end":23,"type":"numeric"}]},{"record":"file_trailer","type":"9","label":"Trailer de Arquivo","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"record_type","label":"Tipo de Registro","start":8,"end":8,"type":"numeric","default":"9"},{"key":"lot_count","label":"Quantidade de Lotes","start":18,"end":23,"type":"numeric"},{"key":"record_count","label":"Quantidade de Registros","start":24,"end":29,"type":"numeric"}]}]$json$::jsonb,
  $json$[{"record":"detail_t","type":"3","segment":"T","label":"Retorno Segmento T - Dados do Título","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"segment","label":"Segmento","start":14,"end":14,"default":"T"},{"key":"occurrence","label":"Código de Movimento","start":16,"end":17,"type":"numeric"},{"key":"agency","label":"Agência Mantenedora","start":18,"end":22,"type":"numeric"},{"key":"agency_digit","label":"DV Agência","start":23,"end":23},{"key":"beneficiary_code","label":"Código do Beneficiário","start":24,"end":30,"type":"numeric"},{"key":"our_number","label":"Nosso Número / Identificação do Título","start":38,"end":57},{"key":"wallet","label":"Carteira","start":58,"end":58},{"key":"document","label":"Seu Número","start":59,"end":73},{"key":"due_date","label":"Vencimento","start":74,"end":81,"format":"DDMMYYYY"},{"key":"title_amount","label":"Valor do Título","start":82,"end":96,"type":"numeric2"},{"key":"company_use","label":"Uso da Empresa","start":106,"end":130},{"key":"payer_document","label":"CPF/CNPJ Pagador","start":133,"end":148},{"key":"payer_name","label":"Nome Pagador","start":149,"end":188},{"key":"bank_fee","label":"Tarifa","start":199,"end":213,"type":"numeric2"},{"key":"errors","label":"Motivos / Rejeições","start":214,"end":223}]},{"record":"detail_u","type":"3","segment":"U","label":"Retorno Segmento U - Valores e Datas","fields":[{"key":"bank_code","label":"Código do Banco","start":1,"end":3,"type":"numeric","default":"104"},{"key":"segment","label":"Segmento","start":14,"end":14,"default":"U"},{"key":"occurrence","label":"Código de Movimento","start":16,"end":17,"type":"numeric"},{"key":"interest","label":"Juros / Multa","start":18,"end":32,"type":"numeric2"},{"key":"discount","label":"Desconto","start":33,"end":47,"type":"numeric2"},{"key":"rebate","label":"Abatimento","start":48,"end":62,"type":"numeric2"},{"key":"iof","label":"IOF","start":63,"end":77,"type":"numeric2"},{"key":"paid_amount","label":"Valor Pago","start":78,"end":92,"type":"numeric2"},{"key":"net_amount","label":"Valor Líquido","start":93,"end":107,"type":"numeric2"},{"key":"other_expenses","label":"Outras Despesas","start":108,"end":122,"type":"numeric2"},{"key":"other_credits","label":"Outros Créditos","start":123,"end":137,"type":"numeric2"},{"key":"occurrence_date","label":"Data da Ocorrência","start":138,"end":145,"format":"DDMMYYYY"},{"key":"credit_date","label":"Data do Crédito","start":146,"end":153,"format":"DDMMYYYY"}]}]$json$::jsonb,
  true,now()
),
(
  '104','CAIXA Econômica Federal','cnab400','maio-2024-v029',400,
  'CAIXA - Leiaute de Arquivo Eletrônico Padrão CNAB 400 - Cobrança Bancária CAIXA - SIGCB - 67.126 v029 micro',
  'https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_400.pdf',
  $json$[{"record":"header","type":"0","label":"Header Remessa","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"0"},{"key":"operation","label":"Código Remessa","start":2,"end":2,"type":"numeric","default":"1"},{"key":"remittance_literal","label":"Literal Remessa","start":3,"end":9,"default":"REMESSA"},{"key":"service_code","label":"Código Serviço","start":10,"end":11,"type":"numeric","default":"01"},{"key":"service_literal","label":"Serviço","start":12,"end":26,"default":"COBRANCA"},{"key":"agency","label":"Agência","start":27,"end":30,"type":"numeric","source":"account.agency"},{"key":"beneficiary_code","label":"Código do Beneficiário","start":31,"end":37,"type":"numeric","source":"billing.beneficiary_code"},{"key":"company_name","label":"Nome Empresa","start":47,"end":76,"source":"company.name"},{"key":"bank_code","label":"Código Banco","start":77,"end":79,"type":"numeric","default":"104"},{"key":"bank_name","label":"Nome Banco","start":80,"end":94,"default":"CAIXA"},{"key":"generation_date","label":"Data Geração","start":95,"end":100,"format":"DDMMYY"},{"key":"layout_version","label":"Versão do Layout (NE065)","start":101,"end":103},{"key":"remittance_sequence","label":"Sequencial Remessa","start":390,"end":394,"type":"numeric"},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric","default":"000001"}]},{"record":"detail","type":"1","label":"Detalhe Remessa - Dados do Título","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"1"},{"key":"company_document_type","label":"Tipo Inscrição Empresa","start":2,"end":3,"type":"numeric"},{"key":"company_document","label":"CPF/CNPJ Empresa","start":4,"end":17,"type":"numeric"},{"key":"beneficiary_code","label":"Código do Beneficiário","start":21,"end":27,"type":"numeric","source":"billing.beneficiary_code"},{"key":"wallet","label":"Carteira","start":107,"end":108,"type":"numeric","default":"01"},{"key":"occurrence","label":"Código Ocorrência","start":109,"end":110,"type":"numeric","default":"01"},{"key":"document","label":"Seu Número","start":111,"end":120},{"key":"due_date","label":"Vencimento","start":121,"end":126,"format":"DDMMYY"},{"key":"amount","label":"Valor do Título","start":127,"end":139,"type":"numeric2"},{"key":"bank_code","label":"Banco Compensação","start":140,"end":142,"type":"numeric","default":"104"},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}]},{"record":"trailer","type":"9","label":"Trailer Remessa","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"9"},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}]}]$json$::jsonb,
  $json$[{"record":"header","type":"0","label":"Header Retorno","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"0"},{"key":"return_code","label":"Código Retorno","start":2,"end":2,"type":"numeric","default":"2"},{"key":"return_literal","label":"Literal Retorno","start":3,"end":9,"default":"RETORNO"},{"key":"service_code","label":"Código Serviço","start":10,"end":11,"type":"numeric","default":"01"},{"key":"bank_code","label":"Código Banco","start":77,"end":79,"type":"numeric","default":"104"},{"key":"generation_date","label":"Data Arquivo","start":95,"end":100,"format":"DDMMYY"},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}]},{"record":"detail","type":"1","label":"Detalhe Retorno - Dados do Título","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"1"},{"key":"company_use","label":"Controle do Beneficiário","start":32,"end":56},{"key":"modality","label":"Modalidade","start":57,"end":58,"type":"numeric"},{"key":"our_number","label":"Identificação do Título CAIXA","start":59,"end":73},{"key":"wallet","label":"Carteira","start":107,"end":108,"type":"numeric"},{"key":"occurrence","label":"Código Ocorrência","start":109,"end":110,"type":"numeric"},{"key":"occurrence_date","label":"Data Ocorrência","start":111,"end":116,"format":"DDMMYY"},{"key":"document","label":"Seu Número","start":117,"end":126},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}]},{"record":"trailer","type":"9","label":"Trailer Retorno","fields":[{"key":"record_type","label":"Tipo Registro","start":1,"end":1,"type":"numeric","default":"9"},{"key":"sequence","label":"Sequencial Registro","start":395,"end":400,"type":"numeric"}]}]$json$::jsonb,
  true,now()
)
on conflict(bank_code,layout,version) do update set
  bank_name=excluded.bank_name,
  record_length=excluded.record_length,
  source_name=excluded.source_name,
  source_url=excluded.source_url,
  remittance_model=excluded.remittance_model,
  return_model=excluded.return_model,
  active=true,
  updated_at=now();

create or replace function public.erp_cnab_config_save_v3(
  p_token text,
  p_bank_account uuid,
  p_layout text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $function$
declare
  v record;
  ba public.bank_accounts%rowtype;
  co public.companies%rowtype;
  cfg public.bank_cnab_configs%rowtype;
  bank text;
  layout_name text:=lower(trim(coalesce(p_layout,'')));
  ag text;
  ag_digit text;
  acct text;
  acct_digit text;
  wallet_value text;
  agreement_value text;
  beneficiary_value text;
  species_value text;
  acceptance_value text;
  initial_our bigint;
  ready boolean;
  manual_url text;
  manual_version text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if layout_name not in ('cnab240','cnab400') then
    return jsonb_build_object('ok',false,'error','invalid_cnab_layout');
  end if;

  select * into ba
  from public.bank_accounts
  where id=p_bank_account
    and tenant_id=v.tenant_id
    and active=true
    and account_type='bank';

  if ba.id is null then
    return jsonb_build_object('ok',false,'error','bank_account_not_found');
  end if;

  bank:=lpad(regexp_replace(coalesce(ba.bank_code,''),'\D','','g'),3,'0');

  -- Mantém adaptadores já existentes sem alterar suas regras.
  if bank in ('341','237') then
    return public.erp_cnab_config_save_v2(p_token,p_bank_account,layout_name,p_payload);
  end if;

  if bank<>'104' then
    return jsonb_build_object('ok',false,'error','bank_cnab_not_enabled_yet','bank_code',bank);
  end if;

  select * into co
  from public.companies
  where id=v.company_id and tenant_id=v.tenant_id;

  if co.id is null
     or length(regexp_replace(coalesce(co.cnpj,''),'\D','','g'))<>14 then
    return jsonb_build_object('ok',false,'error','company_cnpj_required');
  end if;

  ag:=regexp_replace(coalesce(nullif(p_payload->>'agency',''),ba.agency,''),'\D','','g');
  ag_digit:=upper(regexp_replace(coalesce(nullif(p_payload->>'agency_digit',''),ba.agency_digit,''),'[^0-9A-Z]','','g'));
  acct:=regexp_replace(coalesce(nullif(p_payload->>'account_number',''),ba.account_number,''),'\D','','g');
  acct_digit:=upper(regexp_replace(coalesce(nullif(p_payload->>'account_digit',''),ba.account_digit,''),'[^0-9A-Z]','','g'));
  agreement_value:=regexp_replace(coalesce(nullif(p_payload->>'agreement',''),ba.agreement,''),'\D','','g');
  beneficiary_value:=regexp_replace(coalesce(nullif(p_payload->>'beneficiary_code',''),ba.beneficiary_code,''),'\D','','g');

  -- CAIXA: C006/NE016. Cobrança simples/registrada = 1 no 240 e 01 no 400.
  wallet_value:=case
    when layout_name='cnab240' then
      case when regexp_replace(coalesce(ba.wallet,''),'\D','','g') in ('1','3','4','6')
           then regexp_replace(ba.wallet,'\D','','g') else '1' end
    else
      case when lpad(regexp_replace(coalesce(ba.wallet,''),'\D','','g'),2,'0') in ('01','03','04','06')
           then lpad(regexp_replace(ba.wallet,'\D','','g'),2,'0') else '01' end
  end;

  species_value:=regexp_replace(coalesce(nullif(p_payload->>'species',''),'01'),'\D','','g');
  acceptance_value:=upper(coalesce(nullif(p_payload->>'acceptance',''),'N'));
  begin
    initial_our:=greatest(coalesce(nullif(p_payload->>'initial_our_number','')::bigint,0),0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'error','cnab_our_number_invalid');
  end;

  if length(ag) not between 1 and 5 then
    return jsonb_build_object('ok',false,'error','caixa_agency_invalid');
  end if;
  if length(ag_digit)>1 then
    return jsonb_build_object('ok',false,'error','caixa_agency_digit_invalid');
  end if;
  if length(acct) not between 1 and 12 then
    return jsonb_build_object('ok',false,'error','caixa_account_invalid');
  end if;
  if length(acct_digit)>1 then
    return jsonb_build_object('ok',false,'error','caixa_account_digit_invalid');
  end if;
  if length(beneficiary_value) not between 1 and 7 then
    return jsonb_build_object('ok',false,'error','caixa_beneficiary_code_required');
  end if;
  if length(species_value)<>2 then
    return jsonb_build_object('ok',false,'error','cnab_species_invalid');
  end if;
  if acceptance_value not in ('A','N') then
    return jsonb_build_object('ok',false,'error','cnab_acceptance_invalid');
  end if;
  if initial_our>999999999999999 then
    return jsonb_build_object('ok',false,'error','cnab_our_number_out_of_range');
  end if;

  if layout_name='cnab240' then
    manual_url:='https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_240.pdf';
    manual_version:='67.118 v031 micro · arquivo 107 · lote 067 · retorno 047';
  else
    manual_url:='https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_400.pdf';
    manual_version:='67.126 v029 micro · maio/2024';
  end if;

  ready:=(length(beneficiary_value) between 1 and 7 and length(ag) between 1 and 5);

  insert into public.bank_cnab_configs(
    tenant_id,company_id,branch_id,bank_account_id,bank_code,layout,
    agency,account_number,account_digit,wallet,species,acceptance,
    our_number_sequence,active,settings
  )
  values(
    v.tenant_id,v.company_id,v.branch_id,ba.id,'104',layout_name,
    ag,acct,coalesce(acct_digit,''),wallet_value,species_value,acceptance_value,
    initial_our,coalesce((p_payload->>'active')::boolean,true),
    jsonb_build_object(
      'bank_name','CAIXA ECONOMICA FEDERAL',
      'agency_digit',ag_digit,
      'agreement',agreement_value,
      'beneficiary_code',beneficiary_value,
      'manual_version',manual_version,
      'manual_url',manual_url,
      'generation_ready',false,
      'return_parser_ready',false,
      'preconfiguration_complete',ready,
      'implementation_stage','official_model_preconfigured',
      'requires_bank_homologation',true
    )
  )
  on conflict(tenant_id,bank_account_id,layout) do update set
    company_id=excluded.company_id,
    branch_id=excluded.branch_id,
    bank_code='104',
    agency=excluded.agency,
    account_number=excluded.account_number,
    account_digit=excluded.account_digit,
    wallet=excluded.wallet,
    species=excluded.species,
    acceptance=excluded.acceptance,
    our_number_sequence=case
      when public.bank_cnab_configs.our_number_sequence=0 and initial_our>0 then initial_our
      else public.bank_cnab_configs.our_number_sequence
    end,
    active=excluded.active,
    settings=excluded.settings,
    updated_at=now()
  returning * into cfg;

  update public.bank_accounts
  set bank_code='104',
      agency=ag,
      agency_digit=ag_digit,
      account_number=acct,
      account_digit=acct_digit,
      wallet=wallet_value,
      agreement=agreement_value,
      beneficiary_code=beneficiary_value,
      default_layout=layout_name,
      updated_at=now()
  where id=ba.id;

  perform private.ensure_bank_file_homologation(cfg.id);

  return jsonb_build_object(
    'ok',true,
    'config_id',cfg.id,
    'bank_code','104',
    'bank_name','CAIXA Econômica Federal',
    'layout',layout_name,
    'preconfigured',true,
    'generation_ready',false,
    'return_parser_ready',false,
    'requires_homologation',true,
    'official_model_ready',true,
    'manual_version',manual_version,
    'manual_url',manual_url
  );
end
$function$;

comment on function public.erp_cnab_config_save_v3(text,uuid,text,jsonb) is
'Configurador multibanco. Encaminha Itaú/Bradesco ao v2 e habilita pré-configuração oficial CAIXA 104, sem liberar geração/retorno operacional antes do adaptador específico.';
