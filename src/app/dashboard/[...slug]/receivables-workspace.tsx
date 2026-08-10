'use client';

import { useMemo, useState, useTransition } from 'react';
import { erpReceivablesList, type ReceivableFilters } from './receivables-actions';

type Row=Record<string,unknown>;
type Props={initial:Row[];customers:Row[]};

const statusLabels:Record<string,string>={open:'Em aberto',paid:'Quitado',partial:'Parcial',overdue:'Vencido',cancelled:'Cancelado'};
const documentLabels:Record<string,string>={boleto:'Boleto',crediario:'Crediário',manual:'Manual',venda:'Venda',devolucao:'Devolução'};
const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:unknown)=>{if(!value)return '—';const raw=String(value);const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR')};
const statusLabel=(value:unknown)=>statusLabels[String(value)]||String(value||'—');
const docLabel=(value:unknown)=>documentLabels[String(value)]||String(value||'—');

const empty:ReceivableFilters={issuedFrom:'',issuedTo:'',documentType:'',customerId:'',dueFrom:'',dueTo:'',paidFrom:'',paidTo:''};

export function ReceivablesWorkspace({initial,customers}:Props){
  const [rows,setRows]=useState<Row[]>(initial);
  const [filters,setFilters]=useState<ReceivableFilters>(empty);
  const [message,setMessage]=useState('');
  const [pending,startTransition]=useTransition();

  const totals=useMemo(()=>rows.reduce<{amount:number;paid:number}>((acc,row)=>{acc.amount+=Number(row.amount||0);acc.paid+=Number(row.paid_amount||0);return acc;},{amount:0,paid:0}),[rows]);
  const set=(key:keyof ReceivableFilters,value:string)=>setFilters(current=>({...current,[key]:value}));
  const load=(next:ReceivableFilters=filters)=>startTransition(async()=>{const result=await erpReceivablesList(next);if(result.ok){setRows(result.data);setMessage('');}else setMessage(String(result.error||'Não foi possível consultar as contas a receber.'));});
  const clear=()=>{setFilters(empty);load(empty);};

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

    <section className="erp-module-card">
      <div className="erp-receivable-summary"><div><span>Títulos encontrados</span><b>{rows.length}</b></div><div><span>Valor total</span><b>{money(totals.amount)}</b></div><div><span>Valor quitado</span><b>{money(totals.paid)}</b></div><div><span>Saldo</span><b>{money(Math.max(totals.amount-totals.paid,0))}</b></div></div>
      {rows.length===0?<p className="erp-empty">Nenhum título encontrado para os filtros selecionados.</p>:<div className="erp-table-scroll"><table className="erp-data-table erp-receivable-table"><thead><tr><th>Emissão</th><th>Documento</th><th>Cliente</th><th>Vencimento</th><th>Quitação</th><th>Descrição</th><th>Parcela</th><th>Valor</th><th>Recebido</th><th>Status</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td>{date(row.issued_at)}</td><td><span className="erp-doc-chip">{docLabel(row.document_type)}</span></td><td>{String(row.customer||'—')}</td><td>{date(row.due_date)}</td><td>{date(row.paid_at)}</td><td>{String(row.description||'—')}</td><td>{row.installment?`${String(row.installment)}/${String(row.installments||row.installment)}`:'—'}</td><td><b>{money(row.amount)}</b></td><td>{money(row.paid_amount)}</td><td><span className={`erp-fin-status status-${String(row.status||'open')}`}>{statusLabel(row.status)}</span></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
