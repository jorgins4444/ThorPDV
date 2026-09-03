'use client';

import { useEffect, useState } from 'react';
import './sale-modern-layout.css';
import './sale-document-choice-v2.css';
import { SaleWorkspaceV070 } from './sale-workspace-v070';
import { salesOptionsGet } from './sales-options-actions';

type Row=Record<string,unknown>;
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const EMPTY:SalesOptions={payment_methods:[],payment_terms:[],card_brands:[],card_acquirers:[],credit_installments:[]};

const FULLSCREEN_CSS=`
.erp-sale-fullscreen-shell{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,#fbfbfe 0%,#f5f6fb 100%);color:#17162c;font-family:Arial,Calibri,sans-serif}
.erp-sale-fullscreen-header{min-height:86px;flex:0 0 auto;display:grid;grid-template-columns:minmax(330px,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:4px 20px;padding:16px 28px 14px;background:#fff;color:#17162c;border-bottom:1px solid #e8e8f2;box-shadow:0 6px 24px rgba(35,30,75,.05)}
.erp-sale-fullscreen-header>.erp-sale-back{grid-column:1;grid-row:1;justify-self:start}.erp-sale-fullscreen-header>div:nth-child(2){grid-column:1;grid-row:2;display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:2px!important}.erp-sale-fullscreen-header>div:nth-child(2) small{display:none}.erp-sale-fullscreen-header>div:nth-child(2) strong{font-size:26px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.03em;color:#17162c}.erp-sale-fullscreen-header>div:nth-child(2) strong::after{content:'Venda à vista ou a prazo usando as formas e condições definidas em Opções de Vendas.';display:block;margin-top:7px;font-size:12px;line-height:1.4;font-weight:500;letter-spacing:0;color:#68677b}
.erp-sale-back{display:inline-flex;align-items:center;min-height:31px;padding:0 11px;border:1px solid #d9cff7;border-radius:999px;background:#fff;color:#5d35d5!important;text-decoration:none!important;font-size:11px;font-weight:900}.erp-sale-back:hover{background:#f7f3ff;border-color:#bca9f2}
.erp-sale-header-actions{grid-column:2;grid-row:1/3;display:flex!important;align-items:stretch!important;justify-content:flex-end!important;gap:12px!important;flex-wrap:nowrap!important;min-width:470px;padding:10px 12px;border:1px solid #e4e2ed;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(48,39,100,.06)}
.erp-sale-fullscreen-shell>.erp-sale-workspace{flex:1;min-height:0;overflow:auto;padding:14px 28px 92px}.erp-sale-fullscreen-shell .erp-sale-main-grid{min-height:calc(100vh - 330px)}
.erp-sale-fullscreen-loading{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#f8f8fc;color:#2d2940}.erp-sale-fullscreen-loading strong{font-size:20px}.erp-sale-fullscreen-loading span{font-size:12px;color:#747183}.erp-sale-fullscreen-loading.error strong{color:#a83a3a}.erp-sale-fullscreen-loading a{margin-top:10px;color:#6335c7;font-weight:800;text-decoration:none}
.erp-sale-product-row{grid-template-columns:52px 72px minmax(0,1fr) auto!important}.erp-sale-product-thumb{position:relative;width:46px;height:46px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#f1eff6;color:#9b94ae;font-size:17px}.erp-sale-product-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff}.erp-sale-empty-state.search{padding:24px}.erp-sale-search-empty-icon{font-size:42px!important;line-height:1;color:#6740e8}.erp-sale-empty-state.search span:last-child{max-width:360px;line-height:1.5}
@media(max-width:1100px){.erp-sale-fullscreen-header{grid-template-columns:1fr}.erp-sale-header-actions{grid-column:1;grid-row:3;min-width:0;justify-content:flex-start!important}.erp-sale-fullscreen-header>div:nth-child(2){grid-column:1}.erp-sale-fullscreen-shell>.erp-sale-workspace{padding:12px 16px 92px}}
@media(max-width:900px){.erp-sale-fullscreen-header{padding:12px 14px}.erp-sale-fullscreen-header>div:nth-child(2) strong{font-size:22px!important}.erp-sale-header-actions{width:100%;overflow-x:auto}.erp-sale-product-row{grid-template-columns:48px 60px minmax(0,1fr)!important}.erp-sale-product-row>strong{grid-column:3;justify-self:start}.erp-sale-fullscreen-shell>.erp-sale-workspace{padding:8px 8px 92px}}
`;

export function SaleWorkspace({customers,priceTables,initialSalesOptions}:{customers:Row[];priceTables:Row[];initialSalesOptions?:SalesOptions}){
  const [salesOptions,setSalesOptions]=useState<SalesOptions>(initialSalesOptions??EMPTY);
  const [loading,setLoading]=useState(!initialSalesOptions);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(initialSalesOptions)return;
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
  },[initialSalesOptions]);

  if(loading)return <><style>{FULLSCREEN_CSS}</style><div className="erp-sale-fullscreen-loading"><strong>ThorGestão PDV</strong><span>Carregando opções da venda...</span></div></>;
  if(error)return <><style>{FULLSCREEN_CSS}</style><div className="erp-sale-fullscreen-loading error"><strong>Não foi possível abrir a Nova Venda</strong><span>{error}</span><a href="/dashboard/vendas">← Voltar para o ThorGestão</a></div></>;
  return <><style>{FULLSCREEN_CSS}</style><SaleWorkspaceV070 customers={customers} priceTables={priceTables} salesOptions={salesOptions}/></>;
}
