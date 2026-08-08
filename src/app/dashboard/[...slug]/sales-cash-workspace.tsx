'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { erpCashClosureHistory, erpCashManagementClose, erpCashManagementReopen, erpSalesCashDashboard } from './actions';

type Row=Record<string,unknown>;
type Dashboard={sessions:Row[];operations:Row[];operators:Row[];branches:Row[];summary:Row};
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
function localDate(offset=0){const d=new Date();d.setDate(d.getDate()+offset);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function toRange(date:string,end=false){const d=new Date(`${date}T00:00:00`);if(end)d.setDate(d.getDate()+1);return d.toISOString();}

const operationLabels:Record<string,string>={opening:'Abertura',sale:'Venda',cash_movement:'Movimento',closing:'Fechamento',reopen:'Reabertura'};
const statusLabels:Record<string,string>={open:'Aberto',closed:'Fechado',completed:'Concluída',cancelled:'Cancelada',supply:'Suprimento',withdrawal:'Sangria',sangria:'Sangria',expense:'Despesa',refund:'Devolução',reopened:'Reaberto'};

export function SalesCashWorkspace(){
  const [tab,setTab]=useState<'operations'|'closures'>('operations');
  const [start,setStart]=useState(localDate());
  const [end,setEnd]=useState(localDate());
  const [operatorId,setOperatorId]=useState('');
  const [branchId,setBranchId]=useState('');
  const [status,setStatus]=useState('');
  const [data,setData]=useState<Dashboard>({sessions:[],operations:[],operators:[],branches:[],summary:{}});
  const [closures,setClosures]=useState<Row[]>([]);
  const [message,setMessage]=useState('');
  const [pending,startTransition]=useTransition();
  const [modal,setModal]=useState<{type:'close'|'reopen';session:Row}|null>(null);
  const [closing,setClosing]=useState('');
  const [reason,setReason]=useState('');

  const filterPayload=useMemo(()=>({start:toRange(start),end:toRange(end,true),operatorId:operatorId||undefined,branchId:branchId||undefined,status:status||undefined}),[start,end,operatorId,branchId,status]);

  async function load(){
    setMessage('');
    const [dashboard,history]=await Promise.all([
      erpSalesCashDashboard(filterPayload),
      erpCashClosureHistory({start:filterPayload.start,end:filterPayload.end,operatorId:filterPayload.operatorId,branchId:filterPayload.branchId}),
    ]);
    if(!dashboard.ok){setMessage(text(dashboard.error||'Não foi possível carregar as operações de caixa.'));return;}
    setData({sessions:dashboard.sessions,operations:dashboard.operations,operators:dashboard.operators,branches:dashboard.branches,summary:dashboard.summary});
    if(history.ok)setClosures(history.data); else setMessage(text(history.error||'Não foi possível carregar o histórico de fechamentos.'));
  }
  useEffect(()=>{startTransition(()=>{void load()})},[]);

  function applyFilters(){startTransition(()=>{void load()})}
  function openClose(session:Row){setClosing(num(session.expected_cash).toFixed(2));setReason('');setModal({type:'close',session})}
  function openReopen(session:Row){setReason('');setClosing('');setModal({type:'reopen',session})}

  async function confirmAction(){
    if(!modal)return;
    if(modal.type==='close'){
      const amount=Number(String(closing).replace(',','.'));
      if(!Number.isFinite(amount)||amount<0){setMessage('Informe um valor contado válido.');return;}
      const r=await erpCashManagementClose(text(modal.session.id||modal.session.cash_session_id),amount,reason||'Fechamento realizado pelo módulo Vendas do Gestão');
      if(!r.ok){setMessage(text(r.error||'Não foi possível fechar o caixa.'));return;}
      setMessage(`Caixa fechado pelo Gestão. Esperado: ${money(r.expected)} · Contado: ${money(r.closing)} · Diferença: ${money(r.difference)}.`);
    }else{
      if(reason.trim().length<3){setMessage('Informe o motivo da reabertura.');return;}
      const r=await erpCashManagementReopen(text(modal.session.cash_session_id||modal.session.id),reason.trim());
      if(!r.ok){setMessage(text(r.error||'Não foi possível reabrir o caixa.'));return;}
      setMessage('Caixa reaberto para correção. O fechamento anterior foi preservado no histórico.');
    }
    setModal(null);setReason('');setClosing('');await load();
  }

  const openSessions=data.sessions.filter(s=>text(s.status)==='open');
  const negativeOp=(o:Row)=>['withdrawal','sangria','expense','refund'].includes(text(o.status));

  return <div className="sales-cash-workspace">
    <section className="sales-cash-kpis">
      <article><span>Caixas abertos</span><strong>{num(data.summary.open_cash)}</strong><small>sessões em operação</small></article>
      <article><span>Caixas fechados</span><strong>{num(data.summary.closed_cash)}</strong><small>sessões encontradas</small></article>
      <article><span>Vendas no período</span><strong>{money(data.summary.sales_total)}</strong><small>operações sincronizadas</small></article>
      <article><span>Sessões</span><strong>{num(data.summary.sessions)}</strong><small>no filtro atual</small></article>
    </section>

    <section className="sales-cash-card filters-card">
      <div className="sales-cash-tabs"><button className={tab==='operations'?'active':''} onClick={()=>setTab('operations')}>Operações de Caixa</button><button className={tab==='closures'?'active':''} onClick={()=>setTab('closures')}>Fechamentos / Histórico</button></div>
      <div className="sales-cash-filters">
        <label><span>De</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label><span>Até</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
        <label><span>Operador</span><select value={operatorId} onChange={e=>setOperatorId(e.target.value)}><option value="">Todos</option>{data.operators.map(o=><option key={text(o.id)} value={text(o.id)}>{text(o.name)}</option>)}</select></label>
        <label><span>Filial</span><select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Todas</option>{data.branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label>
        {tab==='operations'&&<label><span>Status do caixa</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="open">Aberto</option><option value="closed">Fechado</option></select></label>}
        <button className="sales-cash-filter-button" disabled={pending} onClick={applyFilters}>{pending?'Atualizando...':'Aplicar filtros'}</button>
      </div>
      {message&&<div className="sales-cash-message">{message}</div>}
    </section>

    {tab==='operations'?<>
      <section className="sales-cash-card">
        <div className="sales-cash-section-head"><div><h2>Caixas em operação</h2><p>Feche uma sessão diretamente pelo Gestão quando necessário.</p></div><span>{openSessions.length} aberto(s)</span></div>
        {openSessions.length===0?<div className="sales-cash-empty">Nenhum caixa aberto no filtro atual.</div>:<div className="sales-cash-open-grid">{openSessions.map(s=><article key={text(s.id)}>
          <div className="cash-session-title"><div><strong>{text(s.pos)||'PDV'}</strong><small>{text(s.branch)}</small></div><span className="cash-state open">ABERTO</span></div>
          <dl><div><dt>Operador</dt><dd>{text(s.operator)||'Não identificado'}</dd></div><div><dt>Aberto em</dt><dd>{dt(s.opened_at)}</dd></div><div><dt>Fundo inicial</dt><dd>{money(s.opening_amount)}</dd></div><div><dt>Vendas</dt><dd>{num(s.sales_count)} · {money(s.sales_total)}</dd></div><div><dt>Dinheiro recebido</dt><dd>{money(s.cash_received)}</dd></div><div><dt>Esperado em caixa</dt><dd><strong>{money(s.expected_cash)}</strong></dd></div></dl>
          <button className="cash-close-management" onClick={()=>openClose(s)}>Fechar pelo Gestão</button>
        </article>)}</div>}
      </section>

      <section className="sales-cash-card">
        <div className="sales-cash-section-head"><div><h2>Listagem de operações</h2><p>Aberturas, vendas, suprimentos, sangrias, devoluções, fechamentos e reaberturas.</p></div><span>{data.operations.length} operação(ões)</span></div>
        <div className="sales-cash-table-wrap"><table><thead><tr><th>Data / hora</th><th>Tipo</th><th>PDV / Filial</th><th>Operador</th><th>Operação</th><th className="right">Valor</th><th>Status</th></tr></thead><tbody>
          {data.operations.length===0?<tr><td colSpan={7} className="sales-cash-empty">Nenhuma operação encontrada no período.</td></tr>:data.operations.map((o,i)=><tr key={text(o.op_key)||String(i)}><td>{dt(o.occurred_at)}</td><td><span className={`op-type ${text(o.op_type)}`}>{operationLabels[text(o.op_type)]||text(o.op_type)}</span></td><td><strong>{text(o.pos)}</strong><small>{text(o.branch)}</small></td><td>{text(o.operator)||'—'}</td><td>{text(o.description)}</td><td className={`right amount ${negativeOp(o)?'negative':''}`}>{negativeOp(o)?'− ':''}{money(o.amount)}</td><td><span className="op-status">{statusLabels[text(o.status)]||text(o.status)||'—'}</span></td></tr>)}
        </tbody></table></div>
      </section>
    </>:<section className="sales-cash-card">
      <div className="sales-cash-section-head"><div><h2>Histórico de fechamentos</h2><p>Filtre por dia, período, filial ou operador. Fechamentos reabertos permanecem registrados.</p></div><span>{closures.length} fechamento(s)</span></div>
      <div className="sales-cash-table-wrap"><table><thead><tr><th>Fechamento</th><th>PDV / Filial</th><th>Operador</th><th>Abertura</th><th>Vendas</th><th className="right">Esperado</th><th className="right">Contado</th><th className="right">Diferença</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
        {closures.length===0?<tr><td colSpan={10} className="sales-cash-empty">Nenhum fechamento encontrado no período.</td></tr>:closures.map((c,i)=><tr key={`${text(c.cash_session_id)}-${text(c.closed_at)}-${i}`}><td><strong>{dt(c.closed_at)}</strong>{c.reopened_at?<small>Reaberto em {dt(c.reopened_at)}</small>:null}</td><td><strong>{text(c.pos)}</strong><small>{text(c.branch)}</small></td><td>{text(c.operator)||'—'}</td><td>{dt(c.opened_at)}</td><td>{num(c.sales_count)}<small>{money(c.sales_total)}</small></td><td className="right">{money(c.expected_cash)}</td><td className="right">{money(c.closing_amount)}</td><td className={`right ${Math.abs(num(c.difference))>.009?'difference-bad':'difference-ok'}`}>{money(c.difference)}</td><td>{text(c.record_state)==='reopened'?<span className="cash-state reopened">REABERTO DEPOIS</span>:<span className="cash-state closed">FECHADO</span>}{c.reopen_reason?<small className="reopen-reason">{text(c.reopen_reason)}</small>:null}</td><td>{text(c.record_state)==='current'?<button className="cash-reopen-management" onClick={()=>openReopen(c)}>Reabrir</button>:<span className="history-preserved">Histórico preservado</span>}</td></tr>)}
      </tbody></table></div>
    </section>}

    {modal&&<div className="sales-cash-modal-backdrop"><section className="sales-cash-modal">
      {modal.type==='close'?<><small>FECHAMENTO PELO GESTÃO</small><h3>Fechar {text(modal.session.pos)||'caixa'}</h3><p>Confira o valor esperado antes de fechar. O fechamento será registrado no histórico.</p><div className="modal-summary"><span>Esperado em espécie</span><strong>{money(modal.session.expected_cash)}</strong></div><label><span>Dinheiro contado</span><input autoFocus type="number" min="0" step="0.01" value={closing} onChange={e=>setClosing(e.target.value)}/></label><label><span>Observação</span><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Opcional"/></label></>:<><small>REABERTURA PARA CORREÇÃO</small><h3>Reabrir {text(modal.session.pos)||'caixa'}</h3><p>O fechamento anterior continuará no histórico. A sessão voltará ao estado aberto para uma nova conferência.</p><div className="modal-summary"><span>Fechamento anterior</span><strong>{money(modal.session.closing_amount)}</strong></div><label><span>Motivo da reabertura *</span><textarea autoFocus rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex.: valor contado informado incorretamente"/></label></>}
      <div className="sales-cash-modal-actions"><button onClick={()=>setModal(null)}>Cancelar</button><button className={modal.type==='close'?'danger':'primary'} onClick={()=>startTransition(()=>{void confirmAction()})} disabled={pending}>{pending?'Processando...':modal.type==='close'?'Confirmar fechamento':'Reabrir caixa'}</button></div>
    </section></div>}
  </div>;
}
