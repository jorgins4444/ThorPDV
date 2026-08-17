'use client';

import { useState,useTransition } from 'react';
import { cashClosureCorrect,cashClosureDetail,cashClosureReopen } from './cash-closure-actions';

type Row=Record<string,unknown>;
type Detail={session:Row;payments:Row[];movements:Row[];sales:Row[];returns:Row[];audit:Row[];fiscal:Row;snapshot:Row;canCorrect:boolean;canReopen:boolean;permission:string};
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const duration=(v:unknown)=>{const m=Math.max(0,Math.round(num(v)));const h=Math.floor(m/60);const mm=m%60;return h?`${h}h ${mm}min`:`${mm} min`;};
const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',voucher:'Voucher',store_credit:'Crédito da loja',store_credit_voucher:'Vale Crédito',term_sale:'Venda a prazo',other:'Outros'};
const movementLabels:Record<string,string>={supply:'Suprimento',receivable:'Recebimento',withdrawal:'Sangria',sangria:'Sangria',expense:'Despesa',refund:'Devolução'};
const saleStatusLabels:Record<string,string>={completed:'Concluída',cancelled:'Cancelada',pending:'Pendente',open:'Aberta',draft:'Rascunho',processing:'Processando',failed:'Falhou',rejected:'Rejeitada',pending_sync:'Pendente de sincronização',fiscal_pending:'Pendência fiscal'};
const fiscalStatusLabels:Record<string,string>={authorized:'Autorizada',cancelled:'Cancelada',rejected:'Rejeitada',pending:'Pendente',processing:'Processando',draft:'Rascunho',prepared:'Preparada',sending:'Enviando',error:'Erro',contingency:'Contingência'};
const statusLabel=(value:unknown,labels:Record<string,string>)=>{const raw=text(value);return labels[raw]||raw.replaceAll('_',' ');};
const hasValue=(v:unknown)=>Math.abs(num(v))>.009;
const saleItems=(sale:Row)=>Array.isArray(sale.items)?sale.items as Row[]:[];
const returnItems=(row:Row)=>Array.isArray(row.items)?row.items as Row[]:[];

