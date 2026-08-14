'use client';

import { ReceivablesBolecodePanel } from './receivables-bolecode-panel';

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
  return <div className="erp-boleto-action-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="erp-boleto-action-modal" role="dialog" aria-modal="true" aria-label="Processar boleto Itaú">
      <header className="erp-boleto-action-header">
        <div><span>COBRANÇA BANCÁRIA</span><h2>Processar boleto Itaú</h2><p>{String(row.customer||'Cliente')} · vencimento {String(row.due_date||'—')} · saldo {Number(row.remaining||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      <div className="erp-boleto-action-body">
        <ReceivablesBolecodePanel receivables={[row]} customers={customers} integrations={integrations} initialBillings={billings}/>
      </div>
    </section>
  </div>;
}
