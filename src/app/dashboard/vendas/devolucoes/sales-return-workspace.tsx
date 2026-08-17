'use client';

import { useEffect,useMemo,useState,useTransition } from 'react';
import { salesReturnDetail,salesReturnsDashboard } from './actions';

type Row=Record<string,unknown>;
type Detail={return:Row;items:Row[];voucherMovements:Row[]};
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const money=(v:unknown)=>num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
function isoDate(d:Date){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function startOfMonth(){const n=new Date();return isoDate(new Date(n.getFullYear(),n.getMonth(),1));}
function today(){return isoDate(new Date());}
function toRange(value:string,end=false){const d=new Date(`${value}T00:00:00`);if(end)d.setDate(d.getDate()+1);return d.toISOString();}
const statusLabel:Record<string,string>={open:'Em aberto',completed:'Concluída',cancelled:'Cancelada'};
const movementLabel:Record<string,string>={issue:'Emissão do vale',debit:'Utilização em venda',reversal:'Estorno',credit:'Crédito'};

export function SalesReturnWorkspace(){
  const [start,setStart]=useState(startOfMonth());
  const [end,setEnd]=useState(today());
  const [status,setStatus]=useState('');
  const [branchId,setBranchId]=useState('');
  const [search,setSearch]=useState('');
  const [rows,setRows]=useState<Row[]>([]);
  const [branches,setBranches]=useState<Row[]>([]);
  const [summary,setSummary]=useState<Row>({});
  const [message,setMessage]=useState('');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState('');
  const [pending,startTransition]=useTransition();

  const filters=useMemo(()=>({start:toRange(start),end:toRange(end,true),status:status||undefined,branchId:branchId||undefined,search:search.trim()||undefined}),[start,end,status,branchId,search]);

  async function load(){
    setMessage('');
    const r=await salesReturnsDashboard(filters);
    if(!r.ok){setMessage(text(r.error||'Não foi possível carregar as devoluções.'));return;}
    setRows(r.data);setSummary(r.summary);setBranches(r.branches);
  }
  useEffect(()=>{startTransition(()=>{void load()})},[]);

  async function openDetail(id:string){
    setDetailLoading(id);setMessage('');
    const r=await salesReturnDetail(id);
    setDetailLoading('');
    if(!r.ok){setMessage(text(r.error||'Não foi possível abrir a devolução.'));return;}
    setDetail({return:r.return,items:r.items,voucherMovements:r.voucherMovements});
  }

  const beneficiary=(row:Row)=>text(row.customer_name)||text(row.guest_name)||text(row.guest_document)||'Pessoa sem cadastro';
  const creditType=(row:Row)=>text(row.credit_type)==='store_credit_voucher'?'Vale Crédito':'Crédito no cliente';

  return <div className="returns-workspace">
    <section className="returns-kpis">
      <article><span>Em aberto</span><strong>{num(summary.open)}</strong><small>vales ainda com saldo</small></article>
      <article><span>Concluídas</span><strong>{num(summary.completed)}</strong><small>crédito concluído / vale utilizado</small></article>
      <article><span>Total devolvido</span><strong>{money(summary.total_returned)}</strong><small>no período selecionado</small></article>
      <article><span>Saldo de vales</span><strong>{money(summary.voucher_open_balance)}</strong><small>Vale Crédito ainda disponível</small></article>
    </section>

    <section className="returns-card returns-filters">
      <div className="returns-heading"><div><small>VENDAS / DEVOLUÇÕES</small><h2>Controle de devoluções</h2><p>As devoluções feitas no ThorPDV entram automaticamente aqui. Vale Crédito permanece em aberto enquanto possuir saldo.</p></div><button className="returns-primary" disabled={pending} onClick={()=>startTransition(()=>{void load()})}>{pending?'Atualizando...':'Atualizar'}</button></div>
      <div className="returns-filter-grid">
        <label><span>De</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label><span>Até</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
        <label><span>Situação</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todas</option><option value="open">Em aberto</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option></select></label>
        <label><span>Filial</span><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Todas</option>{branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label>
        <label className="returns-search"><span>Buscar</span><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();startTransition(()=>{void load()})}}} placeholder="Venda, vale, cliente, CPF ou operador"/></label>
        <button className="returns-filter-button" disabled={pending} onClick={()=>startTransition(()=>{void load()})}>Aplicar filtros</button>
      </div>
      {message&&<div className="returns-message">{message}</div>}
    </section>

    <section className="returns-card">
      <div className="returns-section-head"><div><h2>Devoluções registradas</h2><p>Rastreabilidade da venda, operador, beneficiário, restituição e saldo do Vale Crédito.</p></div><span>{rows.length} registro(s)</span></div>
      <div className="returns-table-wrap"><table><thead><tr><th>Data</th><th>Venda</th><th>Filial / PDV</th><th>Operador</th><th>Beneficiário</th><th>Restituição</th><th>Valor</th><th>Situação</th><th>Vale Crédito</th><th></th></tr></thead><tbody>
        {rows.length===0?<tr><td colSpan={10} className="returns-empty">Nenhuma devolução encontrada.</td></tr>:rows.map(row=>{const id=text(row.return_id);const open=text(row.operational_status)==='open';return <tr key={id}>
          <td><strong>{dt(row.created_at)}</strong></td>
          <td><strong>#{text(row.sale_number)}</strong><small>{num(row.items_count)} item(ns)</small></td>
          <td><strong>{text(row.branch)||'—'}</strong><small>{text(row.pos)||'PDV não identificado'}</small></td>
          <td>{text(row.operator)||'—'}</td>
          <td><strong>{beneficiary(row)}</strong><small>{text(row.customer_document)||text(row.guest_document)||''}</small></td>
          <td><span className={`returns-credit-type ${text(row.credit_type)}`}>{creditType(row)}</span></td>
          <td className="returns-amount">{money(row.total)}</td>
          <td><span className={`returns-status status-${text(row.operational_status)}`}>{statusLabel[text(row.operational_status)]||text(row.operational_status)}</span></td>
          <td>{text(row.voucher_number)?<div className="returns-voucher-cell"><b>{text(row.voucher_number)}</b><small>{open?`Saldo ${money(row.voucher_remaining)}`:`Utilizado ${money(row.voucher_used_amount)}`}</small></div>:<span className="returns-muted">—</span>}</td>
          <td><button className="returns-detail-button" disabled={detailLoading===id} onClick={()=>void openDetail(id)}>{detailLoading===id?'...':'Ver detalhes'}</button></td>
        </tr>})}
      </tbody></table></div>
    </section>

    {detail&&<div className="returns-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><aside className="returns-detail">
      <header><div><small>DEVOLUÇÃO</small><h2>Venda #{text(detail.return.sale_number)}</h2><p>{dt(detail.return.created_at)} · {text(detail.return.branch)} · {text(detail.return.pos)}</p></div><button aria-label="Fechar" onClick={()=>setDetail(null)}>×</button></header>
      <section className="returns-detail-summary">
        <article><span>Valor devolvido</span><strong>{money(detail.return.total)}</strong></article>
        <article><span>Situação</span><strong>{statusLabel[text(detail.return.operational_status)]||text(detail.return.operational_status)}</strong></article>
        <article><span>Restituição</span><strong>{creditType(detail.return)}</strong></article>
        <article><span>Operador</span><strong>{text(detail.return.operator)||'—'}</strong></article>
      </section>
      <section className="returns-detail-section"><h3>Beneficiário</h3><div className="returns-beneficiary"><strong>{beneficiary(detail.return)}</strong><span>{text(detail.return.customer_document)||text(detail.return.guest_document)||'Sem documento informado'}</span></div></section>
      {text(detail.return.reason)&&<section className="returns-detail-section"><h3>Motivo</h3><p>{text(detail.return.reason)}</p></section>}
      <section className="returns-detail-section"><div className="returns-title-row"><h3>Produtos devolvidos</h3><span>{detail.items.length} item(ns)</span></div><div className="returns-items"><div className="head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span></div>{detail.items.map((item,i)=><div key={text(item.id)||String(i)}><span><strong>{text(item.description)||'Produto'}</strong><small>{text(item.sku)?`SKU ${text(item.sku)}`:''}</small></span><span>{num(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})} {text(item.unit)}</span><span>{money(item.unit_price)}</span><strong>{money(item.total)}</strong></div>)}</div></section>
      {text(detail.return.voucher_number)&&<section className="returns-detail-section returns-voucher-panel"><div className="returns-title-row"><div><small>VALE CRÉDITO</small><h3>{text(detail.return.voucher_number)}</h3></div><span className={`returns-status status-${num(detail.return.voucher_remaining)>0.001?'open':'completed'}`}>{num(detail.return.voucher_remaining)>0.001?'Em aberto':'Concluído'}</span></div><div className="returns-voucher-numbers"><span>Emitido <b>{dt(detail.return.voucher_issued_at)}</b></span><span>Valor original <b>{money(detail.return.voucher_original_amount)}</b></span><span>Utilizado <b>{money(detail.return.voucher_used_amount)}</b></span><span>Saldo <b>{money(detail.return.voucher_remaining)}</b></span></div></section>}
      {detail.voucherMovements.length>0&&<section className="returns-detail-section"><div className="returns-title-row"><h3>Histórico do Vale Crédito</h3><span>{detail.voucherMovements.length} movimento(s)</span></div><div className="returns-timeline">{detail.voucherMovements.map((m,i)=><article key={text(m.id)||String(i)}><div><strong>{movementLabel[text(m.entry_type)]||text(m.entry_type)}</strong><small>{dt(m.created_at)}{text(m.sale_number)?` · Venda #${text(m.sale_number)}`:''}</small></div><b className={text(m.entry_type)==='debit'?'negative':''}>{text(m.entry_type)==='debit'?'- ':''}{money(m.amount)}</b></article>)}</div></section>}
    </aside></div>}
  </div>;
}
