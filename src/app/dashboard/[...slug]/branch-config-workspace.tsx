'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  branchConfigurationGet,branchConfigurationSave,branchDeliveryRateSave,
  branchPaymentIntegrationSave,branchSmartPosTerminalSave,branchTaxGroupSave,
} from './branch-config-actions';

type Row=Record<string,unknown>;
type ConfigResult=Row&{ok?:boolean;error?:string};
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v??0);
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v as Row[]:[];

const tabs=[
  ['general','Geral'],['terminals','Meus Terminais'],['fiscal','Fiscal'],['parameters','Parâmetros'],
  ['tax','Grupo de tributos'],['delivery','Taxa de entrega'],['integrations','Integrações'],['history','Histórico'],
] as const;

const providers={
  stone:{label:'Stone',modes:[['stone_sdk','SDK Android Stone'],['stone_deeplink','DeepLink Stone']],hint:'POS Android. StoneCode identifica o estabelecimento. SDK cobre pagamento/cancelamento e pode operar PIX com credenciais específicas.'},
  pagbank:{label:'PagBank / PagSeguro',modes:[['pagbank_smartpos_sdk','PlugPag SmartPOS SDK']],hint:'Integração nativa Android pelo PlugPag. Exige parceria, terminal DEBUG, homologação e distribuição pelo ecossistema PagBank.'},
  ton:{label:'TON',modes:[['ton_partner','Integração parceira / homologada']],hint:'T3 Smart é Android, mas a integração de terceiros não possui documentação pública equivalente às demais. Manteremos o conector condicionado à homologação comercial do TON.'},
  getnet:{label:'Getnet Get Smart',modes:[['getnet_deeplink','DeepLink de pagamento Get Smart']],hint:'Pagamento via deeplink; hardware via SDK Getnet. Aplicativo precisa funcionar nos modelos homologados e passar certificação Get Store.'},
  cielo:{label:'Cielo LIO',modes:[['cielo_lio_local','LIO Local / SDK Android'],['cielo_lio_remote','LIO Remota / Order Manager']],hint:'Pode rodar app Android dentro da LIO ou integrar o PDV externo por API remota REST.'},
  rede:{label:'Rede / Itaú Laranjinha',modes:[['rede_store','Rede Store / SmartPOS'],['rede_tef','TEF Rede'],['rede_api','APIs Rede']],hint:'Rede oferece Rede Store, TEF e APIs. A Laranjinha Smart recebe apps de gestão; integração final depende do programa/parceria e homologação escolhidos.'},
} as const;

type Provider=keyof typeof providers;

async function fileData(file:File){if(file.size>260_000)throw new Error('Imagem acima de 250 KB. Reduza o arquivo antes de enviar.');return await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('Falha ao ler imagem.'));r.readAsDataURL(file);});}

