'use client';

import { useState } from 'react';
import { ReceivablesBolecodePanel } from './receivables-bolecode-panel';
import { simulateReceivableItauPayment } from './receivables-bolecode-actions';

type Row=Record<string,unknown>;

type Props={
  row:Row;
  customers:Row[];
  integrations:Row[];
  initialBillings:Row[];
  onClose:()=>void;
};

export function ReceivableBoletoActionModal({row,customers,integrations,initialBillings,onClose}:Props){
  const id=String(row.id||'');
  const billings=initialBillings.filter(b=>String(b.financial_entry_id)===id);
  const payableSandboxBilling=billings.find(b=>String(b.environment)==='sandbox'&&['issued','processing'].includes(String(b.status)));
  const [simulating,setSimulating]=useState(false);
  const [simulationMessage,setSimulationMessage]=useState('');

  async function simulatePayment(){
    if(!payableSandboxBilling?.id||simulating)return;
    setSimulating(true);
    setSimulationMessage('');
    const result=await simulateReceivableItauPayment(String(payableSandboxBilling.id));
    setSimulating(false);
    if(result.ok){
      const amount=Number(result.amount||row.remaining||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      setSimulationMessage(`✓ Evento bancário simulado processado. ${amount} baixado automaticamente no Contas a Receber.`);
      window.setTimeout(()=>window.location.reload(),900);
      return;
    }
    const error=String(result.error||'');
    if(error==='sandbox_only')setSimulationMessage('A simulação de liquidação é permitida somente no ambiente Sandbox.');
    else if(error==='billing_not_payable')setSimulationMessage('Este boleto não está em situação válida para simular pagamento.');
    else setSimulationMessage(String(result.detail||result.error||'Não foi possível simular a liquidação do boleto.'));
  }

  return <div className="erp-boleto-action-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="erp-boleto-action-modal" role="dialog" aria-modal="true" aria-label="Processar boleto Itaú">
      <header className="erp-boleto-action-header">
        <div><span>COBRANÇA BANCÁRIA</span><h2>Processar boleto Itaú</h2><p>{String(row.customer||'Cliente')} · vencimento {String(row.due_date||'—')} · saldo {Number(row.remaining||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      {payableSandboxBilling&&<div style={{padding:'12px 20px 0',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <button type="button" className="erp-primary" onClick={simulatePayment} disabled={simulating}>{simulating?'Simulando evento bancário…':'✓ Simular pagamento do boleto'}</button>
        <small>Sandbox: simula uma liquidação Itaú e executa a mesma baixa automática preparada para o webhook bancário.</small>
      </div>}
      {simulationMessage&&<div style={{padding:'10px 20px 0'}}><strong>{simulationMessage}</strong></div>}
      <div className="erp-boleto-action-body">
        <ReceivablesBolecodePanel receivables={[row]} customers={customers} integrations={integrations} initialBillings={billings}/>
      </div>
    </section>
  </div>;
}
