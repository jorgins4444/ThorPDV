'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { erpStockLocationDelete, erpStockLocationSave } from './stock-location-actions';

type Row=Record<string,unknown>;
const num=(v:unknown)=>Number(v??0)||0;

function friendlyError(error:unknown){
  const code=String(error??'erro');
  if(code.includes('stock_location_has_movements'))return 'Este estoque não pode ser excluído porque já possui movimentações. O histórico será preservado.';
  if(code.includes('stock_location_has_balance'))return 'Este estoque não pode ser excluído ou desativado porque ainda possui saldo.';
  if(code.includes('only_stock_location_cannot_be_deleted'))return 'O único estoque ativo da filial não pode ser excluído.';
  if(code.includes('default_stock_location_cannot_be_disabled'))return 'O estoque padrão não pode ser desativado.';
  if(code.includes('duplicate_stock_location'))return 'Já existe um estoque com este nome ou código.';
  return code;
}

export function StockLocationsWorkspace({locations,branches}:{locations:Row[];branches:Row[]}){
  const router=useRouter();
  const [rows,setRows]=useState<Row[]>(locations);
  const [showNew,setShowNew]=useState(false);
  const [name,setName]=useState('');
  const [code,setCode]=useState('');
  const [branchId,setBranchId]=useState(String(branches.find(b=>Boolean(b.is_headquarters))?.id??branches[0]?.id??''));
  const [makeDefault,setMakeDefault]=useState(false);
  const [allowNegative,setAllowNegative]=useState(false);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [busyId,setBusyId]=useState('');

  useEffect(()=>{setRows(locations)},[locations]);

  function resetNew(){setName('');setCode('');setMakeDefault(false);setAllowNegative(false);}

  async function create(e:FormEvent){
    e.preventDefault();setSaving(true);setMessage('');
    const r=await erpStockLocationSave({name,code:code||null,branch_id:branchId,is_default:makeDefault,active:true,allow_negative_stock:allowNegative});
    setSaving(false);
    if(r.ok){resetNew();setShowNew(false);router.refresh();}
    else setMessage(`Não foi possível criar o estoque: ${friendlyError(r.error)}`);
  }

  async function saveRow(row:Row,changes:{isDefault?:boolean;active?:boolean;allowNegative?:boolean}){
    const id=String(row.id);setBusyId(id);setMessage('');
    const nextDefault=changes.isDefault??Boolean(row.is_default);
    const nextActive=changes.active??row.active!==false;
    const nextAllowNegative=changes.allowNegative??Boolean(row.allow_negative_stock);
    const r=await erpStockLocationSave({
      id:row.id,
      name:row.name,
      code:row.code??null,
      branch_id:row.branch_id,
      is_default:nextDefault,
      active:nextActive,
      allow_negative_stock:nextAllowNegative
    });
    setBusyId('');
    if(r.ok){
      setRows(current=>current.map(item=>{
        if(String(item.id)===id)return {...item,is_default:nextDefault,active:nextActive,allow_negative_stock:nextAllowNegative};
        if(changes.isDefault===true&&String(item.branch_id)===String(row.branch_id))return {...item,is_default:false};
        return item;
      }));
      router.refresh();
    }else setMessage(`Não foi possível alterar o estoque: ${friendlyError(r.error)}`);
  }

  async function deleteRow(row:Row){
    const rowName=String(row.name??'estoque');
    if(!window.confirm(`Excluir o estoque "${rowName}"? Esta ação só será permitida se nunca tiver existido movimentação de produtos neste estoque.`))return;
    const id=String(row.id);setBusyId(id);setMessage('');
    const r=await erpStockLocationDelete(id);
    setBusyId('');
    if(r.ok){setRows(current=>current.filter(item=>String(item.id)!==id));router.refresh();}
    else setMessage(`Não foi possível excluir: ${friendlyError(r.error)}`);
  }

  return <div className="erp-stock-location-page">
    <section className="erp-module-card erp-stock-location-section">
      <div className="erp-stock-location-head">
        <div><h2>Estoques cadastrados</h2><p>Cadastre estoques físicos por filial e defina a política de saldo individualmente para cada um.</p></div>
        <button className="erp-primary erp-stock-new-button" type="button" onClick={()=>{setMessage('');setShowNew(true)}}>+ Novo Estoque</button>
      </div>
      {message&&<p className="erp-message">{message}</p>}
      <div className="erp-stock-location-grid">{rows.map(row=>{
        const hasOtherActive=rows.some(other=>String(other.id)!==String(row.id)&&String(other.branch_id)===String(row.branch_id)&&other.active!==false);
        const canDelete=Boolean(row.can_delete)&&(!Boolean(row.is_default)||hasOtherActive);
        const movementCount=num(row.movement_count);
        const isBusy=busyId===String(row.id);
        const negativeAllowed=Boolean(row.allow_negative_stock);
        return <article className={`erp-stock-location-card ${row.active===false?'disabled':''}`} key={String(row.id)}>
          <div className="erp-stock-location-copy">
            <small>{String(row.branch_name??'')}</small>
            <h3>{String(row.name)}</h3>
            <p>{Boolean(row.code)?`Código ${String(row.code)}`:'Sem código'} · {movementCount.toLocaleString('pt-BR')} movimentação(ões)</p>
          </div>
          <div className="erp-stock-location-badges">
            {Boolean(row.is_default)&&<span className="erp-pill">Padrão</span>}
            <span>{num(row.total_quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})} un. líquidas</span>
          </div>
          <div className="erp-stock-policy-card">
            <div>
              <strong>{negativeAllowed?'Permitir estoque negativo':'Bloquear estoque negativo'}</strong>
              <small>{negativeAllowed?'Vendas vinculadas a este estoque podem deixar o saldo abaixo de zero.':'Vendas vinculadas a este estoque são bloqueadas quando o saldo for insuficiente.'}</small>
            </div>
            <label className="erp-stock-switch" title="Permitir estoque negativo">
              <input type="checkbox" checked={negativeAllowed} disabled={isBusy||row.active===false} onChange={e=>saveRow(row,{allowNegative:e.target.checked})}/>
              <span/>
            </label>
          </div>
          <div className="erp-stock-location-actions">
            {!Boolean(row.is_default)&&row.active!==false&&<button className="erp-ghost" disabled={isBusy} type="button" onClick={()=>saveRow(row,{isDefault:true,active:true})}>Tornar padrão</button>}
            {!Boolean(row.is_default)&&<button className="erp-ghost" disabled={isBusy} type="button" onClick={()=>saveRow(row,{active:row.active===false})}>{row.active===false?'Ativar':'Desativar'}</button>}
            {canDelete&&<button className="erp-ghost" disabled={isBusy} type="button" onClick={()=>deleteRow(row)}>Excluir estoque</button>}
          </div>
          <div className="erp-stock-location-integrity-note">{!canDelete&&<small>Exclusão protegida para preservar histórico, saldos e integridade das movimentações.</small>}</div>
        </article>;
      })}</div>
    </section>

    {showNew&&<div className="erp-modal-backdrop erp-stock-modal-backdrop" onMouseDown={()=>!saving&&setShowNew(false)}>
      <div className="erp-modal erp-stock-modal" role="dialog" aria-modal="true" aria-labelledby="erp-new-stock-title" onMouseDown={e=>e.stopPropagation()}>
        <div className="erp-modal-head"><div><h2 id="erp-new-stock-title">Novo Estoque</h2><p>Crie um estoque físico e configure sua política de saldo.</p></div><button type="button" aria-label="Fechar" onClick={()=>!saving&&setShowNew(false)}>×</button></div>
        <form onSubmit={create}>
          <div className="erp-form-grid erp-stock-modal-grid">
            <label>Nome<input required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Depósito, Loja 2, Câmara Fria"/></label>
            <label>Código<input maxLength={30} value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Opcional"/></label>
            <label>Filial vinculada<select required value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={String(b.id)} value={String(b.id)}>{String(b.name)}{Boolean(b.is_headquarters)?' — Matriz':''}</option>)}</select></label>
            <label className="erp-stock-checkbox"><input type="checkbox" checked={makeDefault} onChange={e=>setMakeDefault(e.target.checked)}/><span>Tornar estoque padrão desta filial</span></label>
            <label className="erp-stock-checkbox"><input type="checkbox" checked={allowNegative} onChange={e=>setAllowNegative(e.target.checked)}/><span>Permitir estoque negativo neste estoque</span></label>
          </div>
          <div className="erp-modal-actions"><button type="button" className="erp-ghost" disabled={saving} onClick={()=>setShowNew(false)}>Cancelar</button><button className="erp-primary" disabled={saving||!name.trim()||!branchId}>{saving?'Salvando...':'Criar Estoque'}</button></div>
        </form>
      </div>
    </div>}
  </div>;
}
