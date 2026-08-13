'use client';

import { useMemo, useState, useTransition } from 'react';
import { erpReceivablesList, erpSettleReceivable, type ReceivableFilters } from './receivables-actions';

type Row=Record<string,unknown>;
type Props={initial:Row[];customers:Row[];accounts:Row[];paymentMethods:Row[]};

const statusLabels:Record<string,string>={open:'Em aberto',paid:'Quitado',partial:'Parcial',overdue:'Vencido',cancelled:'Cancelado'};
const documentLabels:Record<string,string>={boleto:'Boleto',crediario:'Crediário'};
const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:unknown)=>{if(!value)return '—';const raw=String(value);const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR')};
const statusLabel=(value:unknown)=>statusLabels[String(value)]||String(value||'—');
const docLabel=(value:unknown)=>documentLabels[String(value)]||String(value||'—');
const today=()=>new Date().toISOString().slice(0,10);
const errorLabel=(value:unknown)=>{const e=String(value||'erro');const labels:Record<string,string>={
  invalid_settlement_amount:'Valor inválido para a baixa.',
  invalid_payment_method:'Forma de pagamento indisponível.',
  destination_required:'Selecione a conta de destino.',
  financial_account_destination_required:'Selecione uma Conta Bancária ou o Caixa Interno.',
  bank_account_not_found:'Conta de destino não encontrada ou inativa.',
  internal_cash_requires_cash_payment:'O Caixa Interno aceita recebimentos em dinheiro. Para PIX, cartão ou transferência, selecione uma conta bancária.',
  term_receivable_only:'Somente títulos de Venda a Prazo (Crediário ou Boleto) podem ser baixados neste módulo.',
};return labels[e]||e};

const empty:ReceivableFilters={issuedFrom:'',issuedTo:'',documentType:'',customerId:'',dueFrom:'',dueTo:'',paidFrom:'',paidTo:''};

export function ReceivablesWorkspace({initial,customers,accounts,paymentMethods}:Props){
  const [rows,setRows]=useState<Row[]>(initial);
  const [filters,setFilters]=useState<ReceivableFilters>(empty);
  const [message,setMessage]=useState('');
  const [pending,startTransition]=useTransition();
  const [selected,setSelected]=useState<Row|null>(null);
  const [method,setMethod]=useState('cash');
  const [accountId,setAccountId]=useState('');
  const [settleAmount,setSettleAmount]=useState(0);
  const [settleDate,setSettleDate]=useState(today());
  const [notes,setNotes]=useState('');
  const [settling,setSettling]=useState(false);

  const activeAccounts=useMemo(()=>accounts.filter(a=>a.active!==false&&['bank','internal_cash'].includes(String(a.account_type))),[accounts]);
  const bankOnly=useMemo(()=>activeAccounts.filter(a=>a.account_type==='bank'),[activeAccounts]);
  const internalCash=useMemo(()=>activeAccounts.find(a=>a.account_type==='internal_cash'),[activeAccounts]);
  const settlementMethods=useMemo(()=>{
    const allowed=paymentMethods.filter(m=>!['term_sale','store_credit'].includes(String(m.code)));
    return allowed.length?allowed:[{code:'cash',name:'Dinheiro'}];
  },[paymentMethods]);
  const totals=useMemo(()=>rows.reduce<{amount:number;paid:number}>((acc,row)=>{acc.amount+=Number(row.amount||0);acc.paid+=Number(row.paid_amount||0);return acc;},{amount:0,paid:0}),[rows]);
  const destinationAccounts=method==='cash'?activeAccounts:bankOnly;

  const set=(key:keyof ReceivableFilters,value:string)=>setFilters(current=>({...current,[key]:value}));
  const load=(next:ReceivableFilters=filters)=>startTransition(async()=>{const result=await erpReceivablesList(next);if(result.ok){setRows(result.data);setMessage('');}else setMessage(String(result.error||'Não foi possível consultar as contas a receber.'));});
  const clear=()=>{setFilters(empty);load(empty);};

  function defaultAccount(nextMethod:string){
    if(nextMethod==='cash')return String(internalCash?.id??activeAccounts[0]?.id??'');
    return String(bankOnly[0]?.id??'');
  }

  function openSettlement(row:Row){
    const firstMethod=String(settlementMethods.find(m=>String(m.code)==='cash')?.code??settlementMethods[0]?.code??'cash');
    setSelected(row);
    setMethod(firstMethod);
    setAccountId(defaultAccount(firstMethod));
    setSettleAmount(Number(row.remaining??Math.max(Number(row.amount||0)-Number(row.paid_amount||0),0)));
    setSettleDate(today());
    setNotes('');
  }

  function changeMethod(next:string){
    setMethod(next);
    setAccountId(defaultAccount(next));
  }

  async function settle(){
    if(!selected||!accountId)return;
    setSettling(true);setMessage('');
    const settledAt=settleDate?`${settleDate}T12:00:00-03:00`:new Date().toISOString();
    const r=await erpSettleReceivable(String(selected.id),{
      amount:settleAmount,
      payment_method:method,
      destination_type:'bank_account',
      bank_account_id:accountId,
      cash_session_id:null,
      settled_at:settledAt,
      notes,
    });
    setSettling(false);
    if(r.ok){
      const destination=destinationAccounts.find(a=>String(a.id)===accountId);
      const destinationName=String(destination?.name||'conta financeira');
      setMessage(Number(r.remaining||0)<=0.001?`Título quitado. Valor recebido em ${destinationName}.`:`Recebimento parcial registrado em ${destinationName}.`);
      setSelected(null);
      const result=await erpReceivablesList(filters);if(result.ok)setRows(result.data);
    }else setMessage(`Não foi possível receber: ${errorLabel(r.error)}`);
  }

  const canSettle=Boolean(selected)&&settleAmount>0&&Boolean(accountId)&&destinationAccounts.some(a=>String(a.id)===accountId);

  return <div className="erp-receivables">
    <section className="erp-term-only-note">
      <div><span>CARTEIRA A PRAZO</span><strong>Somente Crediário e Boleto</strong><p>Vendas em Dinheiro, PIX, Débito, Crédito, Voucher e demais modalidades à vista não entram em Contas a Receber.</p></div>
      <div className="erp-term-destinations"><span>Recebimento</span><b>Conta Bancária</b><i>ou</i><b>Caixa Interno</b></div>
    </section>

    <section className="erp-module-card erp-receivable-filters">
      <div className="erp-receivable-filter-head"><div><h2>Filtros de Contas a Receber</h2><p>Consulte parcelas de vendas a prazo por emissão, modalidade, cliente, vencimento e quitação.</p></div><div className="erp-receivable-actions"><button type="button" className="erp-row-action" onClick={clear}>Limpar</button><button type="button" className="erp-primary" disabled={pending} onClick={()=>load()}>{pending?'Consultando...':'Aplicar filtros'}</button></div></div>
      <div className="erp-receivable-filter-grid">
        <fieldset><legend>Data de emissão</legend><label>De<input type="date" value={filters.issuedFrom||''} onChange={e=>set('issuedFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.issuedTo||''} onChange={e=>set('issuedTo',e.target.value)}/></label></fieldset>
        <label>Modalidade<select value={filters.documentType||''} onChange={e=>set('documentType',e.target.value)}><option value="">Crediário + Boleto</option><option value="crediario">Crediário</option><option value="boleto">Boleto</option></select></label>
        <label>Cliente<select value={filters.customerId||''} onChange={e=>set('customerId',e.target.value)}><option value="">Todos os clientes</option>{customers.filter(c=>c.active!==false).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name||'Cliente')}{c.document?` — ${String(c.document)}`:''}</option>)}</select></label>
        <fieldset><legend>Data de vencimento</legend><label>De<input type="date" value={filters.dueFrom||''} onChange={e=>set('dueFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.dueTo||''} onChange={e=>set('dueTo',e.target.value)}/></label></fieldset>
        <fieldset><legend>Data de quitação</legend><label>De<input type="date" value={filters.paidFrom||''} onChange={e=>set('paidFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.paidTo||''} onChange={e=>set('paidTo',e.target.value)}/></label></fieldset>
      </div>
      {message&&<p className="erp-message">{message}</p>}
    </section>

    {selected&&<section className="erp-module-card erp-settlement-panel">
      <div className="erp-receivable-filter-head"><div><h2>Receber / quitar título</h2><p>{String(selected.customer||'Cliente')} · {docLabel(selected.document_type)} · {String(selected.description||'Título')} · saldo {money(selected.remaining)}</p></div><button type="button" className="erp-ghost" onClick={()=>setSelected(null)}>Fechar</button></div>
      <div className="erp-settlement-grid">
        <label>Valor recebido<input type="number" min="0.01" max={Number(selected.remaining||0)} step="0.01" value={settleAmount} onChange={e=>setSettleAmount(Number(e.target.value))}/></label>
        <label>Data do recebimento<input type="date" value={settleDate} onChange={e=>setSettleDate(e.target.value)}/></label>
        <label>Forma de recebimento<select value={method} onChange={e=>changeMethod(e.target.value)}>{settlementMethods.map(m=><option key={String(m.code)} value={String(m.code)}>{String(m.name)}</option>)}</select></label>
        <label>Destino do recebimento<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione...</option>{destinationAccounts.map(a=><option key={String(a.id)} value={String(a.id)}>{a.account_type==='internal_cash'?'Caixa Interno':'Conta Bancária'} · {String(a.name)} · saldo {money(a.balance)}</option>)}</select></label>
        <div className="erp-destination-info"><span>{destinationAccounts.find(a=>String(a.id)===accountId)?.account_type==='internal_cash'?'CAIXA INTERNO':'CONTA BANCÁRIA'}</span><b>{String(destinationAccounts.find(a=>String(a.id)===accountId)?.name||'Selecione o destino')}</b><small>{destinationAccounts.find(a=>String(a.id)===accountId)?.account_type==='internal_cash'?'Caixa financeiro do ThorGestão; não altera a sessão operacional do PDV.':'O recebimento será lançado no livro financeiro desta conta para conciliação.'}</small></div>
        <label className="wide">Observação<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opcional: NSU, comprovante, referência do recebimento..."/></label>
      </div>
      {method!=='cash'&&!bankOnly.length&&<p className="erp-message">Cadastre ao menos uma conta em Financeiro → Contas Bancárias para receber por {String(settlementMethods.find(m=>String(m.code)===method)?.name??method)}.</p>}
      {method==='cash'&&!activeAccounts.length&&<p className="erp-message">Nenhuma conta financeira ativa foi encontrada. O Caixa Interno deve ser criado automaticamente pelo sistema.</p>}
      <div className="erp-settlement-actions"><button type="button" className="erp-primary" disabled={!canSettle||settling} onClick={settle}>{settling?'Registrando...':settleAmount+0.001>=Number(selected.remaining||0)?'Quitar título':'Registrar recebimento parcial'}</button></div>
    </section>}

    <section className="erp-module-card">
      <div className="erp-receivable-summary"><div><span>Parcelas a prazo</span><b>{rows.length}</b></div><div><span>Valor total</span><b>{money(totals.amount)}</b></div><div><span>Valor recebido</span><b>{money(totals.paid)}</b></div><div><span>Saldo a receber</span><b>{money(Math.max(totals.amount-totals.paid,0))}</b></div></div>
      {rows.length===0?<p className="erp-empty">Nenhum título de Crediário ou Boleto encontrado para os filtros selecionados.</p>:<div className="erp-table-scroll"><table className="erp-data-table erp-receivable-table"><thead><tr><th>Emissão</th><th>Modalidade</th><th>Cliente</th><th>Vencimento</th><th>Quitação</th><th>Descrição</th><th>Parcela</th><th>Valor</th><th>Recebido</th><th>Saldo</th><th>Status</th><th>Ação</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td>{date(row.issued_at)}</td><td><span className={`erp-doc-chip doc-${String(row.document_type)}`}>{docLabel(row.document_type)}</span></td><td>{String(row.customer||'—')}</td><td>{date(row.due_date)}</td><td>{date(row.paid_at)}</td><td>{String(row.description||'—')}</td><td>{row.installment?`${String(row.installment)}/${String(row.installments||row.installment)}`:'—'}</td><td><b>{money(row.amount)}</b></td><td>{money(row.paid_amount)}</td><td><b>{money(row.remaining)}</b></td><td><span className={`erp-fin-status status-${String(row.status||'open')}`}>{statusLabel(row.status)}</span></td><td>{!['paid','cancelled'].includes(String(row.status))&&Number(row.remaining||0)>0?<button type="button" className="erp-row-action" onClick={()=>openSettlement(row)}>Receber / quitar</button>:'—'}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
