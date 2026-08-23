'use client';

import { useEffect, useState } from 'react';
import { SaleWorkspaceV070 } from './sale-workspace-v070';
import { salesOptionsGet } from './sales-options-actions';

type Row=Record<string,unknown>;
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const EMPTY:SalesOptions={payment_methods:[],payment_terms:[],card_brands:[],card_acquirers:[],credit_installments:[]};

export function SaleWorkspace({customers,priceTables}:{customers:Row[];priceTables:Row[]}){
  const [salesOptions,setSalesOptions]=useState<SalesOptions>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    void salesOptionsGet().then(r=>{
      if(!active)return;
      if(r.ok){
        setSalesOptions({
          payment_methods:Array.isArray(r.payment_methods)?r.payment_methods:[],
          payment_terms:Array.isArray(r.payment_terms)?r.payment_terms:[],
          card_brands:Array.isArray(r.card_brands)?r.card_brands:[],
          card_acquirers:Array.isArray(r.card_acquirers)?r.card_acquirers:[],
          credit_installments:Array.isArray(r.credit_installments)?r.credit_installments:[],
        });
      }else setError(String(r.error??'Não foi possível carregar as formas de pagamento.'));
      setLoading(false);
    }).catch(e=>{
      if(!active)return;
      setError(e instanceof Error?e.message:'Não foi possível carregar as formas de pagamento.');
      setLoading(false);
    });
    return()=>{active=false};
  },[]);

  if(loading)return <div className="erp-sale-fullscreen-loading"><strong>ThorGestão PDV</strong><span>Carregando opções da venda...</span></div>;
  if(error)return <div className="erp-sale-fullscreen-loading error"><strong>Não foi possível abrir a Nova Venda</strong><span>{error}</span><a href="/dashboard/vendas">← Voltar para o ThorGestão</a></div>;
  return <SaleWorkspaceV070 customers={customers} priceTables={priceTables} salesOptions={salesOptions}/>;
}
