'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type ColumnDefinition={key:string;label:string;index:number;required:boolean};

const STORAGE_KEY='thor-gestao:products:list-columns:v1';
const COLUMNS:ColumnDefinition[]=[
  {key:'select',label:'Seleção',index:1,required:true},
  {key:'actions',label:'Ações',index:2,required:true},
  {key:'description',label:'Descrição',index:3,required:true},
  {key:'sku',label:'SKU',index:4,required:true},
  {key:'sale',label:'Venda',index:5,required:true},
  {key:'stock',label:'Estoque',index:6,required:true},
  {key:'unit',label:'UN',index:7,required:true},
  {key:'category',label:'Categoria',index:8,required:false},
  {key:'brand',label:'Marca',index:9,required:false},
  {key:'group',label:'Grupo',index:10,required:false},
  {key:'ncm',label:'NCM',index:11,required:false},
  {key:'tax',label:'Situação tributária',index:12,required:false},
  {key:'type',label:'Tipo',index:13,required:false},
  {key:'active',label:'Ativo',index:14,required:true},
];
const OPTIONAL=COLUMNS.filter(column=>!column.required);
const REQUIRED=COLUMNS.filter(column=>column.required&&column.key!=='select');

function loadPreference(){
  if(typeof window==='undefined')return [] as string[];
  try{
    const parsed=JSON.parse(window.localStorage.getItem(STORAGE_KEY)||'[]');
    if(!Array.isArray(parsed))return [];
    const allowed=new Set(OPTIONAL.map(column=>column.key));
    return parsed.map(String).filter(key=>allowed.has(key));
  }catch{return [] as string[];}
}

export function ProductListColumns(){
  const [enabled,setEnabled]=useState<string[]>([]);
  const [ready,setReady]=useState(false);
  const [host,setHost]=useState<HTMLElement|null>(null);

  useEffect(()=>{setEnabled(loadPreference());setReady(true);},[]);

  useEffect(()=>{
    let current:HTMLElement|null=null;
    const syncHost=()=>{
      const actions=document.querySelector('.enhanced-product-list .studio-list-toolbar > div:last-child');
      if(!(actions instanceof HTMLElement)){if(current){current.remove();current=null;setHost(null);}return;}
      let next=actions.querySelector(':scope > .product-column-picker-host');
      if(!(next instanceof HTMLElement)){
        next=document.createElement('div');
        next.className='product-column-picker-host';
        actions.insertBefore(next,actions.firstChild);
      }
      if(current!==next){current=next;setHost(next);}
    };
    syncHost();
    const observer=new MutationObserver(syncHost);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();current?.remove();};
  },[]);

  useEffect(()=>{
    if(!ready)return;
    try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(enabled));}catch{}
  },[enabled,ready]);

  const hiddenStyle=useMemo(()=>{
    const visible=new Set(enabled);
    const hidden=OPTIONAL.filter(column=>!visible.has(column.key));
    const rules=hidden.map(column=>`.enhanced-product-table th:nth-child(${column.index}),.enhanced-product-table td:nth-child(${column.index}){display:none!important}`).join('\n');
    const minWidth=980+(enabled.length*125);
    return `${rules}\n.enhanced-product-table{min-width:${minWidth}px!important}`;
  },[enabled]);

  const toggle=(key:string)=>setEnabled(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  const picker=<details className="product-column-picker">
    <summary title="Escolher colunas visíveis"><span>▥</span> Colunas <b>{REQUIRED.length+enabled.length}</b></summary>
    <div className="product-column-popover">
      <header><div><strong>Colunas da listagem</strong><small>Escolha quais informações complementares deseja exibir.</small></div></header>
      <section>
        <span className="product-column-section-title">Sempre visíveis</span>
        <div className="product-column-options required">{REQUIRED.map(column=><label key={column.key}><input type="checkbox" checked disabled/><span>{column.label}</span><em>Obrigatória</em></label>)}</div>
      </section>
      <section>
        <span className="product-column-section-title">Opcionais</span>
        <div className="product-column-options">{OPTIONAL.map(column=><label key={column.key}><input type="checkbox" checked={enabled.includes(column.key)} onChange={()=>toggle(column.key)}/><span>{column.label}</span></label>)}</div>
      </section>
      <footer><button type="button" onClick={()=>setEnabled([])}>Somente essenciais</button><button type="button" onClick={()=>setEnabled(OPTIONAL.map(column=>column.key))}>Mostrar todas</button></footer>
    </div>
  </details>;

  return <>{ready&&<style>{hiddenStyle}</style>}{host?createPortal(picker,host):null}</>;
}
