'use client';

import { useMemo,useState } from 'react';
import type { CnabLayout } from './bank-cnab-actions';
import { confirmCnabReturnImport,reviewCnabReturn } from './bank-cnab-return-review-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const bool=(v:unknown)=>v===true||v==='true';
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const layout=(v:unknown):CnabLayout=>text(v)==='cnab240'?'cnab240':'cnab400';
const layoutLabel=(v:unknown)=>layout(v)==='cnab240'?'CNAB 240':'CNAB 400';
const statusLabel=(r:Row)=>{
  if(!bool(r.matched))return 'Boleto não localizado';
  if(bool(r.is_liquidation)){
    if(text(r.review_status)==='already_paid')return 'Já quitado';
    if(text(r.review_status)==='cancelled')return 'Título cancelado';
    if(bool(r.selectable))return 'Pronto para baixa';
    return 'Liquidação bloqueada';
  }
  if(text(r.occurrence_code)==='02')return 'Entrada confirmada';
  if(text(r.occurrence_code)==='03')return 'Entrada rejeitada';
  if(text(r.occurrence_code)==='09')return 'Baixa simples';
  return text(r.occurrence_label)||'Evento bancário';
};

export function BankCnabReturnReviewPanelV2({initial}:{initial:Row}){
  const configs=Array.isArray(initial.configs)?initial.configs as Row[]:[];
  const [configId,setConfigId]=useState(text(configs[0]?.id));
  const active=useMemo(()=>configs.find(c=>text(c.id)===configId),[configs,configId]);
  const activeLayout=layout(active?.layout);
  const [file,setFile]=useState<File|null>(null);
  const [content,setContent]=useState('');
  const [review,setReview]=useState<Row|null>(null);
  const [selected,setSelected]=useState<number[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const rows=useMemo(()=>Array.isArray(review?.details)?review!.details as Row[]:[],[review]);
  const liquidations=useMemo(()=>rows.filter(r=>bool(r.is_liquidation)),[rows]);
  const otherEvents=useMemo(()=>rows.filter(r=>!bool(r.is_liquidation)),[rows]);
  const matchedRows=useMemo(()=>rows.filter(r=>bool(r.matched)),[rows]);
  const unmatchedRows=useMemo(()=>rows.filter(r=>!bool(r.matched)),[rows]);
  const selectable=useMemo(()=>liquidations.filter(r=>bool(r.selectable)).map(r=>num(r.line_number)),[liquidations]);
  const selectedTotal=useMemo(()=>liquidations.filter(r=>selected.includes(num(r.line_number))).reduce((s,r)=>s+num(r.return_paid_amount||r.boleto_amount),0),[liquidations,selected]);

  function reset(){setContent('');setReview(null);setSelected([]);setMessage('');}
  function toggle(line:number){setSelected(s=>s.includes(line)?s.filter(x=>x!==line):[...s,line]);}
  function toggleAll(){setSelected(s=>s.length===selectable.length?[]:selectable);}

  async function analyze(){
    if(!active){setMessage('Selecione o convênio CNAB.');return;}
    if(!file){setMessage('Selecione um arquivo de retorno .RET.');return;}
    setBusy(true);setMessage('');
    let raw='';try{raw=await file.text();}catch{setBusy(false);setMessage('Não foi possível ler o arquivo.');return;}
    const result=await reviewCnabReturn(activeLayout,configId,raw);setBusy(false);
    if(!result.ok){setMessage(text(result.detail||result.error||'Não foi possível analisar o retorno.'));return;}
    if(result.already_imported){setMessage('Este arquivo já foi importado anteriormente. Nenhuma baixa será duplicada.');return;}
    const parsed=Array.isArray(result.details)?result.details as Row[]:[];
    setContent(raw);setReview(result);setSelected(parsed.filter(r=>bool(r.selected_default)).map(r=>num(r.line_number)));
  }

  async function confirm(){
    if(!file||!review||!content||!active)return;
    setBusy(true);setMessage('');
    const result=await confirmCnabReturnImport(activeLayout,configId,file.name,content,selected);setBusy(false);
    if(!result.ok){setMessage(text(result.detail||result.error||'Falha ao confirmar o retorno.'));return;}
    if(result.already_imported){setMessage('Este retorno já havia sido importado. Nenhuma baixa foi duplicada.');return;}
    setMessage(`Importação concluída: ${text(result.matched_count)} boleto(s) localizado(s), ${text(result.paid_count)} quitado(s) e ${text(result.error_count)} pendência(s).`);
    setReview(null);setContent('');setSelected([]);setFile(null);
  }

  function table(list:Row[],liquidation:boolean){
    return <div className="cnab-ret-v2-table"><table><thead><tr>{liquidation?<th></th>:null}<th>Cliente / título</th><th>Nosso Número</th><th>Emissão</th><th>Vencimento</th><th>Valor boleto</th>{liquidation?<><th>Liquidação</th><th>Valor liquidado</th></>:null}<th>Ocorrência</th><th>Localização</th></tr></thead><tbody>{list.map((r,i)=>{const line=num(r.line_number);const checked=selected.includes(line);return <tr key={`${line}-${i}`} className={`${bool(r.matched)?'matched':'unmatched'} ${checked?'selected':''}`}>{liquidation?<td><input type="checkbox" checked={checked} disabled={!bool(r.selectable)||busy} onChange={()=>toggle(line)}/></td>:null}<td><b>{text(r.customer_name)||'Boleto não localizado'}</b><small>{text(r.description)||`Documento ${text(r.return_document_number)||'—'}`}</small>{text(r.remittance_file)?<small>Remessa: {text(r.remittance_file)}</small>:null}</td><td><b>{text(r.our_number)||text(r.return_our_number)||'—'}</b><small>{text(r.match_by)==='identificador_remessa'?'Identificador TH...':text(r.match_by)==='nosso_numero'?'Nosso Número':'Sem vínculo'}</small></td><td>{date(r.issued_at)}</td><td>{date(r.due_date)}</td><td><b>{money(r.boleto_amount||r.return_title_amount)}</b></td>{liquidation?<><td>{date(r.liquidation_date)}</td><td><b>{money(r.return_paid_amount||r.boleto_amount)}</b></td></>:null}<td><span className="cnab-ret-v2-occ">{text(r.occurrence_code)||'—'}</span><small>{text(r.occurrence_label)}</small></td><td><span className={`cnab-ret-v2-status ${bool(r.matched)?'ok':'error'}`}>{statusLabel(r)}</span></td></tr>})}</tbody></table></div>;
  }

  return <section className="cnab-panel cnab-ret-v2">
    <header><div><span>ARQUIVO RETORNO · CONFERÊNCIA</span><h2>Localizar boletos antes de importar</h2><p>Todos os eventos do retorno são exibidos individualmente. Somente liquidações selecionadas podem gerar baixa financeira.</p></div></header>
    <div className="cnab-ret-v2-controls"><label>Convênio<select value={configId} onChange={e=>{setConfigId(e.target.value);reset();}}>{configs.map(c=><option key={text(c.id)} value={text(c.id)}>{layoutLabel(c.layout)} · {text(c.account_name)} · Ag. {text(c.agency)} · Conta {text(c.account_number)}-{text(c.account_digit)}</option>)}</select></label><label className="file">Arquivo .RET<input type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>{setFile(e.target.files?.[0]||null);reset();}}/><span>{file?.name||'Selecionar retorno do banco'}</span></label><button className="primary" type="button" disabled={busy||!file||!active} onClick={()=>void analyze()}>{busy?'Analisando...':'Analisar e localizar boletos'}</button></div>
    {message?<div className="cnab-ret-v2-message">{message}</div>:null}
    {review?<div className="cnab-ret-v2-review">
      <div className="cnab-ret-v2-summary"><article><span>Registros do retorno</span><b>{rows.length}</b></article><article><span>Boletos localizados</span><b>{matchedRows.length}</b></article><article className={unmatchedRows.length?'warn':''}><span>Não localizados</span><b>{unmatchedRows.length}</b></article><article><span>Liquidações</span><b>{liquidations.length}</b></article><article><span>Selecionados para baixa</span><b>{selected.length}</b><small>{money(selectedTotal)}</small></article></div>
      {liquidations.length?<><div className="cnab-ret-v2-head"><div><small>LIQUIDAÇÕES</small><h3>Boletos pagos informados pelo banco</h3></div>{selectable.length?<button type="button" onClick={toggleAll}>{selected.length===selectable.length?'Desmarcar todos':'Selecionar todos aptos'}</button>:null}</div>{table(liquidations,true)}</>:null}
      {otherEvents.length?<><div className="cnab-ret-v2-head"><div><small>OUTROS EVENTOS BANCÁRIOS</small><h3>Títulos encontrados no arquivo</h3><p>Entrada confirmada, rejeição, baixa simples e outros eventos aparecem aqui sem serem confundidos com pagamento.</p></div></div>{table(otherEvents,false)}</>:null}
      <footer><div><b>{matchedRows.length} de {rows.length} título(s) localizado(s)</b><span>{selected.length?`${selected.length} liquidação(ões) serão baixadas após sua confirmação.`:'Nenhuma baixa financeira será realizada.'}</span></div><button type="button" onClick={()=>{setReview(null);setContent('');setSelected([]);}} disabled={busy}>Voltar</button><button className="primary" type="button" onClick={()=>void confirm()} disabled={busy}>{busy?'Confirmando...':selected.length?`Confirmar importação e baixar ${selected.length} boleto(s)`:'Confirmar importação sem baixas'}</button></footer>
    </div>:null}
  </section>;
}
