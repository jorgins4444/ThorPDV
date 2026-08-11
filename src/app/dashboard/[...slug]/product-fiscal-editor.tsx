'use client';

import { useEffect, useMemo, useState } from 'react';
import { fiscalConfigGet } from './fiscal-config-actions';

type Row = Record<string, unknown>;

type FiscalDraft = {
  ncm:string; cest:string; cfop_default:string; origin:string; product_type:string;
  cst_icms:string; csosn:string; cst_pis:string; cst_cofins:string; cst_ipi:string;
  icms_rate:string; pis_rate:string; cofins_rate:string; ipi_rate:string;
  reform_cst:string; reform_classification:string;
  fiscal_origin_uf:string; fiscal_destination_uf:string; fiscal_customer_type:string;
  icms_tax_benefit:string; icms_exemption_reason:string; icms_discount:boolean;
  icms_credit_benefit:string; icms_presumed_credit_rate:string;
  ipi_legal_framework:string;
  petroleum_anp_code:string; petroleum_cide_rate:string; petroleum_mix_percent:string;
};

type FiscalField = keyof FiscalDraft;
type FiscalTab = 'data'|'reform'|'icms'|'ipi'|'pis'|'petroleum';

const text=(v:unknown)=>v==null?'':String(v);
const rows=(v:unknown):Row[]=>Array.isArray(v)?v as Row[]:[];
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};

const tabs:[FiscalTab,string][]=[
  ['data','Dados fiscais'],['reform','Reforma Tributária'],['icms','ICMS'],['ipi','IPI'],['pis','PIS/COFINS'],['petroleum','Derivados de petróleo'],
];

const ufs=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const origins=[
  ['0','Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8'],
  ['1','Estrangeira - importação direta, exceto a indicada no código 6'],
  ['2','Estrangeira - adquirida no mercado interno, exceto a indicada no código 7'],
  ['3','Nacional, mercadoria ou bem com conteúdo de importação superior a 40% e inferior ou igual a 70%'],
  ['4','Nacional, cuja produção tenha sido feita em conformidade com processos produtivos básicos'],
  ['5','Nacional, mercadoria ou bem com conteúdo de importação inferior ou igual a 40%'],
  ['6','Estrangeira - importação direta, sem similar nacional, constante em lista da CAMEX'],
  ['7','Estrangeira - adquirida no mercado interno, sem similar nacional, constante em lista da CAMEX'],
  ['8','Nacional, mercadoria ou bem com conteúdo de importação superior a 70%'],
];
const icmsCst=[
  ['00','Tributada integralmente'],['10','Tributada e com cobrança do ICMS por substituição tributária'],['20','Com redução de base de cálculo'],
  ['30','Isenta ou não tributada e com cobrança do ICMS por substituição tributária'],['40','Isenta'],['41','Não tributada'],['50','Suspensão'],
  ['51','Diferimento'],['60','ICMS cobrado anteriormente por substituição tributária'],['70','Redução de base de cálculo e cobrança por substituição tributária'],['90','Outras'],
];
const csosn=[
  ['101','Tributada pelo Simples Nacional com permissão de crédito'],['102','Tributada pelo Simples Nacional sem permissão de crédito'],
  ['103','Isenção do ICMS no Simples Nacional para faixa de receita bruta'],['201','Com permissão de crédito e cobrança do ICMS por substituição tributária'],
  ['202','Sem permissão de crédito e cobrança do ICMS por substituição tributária'],['203','Isenção e cobrança do ICMS por substituição tributária'],
  ['300','Imune'],['400','Não tributada pelo Simples Nacional'],['500','ICMS cobrado anteriormente por substituição tributária ou antecipação'],['900','Outros'],
];
const pisCofins=[
  ['01','Operação Tributável com Alíquota Básica'],['02','Operação Tributável com Alíquota Diferenciada'],['03','Operação Tributável com Alíquota por Unidade de Medida de Produto'],
  ['04','Operação Tributável Monofásica - Revenda a Alíquota Zero'],['05','Operação Tributável por Substituição Tributária'],['06','Operação Tributável a Alíquota Zero'],
  ['07','Operação Isenta da Contribuição'],['08','Operação sem Incidência da Contribuição'],['09','Operação com Suspensão da Contribuição'],['49','Outras Operações de Saída'],
  ['50','Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno'],['51','Direito a Crédito - Vinculada Exclusivamente a Receita Não Tributada'],
  ['52','Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação'],['53','Direito a Crédito - Vinculada a Receitas Tributadas e Não Tributadas'],
  ['54','Direito a Crédito - Vinculada a Receitas Tributadas e de Exportação'],['55','Direito a Crédito - Vinculada a Receitas Não Tributadas e de Exportação'],
  ['56','Direito a Crédito - Vinculada a Receitas Tributadas, Não Tributadas e de Exportação'],['60','Crédito Presumido - Vinculado Exclusivamente a Receita Tributada'],
  ['61','Crédito Presumido - Vinculado Exclusivamente a Receita Não Tributada'],['62','Crédito Presumido - Vinculado Exclusivamente a Receita de Exportação'],
  ['63','Crédito Presumido - Vinculado a Receitas Tributadas e Não Tributadas'],['64','Crédito Presumido - Vinculado a Receitas Tributadas e de Exportação'],
  ['65','Crédito Presumido - Vinculado a Receitas Não Tributadas e de Exportação'],['66','Crédito Presumido - Vinculado a Receitas Tributadas, Não Tributadas e de Exportação'],
  ['67','Crédito Presumido - Outras Operações'],['70','Operação de Aquisição sem Direito a Crédito'],['71','Operação de Aquisição com Isenção'],
  ['72','Operação de Aquisição com Suspensão'],['73','Operação de Aquisição a Alíquota Zero'],['74','Operação de Aquisição sem Incidência'],
  ['75','Operação de Aquisição por Substituição Tributária'],['98','Outras Operações de Entrada'],['99','Outras Operações'],
];
const ipiCst=[
  ['00','Entrada com recuperação de crédito'],['01','Entrada tributada com alíquota zero'],['02','Entrada isenta'],['03','Entrada não tributada'],['04','Entrada imune'],['05','Entrada com suspensão'],['49','Outras entradas'],
  ['50','Saída tributada'],['51','Saída tributada com alíquota zero'],['52','Saída isenta'],['53','Saída não tributada'],['54','Saída imune'],['55','Saída com suspensão'],['99','Outras saídas'],
];
const reformSuggestions=[
  ['000','Tributação integral'],['200','Alíquota reduzida'],['410','Imunidade e não incidência'],['510','Diferimento'],['515','Diferimento com redução de alíquota'],
];
const customerTypes=[['both','Ambos'],['consumer','Consumidor / Não contribuinte'],['contributor','Empresa / Contribuinte']];
const exemptionReasons=[
  ['','Selecione'],['3','Uso na agropecuária'],['4','Frotista / locadora'],['5','Diplomático / consular'],['6','Utilitários e motocicletas de transporte'],
  ['7','SUFRAMA'],['8','Venda a órgão público'],['9','Outros'],['10','Deficiente condutor'],['11','Deficiente não condutor'],['12','Órgão de fomento e desenvolvimento'],['16','Olímpicos / Paraolímpicos'],['90','Outros motivos previstos na legislação'],
];

