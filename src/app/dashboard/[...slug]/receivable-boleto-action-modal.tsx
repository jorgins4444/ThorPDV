'use client';

type Row=Record<string,unknown>;
type Props={row:Row;customers:Row[];integrations:Row[];initialBillings:Row[];onClose:()=>void};
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';

export function ReceivableBoletoActionModal({row,onClose}:Props){
  return <div className="erp-boleto-action-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="erp-boleto-action-modal" role="dialog" aria-modal="true" aria-label="Processar boleto por remessa">
      <header className="erp-boleto-action-header"><div><span>COBRANÇA BANCÁRIA</span><h2>Boleto por Remessa / Retorno</h2><p>{String(row.customer||'Cliente')} · vencimento {date(row.due_date)} · saldo {money(row.remaining)}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
      <div className="erp-boleto-action-body">
        <div style={{padding:'24px',display:'grid',gap:16}}>
          <div style={{padding:'18px',border:'1px solid #dde3ea',borderRadius:12,background:'#f8fafc'}}><strong style={{display:'block',fontSize:17,marginBottom:6}}>Cobrança via Itaú CNAB 400</strong><span>O ThorGestão não envia mais este boleto pela API BoleCode. O registro será feito por arquivo de remessa e a baixa será processada pelo arquivo retorno do banco.</span></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}><div><b>1. Remessa</b><small style={{display:'block',marginTop:4}}>Selecione este título e gere o arquivo .REM.</small></div><div><b>2. Itaú</b><small style={{display:'block',marginTop:4}}>Envie a remessa na transmissão de arquivos.</small></div><div><b>3. Retorno</b><small style={{display:'block',marginTop:4}}>Importe o .RET para baixar automaticamente.</small></div></div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:10}}><button type="button" onClick={onClose}>Fechar</button><a className="erp-primary" href="/dashboard/financeiro/remessa-retorno">Abrir Remessa / Retorno</a></div>
        </div>
      </div>
    </section>
  </div>;
}
