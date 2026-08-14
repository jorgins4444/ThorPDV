'use client';

import { useState,useTransition } from 'react';
import { cashClosureCorrect,cashClosureDetail } from './cash-closure-actions';

type Row=Record<string,unknown>;
type Detail={session:Row;payments:Row[];movements:Row[];sales:Row[];audit:Row[];fiscal:Row;canCorrect:boolean;permission:string};
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const duration=(v:unknown)=>{const m=Math.max(0,Math.round(num(v)));const h=Math.floor(m/60);const mm=m%60;return h?`${h}h ${mm}min`:`${mm} min`;};
const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',voucher:'Voucher',store_credit:'Crédito da loja',other:'Outros'};
const movementLabels:Record<string,string>={supply:'Suprimento',receivable:'Recebimento',withdrawal:'Sangria',sangria:'Sangria',expense:'Despesa',refund:'Devolução'};

export function CashClosureHistoryPanel({rows,onReload,onMessage}:{rows:Row[];onReload:()=>Promise<void>;onMessage:(message:string)=>void}){
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState('');
  const [correcting,setCorrecting]=useState(false);
  const [closing,setClosing]=useState('');
  const [reason,setReason]=useState('');
  const [pending,startTransition]=useTransition();

  async function openDetail(row:Row){
    const id=text(row.cash_session_id);if(!id)return;
    setDetailLoading(id);
    const r=await cashClosureDetail(id);
    setDetailLoading('');
    if(!r.ok){onMessage(text(r.error||'Não foi possível carregar o fechamento.'));return;}
    setDetail({session:r.session,payments:r.payments,movements:r.movements,sales:r.sales,audit:r.audit,fiscal:r.fiscal,canCorrect:r.canCorrect,permission:r.permission});
  }
  function openCorrection(){if(!detail)return;setClosing(num(detail.session.closing_amount).toFixed(2));setReason('');setCorrecting(true);}
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
    if(fresh.ok)setDetail({session:fresh.session,payments:fresh.payments,movements:fresh.movements,sales:fresh.sales,audit:fresh.audit,fiscal:fresh.fiscal,canCorrect:fresh.canCorrect,permission:fresh.permission});
  }

  return <section className="sales-cash-card closure-history-card">
    <div className="sales-cash-section-head"><div><h2>Histórico de fechamentos de caixa</h2><p>Conferência completa de valores, vendas, recebimentos, movimentos, fiscal e auditoria de cada fechamento.</p></div><span>{rows.length} fechamento(s)</span></div>
    <div className="closure-history-table"><table><thead><tr><th>Fechamento</th><th>Caixa</th><th>Operador</th><th>Período</th><th>Vendas</th><th>Recebido</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {rows.length===0?<tr><td colSpan={11} className="sales-cash-empty">Nenhum fechamento encontrado no período.</td></tr>:rows.map((c,i)=><tr key={`${text(c.cash_session_id)}-${text(c.closed_at)}-${i}`}>
        <td><strong>{dt(c.closed_at)}</strong><small>{text(c.business_date)?`Competência ${new Date(`${text(c.business_date)}T12:00:00`).toLocaleDateString('pt-BR')}`:''}</small></td>
        <td><strong>{text(c.pos)||'PDV'}</strong><small>{text(c.branch)}</small></td>
        <td>{text(c.operator)||'Não identificado'}</td>
        <td><span>{dt(c.opened_at)}</span><small>{duration(c.duration_minutes)}</small></td>
        <td><strong>{num(c.sales_count)}</strong><small>{money(c.sales_total)}</small></td>
        <td><strong>{money(c.received_total)}</strong><small>Dinheiro {money(c.cash_received)}</small></td>
        <td>{money(c.expected_cash)}</td><td>{money(c.closing_amount)}</td>
        <td className={Math.abs(num(c.difference))>.009?'difference-bad':'difference-ok'}><strong>{money(c.difference)}</strong></td>
        <td>{text(c.record_state)==='reopened'?<span className="cash-state reopened">REABERTO</span>:<span className="cash-state closed">FECHADO</span>}{num(c.correction_count)>0?<small className="closure-corrected-tag">{num(c.correction_count)} correção(ões)</small>:null}</td>
        <td><button className="sale-detail-button" disabled={detailLoading===text(c.cash_session_id)} onClick={()=>startTransition(()=>{void openDetail(c)})}>{detailLoading===text(c.cash_session_id)||pending?'Carregando...':'Ver detalhes'}</button></td>
      </tr>)}</tbody></table></div>

    {detail&&<div className="closure-detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><aside className="closure-detail-panel">
      <header><div><small>HISTÓRICO DO FECHAMENTO</small><h2>{text(detail.session.pos)||'Caixa'} · {text(detail.session.branch)}</h2><p>{dt(detail.session.opened_at)} → {dt(detail.session.closed_at)} · {text(detail.session.operator)||'Operador não identificado'}</p></div><button type="button" onClick={()=>setDetail(null)}>×</button></header>
      <div className="closure-status-line"><span className={`cash-state ${text(detail.session.status)==='closed'?'closed':'open'}`}>{text(detail.session.status)==='closed'?'FECHADO':'ABERTO'}</span><span>Competência: {text(detail.session.business_date)||'—'}</span><span>Duração: {duration(detail.session.duration_minutes)}</span>{detail.canCorrect&&text(detail.session.status)==='closed'?<button className="closure-correct-button" onClick={openCorrection}>Corrigir caixa</button>:<span className="closure-permission-lock">🔒 Correção exige {detail.permission}</span>}</div>
      <section className="closure-summary-grid"><div><span>Fundo inicial</span><strong>{money(detail.session.opening_amount)}</strong></div><div><span>Vendas</span><strong>{money(detail.session.sales_total)}</strong><small>{num(detail.session.sales_count)} concluída(s)</small></div><div><span>Total recebido</span><strong>{money(detail.session.received_total)}</strong></div><div><span>Esperado em espécie</span><strong>{money(detail.session.expected_cash)}</strong></div><div><span>Contado</span><strong>{money(detail.session.closing_amount)}</strong></div><div className={Math.abs(num(detail.session.difference))>.009?'alert':'ok'}><span>Diferença</span><strong>{money(detail.session.difference)}</strong></div></section>

      <details open><summary>Formas de pagamento <b>{detail.payments.length}</b></summary><div className="closure-payment-grid">{detail.payments.length===0?<p>Sem pagamentos registrados.</p>:detail.payments.map((p,i)=><article key={`${text(p.method)}-${text(p.status)}-${i}`}><span>{paymentLabels[text(p.method)]||text(p.method)}</span><strong>{money(p.amount)}</strong><small>{num(p.payment_count)} lançamento(s) · {text(p.status)}</small>{num(p.change_amount)>0?<small>Troco: {money(p.change_amount)}</small>:null}</article>)}</div></details>

      <details open><summary>Movimentos de caixa <b>{detail.movements.length}</b></summary><div className="closure-detail-table"><table><thead><tr><th>Data</th><th>Tipo</th><th>Forma</th><th>Observação</th><th>Valor</th></tr></thead><tbody>{detail.movements.length===0?<tr><td colSpan={5}>Nenhum movimento adicional.</td></tr>:detail.movements.map((m,i)=><tr key={text(m.id)||String(i)}><td>{dt(m.created_at)}</td><td>{movementLabels[text(m.movement_type)]||text(m.movement_type)}</td><td>{paymentLabels[text(m.payment_method)]||text(m.payment_method)||'—'}</td><td>{text(m.notes)||'—'}</td><td>{money(m.amount)}</td></tr>)}</tbody></table></div></details>

      <details><summary>Vendas da sessão <b>{detail.sales.length}</b></summary><div className="closure-detail-table"><table><thead><tr><th>Venda</th><th>Data</th><th>Operador</th><th>Status</th><th>Fiscal</th><th>Total</th></tr></thead><tbody>{detail.sales.map((s,i)=><tr key={text(s.id)||String(i)}><td>#{text(s.number)}</td><td>{dt(s.occurred_at)}</td><td>{text(s.operator)||'—'}</td><td>{text(s.status)}</td><td>{text(s.document_type)?`${text(s.document_type).toUpperCase()} · ${text(s.fiscal_status)}`:'Não fiscal'}</td><td>{money(s.total)}</td></tr>)}</tbody></table></div></details>

      <details open><summary>Resumo fiscal</summary><div className="closure-fiscal-grid"><span>Total documentos <b>{num(detail.fiscal.total)}</b></span><span>Autorizados <b>{num(detail.fiscal.authorized)}</b></span><span>Cancelados <b>{num(detail.fiscal.cancelled)}</b></span><span>Rejeitados <b>{num(detail.fiscal.rejected)}</b></span><span>Pendentes <b>{num(detail.fiscal.pending)}</b></span><span>NFC-e / NF-e <b>{num(detail.fiscal.nfce)} / {num(detail.fiscal.nfe)}</b></span></div></details>

      <details open><summary>Auditoria e correções <b>{detail.audit.length}</b></summary><div className="closure-audit-list">{detail.audit.length===0?<p>Nenhuma intervenção administrativa registrada.</p>:detail.audit.map((a,i)=><article key={text(a.id)||String(i)}><div><strong>{text(a.action_label)||text(a.action)}</strong><span>{dt(a.created_at)}</span></div><p>{text(a.reason)||'Sem observação.'}</p><small>{text(a.actor_email)||'Sistema'}{a.previous_closing_amount!=null||a.new_closing_amount!=null?` · ${money(a.previous_closing_amount)} → ${a.new_closing_amount==null?'—':money(a.new_closing_amount)}`:''}</small></article>)}</div></details>
      {text(detail.session.notes)?<details><summary>Observações da sessão</summary><pre className="closure-notes">{text(detail.session.notes)}</pre></details>:null}
    </aside></div>}

    {correcting&&detail&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal closure-correction-modal"><small>CORREÇÃO AUDITADA</small><h3>Corrigir fechamento de caixa</h3><p>Esta operação altera somente o valor contado do fechamento. Vendas, pagamentos, sangrias, suprimentos e demais movimentos permanecem intactos.</p><div className="closure-correction-compare"><div><span>Esperado</span><strong>{money(detail.session.expected_cash)}</strong></div><div><span>Contado atual</span><strong>{money(detail.session.closing_amount)}</strong></div></div><label><span>Novo valor contado *</span><input autoFocus type="number" min="0" step="0.01" value={closing} onChange={e=>setClosing(e.target.value)}/></label><label><span>Motivo da correção *</span><textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explique por que o fechamento precisa ser corrigido..."/></label><div className="closure-audit-warning">A alteração ficará registrada com usuário, data/hora, valor anterior, novo valor e justificativa.</div><div className="sales-cash-modal-actions"><button type="button" onClick={()=>setCorrecting(false)}>Cancelar</button><button type="button" className="primary" disabled={pending} onClick={()=>startTransition(()=>{void saveCorrection()})}>{pending?'Corrigindo...':'Confirmar correção'}</button></div></section></div>}
  </section>;
}