export function CashClosureHistoryPanel({rows,onReload,onMessage}:{rows:Row[];onReload:()=>Promise<void>;onMessage:(message:string)=>void}){
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState('');
  const [correcting,setCorrecting]=useState(false);
  const [reopening,setReopening]=useState(false);
  const [expandedSale,setExpandedSale]=useState('');
  const [closing,setClosing]=useState('');
  const [reason,setReason]=useState('');
  const [reopenReason,setReopenReason]=useState('');
  const [pending,startTransition]=useTransition();

  async function openDetail(row:Row){
    const id=text(row.cash_session_id);if(!id)return;
    const key=`${id}:${text(row.closure_audit_id)}`;
    setDetailLoading(key);setExpandedSale('');
    const r=await cashClosureDetail(id,text(row.closure_audit_id)||undefined);
    setDetailLoading('');
    if(!r.ok){onMessage(text(r.error||'Não foi possível carregar o fechamento.'));return;}
    setDetail({session:r.session,payments:r.payments,movements:r.movements,sales:r.sales,returns:r.returns,audit:r.audit,fiscal:r.fiscal,snapshot:r.snapshot,canCorrect:r.canCorrect,canReopen:r.canReopen,permission:r.permission});
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
    if(fresh.ok)setDetail({session:fresh.session,payments:fresh.payments,movements:fresh.movements,sales:fresh.sales,returns:fresh.returns,audit:fresh.audit,fiscal:fresh.fiscal,snapshot:fresh.snapshot,canCorrect:fresh.canCorrect,canReopen:fresh.canReopen,permission:fresh.permission});
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

  const countedPayments=(detail&&Array.isArray(detail.snapshot.counted_payments)?detail.snapshot.counted_payments as Row[]:[])
    .filter(p=>hasValue(p.expected)||hasValue(p.counted)||hasValue(p.difference));
  const visiblePayments=(detail?.payments||[]).filter(p=>hasValue(p.amount)||num(p.payment_count||p.count)>0);
  const visibleMovements=(detail?.movements||[]).filter(m=>hasValue(m.amount));
  const visibleAudit=(detail?.audit||[]).filter(a=>text(a.action)==='management_reopen'||text(a.action)==='management_correct'||Boolean(text(a.reason).trim()));
  const fiscalTotal=num(detail?.fiscal.total);
  const currentClosed=Boolean(detail&&text(detail.session.record_state)!=='reopened'&&text(detail.session.status)==='closed');
  const notes=text(detail?.session.notes).trim();

  return <section className="sales-cash-card closure-history-card">
    <div className="sales-cash-section-head"><div><h2>Histórico de fechamentos de caixa</h2><p>Consulte os valores principais de cada fechamento e reabra somente quando precisar corrigir a operação.</p></div><span>{rows.length} fechamento(s)</span></div>
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
        <td>{text(c.record_state)==='reopened'?<span className="cash-state reopened">REABERTO</span>:<span className="cash-state closed">FECHADO</span>}{num(c.correction_count)>0?<small className="closure-corrected-tag">{num(c.correction_count)} correção(ões)</small>:null}</td>
        <td><button className="sale-detail-button" disabled={detailLoading===loadingKey} onClick={()=>startTransition(()=>{void openDetail(c)})}>{detailLoading===loadingKey?'Carregando...':'Ver detalhes'}</button></td>
      </tr>})}</tbody></table></div>

    {detail&&<div className="closure-detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><aside className="closure-detail-panel closure-practical-panel">
      <header><div><small>FECHAMENTO DE CAIXA</small><h2>{text(detail.session.pos)||'Caixa'} · {text(detail.session.branch)}</h2><p>{dt(detail.session.opened_at)} → {dt(detail.session.closed_at)} · {text(detail.session.operator)||'Operador não identificado'}</p></div><button type="button" aria-label="Fechar" onClick={()=>setDetail(null)}>×</button></header>

      <div className="closure-practical-toolbar">
        <div className="closure-practical-status">
          {text(detail.session.record_state)==='reopened'?<span className="cash-state reopened">REABERTO</span>:<span className="cash-state closed">FECHADO</span>}
          <span>Competência {text(detail.session.business_date)||'—'}</span>
          <span>{duration(detail.session.duration_minutes)}</span>
          <span>Fundo inicial {money(detail.session.opening_amount)}</span>
        </div>
        {currentClosed&&(detail.canCorrect||detail.canReopen)?<div className="closure-practical-actions">
          {detail.canCorrect?<button className="closure-correct-button" onClick={openCorrection}>Corrigir valor</button>:null}
          {detail.canReopen?<button className="closure-reopen-button" onClick={openReopen}>Reabrir caixa</button>:null}
        </div>:null}
      </div>

      {text(detail.session.record_state)==='reopened'?<div className="closure-reopened-note"><strong>Fechamento reaberto em {dt(detail.session.reopened_at)}</strong><span>{text(detail.session.reopen_reason)||'Motivo não informado'}</span></div>:null}

      <section className="closure-practical-summary">
        <article><span>Vendas</span><strong>{money(detail.session.sales_total)}</strong><small>{num(detail.session.sales_count)} venda(s)</small></article>
        <article><span>Total recebido</span><strong>{money(detail.session.received_total)}</strong></article>
        {num(detail.session.returns_count)>0?<article><span>Devoluções</span><strong>{money(detail.session.returns_total)}</strong><small>{num(detail.session.returns_count)} operação(ões) · crédito/vale</small></article>:null}
        <article><span>Dinheiro esperado</span><strong>{money(detail.session.expected_cash)}</strong></article>
        <article><span>Dinheiro contado</span><strong>{money(detail.session.closing_amount)}</strong></article>
        <article className={Math.abs(num(detail.session.difference))>.009?'difference':'balanced'}><span>Diferença</span><strong>{money(detail.session.difference)}</strong><small>{Math.abs(num(detail.session.difference))>.009?'Divergência no fechamento':'Caixa conferido'}</small></article>
      </section>

      {(countedPayments.length>0||visiblePayments.length>0)?<section className="closure-practical-section">
        <div className="closure-practical-section-title"><div><small>CONFERÊNCIA</small><h3>Formas de pagamento</h3></div><span>{countedPayments.length||visiblePayments.length} forma(s)</span></div>
        {countedPayments.length>0?<div className="closure-practical-payments-table">
          <div className="head"><span>Forma</span><span>Sistema</span><span>Conferido</span><span>Diferença</span></div>
          {countedPayments.map((p,i)=><div key={`${text(p.method)}-${i}`}><strong>{paymentLabels[text(p.method)]||text(p.method)}</strong><span>{money(p.expected)}</span><span>{money(p.counted)}</span><b className={Math.abs(num(p.difference))>.009?'difference-bad':'difference-ok'}>{money(p.difference)}</b></div>)}
        </div>:<div className="closure-practical-payment-cards">{visiblePayments.map((p,i)=><article key={`${text(p.method)}-${i}`}><span>{paymentLabels[text(p.method)]||text(p.method)}</span><strong>{money(p.amount)}</strong>{num(p.payment_count||p.count)>0?<small>{num(p.payment_count||p.count)} lançamento(s)</small>:null}</article>)}</div>}
      </section>:null}

      {detail.sales.length>0?<section className="closure-practical-section closure-practical-sales-section">
        <div className="closure-practical-section-title"><div><small>VENDAS</small><h3>Vendas deste fechamento</h3></div><span>{detail.sales.length} venda(s)</span></div>
        <div className="closure-sales-list">{detail.sales.map((s,i)=>{const sid=text(s.id)||String(i);const items=saleItems(s);const expanded=expandedSale===sid;return <article className={`closure-sale-card ${expanded?'expanded':''}`} key={sid}>
          <div className="closure-sale-main">
            <div className="closure-sale-identity"><strong>Venda #{text(s.number)||'—'}</strong><small>{dt(s.occurred_at)} · {text(s.operator)||'Operador não identificado'}</small></div>
            <div className="closure-sale-status-cell"><span>Status</span><b className={`closure-sale-status status-${text(s.status)}`}>{statusLabel(s.status,saleStatusLabels)}</b></div>
            <div className="closure-sale-fiscal"><span>Fiscal</span><b>{text(s.document_type)?`${text(s.document_type).toUpperCase()} · ${statusLabel(s.fiscal_status,fiscalStatusLabels)}`:'Não fiscal'}</b></div>
            <div className="closure-sale-total"><span>Total</span><strong>{money(s.total)}</strong></div>
            <button type="button" className="closure-sale-operation-button" onClick={()=>setExpandedSale(expanded?'':sid)}>{expanded?'Fechar operação':'Ver operação'}</button>
          </div>
          {expanded?<div className="closure-sale-operation">
            <div className="closure-sale-operation-summary">
              <span>Subtotal <b>{money(s.subtotal)}</b></span>
              {hasValue(s.discount)?<span>Desconto <b>- {money(s.discount)}</b></span>:null}
              {hasValue(s.surcharge)?<span>Acréscimo <b>{money(s.surcharge)}</b></span>:null}
              <span>Total da operação <b>{money(s.total)}</b></span>
            </div>
            <div className="closure-sale-items-title"><strong>Produtos vendidos</strong><span>{items.length} item(ns)</span></div>
            {items.length>0?<div className="closure-sale-items-table">
              <div className="head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Desconto</span><span>Total</span></div>
              {items.map((item,itemIndex)=><div key={text(item.id)||`${sid}-${itemIndex}`}>
                <span className="product"><strong>{text(item.description)||'Produto'}</strong><small>{text(item.sku)?`SKU ${text(item.sku)}`:''}{text(item.unit)?`${text(item.sku)?' · ':''}${text(item.unit)}`:''}</small></span>
                <span>{num(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}</span>
                <span>{money(item.unit_price)}</span>
                <span>{hasValue(item.discount)?money(item.discount):'—'}</span>
                <strong>{money(item.total)}</strong>
              </div>)}
            </div>:<div className="closure-sale-items-empty">Nenhum item de produto foi encontrado para esta operação.</div>}
          </div>:null}
        </article>})}</div>
      </section>:null}

      {detail.returns.length>0?<section className="closure-practical-section">
        <div className="closure-practical-section-title"><div><small>DEVOLUÇÕES</small><h3>Devoluções deste fechamento</h3></div><span>{detail.returns.length} devolução(ões)</span></div>
        <div className="closure-return-list">{detail.returns.map((r,i)=>{const items=returnItems(r);return <article key={text(r.id)||String(i)} className="closure-return-card">
          <div className="closure-return-main"><div><strong>Venda #{text(r.sale_number)}</strong><small>{dt(r.created_at)} · {text(r.operator)||'Operador não identificado'}</small></div><div><span>{text(r.credit_type)==='store_credit_voucher'?'Vale Crédito':'Crédito no cliente'}</span><b>{money(r.total)}</b></div></div>
          <div className="closure-return-beneficiary"><span>Beneficiário</span><strong>{text(r.customer_name)||text(r.guest_name)||text(r.guest_document)||'Pessoa sem cadastro'}</strong></div>
          {text(r.voucher_number)?<div className="closure-return-voucher"><span>Vale {text(r.voucher_number)}</span><span>Saldo {money(r.voucher_remaining)}</span><span>Status {text(r.voucher_status)==='active'?'Ativo':text(r.voucher_status)}</span></div>:null}
          {items.length>0?<div className="closure-return-items">{items.map((item,j)=><span key={`${text(r.id)}-${j}`}><b>{text(item.description)||text(item.sku)||'Produto'}</b> · {num(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})} {text(item.unit)} · {money(item.total)}</span>)}</div>:null}
          <small className="closure-return-note">Operação de crédito. Não altera o dinheiro físico esperado do caixa.</small>
        </article>})}</div>
      </section>:null}

      {visibleMovements.length>0?<section className="closure-practical-section">
        <div className="closure-practical-section-title"><div><small>MOVIMENTAÇÃO</small><h3>Entradas e saídas do caixa</h3></div><span>{visibleMovements.length} movimento(s)</span></div>
        <div className="closure-practical-movements">{visibleMovements.map((m,i)=><article key={text(m.id)||String(i)}><div><strong>{movementLabels[text(m.movement_type)]||text(m.movement_type)}</strong><small>{dt(m.created_at)}{text(m.notes)?` · ${text(m.notes)}`:''}</small></div><b className={['withdrawal','sangria','expense','refund'].includes(text(m.movement_type))?'negative':''}>{money(m.amount)}</b></article>)}</div>
      </section>:null}

      {fiscalTotal>0?<section className="closure-practical-section closure-practical-fiscal">
        <div className="closure-practical-section-title"><div><small>FISCAL</small><h3>Documentos fiscais</h3></div><span>{fiscalTotal} documento(s)</span></div>
        <div className="closure-practical-fiscal-grid">
          {num(detail.fiscal.authorized)>0?<span>Autorizados <b>{num(detail.fiscal.authorized)}</b></span>:null}
          {num(detail.fiscal.cancelled)>0?<span>Cancelados <b>{num(detail.fiscal.cancelled)}</b></span>:null}
          {num(detail.fiscal.rejected)>0?<span>Rejeitados <b>{num(detail.fiscal.rejected)}</b></span>:null}
          {num(detail.fiscal.pending)>0?<span>Pendentes <b>{num(detail.fiscal.pending)}</b></span>:null}
          {num(detail.fiscal.nfce)>0?<span>NFC-e <b>{num(detail.fiscal.nfce)}</b></span>:null}
          {num(detail.fiscal.nfe)>0?<span>NF-e <b>{num(detail.fiscal.nfe)}</b></span>:null}
        </div>
      </section>:null}

      {visibleAudit.length>0?<section className="closure-practical-section">
        <div className="closure-practical-section-title"><div><small>AUDITORIA</small><h3>Alterações neste fechamento</h3></div><span>{visibleAudit.length} registro(s)</span></div>
        <div className="closure-practical-audit">{visibleAudit.map((a,i)=><article key={text(a.id)||String(i)}><div><strong>{text(a.action_label)||text(a.action)}</strong><small>{dt(a.created_at)} · {text(a.actor_email)||'Sistema'}</small></div><p>{text(a.reason)||'Sem observação.'}</p></article>)}</div>
      </section>:null}

      {notes?<div className="closure-practical-notes"><strong>Observação</strong><span>{notes}</span></div>:null}
    </aside></div>}

    {correcting&&detail&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal closure-correction-modal"><small>CORREÇÃO AUDITADA</small><h3>Corrigir valor contado</h3><p>Altere apenas o valor contado. As vendas e movimentações permanecem intactas.</p><div className="closure-correction-compare"><div><span>Esperado</span><strong>{money(detail.session.expected_cash)}</strong></div><div><span>Contado atual</span><strong>{money(detail.session.closing_amount)}</strong></div></div><label><span>Novo valor contado *</span><input autoFocus type="number" min="0" step="0.01" value={closing} onChange={e=>setClosing(e.target.value)}/></label><label><span>Motivo da correção *</span><textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explique por que o valor precisa ser corrigido..."/></label><div className="closure-audit-warning">Usuário, data/hora, valor anterior, novo valor e justificativa ficarão registrados.</div><div className="sales-cash-modal-actions"><button type="button" onClick={()=>setCorrecting(false)}>Cancelar</button><button type="button" className="primary" disabled={pending} onClick={()=>startTransition(()=>{void saveCorrection()})}>{pending?'Corrigindo...':'Confirmar correção'}</button></div></section></div>}

    {reopening&&detail&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal closure-reopen-modal"><small>REABERTURA AUDITADA</small><h3>Reabrir este caixa?</h3><p>Use esta opção somente quando precisar lançar ou corrigir algo depois do fechamento.</p><div className="closure-correction-compare"><div><span>Fechado em</span><strong className="date-value">{dt(detail.session.closed_at)}</strong></div><div><span>Valor contado</span><strong>{money(detail.session.closing_amount)}</strong></div></div><label><span>Motivo da reabertura *</span><textarea autoFocus rows={4} value={reopenReason} onChange={e=>setReopenReason(e.target.value)} placeholder="Ex.: lançamento faltante, valor informado incorretamente..."/></label><div className="closure-reopen-warning"><strong>Importante</strong><span>O fechamento continuará no histórico como REABERTO. Usuário, horário e motivo ficarão registrados.</span></div><div className="sales-cash-modal-actions"><button type="button" onClick={()=>setReopening(false)}>Cancelar</button><button type="button" className="primary closure-reopen-confirm" disabled={pending||reopenReason.trim().length<5} onClick={()=>startTransition(()=>{void saveReopen()})}>{pending?'Reabrindo...':'Confirmar reabertura'}</button></div></section></div>}
  </section>;
}
