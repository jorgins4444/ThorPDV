'use client';

import { FormEvent,useMemo,useState } from 'react';
import { cnabData,generateCnabRemittance,markCnabRemittanceSent,saveCnabConfig,type CnabLayout } from './bank-cnab-actions';
import { confirmCnabReturnImport,reviewCnabReturn } from './bank-cnab-return-review-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const dateTime=(v:unknown)=>{if(!v)return '—';const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const layoutLabel=(v:unknown)=>text(v)==='cnab240'?'CNAB 240':'CNAB 400';
const asLayout=(v:unknown):CnabLayout=>text(v)==='cnab240'?'cnab240':'cnab400';
const bool=(v:unknown)=>v===true||v==='true';
const flowErrors:Record<string,string>={
  invalid_session:'Sua sessão expirou.',select_receivables:'Selecione pelo menos um título para gerar a remessa.',too_many_receivables:'Selecione no máximo 500 títulos por arquivo.',
  cnab_config_not_found:'Configure e ative um convênio CNAB antes de continuar.',cnab_config_not_supported:'A configuração escolhida não é compatível com este layout.',
  bank_account_not_homologated:'Esta conta ainda não foi homologada. Conclua a Homologação Bancária antes de gerar remessas normais.',invalid_receivables:'Há título inválido ou já quitado na seleção.',
  receivable_already_in_active_remittance:'Um dos títulos selecionados já está em uma remessa ativa.',payer_document_invalid:'CPF/CNPJ do pagador inválido.',payer_data_incomplete:'Complete os dados cadastrais do pagador antes de gerar a remessa.',
  cnab_our_number_sequence_exhausted:'A sequência de Nosso Número atingiu o limite da carteira.',return_file_empty:'O arquivo retorno está vazio.',return_not_itau_cnab400:'O arquivo não foi reconhecido como retorno Itaú CNAB 400.',
  return_not_itau_cnab240:'O arquivo não foi reconhecido como retorno Itaú CNAB 240.',cnab400_file_is_not_return:'O arquivo selecionado é uma remessa, não um retorno do Itaú.',
  bank_account_not_found:'Conta bancária não encontrada.',company_cnpj_required:'O CNPJ da empresa precisa estar completo antes de configurar a cobrança.',cnab_agency_must_have_4_digits:'Informe a agência Itaú com 4 dígitos.',
  cnab_account_must_have_5_digits:'A conta corrente de cobrança Itaú deve possuir 5 dígitos, sem o DAC.',cnab_account_digit_required:'Informe o DAC da conta corrente.',cnab_wallet_not_supported:'Nesta primeira versão utilize a carteira 109.',
  cnab_species_invalid:'Espécie do título inválida.',cnab_acceptance_invalid:'Aceite inválido.',
};
const friendlyError=(r:Row)=>flowErrors[text(r.error)]||text(r.detail||r.error||'Não foi possível concluir a operação.');
const reviewStatus=(v:unknown)=>({ready:'Pronto para baixa',not_found:'Boleto não localizado',already_paid:'Já quitado',cancelled:'Título cancelado',blocked:'Bloqueado',informational:'Informativo'}[text(v)]||text(v));

