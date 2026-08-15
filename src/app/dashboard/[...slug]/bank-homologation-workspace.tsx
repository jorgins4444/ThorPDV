'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  bankHomologationData,
  bankLayoutProfile,
  bindHomologationRemittance,
  confirmBankLayout,
  generateCnabRemittance,
  homologationTestFile,
  importCnabReturn,
  markHomologationRemittanceSent,
  resetBankLayoutProfile,
  restartBankHomologation,
  saveBankLayoutProfile,
  saveCnabConfig,
  selectHomologationTest,
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
const statusLabel:Record<string,string>={draft:'Não iniciada',configured:'Configuração',test_selected:'Título teste escolhido',test_generated:'Remessa teste gerada',awaiting_return:'Aguardando retorno',approved:'Homologada',failed:'Falha na homologação',revoked:'Homologação revogada'};
const steps=[['1','Conta bancária'],['2','Layout'],['3','Estrutura'],['4','Título teste'],['5','Remessa teste'],['6','Retorno'],['7','Homologada']];
const errors:Record<string,string>={
 invalid_session:'Sua sessão expirou.',layout_profile_not_found:'Modelo estrutural da conta não encontrado.',official_model_not_found:'Não há modelo oficial vinculado a este layout.',
 model_must_be_array:'O modelo estrutural está inválido.',record_key_required:'Há um registro sem identificador.',record_fields_must_be_array:'A lista de campos do registro está inválida.',field_key_required:'Há um campo sem identificador.',field_position_invalid:'Há posição inicial/final inválida.',field_position_out_of_range:'Há campo fora do tamanho permitido do registro.',
 invalid_test_receivable:'O título escolhido não está disponível para homologação.',test_receivable_must_be_boleto:'O título teste precisa ser do tipo boleto.',test_payer_data_incomplete:'Complete CPF/CNPJ e endereço do cliente do título teste.',test_receivable_already_remitted:'Esse título já participa de uma remessa.',test_receivable_not_selected:'Escolha o título de teste antes de gerar o arquivo.',test_remittance_not_found:'A remessa teste não foi localizada.',test_title_not_in_remittance:'O título teste não foi localizado dentro da remessa gerada.',homologation_remittance_must_have_one_title:'A remessa de homologação deve conter exatamente um título.',test_remittance_not_generated:'Gere a remessa teste primeiro.',return_not_itau_cnab240:'O arquivo não foi reconhecido como retorno Itaú CNAB 240.',return_not_itau_cnab400:'O arquivo não foi reconhecido como retorno Itaú CNAB 400.',return_file_empty:'O retorno está vazio.',bank_account_not_homologated:'A conta ainda não está homologada para remessas normais.',
 payer_document_invalid:'CPF/CNPJ do pagador inválido.',payer_data_incomplete:'Cadastro do pagador incompleto.',cnab_account_config_invalid:'Agência, conta ou DAC da cobrança estão inválidos.',cnab_config_not_supported:'O layout selecionado ainda não possui adaptador de geração.',
};
const friendly=(r:Row)=>errors[text(r.error)]||text(r.detail||r.error||'Não foi possível concluir a operação.');

