'use client';

import { useState,useTransition } from 'react';
import { cashClosureCorrect,cashClosureDetail,cashClosureReopen } from './cash-closure-actions';

type Row=Record<string,unknown>;
type Detail={session:Row;payments:Row[];movements:Row[];sales:Row[];audit:Row[];fiscal:Row;snapshot:Row;canCorrect:boolean;canReopen:boolean;permission:string};
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const duration=(v:unknown)=>{const m=Math.max(0,Math.round(num(v)));const h=Math.floor(m/60);const mm=m%60;return h?`${h}h ${mm}min`:`${mm} min`;};
const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',voucher:'Voucher',store_credit:'Crédito da loja',term_sale:'Venda a prazo',other:'Outros'};
const movementLabels:Record<string,string>={supply:'Suprimento',receivable:'Recebimento',withdrawal:'Sangria',sangria:'Sangria',expense:'Despesa',refund:'Devolução'};

export function CashClosureHistoryPanel({rows,onReload,onMessage}:{rows:Row[];onReload:()=>Promise<void>;onMessage:(message:string)=>void}){
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState('');
  const [correcting,setCorrecting]=useState(false);
  const [reopening,setReopening]=useState(false);
  const [closing,setClosing]=useState('');
  const [reason,setReason]=useState('');
  const [reopenReason,setReopenReason]=useState('');
  const [pending,startTransition]=useTransition();

  async function openDetail(row:Row){
    const id=text(row.cash_session_id);if(!id)return;
    setDetailLoading(`${id}:${text(row.closure_audit_id)}`);
    const r=await cashClosureDetail(id,text(row.closure_audit_id)||undefined);
    setDetailLoading('');
    if(!r.ok){onMessage(text(r.error||'Não foi possível carregar o fechamento.'));return;}
    setDetail({session:r.session,payments:r.payments,movements:r.movements,sales:r.sales,audit:r.audit,fiscal:r.fiscal,snapshot:r.snapshot,canCorrect:r.canCorrect,canReopen:r.canReopen,permission:r.permission});
  }
  function openCorrection(){if(!detail)return;setClosing(num(detail.session.closing_amount).toFixed(2));setReason('');setCorrecting(true);}
  function openReopen(){if(!detail)return;setReopenReason('');setReopening(true);}

  async function saveCorrection(){
    if(!detail)return;
    const value=Number(String(closing).replace(',','.'));
    if(!Number.isFinite(value)||value<0){onMessage('Informe um valor contado válido.');return;}
    if(reason.trim().length<5){onMessage('Informe o motivo da correção com pelo menos 5 caracteres.');return;}
    const r=await cashClosureCorrect(text(detail.session.id),value,reason.trim());
    if(!r.ok){
      const labels:Record<string,string>={permission_denied_cash_correct_closure:'Seu perfil não possui a permissão “Corrigir fechamento de caixa”.',correction_reason_required:'Informe o motivo da correção.',cash_not_closed:'Somente um caixa fechado pode ser corrigido.'};
      onMessage(labels[text(r.error)]||text(r.error||'Não foi possível corrigir o caixa.'));return;
    }
    onMessage(`Fechamento corrigido. Anterior: ${money(r.previous_closing)} · Novo contado: ${money(r.closing)} · Diferença: ${money(r.difference)}.`);
    setCorrecting(false);await onReload();
    const fresh=await cashClosureDetail(text(detail.session.id));
    if(fresh.ok)setDetail({session:fresh.session,payments:fresh.payments,movements:fresh.movements,sales:fresh.sales,audit:fresh.audit,fiscal:fresh.fiscal,snapshot:fresh.snapshot,canCorrect:fresh.canCorrect,canReopen:fresh.canReopen,permission:fresh.permission});
  }

  async function saveReopen(){
    if(!detail)return;
    const why=reopenReason.trim();
    if(why.length<5){onMessage('Informe o motivo da reabertura com pelo menos 5 caracteres.');return;}
    const r=await cashClosureReopen(text(detail.session.id),why);
    if(!r.ok){
      const labels:Record<string,string>={
        permission_denied_cash_correct_closure:'Seu perfil não possui permissão para reabrir fechamento de caixa.',
        reopen_reason_required:'Informe o motivo da reabertura.',
        cash_not_closed:'Este caixa não está mais fechado e não pode ser reaberto.',
        pos_has_another_open_cash:'Não é possível reabrir: já existe outro caixa aberto neste PDV.',
      };
      onMessage(labels[text(r.error)]||text(r.error||'Não foi possível reabrir o caixa.'));return;
    }
    setReopening(false);setReopenReason('');setDetail(null);
    await onReload();
    onMessage('Caixa reaberto com sucesso. A justificativa, o usuário e a data/hora ficaram registrados na auditoria.');
  }

  const countedPayments=detail&&Array.isArray(detail.snapshot.counted_payments)?detail.snapshot.counted_payments as Row[]:[];
  const currentClosed=Boolean(detail&&text(detail.session.record_state)!=='reopened'&&text(detail.session.status)==='closed');

  return <section className="sales-cash-card closure-history-card">
    <div className="sales-cash-section-head"><div><h2>Histórico de fechamentos de caixa</h2><p>Conferência completa de valores, vendas, recebimentos, movimentos, fiscal e auditoria de cada fechamento.</p></div><span>{rows.length} fechamento(s)</span></div>
    <div className="closure-history-table"><table><thead><tr><th>Fechamento</th><th>Caixa</th><th>Operador</th><th>Período</th><th>Vendas</th><th>Recebido</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {rows.length===0?<tr><td colSpan={11} className="sales-cash-empty">Nenhum fechamento encontrado no período.</td></tr>:rows.map((c,i)=>{const loadingKey=`${text(c.cash_session_id)}:${text(c.closure_audit_id)}`;return <tr key={`${text(c.cash_session_id)}-${text(c.closed_at)}-${text(c.closure_audit_id)}-${i}`}>
        <td><strong>{dt(c.closed_at)}</strong><small>{text(c.business_date)?`Competência ${new Date(`${text(c.business_date)}T12:00:00`).toLocaleDateString('pt-BR')}`:''}</small></td>
        <td><strong>{text(c.pos)||'PDV'}</strong><small>{text(c.branch)}</small></td>
        <td>{text(c.operator)||'Não identificado'}</td>
        <td><span>{dt(c.opened_at)}</span><small>{duration(c.duration_minutes)}</small></td>
        <td><strong>{num(c.sales_count)}</strong><small>{money(c.sales_total)}</small></td>
        <td><strong>{money(c.received_total)}</strong><small>Dinheiro {money(c.cash_received)}</small></td>
        <td>{money(c.expected_cash)}</td><td>{money(c.closing_amount)}</td>
        <td className={Math.abs(num(c.difference))>.009?'difference-bad':'difference-ok'}><strong>{money(c.difference)}</strong></td>
        <td>{text(c.record_state)==='reopened'?<span className="cash-state reopened">REABERTO</span>:<span className="cash-state closed">FECHADO</span>}{num(c.correction_count)>0?<small className="closure-corrected-tag">{num(c.correction_count)} correção(ões)</small>:null}{text(c.reopen_reason)?<small>Motivo: {text(c.reopen_reason)}</small>:null}</td>
        <td><button className="sale-detail-button" disabled={detailLoading===loadingKey} onClick={()=>startTransition(()=>{void openDetail(c)})}>{detailLoading===loadingKey||pending?'Carregando...':'Ver detalhes'}</button></td>
      </tr>})}</tbody></table></div>

    {detail&&<div className="closure-detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><aside className="closure-detail-panel">
      <header><div><small>HISTÓRICO DO FECHAMENTO</small><h2>{text(detail.session.pos)||'Caixa'} · {text(detail.session.branch)}</h2><p>{dt(detail.session.opened_at)} → {dt(detail.session.closed_at)} · {text(detail.session.operator)||'Operador não identificado'}</p></div><button type="button" onClick={()=>setDetail(null)}>×</button></header>
      <div className="closure-status-line">
        {text(detail.session.record_state)==='reopened'?<span className="cash-state reopened">REABERTO</span>:<span className="cash-state closed">FECHADO</span>}
        <span>Competência: {text(detail.session.business_date)||'—'}</span><span>Duração: {duration(detail.session.duration_minutes)}</span>
        {currentClosed&&detail.canCorrect?<button className="closure-correct-button" onClick={openCorrection}>Corrigir caixa</button>:null}
        {currentClosed&&detail.canReopen?<button className="closure-reopen-button" onClick={openReopen}>Reabrir caixa</button>:null}
        {!detail.canCorrect&&!detail.canReopen?<span className="closure-permission-lock">🔒 Alterações exigem {detail.permission}</span>:null}
      </div>
      {text(detail.session.record_state)==='reopened'?<div className="closure-reopened-note"><strong>Este fechamento foi reaberto em {dt(detail.session.reopened_at)}.</strong><span>Motivo: {text(detail.session.reopen_reason)||'Não informado'}</span></div>:null}
      <section className="closure-summary-grid"><div><span>Fundo inicial</span><strong>{money(detail.session.opening_amount)}</strong></div><div><span>Vendas</span><strong>{money(detail.session.sales_total)}</strong><small>{num(detail.session.sales_count)} concluída(s)</small></div><div><span>Total recebido</span><strong>{money(detail.session.received_total)}</strong></div><div><span>Esperado em espécie</span><strong>{money(detail.session.expected_cash)}</strong></div><div><span>Contado</span><strong>{money(detail.session.closing_amount)}</strong></div><div className={Math.abs(num(detail.session.difference))>.009?'alert':'ok'}><span>Diferença</span><strong>{money(detail.session.difference)}</strong></div></section>

      {countedPayments.length>0?<details open><summary>Conferência registrada no fechamento <b>{countedPayments.length}</b></summary><div className="closure-reconciliation-table"><div className="closure-reconciliation-row head"><span>Forma</span><span>Sistema</span><span>Conferido</span><span>Diferença</span></div>{countedPayments.map((p,i)=><div className="closure-reconciliation-row" key={`${text(p.method)}-${i}`}><strong>{paymentLabels[text(p.method)]||text(p.method)}</strong><span>{money(p.expected)}</span><span>{money(p.counted)}</span><b className={Math.abs(num(p.difference))>.009?'difference-bad':'difference-ok'}>{money(p.difference)}</b></div>)}</div></details>:null}

      <details open><summary>Formas de pagamento do sistema <b>{detail.payments.length}</b></summary><div className="closure-payment-grid">{detail.payments.length===0?<p>Sem pagamentos registrados.</p>:detail.payments.map((p,i)=><article key={`${text(p.method)}-${text(p.status)}-${i}`}><span>{paymentLabels[text(p.method)]||text(p.method)}</span><strong>{money(p.amount)}</strong><small>{num(p.payment_count||p.count)} lançamento(s){text(p.status)?` · ${text(p.status)}`:''}</small>{num(p.change_amount)>0?<small>Troco: {money(p.change_amount)}</small>:null}</article>)}</div></details>

      <details open><summary>Movimentos de caixa <b>{detail.movements.length}</b></summary><div className="closure-detail-table"><table><thead><tr><th>Data</th><th>Tipo</th><th>Forma</th><th>Observação</th><th>Valor</th></tr></thead><tbody>{detail.movements.length===0?<tr><td colSpan={5}>Nenhum movimento adicional.</td></tr>:detail.movements.map((m,i)=><tr key={text(m.id)||String(i)}><td>{dt(m.created_at)}</td><td>{movementLabels[text(m.movement_type)]||text(m.movement_type)}</td><td>{paymentLabels[text(m.payment_method)]||text(m.payment_method)||'—'}</td><td>{text(m.notes)||'—'}</td><td>{money(m.amount)}</td></tr>)}</tbody></table></div></details>

      <details><summary>Vendas até este fechamento <b>{detail.sales.length}</b></summary><div className="closure-detail-table"><table><thead><tr><th>Venda</th><th>Data</th><th>Operador</th><th>Status no fechamento</th><th>Fiscal</th><th>Total</th></tr></thead><tbody>{detail.sales.map((s,i)=><tr key={text(s.id)||String(i)}><td>#{text(s.number)}</td><td>{dt(s.occurred_at)}</td><td>{text(s.operator)||'—'}</td><td>{text(s.status)}</td><td>{text(s.document_type)?`${text(s.document_type).toUpperCase()} · ${text(s.fiscal_status)}`:'Não fiscal'}</td><td>{money(s.total)}</td></tr>)}</tbody></table></div></details>

      <details open><summary>Resumo fiscal</summary><div className="closure-fiscal-grid"><span>Total documentos <b>{num(detail.fiscal.total)}</b></span><span>Autorizados <b>{num(detail.fiscal.authorized)}</b></span><span>Cancelados <b>{num(detail.fiscal.cancelled)}</b></span><span>Rejeitados <b>{num(detail.fiscal.rejected)}</b></span><span>Pendentes <b>{num(detail.fiscal.pending)}</b></span><span>NFC-e / NF-e <b>{num(detail.fiscal.nfce)} / {num(detail.fiscal.nfe)}</b></span></div></details>

      <details open><summary>Auditoria, correções e reaberturas <b>{detail.audit.length}</b></summary><div className="closure-audit-list">{detail.audit.length===0?<p>Nenhuma intervenção administrativa registrada.</p>:detail.audit.map((a,i)=><article key={text(a.id)||String(i)}><div><strong>{text(a.action_label)||text(a.action)}</strong><span>{dt(a.created_at)}</span></div><p>{text(a.reason)||'Sem observação.'}</p><small>{text(a.actor_email)||'Sistema'}{a.previous_closing_amount!=null||a.new_closing_amount!=null?` · ${a.previous_closing_amount==null?'—':money(a.previous_closing_amount)} → ${a.new_closing_amount==null?'—':money(a.new_closing_amount)}`:''}</small></article>)}</div></details>
      {text(detail.session.notes)?<details><summary>Observações da sessão</summary><pre className="closure-notes">{text(detail.session.notes)}</pre></details>:null}
    </aside></div>}

    {correcting&&detail&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal closure-correction-modal"><small>CORREÇÃO AUDITADA</small><h3>Corrigir fechamento de caixa</h3><p>Esta operação altera somente o valor contado do fechamento. Vendas, pagamentos, sangrias, suprimentos e demais movimentos permanecem intactos.</p><div className="closure-correction-compare"><div><span>Esperado</span><strong>{money(detail.session.expected_cash)}</strong></div><div><span>Contado atual</span><strong>{money(detail.session.closing_amount)}</strong></div></div><label><span>Novo valor contado *</span><input autoFocus type="number" min="0" step="0.01" value={closing} onChange={e=>setClosing(e.target.value)}/></label><label><span>Motivo da correção *</span><textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explique por que o fechamento precisa ser corrigido..."/></label><div className="closure-audit-warning">A alteração ficará registrada com usuário, data/hora, valor anterior, novo valor e justificativa.</div><div className="sales-cash-modal-actions"><button type="button" onClick={()=>setCorrecting(false)}>Cancelar</button><button type="button" className="primary" disabled={pending} onClick={()=>startTransition(()=>{void saveCorrection()})}>{pending?'Corrigindo...':'Confirmar correção'}</button></div></section></div>}

    {reopening&&detail&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal closure-reopen-modal"><small>REABERTURA AUDITADA</small><h3>Reabrir este caixa?</h3><p>O fechamento será preservado no histórico como <b>REABERTO</b> e a sessão voltará ao estado aberto para que as correções necessárias possam ser realizadas.</p><div className="closure-correction-compare"><div><span>Fechado em</span><strong className="date-value">{dt(detail.session.closed_at)}</strong></div><div><span>Valor contado</span><strong>{money(detail.session.closing_amount)}</strong></div></div><label><span>Motivo da reabertura *</span><textarea autoFocus rows={4} value={reopenReason} onChange={e=>setReopenReason(e.target.value)} placeholder="Ex.: divergência identificada após o fechamento, lançamento faltante..."/></label><div className="closure-reopen-warning"><strong>Importante</strong><span>O motivo, usuário e horário serão gravados na auditoria. A reabertura é bloqueada se já existir outro caixa aberto no mesmo PDV.</span></div><div className="sales-cash-modal-actions"><button type="button" onClick={()=>setReopening(false)}>Cancelar</button><button type="button" className="primary closure-reopen-confirm" disabled={pending||reopenReason.trim().length<5} onClick={()=>startTransition(()=>{void saveReopen()})}>{pending?'Reabrindo...':'Confirmar reabertura'}</button></div></section></div>}
  </section>;
}