function SelectCode({value,onChange,options,placeholder='Selecione'}:{value:string;onChange:(v:string)=>void;options:string[][];placeholder?:string}){
  return <select value={value} onChange={e=>onChange(e.target.value)}><option value="">{placeholder}</option>{options.map(([code,label])=><option key={code} value={code}>{code} - {label}</option>)}</select>;
}

export function ProductFiscalEditor({value,onChange}:{value:FiscalDraft;onChange:(key:FiscalField,value:string|boolean)=>void}){
  const [active,setActive]=useState<FiscalTab>('data');
  const [cfops,setCfops]=useState<Row[]>([]);
  const [issuer,setIssuer]=useState<Row>({});

  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      const r=await fiscalConfigGet();
      if(cancelled||!r.ok)return;
      const settings=obj(r.settings);
      setCfops(rows(settings.cfops).filter(x=>x.active!==false));
      setIssuer(obj(settings.issuer));
    })();
    return()=>{cancelled=true};
  },[]);

  const cfopOptions=useMemo(()=>{
    const list=[...cfops];
    if(value.cfop_default&&!list.some(c=>text(c.code)===value.cfop_default)) list.unshift({code:value.cfop_default,name:'CFOP atualmente informado',active:true});
    return list;
  },[cfops,value.cfop_default]);

  return <section className="product-tax-card">
    <div className="product-tax-title"><div><strong>Tributos e dados fiscais</strong><small>Configuração usada na emissão de NF-e/NFC-e. Selecione os códigos pela descrição para reduzir erros de digitação.</small></div><span>{text(issuer.state)||'UF não definida'}</span></div>
    <div className="product-tax-tabs">{tabs.map(([id,label])=><button type="button" key={id} className={active===id?'active':''} onClick={()=>setActive(id)}>{label}</button>)}</div>

    {active==='data'&&<div className="product-tax-panel">
      <div className="product-form-grid cols4">
        <label className="span2"><span>NCM - Nomenclatura Comum do Mercosul *</span><input inputMode="numeric" maxLength={8} value={value.ncm} onChange={e=>onChange('ncm',e.target.value.replace(/\D/g,'').slice(0,8))} placeholder="8 dígitos"/><small>Informe o NCM oficial do produto.</small></label>
        <label><span>CEST</span><input inputMode="numeric" value={value.cest} onChange={e=>onChange('cest',e.target.value.replace(/\D/g,'').slice(0,7))} placeholder="Quando aplicável"/></label>
        <label><span>Origem da mercadoria *</span><SelectCode value={value.origin} onChange={v=>onChange('origin',v)} options={origins}/></label>
        <label><span>Tipo do produto</span><select value={value.product_type} onChange={e=>onChange('product_type',e.target.value)}><option value="resale">Mercadoria para revenda</option><option value="finished_product">Produto acabado</option><option value="raw_material">Matéria-prima</option><option value="intermediate_product">Produto intermediário</option><option value="packaging">Embalagem</option><option value="use_consumption">Material de uso e consumo</option><option value="fixed_asset">Ativo imobilizado</option><option value="service">Serviço</option><option value="other">Outros</option></select></label>
        <label className="span2"><span>CFOP padrão *</span><select value={value.cfop_default} onChange={e=>onChange('cfop_default',e.target.value)}><option value="">Selecione na lista fiscal...</option>{cfopOptions.map(c=><option key={text(c.code)} value={text(c.code)}>{text(c.code)} - {text(c.name)}</option>)}</select><small>A lista é a mesma mantida no módulo Fiscal.</small></label>
        <div className="product-tax-help span2"><b>Dados essenciais</b><span>NCM, origem e CFOP são a base da classificação fiscal. CEST é necessário apenas nas hipóteses aplicáveis.</span></div>
      </div>
    </div>}

    {active==='reform'&&<div className="product-tax-panel">
      <div className="product-tax-notice">Em 2026, NF-e e NFC-e passaram a contemplar os campos da Reforma Tributária do Consumo. Preencha CST IBS/CBS e cClassTrib conforme o enquadramento efetivo da operação.</div>
      <div className="product-form-grid cols3">
        <label><span>Situação Tributária (CST) do IBS e CBS</span><input list="rtc-cst-options" value={value.reform_cst} onChange={e=>onChange('reform_cst',e.target.value.replace(/\D/g,'').slice(0,3))} placeholder="Selecione ou informe"/><datalist id="rtc-cst-options">{reformSuggestions.map(([code,label])=><option value={code} key={code}>{label}</option>)}</datalist><small>Ex.: 000, 200, 410, 510, 515. Consulte a tabela vigente.</small></label>
        <label className="span2"><span>Classificação Tributária (cClassTrib)</span><input value={value.reform_classification} onChange={e=>onChange('reform_classification',e.target.value.replace(/[^0-9A-Za-z.\-]/g,'').slice(0,20))} placeholder="Informe o código oficial cClassTrib"/><small>A classificação deve ser compatível com o CST IBS/CBS escolhido.</small></label>
      </div>
    </div>}

    {active==='icms'&&<div className="product-tax-panel">
      <div className="product-tax-rule-head"><strong>Regra de ICMS do produto</strong><small>Defina o cenário padrão. A combinação UF + tipo de cliente ajuda a documentar o enquadramento utilizado.</small></div>
      <div className="product-form-grid cols4">
        <label><span>Origem UF</span><select value={value.fiscal_origin_uf} onChange={e=>onChange('fiscal_origin_uf',e.target.value)}><option value="">Selecione</option>{ufs.map(uf=><option key={uf}>{uf}</option>)}</select></label>
        <label><span>Destino UF</span><select value={value.fiscal_destination_uf} onChange={e=>onChange('fiscal_destination_uf',e.target.value)}><option value="">Selecione</option>{ufs.map(uf=><option key={uf}>{uf}</option>)}</select></label>
        <label><span>Tipo de cliente</span><select value={value.fiscal_customer_type} onChange={e=>onChange('fiscal_customer_type',e.target.value)}>{customerTypes.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
        <label><span>Situação tributária (CST)</span><SelectCode value={value.cst_icms} onChange={v=>onChange('cst_icms',v)} options={icmsCst}/></label>
        <label><span>CSOSN</span><SelectCode value={value.csosn} onChange={v=>onChange('csosn',v)} options={csosn}/><small>Use quando o regime tributário exigir CSOSN.</small></label>
        <label><span>Alíquota ICMS %</span><input type="number" min="0" step="0.0001" value={value.icms_rate} onChange={e=>onChange('icms_rate',e.target.value)}/></label>
        <label><span>Benefício fiscal</span><input value={value.icms_tax_benefit} onChange={e=>onChange('icms_tax_benefit',e.target.value)} placeholder="Código, quando aplicável"/></label>
        <label><span>Motivo desoneração do ICMS</span><select value={value.icms_exemption_reason} onChange={e=>onChange('icms_exemption_reason',e.target.value)}>{exemptionReasons.map(([code,label])=><option key={code||'empty'} value={code}>{code?`${code} - ${label}`:label}</option>)}</select></label>
        <label><span>Desconto de ICMS</span><span className="product-tax-toggle"><input type="checkbox" checked={value.icms_discount} onChange={e=>onChange('icms_discount',e.target.checked)}/>{value.icms_discount?'Ativo':'Inativo'}</span></label>
        <label><span>Benefício fiscal crédito presumido</span><input value={value.icms_credit_benefit} onChange={e=>onChange('icms_credit_benefit',e.target.value)}/></label>
        <label><span>Percentual crédito presumido %</span><input type="number" min="0" step="0.0001" value={value.icms_presumed_credit_rate} onChange={e=>onChange('icms_presumed_credit_rate',e.target.value)}/></label>
      </div>
    </div>}

    {active==='ipi'&&<div className="product-tax-panel">
      <div className="product-form-grid cols3">
        <label><span>Situação tributária IPI</span><SelectCode value={value.cst_ipi} onChange={v=>onChange('cst_ipi',v)} options={ipiCst}/></label>
        <label><span>Enquadramento legal do IPI</span><input value={value.ipi_legal_framework} onChange={e=>onChange('ipi_legal_framework',e.target.value.replace(/\D/g,'').slice(0,3))} placeholder="Ex.: 999"/><small>Informe o código de enquadramento aplicável.</small></label>
        <label><span>Alíquota IPI %</span><input type="number" min="0" step="0.0001" value={value.ipi_rate} onChange={e=>onChange('ipi_rate',e.target.value)}/></label>
      </div>
    </div>}

    {active==='pis'&&<div className="product-tax-panel">
      <div className="product-tax-rule-head"><strong>PIS / COFINS de saída</strong><small>Os CSTs são obrigatórios para o ThorFiscal montar o grupo correspondente no XML da NFC-e.</small></div>
      <div className="product-form-grid cols4">
        <label className="span2 product-fiscal-required"><span>CST PIS *</span><SelectCode value={value.cst_pis} onChange={v=>onChange('cst_pis',v)} options={pisCofins}/></label>
        <label><span>Alíquota PIS %</span><input type="number" min="0" step="0.0001" value={value.pis_rate} onChange={e=>onChange('pis_rate',e.target.value)}/></label>
        <div className="product-tax-help"><b>PIS</b><span>Escolha o CST pela descrição; não use um código apenas para ultrapassar a validação fiscal.</span></div>
        <label className="span2 product-fiscal-required"><span>CST COFINS *</span><SelectCode value={value.cst_cofins} onChange={v=>onChange('cst_cofins',v)} options={pisCofins}/></label>
        <label><span>Alíquota COFINS %</span><input type="number" min="0" step="0.0001" value={value.cofins_rate} onChange={e=>onChange('cofins_rate',e.target.value)}/></label>
        <div className="product-tax-help"><b>COFINS</b><span>A alíquota deve acompanhar o tratamento tributário real do produto.</span></div>
      </div>
    </div>}

    {active==='petroleum'&&<div className="product-tax-panel">
      <div className="product-form-grid cols3">
        <label><span>Código ANP</span><input value={value.petroleum_anp_code} onChange={e=>onChange('petroleum_anp_code',e.target.value.replace(/\D/g,'').slice(0,20))} placeholder="Somente combustíveis/derivados"/></label>
        <label><span>Alíquota CIDE %</span><input type="number" min="0" step="0.0001" value={value.petroleum_cide_rate} onChange={e=>onChange('petroleum_cide_rate',e.target.value)}/></label>
        <label><span>Percentual de mistura %</span><input type="number" min="0" max="100" step="0.0001" value={value.petroleum_mix_percent} onChange={e=>onChange('petroleum_mix_percent',e.target.value)}/></label>
        <div className="product-tax-help span3"><b>Aplicação específica</b><span>Deixe estes campos vazios para produtos que não sejam combustíveis, lubrificantes ou derivados sujeitos a informações específicas.</span></div>
      </div>
    </div>}
  </section>;
}