function cloneModel(value:unknown):LayoutRecord[]{
  if(!Array.isArray(value))return [];
  return JSON.parse(JSON.stringify(value)) as LayoutRecord[];
}

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
  const [testEntry,setTestEntry]=useState('');
  const [returnFile,setReturnFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const hom=useMemo(()=>homs.find(h=>text(h.config_id)===selectedConfig),[homs,selectedConfig]);
  const config=useMemo(()=>configs.find(c=>text(c.id)===selectedConfig),[configs,selectedConfig]);
  const currentStep=Number(hom?.current_step||1);
  const approved=text(hom?.status)==='approved';
  const activeLayout=asLayout(config?.layout||hom?.layout);
  const eligible=useMemo(()=>receivables.filter(r=>!r.validation_error&&!r.remitted),[receivables]);
  const chosenTest=useMemo(()=>receivables.find(r=>text(r.id)===text(hom?.test_financial_entry_id||testEntry)),[receivables,hom,testEntry]);

  async function refresh(preferConfig?:string){
    const r=await bankHomologationData();
    if(!r.ok){setMessage(friendly(r));return;}
    setData(r);
    const nextH=Array.isArray(r.homologations)?r.homologations as Row[]:[];
    const nextC=preferConfig||selectedConfig||text(nextH[0]?.config_id);
    if(nextC)setSelectedConfig(nextC);
    const nextHom=nextH.find(h=>text(h.config_id)===nextC);
    if(nextHom)setViewStep(Number(nextHom.current_step||1));
  }

  async function loadProfile(configId:string){
    if(!configId){setProfile(null);setDraft([]);return;}
    const r=await bankLayoutProfile(configId);
    if(!r.ok){setMessage(friendly(r));return;}
    const p=(r.profile as Row)||{};setProfile(p);
    setDraft(cloneModel(direction==='remittance'?p.remittance_model:p.return_model));
  }

  useEffect(()=>{if(selectedConfig)void loadProfile(selectedConfig)},[selectedConfig]);
  useEffect(()=>{if(profile)setDraft(cloneModel(direction==='remittance'?profile.remittance_model:profile.return_model))},[direction]);

  function download(name:string,content:string){const blob=new Blob([content],{type:'text/plain;charset=us-ascii'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500)}

  async function createConfig(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setMessage('');const fd=new FormData(e.currentTarget);
    const r=await saveCnabConfig(asLayout(fd.get('layout')),text(fd.get('bank_account_id')),{agency:text(fd.get('agency')),account_number:text(fd.get('account_number')),account_digit:text(fd.get('account_digit')),wallet:'109',species:text(fd.get('species'))||'01',acceptance:text(fd.get('acceptance'))||'N',initial_our_number:text(fd.get('initial_our_number'))||'0',active:true});
    setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setConfigOpen(false);setMessage('Conta preparada para homologação. Revise agora o modelo estrutural do arquivo.');await refresh(text(r.config_id));setViewStep(2);
  }

  function changeField(ri:number,fi:number,key:keyof LayoutField,value:string){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:r.fields.map((f,j)=>j!==fi?f:{...f,[key]:key==='start'||key==='end'?Number(value||0):value})}))}
  function addField(ri:number){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:[...r.fields,{key:`campo_${r.fields.length+1}`,label:'Novo campo',start:1,end:1}]}))}
  function removeField(ri:number,fi:number){setDraft(cur=>cur.map((r,i)=>i!==ri?r:{...r,fields:r.fields.filter((_,j)=>j!==fi)}))}

  async function saveStructure(){
    if(!selectedConfig)return;setBusy(true);const r=await saveBankLayoutProfile(selectedConfig,direction,draft);setBusy(false);
    if(!r.ok){setMessage(friendly(r));return;}setMessage(`${direction==='remittance'?'Remessa':'Retorno'}: estrutura personalizada salva.`);await loadProfile(selectedConfig);await refresh(selectedConfig);
  }
  async function resetStructure(){if(!selectedConfig)return;if(!window.confirm('Restaurar o modelo estrutural oficial deste banco/layout?'))return;setBusy(true);const r=await resetBankLayoutProfile(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setMessage('Modelo oficial restaurado. A homologação deverá ser refeita.');await loadProfile(selectedConfig);await refresh(selectedConfig);setViewStep(3)}
  async function confirmStructure(){if(!selectedConfig)return;setBusy(true);const r=await confirmBankLayout(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setMessage('Estrutura confirmada. Escolha agora um boleto para o teste de homologação.');await refresh(selectedConfig);setViewStep(4)}

  async function chooseTest(){if(!selectedConfig||!testEntry){setMessage('Escolha um título para a homologação.');return;}setBusy(true);const r=await selectHomologationTest(selectedConfig,testEntry);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setMessage('Título teste reservado para esta homologação.');await refresh(selectedConfig);setViewStep(5)}

  async function generateTest(){
    const entryId=text(hom?.test_financial_entry_id||testEntry);if(!selectedConfig||!entryId)return;
    setBusy(true);setMessage('');const r=await generateCnabRemittance(activeLayout,selectedConfig,[entryId]);
    if(!r.ok){setBusy(false);setMessage(friendly(r));return;}
    const b=await bindHomologationRemittance(selectedConfig,text(r.remittance_id));setBusy(false);
    if(!b.ok){setMessage(friendly(b));return;}
    download(text(r.file_name)||'HOMOLOGACAO.REM',text(r.content));setMessage(`Remessa teste gerada. Nosso Número ${text(b.our_number)}. Imprima o boleto teste e envie o arquivo no ambiente de teste/homologação do banco.`);await refresh(selectedConfig);setViewStep(5);
  }

  async function redownloadTest(){if(!selectedConfig)return;setBusy(true);const r=await homologationTestFile(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}download(text(r.file_name)||'HOMOLOGACAO.REM',text(r.content))}
  async function markSent(){if(!selectedConfig)return;setBusy(true);const r=await markHomologationRemittanceSent(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setMessage('Remessa teste marcada como enviada. Agora aguarde e importe o retorno do banco.');await refresh(selectedConfig);setViewStep(6)}

  async function processReturn(){
    if(!selectedConfig||!returnFile)return;let content='';try{content=await returnFile.text()}catch{setMessage('Não foi possível ler o arquivo.');return}
    setBusy(true);const r=await importCnabReturn(activeLayout,selectedConfig,returnFile.name,content);setBusy(false);
    if(!r.ok){setMessage(friendly(r));return;}
    setReturnFile(null);const el=document.getElementById('homolog-return-file') as HTMLInputElement|null;if(el)el.value='';
    await refresh(selectedConfig);const fresh=await bankHomologationData();const hh=(Array.isArray(fresh.homologations)?fresh.homologations as Row[]:[]).find(x=>text(x.config_id)===selectedConfig);
    if(text(hh?.status)==='approved'){setMessage('Retorno localizado e confirmou o mesmo título teste. Conta bancária HOMOLOGADA para remessas.');setViewStep(7)}else if(text(hh?.status)==='failed'){setMessage('O retorno encontrou o título, mas informou rejeição/erro. Corrija a estrutura ou os dados e refaça o teste.');setViewStep(6)}else{setMessage('Retorno importado, mas o título teste ainda não foi confirmado. Consulte as ocorrências do arquivo.');setViewStep(6)}
  }

  async function restart(){if(!selectedConfig)return;if(!window.confirm('Reiniciar a homologação desta conta?'))return;setBusy(true);const r=await restartBankHomologation(selectedConfig);setBusy(false);if(!r.ok){setMessage(friendly(r));return;}setTestEntry('');setMessage('Homologação reiniciada.');await refresh(selectedConfig);setViewStep(3)}

  const maxView=approved?7:Math.max(currentStep,3);

  return <div className="hom-studio">
    <section className="hom-hero"><div><span>HOMOLOGAÇÃO BANCÁRIA</span><h1>Arquivos de Remessa e Retorno</h1><p>Uma conta só é liberada para remessas normais depois que o retorno do banco reconhecer o título enviado na remessa teste.</p></div><div className={`hom-status ${approved?'approved':text(hom?.status)==='failed'?'failed':'pending'}`}><small>STATUS DA CONTA</small><b>{hom?statusLabel[text(hom.status)]||text(hom.status):'Não configurada'}</b><span>{config?`${layoutLabel(config.layout)} · Banco ${text(config.bank_code)}`:'Escolha uma conta para começar'}</span></div></section>

    <section className="hom-steps">{steps.map(([n,label])=>{const step=Number(n);const done=approved||step<currentStep;const active=step===viewStep;const enabled=step<=maxView;return <button type="button" key={n} disabled={!enabled} className={`${done?'done':''} ${active?'active':''}`} onClick={()=>enabled&&setViewStep(step)}><i>{done?'✓':n}</i><span>{label}</span></button>})}</section>

    {message?<div className="hom-message" onClick={()=>setMessage('')}><span>{message}</span><b>×</b></div>:null}

    <section className="hom-toolbar"><label>Conta / layout<select value={selectedConfig} onChange={e=>{setSelectedConfig(e.target.value);setViewStep(Number(homs.find(h=>text(h.config_id)===e.target.value)?.current_step||2))}}><option value="">Selecione...</option>{homs.map(h=><option key={text(h.config_id)} value={text(h.config_id)}>{text(h.account_name)} · {layoutLabel(h.layout)} · {statusLabel[text(h.status)]||text(h.status)}</option>)}</select></label><button type="button" onClick={()=>void refresh()} disabled={busy}>↻ Atualizar</button><button className="primary" type="button" onClick={()=>setConfigOpen(true)}>＋ Nova homologação</button></section>

    {!selectedConfig?<section className="hom-empty"><b>Nenhuma conta preparada para homologação</b><span>Cadastre o layout e os dados de cobrança. O Thor criará automaticamente o modelo estrutural e bloqueará remessas produtivas até o retorno teste ser validado.</span><button className="primary" type="button" onClick={()=>setConfigOpen(true)}>Iniciar homologação</button></section>:null}

    {selectedConfig?<section className="hom-layout"><aside className="hom-account-card"><span>CONTA EM HOMOLOGAÇÃO</span><h3>{text(hom?.account_name)}</h3><dl><div><dt>Banco</dt><dd>{text(hom?.bank_name)||`Código ${text(config?.bank_code)}`}</dd></div><div><dt>Layout</dt><dd>{layoutLabel(config?.layout)}</dd></div><div><dt>Agência</dt><dd>{text(config?.agency)}</dd></div><div><dt>Conta</dt><dd>{text(config?.account_number)}-{text(config?.account_digit)}</dd></div><div><dt>Carteira</dt><dd>{text(config?.wallet)}</dd></div><div><dt>Registro</dt><dd>{text(hom?.record_length)} posições</dd></div></dl><div className={`hom-account-state ${approved?'ok':''}`}><b>{approved?'Conta liberada':'Remessas bloqueadas'}</b><span>{approved?'Homologação concluída. Remessas normais permitidas.':'Somente a remessa teste escolhida pelo wizard pode ser gerada.'}</span></div>{text(hom?.status)==='failed'||text(hom?.status)==='revoked'?<button type="button" onClick={()=>void restart()} disabled={busy}>Reiniciar homologação</button>:null}</aside>

    <main className="hom-stage">
      {viewStep===1?<div className="hom-stage-card"><header><span>ETAPA 1</span><h2>Dados da conta bancária</h2><p>Estes dados identificam o convênio no arquivo. Para alterar, crie/edite a configuração bancária antes de continuar.</p></header><div className="hom-summary-grid"><div><small>Banco</small><b>{text(hom?.bank_name)||'Itaú'}</b></div><div><small>Código</small><b>{text(config?.bank_code)}</b></div><div><small>Agência</small><b>{text(config?.agency)}</b></div><div><small>Conta</small><b>{text(config?.account_number)}-{text(config?.account_digit)}</b></div></div><div className="hom-actions"><button className="primary" type="button" onClick={()=>setViewStep(2)}>Continuar</button></div></div>:null}

      {viewStep===2?<div className="hom-stage-card"><header><span>ETAPA 2</span><h2>Layout do arquivo</h2><p>O Thor usa um modelo por banco/layout. O Itaú já possui modelos CNAB 240 e CNAB 400; novos bancos poderão ter seus próprios modelos sem alterar o wizard.</p></header><div className="hom-layout-summary"><div><b>{layoutLabel(config?.layout)}</b><span>{activeLayout==='cnab240'?'FEBRABAN 240 · Header/Lote · P/Q · T/U':'Itaú 400 posições · Header/Detalhe/Trailer'}</span></div><div><small>Tamanho do registro</small><strong>{text(hom?.record_length)} bytes</strong></div><div><small>Versão do modelo</small><strong>{text(hom?.version)||'—'}</strong></div><div><small>Personalizado</small><strong>{hom?.customized?'Sim':'Não'}</strong></div></div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(1)}>Voltar</button><button className="primary" type="button" onClick={()=>setViewStep(3)}>Revisar estrutura</button></div></div>:null}

      {viewStep===3?<div className="hom-stage-card structure"><header><span>ETAPA 3</span><h2>Modelo estrutural do arquivo</h2><p>Edite somente quando o contrato/manual do banco exigir. As posições são validadas contra o tamanho do registro.</p></header><div className="hom-direction"><button className={direction==='remittance'?'active':''} type="button" onClick={()=>setDirection('remittance')}>Arquivo Remessa</button><button className={direction==='return'?'active':''} type="button" onClick={()=>setDirection('return')}>Arquivo Retorno</button><span>{draft.length} estrutura(s)</span></div><div className="hom-records">{draft.map((record,ri)=><article key={`${record.record}-${ri}`}><header><div><small>{record.type?`REGISTRO ${record.type}`:'REGISTRO'}{record.segment?` · SEGMENTO ${record.segment}`:''}</small><b>{record.label||record.record}</b></div><button type="button" onClick={()=>addField(ri)}>＋ Campo</button></header><div className="hom-field-head"><span>Campo</span><span>Início</span><span>Fim</span><span>Padrão</span><span>Origem</span><span></span></div>{record.fields.map((field,fi)=><div className="hom-field" key={`${field.key}-${fi}`}><label><input value={field.label||field.key} onChange={e=>changeField(ri,fi,'label',e.target.value)}/><small>{field.key}</small></label><input type="number" min="1" max={Number(profile?.record_length||400)} value={field.start} onChange={e=>changeField(ri,fi,'start',e.target.value)}/><input type="number" min="1" max={Number(profile?.record_length||400)} value={field.end} onChange={e=>changeField(ri,fi,'end',e.target.value)}/><input value={field.default||''} placeholder="—" onChange={e=>changeField(ri,fi,'default',e.target.value)}/><input value={field.source||''} placeholder="origem dinâmica" onChange={e=>changeField(ri,fi,'source',e.target.value)}/><button type="button" title="Remover campo" onClick={()=>removeField(ri,fi)}>×</button></div>)}</article>)}</div><div className="hom-structure-note"><b>Modelo por banco</b><span>Este perfil é uma cópia do modelo do banco para esta conta. Personalizações ficam isoladas nesta homologação e não alteram outras empresas.</span></div><div className="hom-actions spread"><div><button type="button" onClick={()=>void resetStructure()} disabled={busy}>Restaurar modelo oficial</button><button type="button" onClick={()=>void saveStructure()} disabled={busy}>Salvar alterações</button></div><button className="primary" type="button" onClick={()=>void confirmStructure()} disabled={busy}>Confirmar estrutura e avançar</button></div></div>:null}

      {viewStep===4?<div className="hom-stage-card"><header><span>ETAPA 4</span><h2>Escolha o boleto de teste</h2><p>A remessa de homologação terá exatamente um título. O retorno precisa localizar este mesmo título para liberar a conta.</p></header><div className="hom-test-list">{eligible.length===0?<div className="hom-inline-empty">Não há boletos elegíveis. Crie um Contas a Receber do tipo boleto com cliente e endereço completos.</div>:eligible.slice(0,50).map(r=><label className={testEntry===text(r.id)?'selected':''} key={text(r.id)}><input type="radio" name="test_entry" checked={testEntry===text(r.id)} onChange={()=>setTestEntry(text(r.id))}/><div><b>{text(r.customer)}</b><span>{text(r.description)} · vence {date(r.due_date)}</span></div><strong>{money(r.remaining)}</strong></label>)}</div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(3)}>Voltar</button><button className="primary" type="button" onClick={()=>void chooseTest()} disabled={busy||!testEntry}>Reservar título teste</button></div></div>:null}

      {viewStep===5?<div className="hom-stage-card"><header><span>ETAPA 5</span><h2>Gerar, imprimir e enviar o teste</h2><p>O mesmo item da remessa fornece Nosso Número, linha digitável e código de barras para o boleto impresso, evitando divergência entre arquivo e cobrança.</p></header>{chosenTest?<div className="hom-test-title"><div><small>TÍTULO TESTE</small><b>{text(chosenTest.customer)}</b><span>{text(chosenTest.description)} · {date(chosenTest.due_date)}</span></div><strong>{money(chosenTest.remaining)}</strong></div>:null}{hom?.test_remittance_id?<div className="hom-file-ready"><span>ARQUIVO E BOLETO GERADOS</span><b>{text((data.remittances as Row[]|undefined)?.find(r=>text(r.id)===text(hom.test_remittance_id))?.file_name)||'Remessa de homologação'}</b><small>Gerado em {dateTime(hom.remittance_generated_at)}</small><div>{hom?.test_remittance_item_id?<a className="primary-link" target="_blank" rel="noreferrer" href={`/dashboard/financeiro/boleto/${text(hom.test_remittance_item_id)}`}>Imprimir boleto teste</a>:null}<button type="button" onClick={()=>void redownloadTest()} disabled={busy}>↓ Baixar remessa novamente</button>{text(hom.status)==='test_generated'?<button className="primary" type="button" onClick={()=>void markSent()} disabled={busy}>Marcar como enviada ao banco</button>:<span className="hom-wait">Enviada · aguardando retorno</span>}</div></div>:<div className="hom-generate-box"><b>Pronto para gerar</b><span>Será criado um arquivo contendo somente o título selecionado. Após a geração, o boleto Itaú ficará disponível para impressão.</span><button className="primary" type="button" onClick={()=>void generateTest()} disabled={busy}>{busy?'Gerando...':`Gerar remessa e boleto teste ${layoutLabel(activeLayout)}`}</button></div>}<div className="hom-actions"><button type="button" onClick={()=>setViewStep(4)}>Voltar</button>{text(hom?.status)==='awaiting_return'?<button className="primary" type="button" onClick={()=>setViewStep(6)}>Importar retorno</button>:null}</div></div>:null}

      {viewStep===6?<div className="hom-stage-card"><header><span>ETAPA 6</span><h2>Validar o arquivo retorno</h2><p>Importe o retorno baixado do banco. O Thor procurará o Nosso Número/identificador da remessa teste e só homologará a conta quando houver confirmação válida.</p></header><div className="hom-return-box"><input id="homolog-return-file" type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>setReturnFile(e.target.files?.[0]||null)}/><div><b>{returnFile?returnFile.name:'Selecione o arquivo retorno'}</b><span>{returnFile?`${Math.ceil(returnFile.size/1024)} KB`:`Retorno ${layoutLabel(activeLayout)} do banco`}</span></div></div>{hom?.last_error?<div className="hom-error"><b>Último teste rejeitado</b><span>{text((hom.last_error as Row)?.message)||text((hom.last_error as Row)?.return_status)||'O banco retornou erro para o título teste.'}</span></div>:null}<div className="hom-check-list"><div className={hom?.test_remittance_id?'ok':''}><i>{hom?.test_remittance_id?'✓':'1'}</i><span><b>Remessa teste gerada</b><small>Arquivo vinculado à homologação</small></span></div><div className={hom?.remittance_sent_at?'ok':''}><i>{hom?.remittance_sent_at?'✓':'2'}</i><span><b>Remessa enviada</b><small>{hom?.remittance_sent_at?dateTime(hom.remittance_sent_at):'Aguardando envio ao banco'}</small></span></div><div className={approved?'ok':''}><i>{approved?'✓':'3'}</i><span><b>Retorno localiza o título</b><small>{approved?'Identificação confirmada':'Aguardando importação/confirmação'}</small></span></div></div><div className="hom-actions"><button type="button" onClick={()=>setViewStep(5)}>Voltar</button><button className="primary" type="button" disabled={busy||!returnFile} onClick={()=>void processReturn()}>{busy?'Processando...':'Importar retorno e validar'}</button></div></div>:null}

      {viewStep===7?<div className="hom-stage-card success"><div className="hom-success-icon">✓</div><span>HOMOLOGAÇÃO CONCLUÍDA</span><h2>Conta liberada para Remessa / Retorno</h2><p>O banco retornou e o Thor conseguiu localizar o mesmo título utilizado na remessa teste. Esta conta está habilitada para gerar remessas normais.</p><div className="hom-success-grid"><div><small>Banco</small><b>{text(hom?.bank_name)||text(config?.bank_code)}</b></div><div><small>Layout</small><b>{layoutLabel(config?.layout)}</b></div><div><small>Homologada em</small><b>{dateTime(hom?.approved_at)}</b></div><div><small>Status</small><b>Ativa para cobrança</b></div></div><div className="hom-actions center"><a className="primary-link" href="/dashboard/financeiro/remessa-retorno">Ir para Remessa / Retorno</a></div></div>:null}
    </main></section>:null}

    {configOpen?<div className="hom-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfigOpen(false)}}><section className="hom-modal"><header><div><span>NOVA HOMOLOGAÇÃO</span><h2>Configurar conta para cobrança por arquivo</h2><p>O wizard é padrão para todos os bancos. Neste momento os adaptadores ativos são Itaú CNAB 240 e CNAB 400.</p></div><button type="button" onClick={()=>setConfigOpen(false)}>×</button></header><form onSubmit={createConfig}><label className="wide">Conta bancária<select required name="bank_account_id"><option value="">Selecione...</option>{accounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · Banco {text(a.bank_code)||'não informado'}</option>)}</select></label><label>Banco<select disabled defaultValue="341"><option value="341">341 — Itaú Unibanco</option></select></label><label>Layout<select name="layout" value={newLayout} onChange={e=>setNewLayout(asLayout(e.target.value))}>{models.filter(m=>text(m.bank_code)==='341').map(m=><option key={text(m.id)} value={text(m.layout)}>{layoutLabel(m.layout)} · versão {text(m.version)}</option>)}</select></label><label>Agência<input required name="agency" maxLength={4} inputMode="numeric" placeholder="0057"/></label><label>Conta<input required name="account_number" maxLength={5} inputMode="numeric" placeholder="12345"/></label><label>DAC<input required name="account_digit" maxLength={1} inputMode="numeric" placeholder="6"/></label><label>Carteira<input value="109" disabled/></label><label>Espécie<select name="species" defaultValue="01"><option value="01">01 — Duplicata Mercantil</option><option value="08">08 — Duplicata de Serviços</option><option value="17">17 — Conta de Serviços</option><option value="99">99 — Diversos</option></select></label><label>Aceite<select name="acceptance" defaultValue="N"><option value="N">N — Não aceito</option><option value="A">A — Aceito</option></select></label><label className="wide">Último Nosso Número utilizado<input name="initial_our_number" defaultValue="0" inputMode="numeric"/><small>O Thor incrementará a sequência a partir desse valor.</small></label><div className="hom-modal-note wide"><b>Regra de segurança</b><span>Salvar a conta não libera emissão. A liberação só ocorre após a remessa teste e o retorno correspondente.</span></div><div className="actions wide"><button type="button" onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':'Criar e iniciar homologação'}</button></div></form></section></div>:null}
  </div>;
}
