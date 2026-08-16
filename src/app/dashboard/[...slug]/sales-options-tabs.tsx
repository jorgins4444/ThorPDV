'use client';

import { useState } from 'react';
import { SalesOptionsWorkspace } from './sales-options-workspace';
import { SalesSessionRules } from './sales-session-rules';

type Row=Record<string,unknown>;
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[];session_rules:Record<string,unknown>};

export function SalesOptionsTabs({initial}:{initial:SalesOptions}){
  const [tab,setTab]=useState<'session'|'commercial'>('session');
  return <div className="erp-sales-options-tabs-shell">
    <nav className="erp-sales-options-tabs" aria-label="Seções das opções de vendas">
      <button type="button" className={tab==='session'?'active':''} onClick={()=>setTab('session')}><b>Sessão</b><small>Cliente, vendedor e regras da operação</small></button>
      <button type="button" className={tab==='commercial'?'active':''} onClick={()=>setTab('commercial')}><b>Pagamentos e condições</b><small>Meios, cartões, credenciadoras e venda a prazo</small></button>
    </nav>
    {tab==='session'?<SalesSessionRules initial={initial.session_rules}/>:<SalesOptionsWorkspace initial={{payment_methods:initial.payment_methods,payment_terms:initial.payment_terms,card_brands:initial.card_brands,card_acquirers:initial.card_acquirers,credit_installments:initial.credit_installments}}/>}
  </div>;
}
