'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {erpUserCashClose,erpUserCashGet} from './actions';

type Row=Record<string,unknown>;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';

export function SaleUserCashControl(){
 const [cash,setCash]=useState<Row|null>(null);const [loading,setLoading]=useState(true);const [open,setOpen]=useState(false);const [counted,setCounted]=useState('');const [notes,setNotes]=useState('');const [message,setMessage]=useState('');const [closing,setClosing]=useState(false);
 async function load(){setLoading(true);const r=await erpUserCashGet();setLoading(false);if(r.ok&&r.cash&&typeof r.cash==='object'&&!Array.isArray(r.cash))setCash(r.cash as Row);else setCash(null)}
 useEffect(()=>{void load()},[]);
 async function closeCash(){if(counted.trim()===''){setMessage('Informe o valor contado em dinheiro.');return}setClosing(true);const r=await erpUserCashClose(Number(counted),notes||'Fechamento pelo ThorGestão');setClosing(false);if(r.ok){setMessage(`Caixa fechado. Esperado ${money(r.expected)} · contado ${money(r.closing)} · diferença ${money(r.difference)}.`);setCash(null);setCounted('');setNotes('')}else setMessage(String(r.error??'Não foi possível fechar o caixa.'))}
 if(loading)return <span className="erp-sale-cash-status muted">Caixa: verificando...</span>;
 if(!cash)return <Link href="/dashboard/pdv/caixa" className="erp-sale-cash-status warning">Caixa: sem sessão · Abrir/consultar</Link>;
 return <>
  <button type="button" className="erp-sale-cash-status open" onClick={()=>setOpen(true)}>● Caixa aberto · Fechar caixa</button>
  {open&&<div className="erp-sale-cash-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="erp-sale-cash-modal"><header><div><small>MEU CAIXA</small><h3>{String(cash.operator??'Operador')}</h3></div><button onClick={()=>setOpen(false)}>×</button></header><div className="erp-sale-cash-grid"><div><span>PDV</span><b>{String(cash.pos??'—')}</b></div><div><span>Filial</span><b>{String(cash.branch??'—')}</b></div><div><span>Abertura</span><b>{dt(cash.opened_at)}</b></div><div><span>Fundo inicial</span><b>{money(cash.opening_amount)}</b></div><div><span>Vendas</span><b>{money(cash.sales_total)}</b></div><div><span>Recebido</span><b>{money(cash.received_total)}</b></div><div><span>Dinheiro recebido</span><b>{money(cash.cash_received)}</b></div><div><span>Esperado em espécie</span><strong>{money(cash.expected_cash)}</strong></div></div><label>Valor contado<input type="number" min="0" step="0.01" value={counted} onChange={e=>setCounted(e.target.value)} placeholder="0,00"/></label><label>Observação<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opcional"/></label>{message&&<p>{message}</p>}<footer><button className="secondary" onClick={()=>setOpen(false)}>Cancelar</button><button className="danger" disabled={closing} onClick={closeCash}>{closing?'Fechando...':'Fechar meu caixa'}</button></footer></section></div>}
 </>;
}
