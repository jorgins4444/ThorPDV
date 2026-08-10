'use client';

import { FormEvent, useMemo, useState } from 'react';
import { erpSave } from './actions';

type Row=Record<string,unknown>;
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const num=(v:unknown)=>{const n=Number(v??0);return Number.isFinite(n)?n:0};

export function StockTransferLocations({products,locations,balances,history}:{products:Row[];locations:Row[];balances:Row[];history:Row[]}){
  const active=locations.filter(l=>l.active!==false);
  const defaultId=String(active.find(l=>Boolean(l.is_default))?.id??active[0]?.id??'');
  const [source,setSource]=useState(defaultId);
  const [destination,setDestination]=useState('');
  const [productId,setProductId]=useState('');
  const [quantity,setQuantity]=useState(1);
  const [notes,setNotes]=useState('');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const localBalances=useMemo(()=>new Map(balances.filter(b=>String(b.stock_location_id)===source).map(b=>[String(b.product_id),num(b.available)])),[balances,source]);
  const transferRows=history.filter(r=>String(r.movement_type).startsWith('transfer_'));

  async function submit(e:FormEvent){
    e.preventDefault();
    if(source===destination){setMessage('Origem e destino precisam ser locais diferentes.');return;}
    setSaving(true);
    const r=await erpSave('stock',{product_id:productId,stock_location_id:source,destination_stock_location_id:destination,movement_type:'transfer',quantity,notes});
    setSaving(false);
    if(r.ok){setMessage('Transferência concluída entre os locais de estoque.');window.location.reload();}
    else setMessage(`Não foi possível transferir: ${String(r.error??'erro')}`);
  }

  return <section className="erp-module-card">
    <div className="erp-advanced-head"><h2>Transferência entre Locais de Estoque</h2><p>Move a quantidade do local de origem para o destino sem alterar o total geral quando os dois pertencem à mesma filial.</p></div>
    <form className="erp-form-grid erp-advanced-form" onSubmit={submit}>
      <label>Local de origem<select required value={source} onChange={e=>{setSource(e.target.value);setProductId('');}}><option value="">Selecione...</option>{active.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)} — {String(l.branch_name??'')}</option>)}</select></label>
      <label>Local de destino<select required value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Selecione...</option>{active.filter(l=>String(l.id)!==source).map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)} — {String(l.branch_name??'')}</option>)}</select></label>
      <label>Produto<select required value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecione...</option>{products.filter(p=>p.active!==false).map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — saldo origem {String(localBalances.get(String(p.id))??0)}</option>)}</select></label>
      <label>Quantidade<input required type="number" min="0.001" step="0.001" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
      <label className="wide">Observação<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Motivo, documento ou responsável"/></label>
      <button className="erp-primary" disabled={saving||!source||!destination||!productId}>{saving?'Transferindo...':'Confirmar transferência'}</button>
    </form>
    {message&&<p className="erp-message">{message}</p>}
    <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Local</th><th>Filial</th><th>Observação</th></tr></thead><tbody>{transferRows.length===0?<tr><td className="erp-empty" colSpan={7}>Nenhuma transferência registrada.</td></tr>:transferRows.map((r,i)=><tr key={String(r.id??i)}><td>{dt(r.created_at)}</td><td>{String(r.product??'')}</td><td><span className="erp-pill">{String(r.movement_type)}</span></td><td>{String(r.quantity??0)}</td><td>{String(r.stock_location??'')}</td><td>{String(r.branch??'')}</td><td>{String(r.notes??'—')}</td></tr>)}</tbody></table></div>
  </section>;
}
