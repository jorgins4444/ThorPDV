'use client';

import { FormEvent, useState } from 'react';
import { erpStockLocationSave } from './stock-location-actions';

type Row=Record<string,unknown>;
const num=(v:unknown)=>Number(v??0)||0;

export function StockLocationsWorkspace({locations,branches,balances}:{locations:Row[];branches:Row[];balances:Row[]}){
  const [name,setName]=useState('');
  const [code,setCode]=useState('');
  const [branchId,setBranchId]=useState(String(branches.find(b=>Boolean(b.is_headquarters))?.id??branches[0]?.id??''));
  const [makeDefault,setMakeDefault]=useState(false);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  async function create(e:FormEvent){
    e.preventDefault();setSaving(true);
    const r=await erpStockLocationSave({name,code:code||null,branch_id:branchId,is_default:makeDefault,active:true});
    setSaving(false);
    if(r.ok){setMessage('Local de estoque criado.');window.location.reload();}
    else setMessage(`Não foi possível criar: ${String(r.error??'erro')}`);
  }

  async function saveRow(row:Row,isDefault:boolean,active:boolean){
    const r=await erpStockLocationSave({id:row.id,name:row.name,code:row.code??null,branch_id:row.branch_id,is_default:isDefault,active});
    if(r.ok)window.location.reload();else setMessage(`Não foi possível alterar: ${String(r.error??'erro')}`);
  }

  return <div className="erp-stock-location-page">
    <section className="erp-module-card">
      <div className="erp-advanced-head"><h2>Novo Local de Estoque</h2><p>Separe fisicamente os saldos. A Matriz é criada automaticamente como padrão.</p></div>
      <form className="erp-form-grid erp-advanced-form" onSubmit={create}>
        <label>Nome<input required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Filial, Depósito, Loja 2"/></label>
        <label>Código<input maxLength={30} value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Opcional"/></label>
        <label>Filial vinculada<select required value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={String(b.id)} value={String(b.id)}>{String(b.name)}{Boolean(b.is_headquarters)?' — Matriz':''}</option>)}</select></label>
        <label className="erp-stock-checkbox"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)}/><span>Tornar padrão desta filial</span></label>
        <button className="erp-primary" disabled={saving||!name.trim()||!branchId}>{saving?'Salvando...':'Criar local'}</button>
      </form>
      {message&&<p className="erp-message">{message}</p>}
    </section>
    <section className="erp-module-card">
      <div className="erp-advanced-head"><h2>Locais cadastrados</h2><p>O local padrão recebe as movimentações quando nenhum outro local for informado.</p></div>
      <div className="erp-stock-location-grid">{locations.map(row=><article className={`erp-stock-location-card ${row.active===false?'disabled':''}`} key={String(row.id)}>
        <div><small>{String(row.branch_name??'')}</small><h3>{String(row.name)}</h3><p>{Boolean(row.code)?`Código ${String(row.code)}`:'Sem código'} · {num(row.product_count)} produto(s) com saldo</p></div>
        <div className="erp-stock-location-badges">{Boolean(row.is_default)&&<span className="erp-pill">Padrão</span>}<span>{num(row.total_quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})} un. líquidas</span></div>
        <div className="erp-stock-location-actions">{!Boolean(row.is_default)&&row.active!==false&&<button className="erp-ghost" type="button" onClick={()=>saveRow(row,true,true)}>Tornar padrão</button>}<button className="erp-ghost" type="button" onClick={()=>saveRow(row,Boolean(row.is_default),row.active===false)}>{row.active===false?'Ativar':'Desativar'}</button></div>
      </article>)}</div>
    </section>
    <section className="erp-module-card">
      <div className="erp-advanced-head"><h2>Produtos por Local de Estoque</h2><p>A posição abaixo mostra o saldo físico separado por local, sem misturar Matriz, Filial ou Depósito.</p></div>
      <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Local</th><th>Filial</th><th>Produto</th><th>Código</th><th>Unidade</th><th>Quantidade</th><th>Reservado</th><th>Disponível</th></tr></thead><tbody>{balances.length===0?<tr><td colSpan={8} className="erp-empty">Nenhum saldo por local.</td></tr>:balances.map((b,i)=><tr key={`${String(b.stock_location_id)}-${String(b.product_id)}-${i}`}><td><strong>{String(b.location_name??'')}</strong></td><td>{String(b.branch_name??'')}</td><td>{String(b.product_name??'')}</td><td>{String(b.product_code??b.sku??'—')}</td><td>{String(b.unit??'UN')}</td><td>{num(b.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td><td>{num(b.reserved_quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td><td><strong>{num(b.available).toLocaleString('pt-BR',{maximumFractionDigits:3})}</strong></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
