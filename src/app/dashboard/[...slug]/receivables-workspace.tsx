'use client';

import { useMemo, useState, useTransition } from 'react';
import { erpReceivablesList, erpSettleReceivable, type ReceivableFilters } from './receivables-actions';

type Row=Record<string,unknown>;
type Props={initial:Row[];customers:Row[];accounts:Row[];cashSessions:Row[];paymentMethods:Row[]};

const statusLabels:Record<string,string>={open:'Em aberto',paid:'Quitado',partial:'Parcial',overdue:'Vencido',cancelled:'Cancelado'};
const documentLabels:Record<string,string>={boleto:'Boleto',crediario:'Crediário',manual:'Manual',venda:'Venda',devolucao:'Devolução'};
const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:unknown)=>{if(!value)return '—';const raw=String(value);const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR')};
const statusLabel=(value:unknown)=>statusLabels[String(value)]||String(value||'—');
const docLabel=(value:unknown)=>documentLabels[String(value)]||String(value||'—');
const today=()=>new Date().toISOString().slice(0,10);
const errorLabel=(value:unknown)=>{const e=String(value||'erro');const labels:Record<string,string>={invalid_settlement_amount:'Valor inválido para a baixa.',invalid_payment_method:'Forma de pagamento indisponível.',destination_required:'Selecione o destino do valor.',bank_account_not_found:'Conta bancária não encontrada ou inativa.',cash_not_open:'O caixa selecionado não está mais aberto.',cash_session_requires_cash_payment:'Somente recebimentos em dinheiro podem entrar no caixa do dia.',internal_cash_requires_cash_payment:'O Caixa Interno aceita somente recebimentos em dinheiro.',store_credit_requires_customer:'Crédito da Loja exige cliente identificado.',insufficient_store_credit:'O cliente não possui crédito disponível suficiente.'};return labels[e]||e};

const empty:ReceivableFilters={issuedFrom:'',issuedTo:'',documentType:'',customerId:'',dueFrom:'',dueTo:'',paidFrom:'',paidTo:''};

export function ReceivablesWorkspace({initial,customers,accounts,cashSessions,paymentMethods}:Props){
  const [rows,setRows]=useState<Row[]>(initial);
  const [filters,setFilters]=useState<ReceivableFilters>(empty);
  const [message,setMessage]=useState('');
  const [pending,startTransition]=useTransition();
  const [selected,setSelected]=useState<Row|null>(null);
  const [method,setMethod]=useState('cash');
  const [destination,setDestination]=useState<'bank_account'|'cash_session'|'store_credit'>('cash_session');
  const [accountId,setAccountId]=useState('');
  const [cashId,setCashId]=useState('');
  const [settleAmount,setSettleAmount]=useState(0);
  const [settleDate,setSettleDate]=useState(today());
  const [notes,setNotes]=useState('');
  const [settling,setSettling]=useState(false);

  const activeAccounts=useMemo(()=>accounts.filter(a=>a.active!==false),[accounts]);
  const bankOnly=useMemo(()=>activeAccounts.filter(a=>a.account_type==='bank'),[activeAccounts]);
  const totals=useMemo(()=>rows.reduce<{amount:number;paid:number}>((acc,row)=>{acc.amount+=Number(row.amount||0);acc.paid+=Number(row.paid_amount||0);return acc;},{amount:0,paid:0}),[rows]);
  const set=(key:keyof ReceivableFilters,value:string)=>setFilters(current=>({...current,[key]:value}));
  const load=(next:ReceivableFilters=filters)=>startTransition(async()=>{const result=await erpReceivablesList(next);if(result.ok){setRows(result.data);setMessage('');}else setMessage(String(result.error||'Não foi possível consultar as contas a receber.'));});
  const clear=()=>{setFilters(empty);load(empty);};

  function openSettlement(row:Row){
    const firstMethod=String(paymentMethods.find(m=>m.code!=='store_credit')?.code??'cash');
    const isCash=firstMethod==='cash';
    setSelected(row);setMethod(firstMethod);setSettleAmount(Number(row.remaining??Math.max(Number(row.amount||0)-Number(row.paid_amount||0),0)));setSettleDate(today());setNotes('');
    if(isCash&&cashSessions.length){setDestination('cash_session');setCashId(String(cashSessions[0]?.id??''));setAccountId('')}
    else{setDestination('bank_account');const pool=isCash?activeAccounts:bankOnly;setAccountId(String(pool[0]?.id??''));setCashId('')}
  }

  function changeMethod(next:string){
    setMethod(next);
    if(next==='store_credit'){setDestination('store_credit');setAccountId('');setCashId('');return}
    if(next==='cash'){
      if(cashSessions.length){setDestination('cash_session');setCashId(String(cashSessions[0]?.id??''));setAccountId('')}
      else{setDestination('bank_account');setAccountId(String(activeAccounts[0]?.id??''));setCashId('')}
      return;
    }
    setDestination('bank_account');setAccountId(String(bankOnly[0]?.id??''));setCashId('');
  }

  async function settle(){
    if(!selected)return;
    setSettling(true);setMessage('');
    const settledAt=settleDate?`${settleDate}T12:00:00-03:00`:new Date().toISOString();
    const r=await erpSettleReceivable(String(selected.id),{amount:settleAmount,payment_method:method,destination_type:destination,bank_account_id:destination==='bank_account'?accountId:null,cash_session_id:destination==='cash_session'?cashId:null,settled_at:settledAt,notes});
    setSettling(false);
    if(r.ok){setMessage(Number(r.remaining||0)<=0.001?'Título quitado e movimentação financeira registrada.':'Recebimento parcial registrado.');setSelected(null);const result=await erpReceivablesList(filters);if(result.ok)setRows(result.data)}
    else setMessage(`Não foi possível receber: ${errorLabel(r.error)}`);
  }

  const selectedCredit=Number(selected?.store_credit_balance??0);
  const destinationAccounts=method==='cash'?activeAccounts:bankOnly;
  const canSettle=Boolean(selected)&&settleAmount>0&&(method==='store_credit'?selectedCredit+0.001>=settleAmount:destination==='cash_session'?Boolean(cashId):Boolean(accountId));

  return <div className="erp-receivables">
    <section className="erp-module-card erp-receivable-filters">
      <div className="erp-receivable-filter-head"><div><h2>Filtros de Contas a Receber</h2><p>Consulte títulos por emissão, documento, cliente, vencimento e quitação.</p></div><div className="erp-receivable-actions"><button type="button" className="erp-row-action" onClick={clear}>Limpar</button><button type="button" className="erp-primary" disabled={pending} onClick={()=>load()}>{pending?'Consultando...':'Aplicar filtros'}</button></div></div>
      <div className="erp-receivable-filter-grid">
        <fieldset><legend>Data de emissão</legend><label>De<input type="date" value={filters.issuedFrom||''} onChange={e=>set('issuedFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.issuedTo||''} onChange={e=>set('issuedTo',e.target.value)}/></label></fieldset>
        <label>Tipo de documento<select value={filters.documentType||''} onChange={e=>set('documentType',e.target.value)}><option value="">Todos</option><option value="boleto">Boleto</option><option value="crediario">Crediário</option><option value="manual">Manual</option><option value="venda">Venda</option><option value="devolucao">Devolução</option></select></label>
        <label>Cliente<select value={filters.customerId||''} onChange={e=>set('customerId',e.target.value)}><option value="">Todos os clientes</option>{customers.filter(c=>c.active!==false).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name||'Cliente')}{c.document?` — ${String(c.document)}`:''}</option>)}</select></label>
        <fieldset><legend>Data de vencimento</legend><label>De<input type="date" value={filters.dueFrom||''} onChange={e=>set('dueFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.dueTo||''} onChange={e=>set('dueTo',e.target.value)}/></label></fieldset>
        <fieldset><legend>Data de quitação</legend><label>De<input type="date" value={filters.paidFrom||''} onChange={e=>set('paidFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.paidTo||''} onChange={e=>set('paidTo',e.target.value)}/></label></fieldset>
      </div>
      {message&&<p className="erp-message">{message}</p>}
    </section>

    {selected&&<section className="erp-module-card erp-settlement-panel">
      <div className="erp-receivable-filter-head"><div><h2>Receber / quitar título</h2><p>{String(selected.customer||'Cliente')} · {String(selected.description||'Título')} · saldo {money(selected.remaining)}</p></div><button type="button" className="erp-ghost" onClick={()=>setSelected(null)}>Fechar</button></div>
      <div className="erp-settlement-grid">
        <label>Valor recebido<input type="number" min="0.01" max={Number(selected.remaining||0)} step="0.01" value={settleAmount} onChange={e=>setSettleAmount(Number(e.target.value))}/></label>
        <label>Data do recebimento<input type="date" value={settleDate} onChange={e=>setSettleDate(e.target.value)}/></label>
        <label>Forma de pagamento<select value={method} onChange={e=>changeMethod(e.target.value)}>{paymentMethods.map(m=>{const code=String(m.code);const isCredit=code==='store_credit';const disabled=isCredit&&selectedCredit<=0;return <option key={code} value={code} disabled={disabled}>{String(m.name)}{isCredit?` — disponível ${money(selectedCredit)}`:''}</option>})}</select></label>
        {method==='cash'&&<label>Destino<select value={destination} onChange={e=>{const d=e.target.value as 'bank_account'|'cash_session';setDestination(d);if(d==='cash_session'){setCashId(String(cashSessions[0]?.id??''));setAccountId('')}else{setAccountId(String(activeAccounts[0]?.id??''));setCashId('')}}}><option value="cash_session" disabled={!cashSessions.length}>Caixa aberto do dia</option><option value="bank_account">Conta financeira / Caixa Interno</option></select></label>}
        {method!=='store_credit'&&method!=='cash'&&<label>Destino<input readOnly value="Conta bancária"/></label>}
        {destination==='bank_account'&&method!=='store_credit'&&<label>Conta de destino<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione...</option>{destinationAccounts.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)} — saldo {money(a.balance)}</option>)}</select></label>}
        {destination==='cash_session'&&method==='cash'&&<label>Caixa do dia<select value={cashId} onChange={e=>setCashId(e.target.value)}><option value="">Selecione...</option>{cashSessions.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.pos)} · {String(c.branch)} · aberto {date(c.opened_at)} · esperado {money(c.expected_cash)}</option>)}</select></label>}
        {method==='store_credit'&&<div className="erp-store-credit-info"><span>Crédito disponível do cliente</span><b>{money(selectedCredit)}</b><small>Somente créditos originados de devoluções/estornos válidos podem ser utilizados.</small></div>}
        <label className="wide">Observação<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opcional: NSU, comprovante, referência..."/></label>
      </div>
      {method!=='cash'&&method!=='store_credit'&&!bankOnly.length&&<p className="erp-message">Cadastre ao menos uma conta em Financeiro → Contas Bancárias para receber por {String(paymentMethods.find(m=>String(m.code)===method)?.name??method)}.</p>}
      {method==='cash'&&!cashSessions.length&&<p className="erp-message">Não há caixa aberto. Você pode direcionar o dinheiro para o Caixa Interno/conta financeira ou abrir um caixa antes da baixa.</p>}
      <div className="erp-settlement-actions"><button type="button" className="erp-primary" disabled={!canSettle||settling} onClick={settle}>{settling?'Registrando...':settleAmount+0.001>=Number(selected.remaining||0)?'Quitar título':'Registrar recebimento parcial'}</button></div>
    </section>}

    <section className="erp-module-card">
      <div className="erp-receivable-summary"><div><span>Títulos encontrados</span><b>{rows.length}</b></div><div><span>Valor total</span><b>{money(totals.amount)}</b></div><div><span>Valor quitado</span><b>{money(totals.paid)}</b></div><div><span>Saldo</span><b>{money(Math.max(totals.amount-totals.paid,0))}</b></div></div>
      {rows.length===0?<p className="erp-empty">Nenhum título encontrado para os filtros selecionados.</p>:<div className="erp-table-scroll"><table className="erp-data-table erp-receivable-table"><thead><tr><th>Emissão</th><th>Documento</th><th>Cliente</th><th>Vencimento</th><th>Quitação</th><th>Descrição</th><th>Parcela</th><th>Valor</th><th>Recebido</th><th>Saldo</th><th>Status</th><th>Ação</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td>{date(row.issued_at)}</td><td><span className="erp-doc-chip">{docLabel(row.document_type)}</span></td><td>{String(row.customer||'—')}</td><td>{date(row.due_date)}</td><td>{date(row.paid_at)}</td><td>{String(row.description||'—')}</td><td>{row.installment?`${String(row.installment)}/${String(row.installments||row.installment)}`:'—'}</td><td><b>{money(row.amount)}</b></td><td>{money(row.paid_amount)}</td><td><b>{money(row.remaining)}</b></td><td><span className={`erp-fin-status status-${String(row.status||'open')}`}>{statusLabel(row.status)}</span></td><td>{!['paid','cancelled'].includes(String(row.status))&&Number(row.remaining||0)>0?<button type="button" className="erp-row-action" onClick={()=>openSettlement(row)}>Receber / quitar</button>:'—'}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
