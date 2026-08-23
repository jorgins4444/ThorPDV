'use client';

import { useEffect, useState } from 'react';
import { SaleWorkspaceV070 } from './sale-workspace-v070';
import { salesOptionsGet } from './sales-options-actions';

type Row=Record<string,unknown>;
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const EMPTY:SalesOptions={payment_methods:[],payment_terms:[],card_brands:[],card_acquirers:[],credit_installments:[]};

const FULLSCREEN_CSS=`
.erp-sale-fullscreen-shell{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;overflow:hidden;background:#f4f4f8;color:#202033;font-family:Inter,Arial,sans-serif}
.erp-sale-fullscreen-header{height:58px;flex:0 0 58px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;padding:0 18px;background:#211c35;color:#fff;box-shadow:0 4px 18px rgba(20,16,40,.18)}
.erp-sale-fullscreen-header>div{display:flex;align-items:baseline;gap:9px}.erp-sale-fullscreen-header small{font-size:9px;font-weight:900;letter-spacing:.12em;color:#bfaef1}.erp-sale-fullscreen-header strong{font-size:15px}.erp-sale-back{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.08);color:#fff!important;text-decoration:none!important;font-size:11px;font-weight:850}.erp-sale-back:hover{background:rgba(255,255,255,.15)}
.erp-sale-fullscreen-status{font-size:10px;font-weight:800;color:#9df0bf}.erp-sale-fullscreen-shell>.erp-sale-workspace{flex:1;min-height:0;overflow:auto;padding:12px 14px 14px}.erp-sale-fullscreen-shell .erp-sale-main-grid{min-height:calc(100vh - 156px)}
.erp-sale-fullscreen-loading{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#f5f4f8;color:#2d2940}.erp-sale-fullscreen-loading strong{font-size:20px}.erp-sale-fullscreen-loading span{font-size:12px;color:#747183}.erp-sale-fullscreen-loading.error strong{color:#a83a3a}.erp-sale-fullscreen-loading a{margin-top:10px;color:#6335c7;font-weight:800;text-decoration:none}
.erp-sale-product-row{grid-template-columns:52px 72px minmax(0,1fr) auto!important}.erp-sale-product-thumb{position:relative;width:46px;height:46px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#f1eff6;color:#9b94ae;font-size:17px}.erp-sale-product-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff}.erp-sale-empty-state.search{padding:24px}.erp-sale-search-empty-icon{font-size:42px!important;line-height:1;color:#9b82dd}.erp-sale-empty-state.search span:last-child{max-width:360px;line-height:1.5}
@media(max-width:900px){.erp-sale-fullscreen-header{grid-template-columns:auto 1fr}.erp-sale-fullscreen-status{display:none}.erp-sale-product-row{grid-template-columns:48px 60px minmax(0,1fr)!important}.erp-sale-product-row>strong{grid-column:3;justify-self:start}.erp-sale-fullscreen-shell>.erp-sale-workspace{padding:8px}}
`;

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

  if(loading)return <><style>{FULLSCREEN_CSS}</style><div className="erp-sale-fullscreen-loading"><strong>ThorGestão PDV</strong><span>Carregando opções da venda...</span></div></>;
  if(error)return <><style>{FULLSCREEN_CSS}</style><div className="erp-sale-fullscreen-loading error"><strong>Não foi possível abrir a Nova Venda</strong><span>{error}</span><a href="/dashboard/vendas">← Voltar para o ThorGestão</a></div></>;
  return <><style>{FULLSCREEN_CSS}</style><SaleWorkspaceV070 customers={customers} priceTables={priceTables} salesOptions={salesOptions}/></>;
}
