'use client';

import { FormEvent,useMemo,useState } from 'react';
import { cnabData,generateCnabRemittance,markCnabRemittanceSent,saveCnabConfig,type CnabLayout } from './bank-cnab-actions';
import { confirmCnabReturnImport,reviewCnabReturn } from './bank-cnab-return-review-actions';

type Row=Record<string,unknown>;
type MainTab='remittance'|'return'|'history';
type HistoryTab='remittance'|'return';

const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const bool=(v:unknown)=>v===true||v==='true';
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const dateTime=(v:unknown)=>{if(!v)return '—';const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const asLayout=(v:unknown):CnabLayout=>text(v)==='cnab240'?'cnab240':'cnab400';
const layoutLabel=(v:unknown)=>asLayout(v)==='cnab240'?'CNAB 240':'CNAB 400';
const statusLabel=(v:unknown)=>({generated:'Gerada',sent:'Enviada',processed:'Processada',processed_with_errors:'Com pendências',paid:'Quitado',partial:'Parcial',open:'Em aberto',accepted:'Entrada confirmada',rejected:'Rejeitado',cancelled:'Cancelado'}[text(v)]||text(v)||'—');
const reviewStatus=(v:unknown)=>({ready:'Pronto para baixa',not_found:'Boleto não localizado',already_paid:'Já quitado',cancelled:'Título cancelado',blocked:'Bloqueado',informational:'Informativo'}[text(v)]||text(v)||'—');
const flowErrors:Record<string,string>={
  invalid_session:'Sua sessão expirou.',select_receivables:'Selecione pelo menos um título.',too_many_receivables:'Selecione no máximo 500 títulos por arquivo.',
  cnab_config_not_found:'Configure e ative um convênio CNAB antes de continuar.',cnab_config_not_supported:'A configuração escolhida não é compatível com este layout.',
  bank_account_not_homologated:'Esta conta ainda não foi homologada. Conclua a Homologação Bancária antes de gerar remessas normais.',invalid_receivables:'Há título inválido ou já quitado na seleção.',
  receivable_already_in_active_remittance:'Um dos títulos selecionados já está em uma remessa ativa.',payer_document_invalid:'CPF/CNPJ do pagador inválido.',payer_data_incomplete:'Complete os dados cadastrais do pagador antes de gerar a remessa.',
  return_file_empty:'O arquivo retorno está vazio.',return_not_itau_cnab400:'O arquivo não foi reconhecido como retorno Itaú CNAB 400.',return_not_itau_cnab240:'O arquivo não foi reconhecido como retorno Itaú CNAB 240.',
  cnab400_file_is_not_return:'O arquivo selecionado é uma remessa, não um retorno do Itaú.',bank_account_not_found:'Conta bancária não encontrada.',company_cnpj_required:'O CNPJ da empresa precisa estar completo.',
  cnab_agency_must_have_4_digits:'Informe a agência Itaú com 4 dígitos.',cnab_account_must_have_5_digits:'A conta corrente Itaú deve possuir 5 dígitos.',cnab_account_digit_required:'Informe o DAC da conta.',cnab_wallet_not_supported:'Utilize a carteira 109.',
};
const friendlyError=(r:Row)=>flowErrors[text(r.error)]||text(r.detail||r.error||'Não foi possível concluir a operação.');

export function BankCnabWorkspaceV2({initial}:{initial:Row}){
  const [data,setData]=useState<Row>(initial);
  const initialConfigs=Array.isArray(initial.configs)?initial.configs as Row[]:[];
  const [selectedConfig,setSelectedConfig]=useState(text(initialConfigs[0]?.id));
  const [tab,setTab]=useState<MainTab>('remittance');
  const [historyTab,setHistoryTab]=useState<HistoryTab>('remittance');
  const [selectedEntries,setSelectedEntries]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [configOpen,setConfigOpen]=useState(false);
  const [newLayout,setNewLayout]=useState<CnabLayout>('cnab400');
  const [returnFile,setReturnFile]=useState<File|null>(null);
  const [returnContent,setReturnContent]=useState('');
  const [returnReview,setReturnReview]=useState<Row|null>(null);
  const [selectedReturnLines,setSelectedReturnLines]=useState<number[]>([]);
  const [reviewOpen,setReviewOpen]=useState(false);

  const accounts=Array.isArray(data.accounts)?data.accounts as Row[]:[];
  const configs=Array.isArray(data.configs)?data.configs as Row[]:[];
  const receivables=Array.isArray(data.receivables)?data.receivables as Row[]:[];
  const remittances=Array.isArray(data.remittances)?data.remittances as Row[]:[];
  const returns=Array.isArray(data.returns)?data.returns as Row[]:[];
  const activeConfig=useMemo(()=>configs.find(c=>text(c.id)===selectedConfig),[configs,selectedConfig]);
  const activeLayout=asLayout(activeConfig?.layout);
  const eligible=useMemo(()=>receivables.filter(r=>!r.validation_error&&!r.remitted),[receivables]);
  const hiddenReceivables=receivables.length-eligible.length;
  const selectedRows=useMemo(()=>eligible.filter(r=>selectedEntries.includes(text(r.id))),[eligible,selectedEntries]);
  const selectedTotal=useMemo(()=>selectedRows.reduce((s,r)=>s+num(r.remaining),0),[selectedRows]);
  const availableTotal=useMemo(()=>eligible.reduce((s,r)=>s+num(r.remaining),0),[eligible]);
  const reviewRows=useMemo(()=>Array.isArray(returnReview?.details)?returnReview!.details as Row[]:[],[returnReview]);
  const liquidationRows=useMemo(()=>reviewRows.filter(r=>bool(r.is_liquidation)),[reviewRows]);
  const matchedRows=useMemo(()=>reviewRows.filter(r=>bool(r.matched)),[reviewRows]);
  const selectableLines=useMemo(()=>liquidationRows.filter(r=>bool(r.selectable)).map(r=>num(r.line_number)),[liquidationRows]);
  const selectedLiquidations=useMemo(()=>liquidationRows.filter(r=>selectedReturnLines.includes(num(r.line_number))),[liquidationRows,selectedReturnLines]);
  const selectedLiquidationTotal=useMemo(()=>selectedLiquidations.reduce((s,r)=>s+num(r.return_paid_amount||r.boleto_amount),0),[selectedLiquidations]);

  async function refresh(preferId?:string){const r=await cnabData();if(!r.ok)return;setData(r);const next=Array.isArray(r.configs)?r.configs as Row[]:[];const wanted=preferId||selectedConfig;if(wanted&&next.some(c=>text(c.id)===wanted))setSelectedConfig(wanted);else setSelectedConfig(text(next[0]?.id));}
  function toggleEntry(id:string){setSelectedEntries(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);}
  function toggleAllEntries(){setSelectedEntries(v=>v.length===eligible.length?[]:eligible.map(r=>text(r.id)));}
  function clearReturn(){setReturnFile(null);setReturnContent('');setReturnReview(null);setSelectedReturnLines([]);setReviewOpen(false);const el=document.getElementById('cnab2-return-file') as HTMLInputElement|null;if(el)el.value='';}
  function toggleReturnLine(line:number){setSelectedReturnLines(v=>v.includes(line)?v.filter(x=>x!==line):[...v,line]);}
  function toggleAllReturnLines(){setSelectedReturnLines(v=>v.length===selectableLines.length?[]:selectableLines);}
  function download(name:string,content:string){const blob=new Blob([content],{type:'text/plain;charset=us-ascii'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}

  async function generate(){if(!activeConfig){setMessage('Selecione um convênio.');return;}if(!selectedEntries.length){setMessage('Selecione pelo menos um título.');return;}setBusy(true);setMessage('');const r=await generateCnabRemittance(activeLayout,selectedConfig,selectedEntries);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}download(text(r.file_name)||'REMESSA.REM',text(r.content));setSelectedEntries([]);setMessage(`${text(r.file_name)} gerada com ${text(r.record_count)} título(s), total ${money(r.total_amount)}.`);await refresh();}
  async function markSent(id:string){setBusy(true);const r=await markCnabRemittanceSent(id);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setMessage('Remessa marcada como enviada.');await refresh();}
  async function analyzeReturn(){if(!activeConfig){setMessage('Selecione o convênio do retorno.');return;}if(!returnFile){setMessage('Selecione um arquivo .RET.');return;}setBusy(true);setMessage('');let content='';try{content=await returnFile.text();}catch{setBusy(false);setMessage('Não foi possível ler o arquivo.');return;}const r=await reviewCnabReturn(activeLayout,selectedConfig,content);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}if(r.already_imported){setMessage('Este arquivo já foi importado anteriormente.');return;}const rows=Array.isArray(r.details)?r.details as Row[]:[];setReturnContent(content);setReturnReview(r);setSelectedReturnLines(rows.filter(x=>bool(x.selected_default)).map(x=>num(x.line_number)));setReviewOpen(true);}
  async function confirmReturn(){if(!returnFile||!returnReview||!returnContent)return;setBusy(true);setMessage('');const r=await confirmCnabReturnImport(activeLayout,selectedConfig,returnFile.name,returnContent,selectedReturnLines);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setMessage(`${text(r.matched_count)} boleto(s) localizado(s), ${text(r.paid_count)} quitado(s) e ${text(r.error_count)} pendência(s).`);clearReturn();await refresh();setTab('history');setHistoryTab('return');}
  async function saveConfig(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage('');const fd=new FormData(e.currentTarget);const layout=asLayout(fd.get('layout'));const r=await saveCnabConfig(layout,text(fd.get('bank_account_id')),{agency:text(fd.get('agency')),account_number:text(fd.get('account_number')),account_digit:text(fd.get('account_digit')),wallet:'109',species:text(fd.get('species'))||'01',acceptance:text(fd.get('acceptance'))||'N',initial_our_number:text(fd.get('initial_our_number'))||'0',active:true});setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setConfigOpen(false);setMessage('Convênio CNAB salvo.');await refresh(text(r.config_id));}

  return <div className="cnab2">
    <section className="cnab2-context">
      <div className="cnab2-account">
        <label>Conta / convênio<select value={selectedConfig} onChange={e=>{setSelectedConfig(e.target.value);setSelectedEntries([]);clearReturn();}}><option value="">Selecione...</option>{configs.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.account_name)} · {layoutLabel(c.layout)}</option>)}</select></label>
        {activeConfig?<div className="cnab2-account-meta"><b>Itaú 341</b><span>{layoutLabel(activeConfig.layout)}</span><span>Carteira {text(activeConfig.wallet)}</span><span>Ag. {text(activeConfig.agency)} · Conta {text(activeConfig.account_number)}-{text(activeConfig.account_digit)}</span></div>:<div className="cnab2-account-meta warning"><b>Convênio não configurado</b></div>}
      </div>
      <div className="cnab2-context-actions"><a href="/dashboard/financeiro/homologacao-bancaria">Homologação</a><button type="button" onClick={()=>void refresh()} disabled={busy}>↻</button><button type="button" onClick={()=>setConfigOpen(true)}>⚙ Configurar</button></div>
    </section>

    {message?<div className="cnab2-message"><span>{message}</span><button type="button" onClick={()=>setMessage('')}>×</button></div>:null}

    <nav className="cnab2-tabs" aria-label="Operações bancárias">
      <button className={tab==='remittance'?'active':''} onClick={()=>setTab('remittance')}><span>↑</span><b>Remessa</b><small>Gerar arquivo para o banco</small></button>
      <button className={tab==='return'?'active':''} onClick={()=>setTab('return')}><span>↓</span><b>Retorno</b><small>Conferir e baixar boletos</small></button>
      <button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><span>≡</span><b>Histórico</b><small>Arquivos processados</small></button>
    </nav>

    {tab==='remittance'?<section className="cnab2-workspace">
      <header className="cnab2-section-head"><div><small>GERAR REMESSA</small><h2>Boletos disponíveis para envio</h2><p>Mostramos somente títulos aptos. Os que já estão em remessa ficam fora desta lista.</p></div><div className="cnab2-head-actions"><button type="button" onClick={toggleAllEntries} disabled={!eligible.length}>{selectedEntries.length===eligible.length&&eligible.length?'Desmarcar todos':'Selecionar todos'}</button><button className="primary" type="button" onClick={()=>void generate()} disabled={busy||!selectedEntries.length||!activeConfig}>{busy?'Gerando...':`Gerar .REM (${selectedEntries.length})`}</button></div></header>
      <div className="cnab2-kpis"><article><span>Disponíveis</span><strong>{eligible.length}</strong><small>{money(availableTotal)}</small></article><article><span>Selecionados</span><strong>{selectedEntries.length}</strong><small>{money(selectedTotal)}</small></article><article><span>Já enviados</span><strong>{hiddenReceivables}</strong><small>ocultos desta lista</small></article></div>
      <div className="cnab2-table"><table><thead><tr><th></th><th>Cliente</th><th>Título</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>{eligible.length===0?<tr><td colSpan={5} className="empty">Nenhum boleto apto para nova remessa.</td></tr>:eligible.map(r=>{const id=text(r.id);return <tr key={id} className={selectedEntries.includes(id)?'selected':''}><td><input type="checkbox" checked={selectedEntries.includes(id)} onChange={()=>toggleEntry(id)}/></td><td><b>{text(r.customer)||'—'}</b><small>{text(r.document)||'Documento não informado'}</small></td><td>{text(r.description)||id.slice(0,8)}</td><td>{date(r.due_date)}</td><td><b>{money(r.remaining)}</b></td></tr>})}</tbody></table></div>
    </section>:null}

    {tab==='return'?<section className="cnab2-workspace cnab2-return-workspace">
      <header className="cnab2-section-head"><div><small>IMPORTAR RETORNO</small><h2>Conferência antes da baixa</h2><p>O arquivo é analisado e os boletos são localizados antes de qualquer alteração financeira.</p></div></header>
      <div className="cnab2-return-card">
        <div className="cnab2-drop"><div className="cnab2-drop-icon">RET</div><div><b>{returnFile?returnFile.name:'Selecione o arquivo de retorno'}</b><span>{returnFile?`${Math.max(1,Math.ceil(returnFile.size/1024))} KB · pronto para análise`:`Arquivo .RET recebido do Itaú`}</span></div><label>{returnFile?'Trocar arquivo':'Escolher arquivo'}<input id="cnab2-return-file" type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>{setReturnFile(e.target.files?.[0]||null);setReturnReview(null);setReturnContent('');setSelectedReturnLines([]);}}/></label></div>
        <div className="cnab2-return-security"><b>Nenhuma baixa automática</b><span>Liquidações encontradas aparecem pré-selecionadas. Você confere boleto, valor e data da liquidação antes de confirmar.</span></div>
        <button className="cnab2-analyze" type="button" disabled={busy||!returnFile||!activeConfig} onClick={()=>void analyzeReturn()}>{busy?'Analisando arquivo...':'Analisar retorno e localizar boletos'}</button>
      </div>
    </section>:null}

    {tab==='history'?<section className="cnab2-workspace">
      <header className="cnab2-section-head"><div><small>HISTÓRICO</small><h2>Arquivos bancários</h2><p>Consulte remessas enviadas e retornos já processados.</p></div><div className="cnab2-history-switch"><button className={historyTab==='remittance'?'active':''} onClick={()=>setHistoryTab('remittance')}>Remessas</button><button className={historyTab==='return'?'active':''} onClick={()=>setHistoryTab('return')}>Retornos</button></div></header>
      {historyTab==='remittance'?<div className="cnab2-table"><table><thead><tr><th>Arquivo</th><th>Gerado em</th><th>Títulos</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>{remittances.length===0?<tr><td colSpan={6} className="empty">Nenhuma remessa gerada.</td></tr>:remittances.map(r=><tr key={text(r.id)}><td><b>{text(r.file_name)}</b><small>{layoutLabel(r.layout)}</small></td><td>{dateTime(r.generated_at)}</td><td>{text(r.record_count)}</td><td><b>{money(r.total_amount)}</b></td><td><span className={`cnab2-status ${text(r.status)}`}>{statusLabel(r.status)}</span></td><td className="actions"><a href={`/dashboard/financeiro/remessa/${text(r.id)}/boletos`}>Boletos</a>{text(r.status)==='generated'?<button type="button" onClick={()=>void markSent(text(r.id))} disabled={busy}>Marcar enviada</button>:null}</td></tr>)}</tbody></table></div>:<div className="cnab2-table"><table><thead><tr><th>Arquivo</th><th>Importado em</th><th>Localizados</th><th>Quitados</th><th>Pendências</th><th>Status</th></tr></thead><tbody>{returns.length===0?<tr><td colSpan={6} className="empty">Nenhum retorno importado.</td></tr>:returns.map(r=><tr key={text(r.id)}><td><b>{text(r.file_name)}</b><small>{layoutLabel(r.layout)}</small></td><td>{dateTime(r.imported_at)}</td><td>{text(r.matched_count)}</td><td><b>{text(r.paid_count)}</b></td><td>{text(r.error_count)}</td><td><span className={`cnab2-status ${text(r.status)}`}>{statusLabel(r.status)}</span></td></tr>)}</tbody></table></div>}
    </section>:null}

    {reviewOpen&&returnReview?<div className="cnab2-review-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setReviewOpen(false)}}><section className="cnab2-review">
      <header><div><small>CONFERÊNCIA DO RETORNO</small><h2>{returnFile?.name}</h2><p>Confira os títulos encontrados. Somente as linhas de liquidação selecionadas serão baixadas.</p></div><button type="button" onClick={()=>setReviewOpen(false)} disabled={busy}>×</button></header>
      <div className="cnab2-review-kpis"><article><span>Registros</span><strong>{reviewRows.length}</strong></article><article><span>Localizados</span><strong>{matchedRows.length}</strong></article><article><span>Liquidações</span><strong>{liquidationRows.length}</strong></article><article><span>Selecionados</span><strong>{selectedReturnLines.length}</strong></article><article><span>Valor para baixa</span><strong>{money(selectedLiquidationTotal)}</strong></article></div>
      {selectableLines.length>0?<div className="cnab2-review-tools"><span>Liquidações aptas estão pré-selecionadas.</span><button type="button" onClick={toggleAllReturnLines}>{selectedReturnLines.length===selectableLines.length?'Desmarcar todas':'Selecionar todas aptas'}</button></div>:null}
      <div className="cnab2-review-table"><table><thead><tr><th></th><th>Evento</th><th>Boleto / cliente</th><th>Nosso Número</th><th>Emissão</th><th>Vencimento</th><th>Valor boleto</th><th>Data evento</th><th>Valor retorno</th><th>Situação</th></tr></thead><tbody>{reviewRows.map((r,i)=>{const line=num(r.line_number);const selectable=bool(r.selectable);const selected=selectedReturnLines.includes(line);return <tr key={`${line}-${i}`} className={`${selected?'selected ':''}${!bool(r.matched)?'unmatched':''}`}><td>{bool(r.is_liquidation)?<input type="checkbox" checked={selected} disabled={!selectable||busy} onChange={()=>toggleReturnLine(line)}/>:<span className="cnab2-event-dot">•</span>}</td><td><b>{text(r.occurrence_code)}</b><small>{text(r.occurrence_label)}</small></td><td><b>{text(r.customer_name)||'Boleto não localizado'}</b><small>{text(r.description)||text(r.return_document_number)||'—'}</small></td><td><b>{text(r.our_number)||text(r.return_our_number)||'—'}</b><small>{text(r.match_by)==='nosso_numero'?'pelo Nosso Número':text(r.match_by)==='identificador_remessa'?'pelo identificador da remessa':''}</small></td><td>{date(r.issued_at)}</td><td>{date(r.due_date)}</td><td><b>{money(r.boleto_amount||r.return_title_amount)}</b></td><td><b>{date(r.liquidation_date||r.occurrence_date)}</b><small>{bool(r.is_liquidation)?'Liquidação/crédito':'Ocorrência bancária'}</small></td><td><b>{bool(r.is_liquidation)?money(r.return_paid_amount||r.boleto_amount):'—'}</b></td><td><span className={`cnab2-review-status ${text(r.review_status)}`}>{bool(r.matched)&&!bool(r.is_liquidation)&&text(r.occurrence_code)==='02'?'Boleto localizado · entrada confirmada':reviewStatus(r.review_status)}</span></td></tr>})}</tbody></table></div>
      <footer><div><b>{selectedReturnLines.length} boleto(s) selecionado(s) para baixa</b><span>{money(selectedLiquidationTotal)}</span></div><button type="button" onClick={()=>setReviewOpen(false)} disabled={busy}>Voltar</button><button className="primary" type="button" onClick={()=>void confirmReturn()} disabled={busy}>{busy?'Confirmando...':selectedReturnLines.length?`Confirmar importação e baixar ${selectedReturnLines.length}`:'Confirmar importação sem baixas'}</button></footer>
    </section></div>:null}

    {configOpen?<div className="cnab2-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setConfigOpen(false)}}><section className="cnab2-modal"><header><div><small>CONFIGURAÇÃO</small><h2>Convênio Itaú CNAB</h2><p>Dados contratados para cobrança bancária.</p></div><button type="button" onClick={()=>setConfigOpen(false)}>×</button></header><form onSubmit={saveConfig}><label className="wide">Layout<select name="layout" value={newLayout} onChange={e=>setNewLayout(asLayout(e.target.value))}><option value="cnab400">CNAB 400 — Itaú</option><option value="cnab240">CNAB 240 — FEBRABAN</option></select></label><label className="wide">Conta bancária<select required name="bank_account_id"><option value="">Selecione...</option>{accounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · Banco {text(a.bank_code)||'—'}</option>)}</select></label><label>Agência<input required name="agency" maxLength={4} inputMode="numeric" placeholder="0456"/></label><label>Conta<input required name="account_number" maxLength={5} inputMode="numeric" placeholder="12345"/></label><label>DAC<input required name="account_digit" maxLength={1} inputMode="numeric" placeholder="7"/></label><label>Carteira<input value="109" readOnly/></label><label>Espécie<select name="species" defaultValue="01"><option value="01">01 — Duplicata Mercantil</option><option value="05">05 — Recibo</option><option value="06">06 — Contrato</option><option value="08">08 — Duplicata de Serviços</option><option value="17">17 — Prestação de Serviços</option><option value="99">99 — Diversos</option></select></label><label>Aceite<select name="acceptance" defaultValue="N"><option value="N">N — Não aceito</option><option value="A">A — Aceito</option></select></label><label>Nosso Número inicial<input name="initial_our_number" defaultValue="0" inputMode="numeric"/></label><div className="wide actions"><button type="button" onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':'Salvar configuração'}</button></div></form></section></div>:null}
  </div>;
}