export function BranchConfigWorkspace({branches}:{branches:Row[]}){
  const [branchId,setBranchId]=useState(text(branches[0]?.id));
  const [active,setActive]=useState<(typeof tabs)[number][0]>('general');
  const [data,setData]=useState<ConfigResult>({});
  const [loading,setLoading]=useState(false);const [message,setMessage]=useState('');
  async function load(){if(!branchId)return;setLoading(true);const r=await branchConfigurationGet(branchId) as ConfigResult;setLoading(false);setData(r);if(!r.ok)setMessage(text(r.error||'Falha ao carregar filial.'));}
  useEffect(()=>{void load();},[branchId]);
  const branch=obj(data.branch),settings=obj(data.settings),branding=obj(settings.branding),params=obj(settings.pdv_parameters);
  const integrations=rows(data.integrations),smart=rows(data.smartpos_terminals),windows=rows(data.windows_terminals),groups=rows(data.tax_groups),rates=rows(data.delivery_rates),history=rows(data.history);
  const integrationMap=useMemo(()=>new Map(integrations.map(i=>[text(i.provider),i])),[integrations]);

  async function saveSection(section:string,payload:Row){const r=await branchConfigurationSave(branchId,section,payload);setMessage(r.ok?'Configuração salva.':`Não foi possível salvar: ${text(r.error)}`);if(r.ok)await load();}
  function formPayload(e:FormEvent<HTMLFormElement>){const fd=new FormData(e.currentTarget);const p:Row={};for(const [k,v] of fd.entries())p[k]=v;return p;}

  return <section className="branch-config-shell erp-module-card">
    <div className="branch-config-top"><div><span>CONFIGURAÇÃO DA FILIAL</span><h2>{text(branch.name)||'Filial'}</h2><p>Dados do estabelecimento, terminais, parâmetros do PDV e integrações. Certificado, CSC, ambiente, séries e transmissão ficam centralizados no módulo Fiscal.</p></div><label>Filial<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label></div>
    <div className="branch-tabs">{tabs.map(([id,label])=><button key={id} className={active===id?'active':''} onClick={()=>setActive(id)}>{label}</button>)}</div>
    {message&&<div className="branch-message">{message}</div>}{loading?<div className="branch-loading">Carregando configuração...</div>:null}

    {active==='general'&&<form className="branch-panel" onSubmit={e=>{e.preventDefault();const p=formPayload(e);void saveSection('general',p);}}>
      <div className="branch-section-head"><div><h3>Dados gerais e fiscais do estabelecimento</h3><p>CNPJ, IE, CRT e endereço identificam a filial emitente e são usados pelo ThorFiscal no XML.</p></div><button className="erp-primary">Gravar</button></div>
      <div className="branch-grid cols3">
        <label>CNPJ<input name="cnpj" defaultValue={text(branch.cnpj)}/></label><label>Nome da filial / Fantasia<input name="name" defaultValue={text(branch.name)}/></label><label>Contato<input name="contact" defaultValue={text(settings.contact)}/></label>
        <label>Responsável<input name="responsible" defaultValue={text(settings.responsible)}/></label><label>E-mail<input type="email" name="email" defaultValue={text(settings.email)}/></label><label>CRT<select name="crt" defaultValue={text(settings.crt)}><option value="">Selecione...</option><option value="1">1 - Simples Nacional</option><option value="2">2 - Simples excesso sublimite</option><option value="3">3 - Regime Normal</option><option value="4">4 - MEI</option></select></label>
        <label>Inscrição estadual<input name="state_registration" defaultValue={text(settings.state_registration)}/></label><label>Inscrição municipal<input name="municipal_registration" defaultValue={text(settings.municipal_registration)}/></label><label>Tipo de negócio<input name="business_type" defaultValue={text(settings.business_type)} placeholder="Ex.: Varejo, Food, Serviços"/></label>
        <label>Detalhes<input name="business_detail" defaultValue={text(settings.business_detail)} placeholder="Ex.: Mercado, Restaurante"/></label><label>Telefone<input name="phone" defaultValue={text(settings.phone)}/></label><label>Celular<input name="mobile" defaultValue={text(settings.mobile)}/></label>
        <label>CEP<input name="postal_code" defaultValue={text(branch.postal_code)}/></label><label className="span2">Endereço<input name="street" defaultValue={text(branch.street)}/></label><label>Número<input name="number" defaultValue={text(branch.number)}/></label>
        <label>Complemento<input name="complement" defaultValue={text(branch.complement)}/></label><label>Bairro<input name="district" defaultValue={text(branch.district)}/></label><label>Estado<input name="state" maxLength={2} defaultValue={text(branch.state)}/></label><label>Cidade<input name="city" defaultValue={text(branch.city)}/></label><label>Código IBGE<input name="ibge_city_code" defaultValue={text(branch.ibge_city_code)}/></label>
        <label className="span3">Observações<textarea name="observations" defaultValue={text(settings.observations)} rows={5}/></label>
      </div>
    </form>}

    {active==='terminals'&&<div className="branch-panel">
      <div className="branch-section-head"><div><h3>Meus terminais</h3><p>Windows ThorPDV e maquinetas SmartPOS vinculadas à filial.</p></div></div>
      <div className="branch-summary"><article><span>ThorPDV Windows</span><strong>{windows.length}</strong></article><article><span>SmartPOS</span><strong>{smart.length}</strong></article><article><span>Online</span><strong>{[...windows,...smart].filter(t=>text(t.status)==='online'||text(t.status)==='active').length}</strong></article></div>
      <h4>ThorPDV Desktop</h4><div className="branch-table"><table><thead><tr><th>Nome</th><th>Máquina</th><th>Versão</th><th>Status</th><th>Último contato</th></tr></thead><tbody>{windows.map(t=><tr key={text(t.id)}><td>{text(t.name)}</td><td>{text(t.hostname)}</td><td>{text(t.app_version)}</td><td>{text(t.status)}</td><td>{text(t.last_seen_at)||'—'}</td></tr>)}</tbody></table></div>
      <h4>SmartPOS</h4><div className="branch-table"><table><thead><tr><th>Adquirente</th><th>Nome</th><th>Modelo</th><th>Série</th><th>Nº lógico</th><th>Status</th></tr></thead><tbody>{smart.map(t=><tr key={text(t.id)}><td>{providers[text(t.provider) as Provider]?.label??text(t.provider)}</td><td>{text(t.name)}</td><td>{text(t.model)||'—'}</td><td>{text(t.serial_number)||'—'}</td><td>{text(t.logical_number)||'—'}</td><td>{text(t.status)}</td></tr>)}</tbody></table></div>
      <form className="branch-inline-form" onSubmit={async e=>{e.preventDefault();const p=formPayload(e);const r=await branchSmartPosTerminalSave(branchId,p);setMessage(r.ok?'Terminal SmartPOS cadastrado.':text(r.error));if(r.ok){e.currentTarget.reset();await load();}}}>
        <select name="provider" required defaultValue="stone">{Object.entries(providers).map(([k,v])=><option value={k} key={k}>{v.label}</option>)}</select><input name="name" required placeholder="Nome do terminal"/><input name="model" placeholder="Modelo"/><input name="serial_number" placeholder="Nº de série"/><input name="logical_number" placeholder="Nº lógico / terminal"/><button className="erp-primary">Adicionar terminal</button>
      </form>
    </div>}

    {active==='fiscal'&&<div className="branch-panel">
      <div className="branch-section-head"><div><h3>Fiscal da filial</h3><p>A configuração fiscal operacional foi centralizada para evitar certificado, CSC ou ambiente divergentes entre telas.</p></div></div>
      <div className="branch-info-strip"><span><b>CNPJ</b>{text(branch.cnpj)||'Não informado'}</span><span><b>Inscrição Estadual</b>{text(settings.state_registration)||'Não informada'}</span><span><b>CRT</b>{text(settings.crt)||'Não definido'}</span><span><b>Endereço fiscal</b>{text(branch.street)&&text(branch.number)&&text(branch.district)&&text(branch.postal_code)&&text(branch.ibge_city_code)?'Completo':'Incompleto'}</span></div>
      <div className="branch-fiscal-central-card">
        <div><strong>Configuração fiscal centralizada</strong><p>Certificado digital A1, ambiente Homologação/Produção, CSC, séries, numeração, vínculo Caixa → Série, CFOP e DANFE são administrados somente no módulo Fiscal.</p></div>
        <Link className="erp-primary" href="/dashboard/fiscal">Abrir módulo Fiscal</Link>
      </div>
      <div className="branch-checks"><div className={text(settings.state_registration)?'ok':'warn'}>Inscrição Estadual do estabelecimento</div><div className={text(settings.crt)?'ok':'warn'}>CRT definido</div><div className={text(branch.street)&&text(branch.number)&&text(branch.district)&&text(branch.postal_code)&&text(branch.ibge_city_code)?'ok':'warn'}>Endereço fiscal completo</div></div>
      <p className="branch-fiscal-central-note">Para alterar certificado, CSC, ambiente, série, numeração ou DANFE, use Fiscal. Esta tela mostra apenas a prontidão cadastral da filial.</p>
    </div>}

    {active==='parameters' &&<div className="branch-panel">
      <div className="branch-section-head"><div><h3>Parâmetros do PDV</h3><p>Identidade visual, impressão, caixa e comportamento operacional.</p></div></div>
      <Branding current={branding} onSave={async p=>saveSection('branding',p)}/>
      <form onSubmit={e=>{e.preventDefault();const p=formPayload(e);void saveSection('parameters',p);}}>
        <div className="branch-grid cols2">
          <label>Cabeçalho das impressões<textarea name="receipt_header" defaultValue={text(settings.receipt_header)} rows={4}/></label><label>Rodapé das impressões<textarea name="receipt_footer" defaultValue={text(settings.receipt_footer)} rows={4}/></label>
        </div>
        <div className="branch-grid cols3">
          <label>Recebimento parcial<select name="partial_receipt" defaultValue={text(params.partial_receipt)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Horário corte/acerto caixa<input type="time" name="cash_cut_time" defaultValue={text(params.cash_cut_time)||'00:00'}/></label><label>Meio integrado à NFC-e<select name="integrated_payment_nfce" defaultValue={text(params.integrated_payment_nfce)||'yes'}><option value="yes">Sim</option><option value="no">Não</option></select></label>
          <label>Acerto de caixa automático<select name="automatic_cash_close" defaultValue={text(params.automatic_cash_close)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Considera acerto de caixa pago<select name="consider_cash_close_paid" defaultValue={text(params.consider_cash_close_paid)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Correção de erros fiscais<select name="fiscal_error_correction" defaultValue={text(params.fiscal_error_correction)||'yes'}><option value="yes">Sim</option><option value="no">Não</option></select></label>
          <label>Exibir acréscimo/desconto separado no fiscal<select name="show_adjustments_separately" defaultValue={text(params.show_adjustments_separately)||'yes'}><option value="yes">Sim</option><option value="no">Não</option></select></label><label>Permite gorjeta<select name="allow_tip" defaultValue={text(params.allow_tip)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Taxa padrão (%)<input type="number" step="0.01" name="default_service_rate" defaultValue={text(params.default_service_rate)||'0'}/></label>
          <label>Junta ficha / venda<select name="merge_tabs" defaultValue={text(params.merge_tabs)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Rateio de conta<select name="split_documents" defaultValue={text(params.split_documents)||'no'}><option value="no">Não</option><option value="yes">Sim</option></select></label><label>Identificação autoatendimento<input name="self_service_id" defaultValue={text(params.self_service_id)}/></label>
        </div><button className="erp-primary">Salvar parâmetros</button>
      </form>
    </div>}

    {active==='tax'&&<div className="branch-panel"><div className="branch-section-head"><h3>Grupos de tributos</h3></div><div className="branch-table"><table><thead><tr><th>Código</th><th>Nome</th><th>Descrição</th><th>Status</th></tr></thead><tbody>{groups.map(g=><tr key={text(g.id)}><td>{text(g.code)||'—'}</td><td>{text(g.name)}</td><td>{text(g.description)||'—'}</td><td>{g.active===false?'Inativo':'Ativo'}</td></tr>)}</tbody></table></div><form className="branch-inline-form" onSubmit={async e=>{e.preventDefault();const p=formPayload(e);const r=await branchTaxGroupSave(branchId,p);setMessage(r.ok?'Grupo tributário salvo.':text(r.error));if(r.ok){e.currentTarget.reset();await load();}}}><input name="code" placeholder="Código"/><input name="name" required placeholder="Nome do grupo"/><input name="description" placeholder="Descrição / regra"/><button className="erp-primary">Adicionar</button></form><p className="branch-help">O grupo organiza regras fiscais por filial. O enquadramento efetivo de ICMS/PIS/COFINS/IBS/CBS continua sendo resolvido pelo cadastro fiscal do produto e pelo motor fiscal.</p></div>}

    {active==='delivery'&&<div className="branch-panel"><div className="branch-section-head"><h3>Taxas de entrega</h3></div><div className="branch-table"><table><thead><tr><th>Regra</th><th>Cidade</th><th>Bairro</th><th>CEP</th><th>Taxa</th><th>Pedido mínimo</th></tr></thead><tbody>{rates.map(r=><tr key={text(r.id)}><td>{text(r.name)}</td><td>{text(r.city)||'—'}</td><td>{text(r.district)||'—'}</td><td>{text(r.postal_code)||'—'}</td><td>R$ {num(r.rate).toFixed(2)}</td><td>R$ {num(r.minimum_order).toFixed(2)}</td></tr>)}</tbody></table></div><form className="branch-inline-form" onSubmit={async e=>{e.preventDefault();const p=formPayload(e);const r=await branchDeliveryRateSave(branchId,p);setMessage(r.ok?'Taxa de entrega salva.':text(r.error));if(r.ok){e.currentTarget.reset();await load();}}}><input name="name" required placeholder="Nome da regra"/><input name="city" placeholder="Cidade"/><input name="district" placeholder="Bairro"/><input name="postal_code" placeholder="CEP"/><input name="rate" type="number" step="0.01" placeholder="Taxa R$"/><input name="minimum_order" type="number" step="0.01" placeholder="Pedido mínimo"/><button className="erp-primary">Adicionar</button></form></div>}

    {active==='integrations'&&<div className="branch-panel"><div className="branch-section-head"><div><h3>Integrações de pagamento SmartPOS</h3><p>Configuração por adquirente. Segredos são gravados em área privada e não voltam para a tela.</p></div></div><div className="provider-grid">{(Object.keys(providers) as Provider[]).map(provider=><ProviderCard key={provider} provider={provider} current={integrationMap.get(provider)} onSave={async payload=>{const r=await branchPaymentIntegrationSave(branchId,payload);setMessage(r.ok?`${providers[provider].label} salvo.`:text(r.error));if(r.ok)await load();}}/>)}</div></div>}

    {active==='history'&&<div className="branch-panel"><div className="branch-section-head"><h3>Histórico de configurações</h3></div><div className="branch-table"><table><thead><tr><th>Data</th><th>Seção</th><th>Ação</th><th>Usuário</th></tr></thead><tbody>{history.map(h=><tr key={text(h.id)}><td>{text(h.created_at)}</td><td>{text(h.section)}</td><td>{text(h.action)}</td><td>{text(h.actor)||'—'}</td></tr>)}</tbody></table></div></div>}
  </section>;
}

function Branding({current,onSave}:{current:Row;onSave:(p:Row)=>Promise<void>}){
 const [value,setValue]=useState<Row>(current);useEffect(()=>setValue(current),[current]);
 async function choose(key:string,file?:File){if(!file)return;try{const d=await fileData(file);setValue(v=>({...v,[key]:d}));}catch(e){window.alert(e instanceof Error?e.message:'Imagem inválida');}}
 return <div className="branding-box"><div className="branding-grid">{[['background_image','Imagem de background para o PDV'],['receipt_header_image','Imagem cabeçalho do cupom'],['store_logo_image','Logo da loja'],['self_service_image','Imagem autoatendimento']].map(([key,label])=><label key={key}><span>{label}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void choose(key,e.target.files?.[0])}/>{text(value[key])?<img src={text(value[key])} alt={label}/>:<small>Nenhuma imagem configurada</small>}</label>)}</div><button type="button" className="erp-primary" onClick={()=>void onSave(value)}>Salvar identidade visual</button></div>;
}

function ProviderCard({provider,current,onSave}:{provider:Provider;current?:Row;onSave:(p:Row)=>Promise<void>}){
 const meta=providers[provider];const publicConfig=obj(current?.public_config);const [secret,setSecret]=useState('');
 return <article className="provider-card"><div className="provider-head"><div><strong>{meta.label}</strong><span className={`provider-status ${text(current?.status)||'not_configured'}`}>{current?.enabled?'Ativa':'Não ativa'}</span></div><p>{meta.hint}</p></div><form onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);void onSave({provider,enabled:fd.get('enabled')==='true',environment:text(fd.get('environment')),integration_mode:text(fd.get('integration_mode')),status:'configured',merchant_code:text(fd.get('merchant_code')),app_id:text(fd.get('app_id')),terminal_group:text(fd.get('terminal_group')),credential_status:secret?'configured':text(current?.credential_status)||'not_configured',public_config:{package_name:text(fd.get('package_name')),return_scheme:text(fd.get('return_scheme')),callback_url:text(fd.get('callback_url'))},secret_config:secret?{partner_credential:secret}:{},notes:text(fd.get('notes'))});}}>
   <label>Ativar<select name="enabled" defaultValue={current?.enabled?'true':'false'}><option value="false">Não</option><option value="true">Sim</option></select></label><label>Ambiente<select name="environment" defaultValue={text(current?.environment)||'homologation'}><option value="homologation">Homologação</option><option value="production">Produção</option></select></label>
   <label>Modo<select name="integration_mode" defaultValue={text(current?.integration_mode)||meta.modes[0][0]}>{meta.modes.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label>{provider==='stone'?'StoneCode':'Código estabelecimento / merchant'}<input name="merchant_code" defaultValue={text(current?.merchant_code)}/></label><label>App ID<input name="app_id" defaultValue={text(current?.app_id)}/></label><label>Grupo / reseller<input name="terminal_group" defaultValue={text(current?.terminal_group)}/></label>
   <label>Package name<input name="package_name" defaultValue={text(publicConfig.package_name)} placeholder="br.com.solve.thorpdv.smart"/></label><label>Return scheme<input name="return_scheme" defaultValue={text(publicConfig.return_scheme)} placeholder="thorpdv"/></label><label>Callback URL<input name="callback_url" defaultValue={text(publicConfig.callback_url)} placeholder="https://..."/></label><label>Credencial secreta / token<input type="password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={current?.secrets_configured?'Credencial já armazenada':'Somente quando fornecida pelo parceiro'}/></label><label className="wide">Observações<input name="notes" defaultValue={text(current?.notes)}/></label><button className="erp-primary">Salvar {meta.label}</button>
  </form></article>;
}
