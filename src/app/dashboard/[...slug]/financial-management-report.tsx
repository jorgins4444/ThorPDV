'use client';

import { useState } from 'react';
import { erpReportV2 } from './report-actions';

type Row=Record<string,unknown>;
type ReportResult={ok?:boolean;error?:string;data?:Row[];start?:string;end?:string;branch?:string|null};
type Kind='expenses_by_category'|'cost_center_expenses'|'chart_account_ledger';
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v??0)||0;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(num(v));
const definitions:Record<Kind,{columns:{key:string;label:string;money?:boolean}[]}>={
  expenses_by_category:{columns:[{key:'category_code',label:'Código'},{key:'category',label:'Categoria'},{key:'account_code',label:'Conta'},{key:'account',label:'Conta gerencial'},{key:'entries',label:'Títulos'},{key:'total_amount',label:'Total',money:true},{key:'paid_amount',label:'Pago',money:true},{key:'open_amount',label:'Em aberto',money:true}]},
  cost_center_expenses:{columns:[{key:'cost_center_code',label:'Código'},{key:'cost_center',label:'Centro de custo'},{key:'branch',label:'Filial'},{key:'entries',label:'Títulos'},{key:'total_amount',label:'Total',money:true},{key:'paid_amount',label:'Pago',money:true},{key:'open_amount',label:'Em aberto',money:true}]},
  chart_account_ledger:{columns:[{key:'account_code',label:'Conta'},{key:'account',label:'Descrição'},{key:'account_type',label:'Tipo'},{key:'entry_type',label:'Movimento'},{key:'entries',label:'Títulos'},{key:'total_amount',label:'Total',money:true},{key:'settled_amount',label:'Realizado',money:true},{key:'open_amount',label:'Em aberto',money:true}]},
};

export function FinancialManagementReport({report,branches,initial}:{report:Kind;branches:Row[];initial:ReportResult}){
  const [data,setData]=useState<Row[]>(Array.isArray(initial.data)?initial.data:[]);
  const [start,setStart]=useState(text(initial.start)||new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10));
  const [end,setEnd]=useState(text(initial.end)||new Date().toISOString().slice(0,10));
  const [branch,setBranch]=useState(text(initial.branch));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(text(initial.error));
  const def=definitions[report];
  const total=data.reduce((s,r)=>s+num(r.total_amount),0);const realized=data.reduce((s,r)=>s+num(r.paid_amount??r.settled_amount),0);const open=data.reduce((s,r)=>s+num(r.open_amount),0);
  async function load(){setLoading(true);setError('');const r=await erpReportV2(report,start,end,branch||undefined);setLoading(false);if(!r.ok){setError(text(r.error||'Erro ao carregar relatório'));return}setData(r.data);}
  return <div className="fin-report">
    <section className="fin-report-metrics"><article><span>Linhas</span><strong>{data.length}</strong></article><article><span>Total classificado</span><strong>{money(total)}</strong></article><article><span>Realizado</span><strong>{money(realized)}</strong></article><article><span>Em aberto</span><strong>{money(open)}</strong></article></section>
    <section className="fin-report-card"><div className="fin-report-filters"><label>De<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Até<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Filial<select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas</option>{branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label><button onClick={()=>void load()} disabled={loading}>{loading?'Atualizando...':'Aplicar filtros'}</button></div>{error&&<p className="fin-report-error">{error}</p>}<div className="fin-report-table"><table><thead><tr>{def.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{data.length===0?<tr><td colSpan={def.columns.length} className="empty">Nenhum movimento encontrado no período.</td></tr>:data.map((r,i)=><tr key={i}>{def.columns.map(c=><td key={c.key}>{c.money?<strong>{money(r[c.key])}</strong>:text(r[c.key])||'—'}</td>)}</tr>)}</tbody></table></div></section>
  </div>;
}