export function BankCnabReviewedWorkspace({initial}:{initial:Row}){
  const [data,setData]=useState<Row>(initial);
  const initialConfigs=Array.isArray(initial.configs)?initial.configs as Row[]:[];
  const [selectedConfig,setSelectedConfig]=useState(text(initialConfigs[0]?.id));
  const [newLayout,setNewLayout]=useState<CnabLayout>('cnab240');
  const [configOpen,setConfigOpen]=useState(false);
  const [selectedEntries,setSelectedEntries]=useState<string[]>([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
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
  const selectedRows=useMemo(()=>receivables.filter(r=>selectedEntries.includes(text(r.id))),[receivables,selectedEntries]);
  const selectedTotal=useMemo(()=>selectedRows.reduce((sum,r)=>sum+num(r.remaining),0),[selectedRows]);
  const reviewRows=useMemo(()=>Array.isArray(returnReview?.details)?returnReview!.details as Row[]:[],[returnReview]);
  const liquidationRows=useMemo(()=>reviewRows.filter(r=>bool(r.is_liquidation)),[reviewRows]);
  const selectableLines=useMemo(()=>liquidationRows.filter(r=>bool(r.selectable)).map(r=>num(r.line_number)),[liquidationRows]);
  const selectedLiquidations=useMemo(()=>liquidationRows.filter(r=>selectedReturnLines.includes(num(r.line_number))),[liquidationRows,selectedReturnLines]);
  const selectedLiquidationTotal=useMemo(()=>selectedLiquidations.reduce((sum,r)=>sum+num(r.return_paid_amount||r.boleto_amount),0),[selectedLiquidations]);
  const otherEvents=useMemo(()=>reviewRows.filter(r=>!bool(r.is_liquidation)),[reviewRows]);
  const eventSummary=useMemo(()=>{const m=new Map<string,{label:string;count:number}>();for(const r of otherEvents){const key=text(r.occurrence_code)||'?';const old=m.get(key);m.set(key,{label:text(r.occurrence_label)||`Ocorrência ${key}`,count:(old?.count||0)+1});}return [...m.entries()];},[otherEvents]);

  async function refresh(preferId?:string){const r=await cnabData();if(!r.ok)return;setData(r);const next=Array.isArray(r.configs)?r.configs as Row[]:[];const wanted=preferId||selectedConfig;if(wanted&&next.some(c=>text(c.id)===wanted))setSelectedConfig(wanted);else setSelectedConfig(text(next[0]?.id));}
  function toggle(id:string){setSelectedEntries(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);}
  function selectAll(){setSelectedEntries(current=>current.length===eligible.length?[]:eligible.map(r=>text(r.id)));}
  function clearReturn(){setReturnFile(null);setReturnContent('');setReturnReview(null);setSelectedReturnLines([]);setReviewOpen(false);const el=document.getElementById('cnab-return-file') as HTMLInputElement|null;if(el)el.value='';}
  function onReturnFile(file:File|null){setReturnFile(file);setReturnContent('');setReturnReview(null);setSelectedReturnLines([]);setReviewOpen(false);}
  function toggleReturnLine(line:number){setSelectedReturnLines(current=>current.includes(line)?current.filter(x=>x!==line):[...current,line]);}
  function toggleAllReturnLines(){setSelectedReturnLines(current=>current.length===selectableLines.length?[]:selectableLines);}

  async function saveConfig(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setMessage('');const fd=new FormData(e.currentTarget);const layout=asLayout(fd.get('layout'));
    const r=await saveCnabConfig(layout,text(fd.get('bank_account_id')),{agency:text(fd.get('agency')),account_number:text(fd.get('account_number')),account_digit:text(fd.get('account_digit')),wallet:'109',species:text(fd.get('species'))||'01',acceptance:text(fd.get('acceptance'))||'N',initial_our_number:text(fd.get('initial_our_number'))||'0',active:true});
    setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setConfigOpen(false);setMessage(`${layoutLabel(layout)} Itaú configurado. Conclua a Homologação Bancária antes da primeira remessa produtiva.`);await refresh(text(r.config_id));
  }
  function download(name:string,content:string){const blob=new Blob([content],{type:'text/plain;charset=us-ascii'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500);}
  async function generate(){
    if(!activeConfig){setMessage('Selecione ou configure um convênio CNAB.');return;}if(!selectedEntries.length){setMessage('Selecione pelo menos um título.');return;}
    setBusy(true);setMessage('');const r=await generateCnabRemittance(activeLayout,selectedConfig,selectedEntries);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}
    download(text(r.file_name)||'REMESSA.REM',text(r.content));setSelectedEntries([]);setMessage(`${layoutLabel(activeLayout)}: remessa ${text(r.file_name)} gerada com ${text(r.record_count)} título(s), total ${money(r.total_amount)}.`);await refresh();
  }
  async function markSent(id:string){setBusy(true);const r=await markCnabRemittanceSent(id);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setMessage('Remessa marcada como enviada ao Itaú.');await refresh();}

  async function analyzeReturn(){
    if(!activeConfig){setMessage('Selecione o convênio correspondente ao arquivo retorno.');return;}if(!returnFile){setMessage('Selecione um arquivo .RET do Itaú.');return;}
    setBusy(true);setMessage('');let content='';try{content=await returnFile.text();}catch{setBusy(false);setMessage('Não foi possível ler o arquivo selecionado.');return;}
    const r=await reviewCnabReturn(activeLayout,selectedConfig,content);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}
    if(r.already_imported){setMessage(`Este retorno já foi importado anteriormente. Nenhuma baixa será duplicada: ${returnFile.name}.`);return;}
    const rows=Array.isArray(r.details)?r.details as Row[]:[];setReturnContent(content);setReturnReview(r);setSelectedReturnLines(rows.filter(x=>bool(x.selected_default)).map(x=>num(x.line_number)));setReviewOpen(true);
  }

  async function confirmReturn(){
    if(!returnFile||!returnReview||!returnContent)return;
    setBusy(true);setMessage('');const r=await confirmCnabReturnImport(activeLayout,selectedConfig,returnFile.name,returnContent,selectedReturnLines);setBusy(false);
    if(!r.ok){setMessage(friendlyError(r));return;}
    if(r.already_imported){setMessage(`Este retorno já havia sido importado. Nenhuma baixa foi duplicada: ${returnFile.name}.`);clearReturn();await refresh();return;}
    const skipped=num(r.skipped_liquidation_count);setMessage(`${layoutLabel(activeLayout)} confirmado: ${text(r.matched_count)} boleto(s) localizado(s), ${text(r.paid_count)} quitado(s)${skipped?`, ${skipped} liquidação(ões) não selecionada(s)`:''}, ${text(r.error_count)} pendência(s).`);clearReturn();await refresh();
  }

  return <div className="cnab-studio">
    <section className="cnab-hero"><div><span>COBRANÇA POR ARQUIVO</span><h1>Remessa / Retorno</h1><p>O arquivo retorno é analisado primeiro. Você confere os boletos liquidados e somente depois confirma as baixas financeiras.</p></div><div className="cnab-hero-badge"><b>240 / 400</b><span>Itaú · Banco 341</span></div></section>
    <section className="cnab-flow"><div><i>1</i><b>Configurar</b><span>Layout, agência, conta e carteira</span></div><div><i>2</i><b>Gerar .REM</b><span>Selecionar títulos em aberto</span></div><div><i>3</i><b>Imprimir boletos</b><span>Padrão bancário Itaú A4</span></div><div><i>4</i><b>Enviar ao Itaú</b><span>Transmissão de arquivos</span></div><div><i>5</i><b>Conferir .RET</b><span>Revisar e confirmar as baixas</span></div></section>
    {message?<div className="cnab-message" onClick={()=>setMessage('')}><span>{message}</span><button type="button">×</button></div>:null}

    <section className="cnab-toolbar"><label>Conta / convênio<select value={selectedConfig} onChange={e=>{setSelectedConfig(e.target.value);setSelectedEntries([]);clearReturn();}}><option value="">Selecione...</option>{configs.map(c=><option key={text(c.id)} value={text(c.id)}>{layoutLabel(c.layout)} · {text(c.account_name)} · ag. {text(c.agency)} · conta {text(c.account_number)}-{text(c.account_digit)}</option>)}</select></label><a className="secondary" href="/dashboard/financeiro/homologacao-bancaria">Homologação Bancária</a><button className="secondary" type="button" onClick={()=>void refresh()} disabled={busy}>↻ Atualizar</button><button className="primary" type="button" onClick={()=>setConfigOpen(true)}>⚙ Configurar CNAB</button></section>
    {activeConfig?<section className="cnab-config-summary"><div><small>CONVÊNIO ATIVO</small><b>{text(activeConfig.account_name)}</b><span>Ag. {text(activeConfig.agency)} · Conta {text(activeConfig.account_number)}-{text(activeConfig.account_digit)}</span></div><div><small>LAYOUT / CARTEIRA</small><b>{layoutLabel(activeConfig.layout)} · {text(activeConfig.wallet)}</b><span>{activeLayout==='cnab240'?'FEBRABAN 240 · arquivo 040 · lote 030':'Itaú 400 posições'}</span></div><div><small>PRÓXIMA REMESSA</small><b>{Number(activeConfig.remittance_sequence||0)+1}</b><span>Nosso Número atual {text(activeConfig.our_number_sequence)||'0'}</span></div></section>:null}

    <section className="cnab-panel"><header><div><span>ARQUIVO REMESSA · {activeConfig?layoutLabel(activeConfig.layout):'CNAB'}</span><h2>Títulos para registro</h2><p>Boletos em aberto com CPF/CNPJ e endereço completos do pagador.</p></div><div className="cnab-selection"><b>{selectedEntries.length}</b><span>selecionados · {money(selectedTotal)}</span></div></header><div className="cnab-panel-actions"><button className="secondary" type="button" onClick={selectAll} disabled={!eligible.length}>{selectedEntries.length===eligible.length&&eligible.length?'Desmarcar todos':'Selecionar elegíveis'}</button><button className="primary" type="button" onClick={()=>void generate()} disabled={busy||!selectedEntries.length||!activeConfig}>{busy?'Processando...':`Gerar ${activeConfig?layoutLabel(activeConfig.layout):'CNAB'} .REM`}</button></div><div className="cnab-table"><table><thead><tr><th></th><th>Cliente</th><th>Título</th><th>Vencimento</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>{receivables.length===0?<tr><td colSpan={6} className="empty">Nenhum boleto em aberto.</td></tr>:receivables.map(r=>{const id=text(r.id);const blocked=Boolean(r.validation_error)||Boolean(r.remitted);return <tr key={id} className={blocked?'muted':''}><td><input type="checkbox" checked={selectedEntries.includes(id)} disabled={blocked} onChange={()=>toggle(id)}/></td><td><b>{text(r.customer)||'—'}</b><small>{text(r.document)||'CPF/CNPJ não informado'}</small></td><td>{text(r.description)||id.slice(0,8)}</td><td>{date(r.due_date)}</td><td><b>{money(r.remaining)}</b></td><td>{r.remitted?<span className="tag sent">Já em remessa</span>:r.validation_error?<span className="tag error">{text(r.validation_error)}</span>:<span className="tag ready">Pronto</span>}</td></tr>})}</tbody></table></div></section>

    <section className="cnab-grid"><article className="cnab-panel return-panel"><header><div><span>ARQUIVO RETORNO · {activeConfig?layoutLabel(activeConfig.layout):'CNAB'}</span><h2>Conferir retorno do banco</h2><p>Primeiro analisamos o arquivo e localizamos os boletos. Nenhuma baixa acontece antes da sua confirmação.</p></div></header><div className="return-drop"><input id="cnab-return-file" type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>onReturnFile(e.target.files?.[0]||null)}/><div><b>{returnFile?returnFile.name:'Selecione o retorno do Itaú'}</b><span>{returnFile?`${Math.ceil(returnFile.size/1024)} KB`:`Retorno ${activeConfig?layoutLabel(activeConfig.layout):'CNAB 240/400'} recebido pelo Itaú Empresas`}</span></div></div><button className="primary wide" type="button" disabled={busy||!returnFile||!activeConfig} onClick={()=>void analyzeReturn()}>{busy?'Analisando retorno...':'Analisar e localizar boletos'}</button><div className="cnab-safe reviewed"><b>Conferência antes da baixa</b><span>As liquidações localizadas serão mostradas pré-selecionadas com valor, emissão, vencimento e data de liquidação. Você decide quais serão baixadas.</span></div></article>
      <article className="cnab-panel"><header><div><span>ÚLTIMAS REMESSAS</span><h2>Arquivos e boletos gerados</h2></div></header><div className="cnab-history">{remittances.length===0?<p>Nenhuma remessa gerada.</p>:remittances.slice(0,8).map(r=><div key={text(r.id)}><div><b>{text(r.file_name)}</b><span>{layoutLabel(r.layout)} · {dateTime(r.generated_at)} · {text(r.record_count)} título(s) · {money(r.total_amount)}</span></div><span className={`tag ${text(r.status)}`}>{text(r.status)==='generated'?'Gerada':text(r.status)==='sent'?'Enviada':text(r.status)==='processed'?'Processada':text(r.status)}</span><a className="primary-link" href={`/dashboard/financeiro/remessa/${text(r.id)}/boletos`}>Boletos</a>{text(r.status)==='generated'?<button type="button" onClick={()=>void markSent(text(r.id))} disabled={busy}>Marcar enviada</button>:null}</div>)}</div></article>
    </section>

    <section className="cnab-panel"><header><div><span>RETORNOS PROCESSADOS</span><h2>Histórico de importação</h2></div></header><div className="cnab-table"><table><thead><tr><th>Arquivo</th><th>Layout</th><th>Importado em</th><th>Localizados</th><th>Quitados</th><th>Pendências</th><th>Status</th></tr></thead><tbody>{returns.length===0?<tr><td colSpan={7} className="empty">Nenhum retorno importado.</td></tr>:returns.map(r=><tr key={text(r.id)}><td><b>{text(r.file_name)}</b><small>Seq. banco {text(r.bank_file_sequence)||'—'}</small></td><td><span className="tag sent">{layoutLabel(r.layout)}</span></td><td>{dateTime(r.imported_at)}</td><td>{text(r.matched_count)}</td><td>{text(r.paid_count)}</td><td>{text(r.error_count)}</td><td><span className={`tag ${text(r.status)}`}>{text(r.status)==='processed'?'Processado':text(r.status)==='processed_with_errors'?'Com pendências':text(r.status)}</span></td></tr>)}</tbody></table></div></section>

    {reviewOpen&&returnReview?<div className="cnab-review-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setReviewOpen(false)}}><section className="cnab-review-modal">
      <header><div><span>CONFERÊNCIA DO ARQUIVO RETORNO</span><h2>{returnFile?.name}</h2><p>{layoutLabel(activeLayout)} · o arquivo foi somente analisado; ainda não houve baixa financeira.</p></div><button type="button" onClick={()=>setReviewOpen(false)} disabled={busy}>×</button></header>
      <div className="cnab-review-summary"><article><span>Liquidações no RET</span><strong>{num(returnReview.liquidation_count)}</strong></article><article><span>Boletos localizados</span><strong>{liquidationRows.filter(r=>bool(r.matched)).length}</strong></article><article><span>Selecionados para baixa</span><strong>{selectedReturnLines.length}</strong></article><article><span>Valor selecionado</span><strong>{money(selectedLiquidationTotal)}</strong></article><article className={num(returnReview.unmatched_count)>0?'attention':''}><span>Não localizados</span><strong>{num(returnReview.unmatched_count)}</strong></article></div>
      <div className="cnab-review-notice"><b>Nenhuma baixa é automática nesta etapa.</b><span>Confira os dados abaixo. Os boletos aptos estão pré-selecionados; você pode desmarcar qualquer liquidação antes de confirmar.</span></div>
      <div className="cnab-review-section-head"><div><small>LIQUIDAÇÕES</small><h3>Boletos encontrados no retorno</h3></div>{selectableLines.length>0?<button type="button" onClick={toggleAllReturnLines}>{selectedReturnLines.length===selectableLines.length?'Desmarcar todos':'Selecionar todos aptos'}</button>:null}</div>
      {liquidationRows.length===0?<div className="cnab-review-empty"><b>Nenhuma liquidação encontrada neste retorno.</b><span>O arquivo possui {otherEvents.length} outro(s) evento(s) bancário(s), que poderão ser registrados sem gerar baixa financeira.</span></div>:<div className="cnab-review-table"><table><thead><tr><th></th><th>Boleto / cliente</th><th>Nosso Número</th><th>Emissão</th><th>Vencimento</th><th>Valor boleto</th><th>Liquidação</th><th>Valor liquidado</th><th>Ocorrência</th><th>Situação</th></tr></thead><tbody>{liquidationRows.map((r,i)=>{const line=num(r.line_number);const selectable=bool(r.selectable);const selected=selectedReturnLines.includes(line);return <tr key={`${line}-${i}`} className={`${selected?'selected ':''}${!bool(r.matched)?'unmatched':''}`}><td><input type="checkbox" checked={selected} disabled={!selectable||busy} onChange={()=>toggleReturnLine(line)}/></td><td><b>{text(r.customer_name)||'Boleto não localizado'}</b><small>{text(r.description)||`Documento retorno ${text(r.return_document_number)||'—'}`}</small><small>{text(r.remittance_file)?`Remessa ${text(r.remittance_file)}`:''}</small></td><td><b>{text(r.our_number)||text(r.return_our_number)||'—'}</b><small>{text(r.match_by)==='nosso_numero'?'Localizado pelo Nosso Número':text(r.match_by)==='identificador_remessa'?'Localizado pelo identificador da remessa':'Sem vínculo'}</small></td><td>{date(r.issued_at)}<small>{text(r.remittance_generated_at)?`Arquivo: ${dateTime(r.remittance_generated_at)}`:''}</small></td><td>{date(r.due_date)}</td><td><b>{money(r.boleto_amount||r.return_title_amount)}</b><small>Saldo atual {money(r.remaining)}</small></td><td><b>{date(r.liquidation_date)}</b><small>{text(r.credit_date)?'Data de crédito do retorno':'Data da ocorrência'}</small></td><td><b>{money(r.return_paid_amount||r.boleto_amount)}</b>{num(r.bank_fee)>0?<small>Tarifa {money(r.bank_fee)}</small>:null}</td><td><span className="cnab-occurrence">{text(r.occurrence_code)}</span><small>{text(r.occurrence_label)}</small></td><td><span className={`cnab-review-status ${text(r.review_status)}`}>{reviewStatus(r.review_status)}</span></td></tr>})}</tbody></table></div>}
      {eventSummary.length>0?<div className="cnab-other-events"><div><small>OUTROS EVENTOS DO RETORNO</small><b>Serão registrados sem baixa financeira</b></div><div>{eventSummary.map(([code,item])=><span key={code}><b>{code}</b> {item.label} · {item.count}</span>)}</div></div>:null}
      <footer><div><b>{selectedReturnLines.length} liquidação(ões) selecionada(s)</b><span>Total previsto para baixa: {money(selectedLiquidationTotal)}</span></div><button type="button" onClick={()=>setReviewOpen(false)} disabled={busy}>Voltar</button><button className="primary" type="button" onClick={()=>void confirmReturn()} disabled={busy}>{busy?'Confirmando...':selectedReturnLines.length?`Confirmar importação e baixar ${selectedReturnLines.length} boleto(s)`:'Confirmar importação sem baixas'}</button></footer>
    </section></div>:null}

    {configOpen?<div className="cnab-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfigOpen(false)}}><section className="cnab-modal"><header><div><span>CONVÊNIO DE COBRANÇA</span><h2>Configurar Itaú CNAB</h2><p>Use exatamente os dados contratados no Itaú.</p></div><button type="button" onClick={()=>setConfigOpen(false)}>×</button></header><form onSubmit={saveConfig}><label className="wide">Layout<select name="layout" value={newLayout} onChange={e=>setNewLayout(asLayout(e.target.value))}><option value="cnab240">CNAB 240 — FEBRABAN 240</option><option value="cnab400">CNAB 400 — Itaú 400 posições</option></select></label><label className="wide">Conta bancária<select required name="bank_account_id"><option value="">Selecione...</option>{accounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · Banco {text(a.bank_code)||'—'}</option>)}</select></label><label>Agência<input required name="agency" inputMode="numeric" maxLength={4} placeholder="0057"/></label><label>Conta corrente<input required name="account_number" inputMode="numeric" maxLength={5} placeholder="12345"/></label><label>DAC da conta<input required name="account_digit" inputMode="numeric" maxLength={1} placeholder="6"/></label><label>Carteira<select name="wallet" defaultValue="109" disabled><option value="109">109 — Direta eletrônica sem emissão</option></select></label><label>Espécie<select name="species" defaultValue="01"><option value="01">01 — Duplicata Mercantil</option><option value="05">05 — Recibo</option><option value="06">06 — Contrato</option><option value="08">08 — Duplicata de Serviços</option><option value="17">17 — Conta de Prestação de Serviços</option><option value="99">99 — Diversos</option></select></label><label>Aceite<select name="acceptance" defaultValue="N"><option value="N">N — Não aceito</option><option value="A">A — Aceito</option></select></label><label>Nosso Número inicial<input name="initial_our_number" inputMode="numeric" defaultValue="0" placeholder="Último número utilizado"/></label><div className="actions wide"><button type="button" onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':`Salvar ${layoutLabel(newLayout)}`}</button></div></form></section></div>:null}
  </div>;
}
