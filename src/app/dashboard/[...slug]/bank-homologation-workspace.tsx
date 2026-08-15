'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  bankHomologationData,
  bankLayoutProfile,
  bindHomologationRemittance,
  confirmBankLayout,
  createHomologationTestTitle,
  generateCnabRemittance,
  homologationTestFile,
  importCnabReturn,
  markHomologationRemittanceSent,
  resetBankLayoutProfile,
  restartBankHomologation,
  saveBankLayoutProfile,
  saveCnabConfig,
  searchHomologationCustomers,
  type BankFileDirection,
  type CnabLayout,
} from './bank-cnab-actions';

type Row=Record<string,unknown>;
type LayoutField={key:string;label?:string;start:number;end:number;type?:string;source?:string;default?:string;format?:string};
type LayoutRecord={record:string;label?:string;type?:string;segment?:string;fields:LayoutField[]};

const text=(v:unknown)=>v==null?'':String(v);
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const dateTime=(v:unknown)=>{if(!v)return '—';const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const asLayout=(v:unknown):CnabLayout=>text(v)==='cnab400'?'cnab400':'cnab240';
const layoutLabel=(v:unknown)=>text(v)==='cnab400'?'CNAB 400':'CNAB 240';
const statusLabel:Record<string,string>={draft:'Não iniciada',configured:'Configuração',test_selected:'Boleto teste criado',test_generated:'Remessa teste gerada',awaiting_return:'Aguardando retorno',approved:'Homologada',failed:'Falha na homologação',revoked:'Homologação revogada'};
const steps=[['1','Conta bancária'],['2','Layout'],['3','Estrutura'],['4','Boleto teste'],['5','Remessa teste'],['6','Retorno'],['7','Homologada']];
const errors:Record<string,string>={
 invalid_session:'Sua sessão expirou.',layout_profile_not_found:'Modelo estrutural da conta não encontrado.',official_model_not_found:'Não há modelo oficial vinculado a este layout.',
 model_must_be_array:'O modelo estrutural está inválido.',record_key_required:'Há um registro sem identificador.',record_fields_must_be_array:'A lista de campos do registro está inválida.',field_key_required:'Há um campo sem identificador.',field_position_invalid:'Há posição inicial/final inválida.',field_position_out_of_range:'Há campo fora do tamanho permitido do registro.',
 customer_search_too_short:'Digite pelo menos 2 caracteres do nome, CPF ou CNPJ.',homologation_customer_not_found:'Cliente não encontrado.',homologation_customer_data_incomplete:'O cliente foi localizado, mas faltam CPF/CNPJ ou endereço completo para o CNAB.',invalid_homologation_test_amount:'Informe um valor válido para o boleto teste.',homologation_already_approved:'Esta conta já está homologada.',test_remittance_already_generated:'A remessa teste já foi gerada. Reinicie a homologação para criar outro boleto.',
 test_remittance_not_found:'A remessa teste não foi localizada.',test_title_not_in_remittance:'O título teste não foi localizado dentro da remessa gerada.',homologation_remittance_must_have_one_title:'A remessa de homologação deve conter exatamente um título.',test_remittance_not_generated:'Gere a remessa teste primeiro.',return_not_itau_cnab240:'O arquivo não foi reconhecido como retorno Itaú CNAB 240.',return_not_itau_cnab400:'O arquivo não foi reconhecido como retorno Itaú CNAB 400.',return_file_empty:'O retorno está vazio.',bank_account_not_homologated:'A conta ainda não está homologada para remessas normais.',
 payer_document_invalid:'CPF/CNPJ do pagador inválido.',payer_data_incomplete:'Cadastro do pagador incompleto.',cnab_account_config_invalid:'Agência, conta ou DAC da cobrança estão inválidos.',cnab_config_not_supported:'O layout selecionado ainda não possui adaptador de geração.',
};
const friendly=(r:Row)=>errors[text(r.error)]||text(r.detail||r.error||'Não foi possível concluir a operação.');

function cloneModel(value:unknown):LayoutRecord[]{if(!Array.isArray(value))return [];return JSON.parse(JSON.stringify(value)) as LayoutRecord[]}

export function BankHomologationWorkspace({initial}:{initial:Row}){
  const [data,setData]=useState<Row>(initial);
  const homs=Array.isArray(data.homologations)?data.homologations as Row[]:[];
  const configs=Array.isArray(data.configs)?data.configs as Row[]:[];
  const accounts=Array.isArray(data.accounts)?data.accounts as Row[]:[];
  const receivables=Array.isArray(data.receivables)?data.receivables as Row[]:[];
  const models=Array.isArray(data.layout_models)?data.layout_models as Row[]:[];
  const initialConfig=text(homs[0]?.config_id||configs[0]?.id);
  const [selectedConfig,setSelectedConfig]=useState(initialConfig);
  const [viewStep,setViewStep]=useState(Number(homs.find(h=>text(h.config_id)===initialConfig)?.current_step||1));
  const [profile,setProfile]=useState<Row|null>(null);
  const [direction,setDirection]=useState<BankFileDirection>('remittance');
  const [draft,setDraft]=useState<LayoutRecord[]>([]);
  const [configOpen,setConfigOpen]=useState(false);
  const [newLayout,setNewLayout]=useState<CnabLayout>('cnab240');
  const [customerQuery,setCustomerQuery]=useState('');
  const [customerResults,setCustomerResults]=useState<Row[]>([]);
  const [selectedCustomer,setSelectedCustomer]=useState('');
  const [testAmount,setTestAmount]=useState('10.00');
  const [searched,setSearched]=useState(false);
  const [returnFile,setReturnFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const hom=useMemo(()=>homs.find(h=>text(h.config_id)===selectedConfig),[homs,selectedConfig]);
  const config=useMemo(()=>configs.find(c=>text(c.id)===selectedConfig),[configs,selectedConfig]);
  const currentStep=Number(hom?.current_step||1);
  const approved=text(hom?.status)==='approved';
  const activeLayout=asLayout(config?.layout||hom?.layout);
  const chosenTest=useMemo(()=>receivables.find(r=>text(r.id)===text(hom?.test_financial_entry_id)),[receivables,hom]);

  async function refresh(preferConfig?:string){
    const r=await bankHomologationData();if(!r.ok){setMessage(friendly(r));return}setData(r);
    const nextH=Array.isArray(r.homologations)?r.homologations as Row[]:[];const nextC=preferConfig||selectedConfig||text(nextH[0]?.config_id);if(nextC)setSelectedConfig(nextC);
    const nextHom=nextH.find(h=>text(h.config_id)===nextC);if(nextHom)setViewStep(Number(nextHom.current_step||1));
  }
  async function loadProfile(configId:string){if(!configId){setProfile(null);setDraft([]);return}const r=await bankLayoutProfile(configId);if(!r.ok){setMessage(friendly(r));return}const p=(r.profile as Row)||{};setProfile(p);setDraft(cloneModel(direction==='remittance'?p.remittance_model:p.return_model))}
  useEffect(()=>{if(selectedConfig)void loadProfile(selectedConfig)},[selectedConfig]);
  useEffect(()=>{if(profile)setDraft(cloneModel(direction==='remittance'?profile.remittance_model:profile.return_model))},[direction]);

  function download(name:string,content:string){const blob=new Blob([content],{type:'text/plain;charset=us-ascii'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500)}

  async function createConfig(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setMessage('');const fd=new FormData(e.currentTarget);
    const r=await saveCnabConfig(asLayout(fd.get('layout')),text(fd.get('bank_account_id')),{agency:text(fd.get('agency')),account_number:text(fd.get('account_number')),account_digit:text(fd.get('account_digit')),wallet:'109',species:text(fd.get('species'))||'01',acceptance:text(fd.get('acceptance'))||'N',initial_our_number:text(fd.get('initial_our_number'))||'0',active:true});
    setBusy(false);if(!r.ok){setMessage(friendly(r));return}setConfigOpen(false);setMessage('Conta preparada para homologação. Revise agora o modelo estrutural do arquivo.');await refresh(text(r.config_id));setViewStep(2);
  }

  function changeField(ri:number,fi:number,key:keyof LayoutField,value:string){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:r.fields.map((f,j)=>j!==fi?f:{...f,[key]:key==='start'||key==='end'?Number(value||0):value})}))}
  function addField(ri:number){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:[...r.fields,{key:`campo_${r.fields.length+1}`,label:'Novo campo',start:1,end:1}]}))}
  function removeField(ri:number,fi:number){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:r.fields.filter((_,j)=>j!==fi)}))}
  async function saveStructure(){if(!selectedConfig)return;setBusy(true);const r=await saveBankLayoutProfile(selectedConfig,direction,draft);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setMessage(`${direction==='remittance'?'Remessa':'Retorno'}: estrutura personalizada salva.`);await loadProfile(selectedConfig);await refresh(selectedConfig)}
  async function resetStructure(){if(!selectedConfig)return;if(!window.confirm('Restaurar o modelo estrutural oficial deste banco/layout?'))return;setBusy(true);const r=await resetBankLayoutProfile(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setMessage('Modelo oficial restaurado. A homologação deverá ser refeita.');await loadProfile(selectedConfig);await refresh(selectedConfig);setViewStep(3)}
  async function confirmStructure(){if(!selectedConfig)return;setBusy(true);const r=await confirmBankLayout(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setMessage('Estrutura confirmada. Gere agora o boleto de teste dentro da homologação.');await refresh(selectedConfig);setViewStep(4)}

  async function findCustomers(e?:FormEvent){e?.preventDefault();setSelectedCustomer('');setSearched(true);setBusy(true);const r=await searchHomologationCustomers(customerQuery);setBusy(false);if(!r.ok){setCustomerResults([]);setMessage(friendly(r));return}const list=Array.isArray(r.customers)?r.customers as Row[]:[];setCustomerResults(list);if(list.length===1&&list[0].ready_for_cnab)setSelectedCustomer(text(list[0].id));if(list.length===0)setMessage('Nenhum cliente encontrado com esse nome, CPF ou CNPJ.')}

  async function createAndGenerateTest(){
    if(!selectedConfig||!selectedCustomer){setMessage('Localize e selecione o cliente do boleto teste.');return}
    const amount=Number(testAmount.replace(',','.'));if(!Number.isFinite(amount)||amount<=0){setMessage('Informe um valor válido para o boleto teste.');return}
    setBusy(true);setMessage('Criando boleto teste...');
    const created=await createHomologationTestTitle(selectedConfig,selectedCustomer,amount);
    if(!created.ok){setBusy(false);setMessage(friendly(created));return}
    const entryId=text(created.financial_entry_id);
    const rem=await generateCnabRemittance(activeLayout,selectedConfig,[entryId]);
    if(!rem.ok){setBusy(false);setMessage(friendly(rem));await refresh(selectedConfig);return}
    const bound=await bindHomologationRemittance(selectedConfig,text(rem.remittance_id));setBusy(false);
    if(!bound.ok){setMessage(friendly(bound));return}
    download(text(rem.file_name)||'HOMOLOGACAO.REM',text(rem.content));
    setMessage(`Boleto teste gerado para ${text(created.customer)} no valor de ${money(created.amount)}. Nosso Número ${text(bound.our_number)}. A remessa teste também foi baixada.`);
    await refresh(selectedConfig);setViewStep(5);
  }

  async function redownloadTest(){if(!selectedConfig)return;setBusy(true);const r=await homologationTestFile(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return}download(text(r.file_name)||'HOMOLOGACAO.REM',text(r.content))}
  async function markSent(){if(!selectedConfig)return;setBusy(true);const r=await markHomologationRemittanceSent(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setMessage('Remessa teste marcada como enviada. Agora aguarde e importe o retorno do banco.');await refresh(selectedConfig);setViewStep(6)}
  async function processReturn(){if(!selectedConfig||!returnFile)return;let content='';try{content=await returnFile.text()}catch{setMessage('Não foi possível ler o arquivo.');return}setBusy(true);const r=await importCnabReturn(activeLayout,selectedConfig,returnFile.name,content);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setReturnFile(null);const el=document.getElementById('homolog-return-file') as HTMLInputElement|null;if(el)el.value='';await refresh(selectedConfig);const fresh=await bankHomologationData();const hh=(Array.isArray(fresh.homologations)?fresh.homologations as Row[]:[]).find(x=>text(x.config_id)===selectedConfig);if(text(hh?.status)==='approved'){setMessage('Retorno localizado e confirmou o mesmo boleto teste. Conta bancária HOMOLOGADA para remessas.');setViewStep(7)}else if(text(hh?.status)==='failed'){setMessage('O retorno encontrou o título, mas informou rejeição/erro. Corrija os dados e refaça o teste.');setViewStep(6)}else{setMessage('Retorno importado, mas o boleto teste ainda não foi confirmado. Consulte as ocorrências do arquivo.');setViewStep(6)}}
  async function restart(){if(!selectedConfig)return;if(!window.confirm('Reiniciar a homologação desta conta?'))return;setBusy(true);const r=await restartBankHomologation(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return}setCustomerResults([]);setSelectedCustomer('');setCustomerQuery('');setMessage('Homologação reiniciada.');await refresh(selectedConfig);setViewStep(3)}

  const maxView=approved?7:Math.max(currentStep,3);

  return <div className="hom-studio">
    <section className="hom-hero"><div><span>HOMOLOGAÇÃO BANCÁRIA</span><h1>Arquivos de Remessa e Retorno</h1><p>Uma conta só é liberada depois que o retorno do banco reconhecer o boleto teste enviado pelo Thor.</p></div><div className={`hom-status ${approved?'approved':text(hom?.status)==='failed'?'failed':'pending'}`}><small>STATUS DA CONTA</small><b>{hom?statusLabel[text(hom.status)]||text(hom.status):'Não configurada'}</b><span>{config?`${layoutLabel(config.layout)} · Banco ${text(config.bank_code)}`:'Escolha uma conta para começar'}</span></div></section>
    <section className="hom-steps">{steps.map(([n,label])=>{const step=Number(n);const done=approved||step<currentStep;const active=step===viewStep;const enabled=step<=maxView;return <button type="button" key={n} disabled={!enabled} className={`${done?'done':''} ${active?'active':''}`} onClick={()=>enabled&&setViewStep(step)}><i>{done?'✓':n}</i><span>{label}</span></button>})}</section>
    {message?<div className="hom-message" onClick={()=>setMessage('')}><span>{message}</span><b>×</b></div>:null}
    <section className="hom-toolbar"><label>Conta / layout<select value={selectedConfig} onChange={e=>{setSelectedConfig(e.target.value);setViewStep(Number(homs.find(h=>text(h.config_id)===e.target.value)?.current_step||2))}}><option value="">Selecione...</option>{homs.map(h=><option key={text(h.config_id)} value={text(h.config_id)}>{text(h.account_name)} · {layoutLabel(h.layout)} · {statusLabel[text(h.status)]||text(h.status)}</option>)}</select></label><button type="button" onClick={()=>void refresh()} disabled={busy}>↻ Atualizar</button><button className="primary" type="button" onClick={()=>setConfigOpen(true)}>＋ Nova homologação</button></section>
    {!selectedConfig?<section className="hom-empty"><b>Nenhuma conta preparada para homologação</b><span>Cadastre o layout e os dados de cobrança. O Thor bloqueará remessas produtivas até o retorno teste ser validado.</span><button className="primary" type="button" onClick={()=>setConfigOpen(true)}>Iniciar homologação</button></section>:null}

    {selectedConfig?<section className="hom-layout"><aside className="hom-account-card"><span>CONTA EM HOMOLOGAÇÃO</span><h3>{text(hom?.account_name)}</h3><dl><div><dt>Banco</dt><dd>{text(hom?.bank_name)||`Código ${text(config?.bank_code)}`}</dd></div><div><dt>Layout</dt><dd>{layoutLabel(config?.layout)}</dd></div><div><dt>Agência</dt><dd>{text(config?.agency)}</dd></div><div><dt>Conta</dt><dd>{text(config?.account_number)}-{text(config?.account_digit)}</dd></div><div><dt>Carteira</dt><dd>{text(config?.wallet)}</dd></div><div><dt>Registro</dt><dd>{text(hom?.record_length)} posições</dd></div></dl><div className={`hom-account-state ${approved?'ok':''}`}><b>{approved?'Conta liberada':'Remessas bloqueadas'}</b><span>{approved?'Homologação concluída. Remessas normais permitidas.':'Somente o boleto teste deste processo pode entrar na remessa antes da homologação.'}</span></div>{text(hom?.status)==='failed'||text(hom?.status)==='revoked'?<button type="button" onClick={()=>void restart()} disabled={busy}>Reiniciar homologação</button>:null}</aside>

    <main className="hom-stage">
      {viewStep===1?<div className="hom-stage-card"><header><span>ETAPA 1</span><h2>Dados da conta bancária</h2><p>Estes dados identificam o convênio no arquivo.</p></header><div className="hom-summary-grid"><div><small>Banco</small><b>{text(hom?.bank_name)||'Itaú'}</b></div><div><small>Código</small><b>{text(config?.bank_code)}</b></div><div><small>Agência</small><b>{text(config?.agency)}</b></div><div><small>Conta</small><b>{text(config?.account_number)}-{text(config?.account_digit)}</b></div></div><div className="hom-actions"><button className="primary" type="button" onClick={()=>setViewStep(2)}>Continuar</button></div></div>:null}

      {viewStep===2?<div className="hom-stage-card"><header><span>ETAPA 2</span><h2>Layout do arquivo</h2><p>O Thor usa um modelo por banco/layout. O Itaú já possui CNAB 240 e CNAB 400.</p></header><div className="hom-layout-summary"><div><b>{layoutLabel(config?.layout)}</b><span>{activeLayout==='cnab240'?'FEBRABAN 240 · Header/Lote · P/Q · T/U':'Itaú 400 posições · Header/Detalhe/Trailer'}</span></div><div><small>Tamanho do registro</small><strong>{text(hom?.record_length)} bytes</strong></div><div><small>Versão do modelo</small><strong>{text(hom?.version)||'—'}</strong></div><div><small>Personalizado</small><strong>{hom?.customized?'Sim':'Não'}</strong></div></div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(1)}>Voltar</button><button className="primary" type="button" onClick={()=>setViewStep(3)}>Revisar estrutura</button></div></div>:null}

      {viewStep===3?<div className="hom-stage-card structure"><header><span>ETAPA 3</span><h2>Modelo estrutural do arquivo</h2><p>Revise Header, detalhes/segmentos e Trailer. Edite somente quando o manual ou contrato bancário exigir.</p></header><div className="hom-direction"><button className={direction==='remittance'?'active':''} type="button" onClick={()=>setDirection('remittance')}>Arquivo Remessa</button><button className={direction==='return'?'active':''} type="button" onClick={()=>setDirection('return')}>Arquivo Retorno</button><span>{draft.length} estrutura(s)</span></div><div className="hom-records">{draft.map((record,ri)=><article key={`${record.record}-${ri}`}><header><div><small>{record.type?`REGISTRO ${record.type}`:'REGISTRO'}{record.segment?` · SEGMENTO ${record.segment}`:''}</small><b>{record.label||record.record}</b></div><button type="button" onClick={()=>addField(ri)}>＋ Campo</button></header><div className="hom-field-head"><span>Campo</span><span>Início</span><span>Fim</span><span>Padrão</span><span>Origem</span><span></span></div>{record.fields.map((field,fi)=><div className="hom-field" key={`${field.key}-${fi}`}><label><input value={field.label||field.key} onChange={e=>changeField(ri,fi,'label',e.target.value)}/><small>{field.key}</small></label><input type="number" min="1" max={Number(profile?.record_length||400)} value={field.start} onChange={e=>changeField(ri,fi,'start',e.target.value)}/><input type="number" min="1" max={Number(profile?.record_length||400)} value={field.end} onChange={e=>changeField(ri,fi,'end',e.target.value)}/><input value={field.default||''} placeholder="—" onChange={e=>changeField(ri,fi,'default',e.target.value)}/><input value={field.source||''} placeholder="origem dinâmica" onChange={e=>changeField(ri,fi,'source',e.target.value)}/><button type="button" title="Remover campo" onClick={()=>removeField(ri,fi)}>×</button></div>)}</article>)}</div><div className="hom-structure-note"><b>Modelo por banco</b><span>As personalizações ficam isoladas nesta conta e não alteram os outros convênios.</span></div><div className="hom-actions spread"><div><button type="button" onClick={()=>void resetStructure()} disabled={busy}>Restaurar modelo oficial</button><button type="button" onClick={()=>void saveStructure()} disabled={busy}>Salvar alterações</button></div><button className="primary" type="button" onClick={()=>void confirmStructure()} disabled={busy}>Confirmar estrutura e avançar</button></div></div>:null}

      {viewStep===4?<div className="hom-stage-card"><header><span>ETAPA 4</span><h2>Gerar boleto de teste</h2><p>Pesquise o pagador por nome, CPF ou CNPJ e informe somente o valor. O vencimento do teste será definido automaticamente para 7 dias.</p></header><div className="hom-test-builder"><form onSubmit={findCustomers}><label className="search"><span>Nome, CPF ou CNPJ</span><div><input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="Ex.: Armazém Cocais ou 02.486.297/0001-95"/><button type="submit" disabled={busy||customerQuery.trim().length<2}>Buscar</button></div><small>O Thor utiliza o endereço já cadastrado do cliente para preencher o arquivo CNAB.</small></label><label className="amount"><span>Valor do boleto teste</span><input type="number" min="0.01" step="0.01" value={testAmount} onChange={e=>setTestAmount(e.target.value)}/><small>Vencimento automático: 7 dias após a geração.</small></label></form><div className="hom-customer-results">{customerResults.map(c=><button type="button" key={text(c.id)} disabled={!c.ready_for_cnab} className={selectedCustomer===text(c.id)?'selected':''} onClick={()=>setSelectedCustomer(text(c.id))}><span><b>{text(c.name)}</b><small>{text(c.document)||'Sem CPF/CNPJ'}</small></span><span><small>{[text(c.street),text(c.number),text(c.city),text(c.state)].filter(Boolean).join(' · ')}</small><strong>{c.ready_for_cnab?(selectedCustomer===text(c.id)?'Selecionado':'Selecionar'):'Cadastro incompleto para CNAB'}</strong></span></button>)}{searched&&customerResults.length===0?<div className="hom-inline-empty">Nenhum cliente localizado.</div>:null}</div><div className="hom-test-help"><b>Teste isolado</b><span>O Thor cria um título marcado como homologação, gera o Nosso Número, o boleto e uma remessa contendo somente esse teste.</span></div></div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(3)}>Voltar</button><button className="primary" type="button" onClick={()=>void createAndGenerateTest()} disabled={busy||!selectedCustomer||Number(testAmount.replace(',','.'))<=0}>{busy?'Gerando...':'Gerar boleto e remessa teste'}</button></div></div>:null}

      {viewStep===5?<div className="hom-stage-card"><header><span>ETAPA 5</span><h2>Boleto e remessa teste</h2><p>O boleto impresso usa exatamente o mesmo Nosso Número, linha digitável e código de barras do item enviado na remessa.</p></header>{chosenTest?<div className="hom-test-title"><div><small>BOLETO TESTE</small><b>{text(chosenTest.customer)}</b><span>{text(chosenTest.document)} · vence {date(chosenTest.due_date)}</span></div><strong>{money(chosenTest.remaining)}</strong></div>:null}{hom?.test_remittance_id?<div className="hom-file-ready"><span>ARQUIVO E BOLETO GERADOS</span><b>{text((data.remittances as Row[]|undefined)?.find(r=>text(r.id)===text(hom.test_remittance_id))?.file_name)||'Remessa de homologação'}</b><small>Gerado em {dateTime(hom.remittance_generated_at)}</small><div>{hom?.test_remittance_item_id?<a className="primary-link" target="_blank" rel="noreferrer" href={`/dashboard/financeiro/boleto/${text(hom.test_remittance_item_id)}`}>Visualizar / imprimir boleto</a>:null}<button type="button" onClick={()=>void redownloadTest()} disabled={busy}>↓ Baixar remessa novamente</button>{text(hom.status)==='test_generated'?<button className="primary" type="button" onClick={()=>void markSent()} disabled={busy}>Marcar como enviada ao banco</button>:<span className="hom-wait">Enviada · aguardando retorno</span>}</div></div>:<div className="hom-generate-box"><b>Aguardando geração</b><span>Volte à etapa anterior e gere o boleto teste.</span></div>}<div className="hom-actions"><button type="button" onClick={()=>setViewStep(4)}>Voltar</button>{text(hom?.status)==='awaiting_return'?<button className="primary" type="button" onClick={()=>setViewStep(6)}>Importar retorno</button>:null}</div></div>:null}

      {viewStep===6?<div className="hom-stage-card"><header><span>ETAPA 6</span><h2>Validar o arquivo retorno</h2><p>Importe o retorno baixado do banco. O Thor procurará o Nosso Número/identificador da remessa teste e só homologará a conta quando houver confirmação válida.</p></header><div className="hom-return-box"><input id="homolog-return-file" type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>setReturnFile(e.target.files?.[0]||null)}/><div><b>{returnFile?returnFile.name:'Selecione o arquivo retorno'}</b><span>{returnFile?`${Math.ceil(returnFile.size/1024)} KB`:`Retorno ${layoutLabel(activeLayout)} do banco`}</span></div></div>{hom?.last_error?<div className="hom-error"><b>Último teste rejeitado</b><span>{text((hom.last_error as Row)?.message)||text((hom.last_error as Row)?.return_status)||'O banco retornou erro para o boleto teste.'}</span></div>:null}<div className="hom-check-list"><div className={hom?.test_remittance_id?'ok':''}><i>{hom?.test_remittance_id?'✓':'1'}</i><span><b>Remessa teste gerada</b><small>Arquivo vinculado à homologação</small></span></div><div className={hom?.remittance_sent_at?'ok':''}><i>{hom?.remittance_sent_at?'✓':'2'}</i><span><b>Remessa enviada</b><small>{hom?.remittance_sent_at?dateTime(hom.remittance_sent_at):'Aguardando envio ao banco'}</small></span></div><div className={approved?'ok':''}><i>{approved?'✓':'3'}</i><span><b>Retorno localiza o boleto</b><small>{approved?'Identificação confirmada':'Aguardando importação/confirmação'}</small></span></div></div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(5)}>Voltar</button><button className="primary" type="button" disabled={busy||!returnFile} onClick={()=>void processReturn()}>{busy?'Processando...':'Importar retorno e validar'}</button></div></div>:null}

      {viewStep===7?<div className="hom-stage-card success"><div className="hom-success-icon">✓</div><span>HOMOLOGAÇÃO CONCLUÍDA</span><h2>Conta liberada para Remessa / Retorno</h2><p>O banco retornou e o Thor localizou o mesmo boleto utilizado no teste. Esta conta está habilitada para gerar remessas normais.</p><div className="hom-success-grid"><div><small>Banco</small><b>{text(hom?.bank_name)||text(config?.bank_code)}</b></div><div><small>Layout</small><b>{layoutLabel(config?.layout)}</b></div><div><small>Homologada em</small><b>{dateTime(hom?.approved_at)}</b></div><div><small>Status</small><b>Ativa para cobrança</b></div></div><div className="hom-actions center"><a className="primary-link" href="/dashboard/financeiro/remessa-retorno">Ir para Remessa / Retorno</a></div></div>:null}
    </main></section>:null}

    {configOpen?<div className="hom-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfigOpen(false)}}><section className="hom-modal"><header><div><span>NOVA HOMOLOGAÇÃO</span><h2>Configurar conta para cobrança por arquivo</h2><p>O wizard é padrão para todos os bancos. Neste momento os adaptadores ativos são Itaú CNAB 240 e CNAB 400.</p></div><button type="button" onClick={()=>setConfigOpen(false)}>×</button></header><form onSubmit={createConfig}><label className="wide">Conta bancária<select required name="bank_account_id"><option value="">Selecione...</option>{accounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · Banco {text(a.bank_code)||'não informado'}</option>)}</select></label><label>Banco<select disabled defaultValue="341"><option value="341">341 — Itaú Unibanco</option></select></label><label>Layout<select name="layout" value={newLayout} onChange={e=>setNewLayout(asLayout(e.target.value))}>{models.filter(m=>text(m.bank_code)==='341').map(m=><option key={text(m.id)} value={text(m.layout)}>{layoutLabel(m.layout)} · versão {text(m.version)}</option>)}</select></label><label>Agência<input required name="agency" maxLength={4} inputMode="numeric" placeholder="0057"/></label><label>Conta<input required name="account_number" maxLength={5} inputMode="numeric" placeholder="12345"/></label><label>DAC<input required name="account_digit" maxLength={1} inputMode="numeric" placeholder="6"/></label><label>Carteira<input value="109" disabled/></label><label>Espécie<select name="species" defaultValue="01"><option value="01">01 — Duplicata Mercantil</option><option value="08">08 — Duplicata de Serviços</option><option value="17">17 — Conta de Serviços</option><option value="99">99 — Diversos</option></select></label><label>Aceite<select name="acceptance" defaultValue="N"><option value="N">N — Não aceito</option><option value="A">A — Aceito</option></select></label><label className="wide">Último Nosso Número utilizado<input name="initial_our_number" defaultValue="0" inputMode="numeric"/><small>O Thor incrementará a sequência a partir desse valor.</small></label><div className="hom-modal-note wide"><b>Regra de segurança</b><span>Salvar a conta não libera emissão. A liberação só ocorre após a remessa teste e o retorno correspondente.</span></div><div className="actions wide"><button type="button" onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':'Criar e iniciar homologação'}</button></div></form></section></div>:null}
  </div>;
}
