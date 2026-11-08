'use client';

import { useMemo,useState,type FormEvent } from 'react';
import { expiryLotsLoad,expiryLotsRemove,expiryLotsSave } from './actions';

type Row=Record<string,unknown>;
type Result={ok?:boolean;error?:string;lots?:Row[];products?:Row[];branch_id?:string};
const number=(value:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(value??0));
const formatDate=(value:unknown)=>{const iso=String(value??'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return '—';const [y,m,d]=iso.split('-');return `${d}/${m}/${y}`;};
const classification=(days:number)=>days<0?'Vencido':days<=30?'Até 30 dias':days<=45?'31–45 dias':days<=60?'46–60 dias':days<=90?'61–90 dias':'Mais de 90 dias';
const initialForm={id:'',product_id:'',lot_number:'',expiry_date:'',quantity:''};
export function ExpiryLotsWorkspace({initial}:{initial:Result}){
 const [data,setData]=useState<Result>(initial),[form,setForm]=useState(initialForm);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[search,setSearch]=useState(''),[group,setGroup]=useState('all');
 const lots=useMemo(()=>Array.isArray(data.lots)?data.lots:[],[data.lots]);
 const products=Array.isArray(data.products)?data.products:[];
 const today=new Date();const localToday=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const daysTo=(date:unknown)=>Math.round((new Date(String(date).slice(0,10)+'T12:00:00').getTime()-new Date(localToday.getFullYear(),localToday.getMonth(),localToday.getDate(),12).getTime())/86400000);
 const active=lots.filter(row=>Number(row.quantity)>0);
 const filtered=active.filter(row=>{
  const hay=`${String(row.name??'')} ${String(row.sku??'')} ${String(row.lot_number??'')}`.toLowerCase();
  if(search&&!hay.includes(search.toLowerCase()))return false;
  const d=daysTo(row.expiry_date);
  return group==='all'||(group==='expired'&&d<0)||(group==='30'&&d>=0&&d<=30)||(group==='45'&&d>30&&d<=45)||(group==='60'&&d>45&&d<=60)||(group==='90'&&d>60&&d<=90)||(group==='90plus'&&d>90);
 });
 async function reload(){const result=await expiryLotsLoad();if(result.ok)setData(result);else setMessage(String(result.error??'Não foi possível atualizar.'));}
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!form.product_id||!form.lot_number.trim()||!form.expiry_date||!form.quantity){setMessage('Preencha os campos obrigatórios.');return;}
  const quantity=Number(form.quantity);
  if(!Number.isFinite(quantity)||quantity<0){setMessage('Quantidade inválida.');return;}
  setBusy(true);setMessage('');
  try{
   const result=await expiryLotsSave({...form,id:form.id||null,quantity});
   if(!result.ok){setMessage('Falha ao salvar: '+String(result.error??'erro'));return;}
   setForm(initialForm);await reload();setMessage('Lote salvo. Os alertas de validade utilizarão esta informação.');
  }catch{setMessage('Falha de conexão ao salvar o lote.');}finally{setBusy(false);}
 }
 async function remove(row:Row){
  if(!window.confirm('Dar baixa no lote '+String(row.lot_number??'')+'? O registro será mantido para histórico, com quantidade zero.'))return;
  setBusy(true);setMessage('');
  try{
   const result=await expiryLotsRemove(String(row.id));
   if(!result.ok){setMessage('Falha ao dar baixa: '+String(result.error??'erro'));return;}
   await reload();setMessage('Baixa registrada: lote sem saldo e fora dos alertas de vencimento.');
  }catch{setMessage('Falha de conexão ao dar baixa.');}finally{setBusy(false);}
 }
 const change=(key:keyof typeof initialForm,value:string)=>setForm(prev=>({...prev,[key]:value}));
 const alerts=[{title:'Vencidos',count:active.filter(r=>daysTo(r.expiry_date)<0).length,className:'expired'},
 {title:'Até 30 dias',count:active.filter(r=>daysTo(r.expiry_date)>=0&&daysTo(r.expiry_date)<=30).length,className:'soon'},
 {title:'31 a 45 dias',count:active.filter(r=>daysTo(r.expiry_date)>30&&daysTo(r.expiry_date)<=45).length,className:''},
 {title:'46 a 60 dias',count:active.filter(r=>daysTo(r.expiry_date)>45&&daysTo(r.expiry_date)<=60).length,className:''},
 {title:'61 a 90 dias',count:active.filter(r=>daysTo(r.expiry_date)>60&&daysTo(r.expiry_date)<=90).length,className:''},
 {title:'Mais de 90 dias',count:active.filter(r=>daysTo(r.expiry_date)>90).length,className:''}];
 return <div className="lot-workspace">
  {!data.ok?<div className="lot-notice">Não foi possível consultar lotes: {String(data.error??'Verifique a migração no Supabase.')}</div>:null}
  <section className="lot-summary">{alerts.map(a=><div key={a.title} className={`lot-summary-card ${a.className}`}><span>{a.title}</span><strong>{a.count}</strong><small>Lotes com saldo</small></div>)}</section>
  <section className="lot-panel"><div className="lot-section-heading"><div><span>CADASTRO POR LOTE</span><h2>{form.id?'Editar lote':'Cadastrar lote e validade'}</h2><p>A validade é cadastrada individualmente por produto e lote. O saldo aqui não movimenta o estoque físico.</p></div></div>
   <form className="lot-form" onSubmit={save}>
    <label>Produto<select required value={form.product_id} onChange={e=>change('product_id',e.target.value)}><option value="">Selecione um produto…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {String(p.sku??'Sem código')} · estoque {number(p.stock)}</option>)}</select></label>
    <label>Número do lote<input required maxLength={100} value={form.lot_number} onChange={e=>change('lot_number',e.target.value)} placeholder="Ex.: LT-2026-001"/></label>
    <label>Data de validade<input required type="date" value={form.expiry_date} onChange={e=>change('expiry_date',e.target.value)}/></label>
    <label>Quantidade no lote<input required type="number" min="0" step="0.001" value={form.quantity} onChange={e=>change('quantity',e.target.value)} placeholder="0"/></label>
    <div className="lot-form-buttons"><button type="submit" className="erp-primary" disabled={busy||!data.ok}>{busy?'Salvando…':form.id?'Atualizar lote':'Cadastrar lote'}</button>{form.id?<button className="erp-ghost" type="button" onClick={()=>setForm(initialForm)}>Cancelar edição</button>:null}</div>
   </form>
   <p className="lot-footnote">Atenção: datas e quantidades devem corresponder ao lote físico. Lotes vencidos exigem tratamento operacional conforme as regras do estabelecimento.</p>
   {message?<p role="status" className="lot-notice">{message}</p>:null}
  </section>
  <section className="lot-panel"><div className="lot-section-heading"><div><span>CONSULTA E ACOMPANHAMENTO</span><h2>Lotes cadastrados</h2><p>Somente a filial vinculada à sessão. Registros com saldo zero não aparecem na lista ativa.</p></div><button className="erp-ghost" type="button" onClick={()=>void reload()} disabled={busy}>Atualizar</button></div>
   <div className="lot-filters"><input aria-label="Buscar por nome, código ou lote" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, código ou lote…"/><select aria-label="Filtrar vencimentos" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Todas as validades</option><option value="expired">Vencidos</option><option value="30">Até 30 dias</option><option value="45">31 a 45 dias</option><option value="60">46 a 60 dias</option><option value="90">61 a 90 dias</option><option value="90plus">Mais de 90 dias</option></select></div>
   <div className="lot-table-wrap"><table className="lot-table"><thead><tr><th>Produto</th><th>Lote</th><th>Validade</th><th>Prazo</th><th>Quantidade</th><th>Ações</th></tr></thead><tbody>{filtered.length?filtered.map(r=>{const days=daysTo(r.expiry_date);return <tr key={String(r.id)}><td><b>{String(r.name??'Produto')}</b><small>{String(r.sku??'')}</small></td><td>{String(r.lot_number??'')}</td><td>{formatDate(r.expiry_date)}</td><td><span className={`lot-status ${days<0?'expired':days<=30?'soon':''}`}>{classification(days)}{days<0?` · ${Math.abs(days)}d`:''}</span></td><td>{number(r.quantity)}</td><td><div className="lot-row-actions"><button type="button" disabled={busy} onClick={()=>{setForm({id:String(r.id),product_id:String(r.product_id),lot_number:String(r.lot_number),expiry_date:String(r.expiry_date).slice(0,10),quantity:String(r.quantity)});window.scrollTo({top:0,behavior:'smooth'});}}>Editar</button><button type="button" disabled={busy} onClick={()=>void remove(r)}>Dar baixa</button></div></td></tr>;}):<tr><td colSpan={6} className="lot-empty">Nenhum lote com saldo encontrado. Cadastre as validades para ativar os alertas.</td></tr>}</tbody></table></div>
  </section>
 </div>;
}
