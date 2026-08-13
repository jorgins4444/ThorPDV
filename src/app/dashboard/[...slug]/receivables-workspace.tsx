'use client';

import { useMemo, useState, useTransition } from 'react';
import { erpReceivableDetail, erpReceivablesList, erpReverseReceivable, erpSettleReceivable, type ReceivableFilters } from './receivables-actions';

type Row=Record<string,unknown>;
type Props={initial:Row[];customers:Row[];accounts:Row[];paymentMethods:Row[]};

const statusLabels:Record<string,string>={open:'Em aberto',paid:'Quitado',partial:'Parcial',overdue:'Vencido',cancelled:'Estornado'};
const documentLabels:Record<string,string>={boleto:'Boleto',crediario:'Crediário'};
const methodLabels:Record<string,string>={cash:'Dinheiro',pix:'PIX',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',voucher:'Voucher',bank_transfer:'Transferência'};
const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:unknown)=>{if(!value)return '—';const raw=String(value);const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR')};
const time=(value:unknown)=>{if(!value)return '—';const d=new Date(String(value));return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};
const dateTime=(value:unknown)=>{if(!value)return '—';const d=new Date(String(value));return Number.isNaN(d.getTime())?String(value):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})};
const statusLabel=(value:unknown)=>statusLabels[String(value)]||String(value||'—');
const docLabel=(value:unknown)=>documentLabels[String(value)]||String(value||'—');
const methodLabel=(value:unknown)=>methodLabels[String(value)]||String(value||'—');
const today=()=>new Date().toISOString().slice(0,10);
const errorLabel=(value:unknown)=>{const e=String(value||'erro');const labels:Record<string,string>={
  invalid_settlement_amount:'Valor inválido para a baixa.',
  invalid_payment_method:'Forma de pagamento indisponível.',
  destination_required:'Selecione a conta de destino.',
  financial_account_destination_required:'Selecione uma Conta Bancária ou o Caixa Interno.',
  bank_account_not_found:'Conta de destino não encontrada ou inativa.',
  internal_cash_requires_cash_payment:'O Caixa Interno aceita recebimentos em dinheiro. Para PIX, cartão ou transferência, selecione uma conta bancária.',
  term_receivable_only:'Somente títulos de Venda a Prazo (Crediário ou Boleto) podem ser operados neste módulo.',
  reversal_reason_required:'Informe o motivo do estorno com pelo menos 3 caracteres.',
  legacy_settlement_requires_manual_reversal:'Este título possui um recebimento antigo que precisa de tratamento manual antes do estorno.',
  settlement_ledger_missing:'Não foi encontrada a movimentação financeira vinculada ao recebimento.',
};return labels[e]||e};

const empty:ReceivableFilters={issuedFrom:'',issuedTo:'',documentType:'',customerId:'',dueFrom:'',dueTo:'',paidFrom:'',paidTo:''};

export function ReceivablesWorkspace({initial,customers,accounts,paymentMethods}:Props){
  const [rows,setRows]=useState<Row[]>(initial);
  const [filters,setFilters]=useState<ReceivableFilters>(empty);
  const [message,setMessage]=useState('');
  const [pending,startTransition]=useTransition();
  const [selected,setSelected]=useState<Row|null>(null);
  const [method,setMethod]=useState('cash');
  const [accountId,setAccountId]=useState('');
  const [settleAmount,setSettleAmount]=useState(0);
  const [settleDate,setSettleDate]=useState(today());
  const [notes,setNotes]=useState('');
  const [settling,setSettling]=useState(false);
  const [detail,setDetail]=useState<Row|null>(null);
  const [detailLoadingId,setDetailLoadingId]=useState('');
  const [reverseTarget,setReverseTarget]=useState<Row|null>(null);
  const [reverseReason,setReverseReason]=useState('');
  const [reversing,setReversing]=useState(false);

  const activeAccounts=useMemo(()=>accounts.filter(a=>a.active!==false&&['bank','internal_cash'].includes(String(a.account_type))),[accounts]);
  const bankOnly=useMemo(()=>activeAccounts.filter(a=>a.account_type==='bank'),[activeAccounts]);
  const internalCash=useMemo(()=>activeAccounts.find(a=>a.account_type==='internal_cash'),[activeAccounts]);
  const settlementMethods=useMemo(()=>{
    const allowed=paymentMethods.filter(m=>!['term_sale','store_credit'].includes(String(m.code)));
    return allowed.length?allowed:[{code:'cash',name:'Dinheiro'}];
  },[paymentMethods]);
  const totals=useMemo(()=>rows.reduce<{amount:number;paid:number}>((acc,row)=>{if(String(row.status)==='cancelled')return acc;acc.amount+=Number(row.amount||0);acc.paid+=Number(row.paid_amount||0);return acc;},{amount:0,paid:0}),[rows]);
  const destinationAccounts=method==='cash'?activeAccounts:bankOnly;

  const detailTitle=(detail?.title as Row|undefined)??{};
  const detailOperation=(detail?.operation as Row|undefined)??{};
  const detailNfce=(detail?.nfce as Row|undefined)??{};
  const detailReceipt=(detail?.receipt_summary as Row|undefined)??{};
  const detailProducts=Array.isArray(detail?.products)?detail.products as Row[]:[];
  const detailReceipts=Array.isArray(detail?.receipts)?detail.receipts as Row[]:[];

  const set=(key:keyof ReceivableFilters,value:string)=>setFilters(current=>({...current,[key]:value}));
  const load=(next:ReceivableFilters=filters)=>startTransition(async()=>{const result=await erpReceivablesList(next);if(result.ok){setRows(result.data);setMessage('');}else setMessage(String(result.error||'Não foi possível consultar as contas a receber.'));});
  const clear=()=>{setFilters(empty);load(empty);};

  async function reloadRows(){const result=await erpReceivablesList(filters);if(result.ok)setRows(result.data);}

  function defaultAccount(nextMethod:string){
    if(nextMethod==='cash')return String(internalCash?.id??activeAccounts[0]?.id??'');
    return String(bankOnly[0]?.id??'');
  }

  function openSettlement(row:Row){
    const firstMethod=String(settlementMethods.find(m=>String(m.code)==='cash')?.code??settlementMethods[0]?.code??'cash');
    setDetail(null);
    setSelected(row);
    setMethod(firstMethod);
    setAccountId(defaultAccount(firstMethod));
    setSettleAmount(Number(row.remaining??Math.max(Number(row.amount||0)-Number(row.paid_amount||0),0)));
    setSettleDate(today());
    setNotes('');
  }

  function changeMethod(next:string){setMethod(next);setAccountId(defaultAccount(next));}

  async function settle(){
    if(!selected||!accountId)return;
    setSettling(true);setMessage('');
    const settledAt=settleDate?`${settleDate}T12:00:00-03:00`:new Date().toISOString();
    const r=await erpSettleReceivable(String(selected.id),{
      amount:settleAmount,payment_method:method,destination_type:'bank_account',bank_account_id:accountId,cash_session_id:null,settled_at:settledAt,notes,
    });
    setSettling(false);
    if(r.ok){
      const destination=destinationAccounts.find(a=>String(a.id)===accountId);
      const destinationName=String(destination?.name||'conta financeira');
      setMessage(Number(r.remaining||0)<=0.001?`Título quitado. Valor recebido em ${destinationName}.`:`Recebimento parcial registrado em ${destinationName}.`);
      setSelected(null);await reloadRows();
    }else setMessage(`Não foi possível receber: ${errorLabel(r.error)}`);
  }

  async function openDetails(row:Row){
    const id=String(row.id||'');if(!id)return;
    setDetailLoadingId(id);setMessage('');
    const r=await erpReceivableDetail(id);
    setDetailLoadingId('');
    if(r.ok){setSelected(null);setDetail(r)}else setMessage(`Não foi possível abrir os detalhes: ${errorLabel(r.error)}`);
  }

  function askReverse(row:Row){setReverseTarget(row);setReverseReason('');}

  async function reverseReceivable(){
    if(!reverseTarget||reverseReason.trim().length<3)return;
    setReversing(true);setMessage('');
    const r=await erpReverseReceivable(String(reverseTarget.id),reverseReason.trim());
    setReversing(false);
    if(r.ok){
      const reversed=Number(r.reversed_total||0);
      setMessage(reversed>0?`Conta estornada. ${money(reversed)} de recebimentos foram revertidos no financeiro.`:'Conta estornada. Não havia recebimento financeiro para reverter.');
      setReverseTarget(null);setDetail(null);setSelected(null);await reloadRows();
    }else setMessage(`Não foi possível estornar: ${errorLabel(r.error)}`);
  }

  const canSettle=Boolean(selected)&&settleAmount>0&&Boolean(accountId)&&destinationAccounts.some(a=>String(a.id)===accountId);
  const detailStatus=String(detailTitle.status||'open');
  const detailRow=rows.find(r=>String(r.id)===String(detailTitle.id))??detailTitle;

  return <div className="erp-receivables">
    <section className="erp-term-only-note">
      <div><span>CARTEIRA A PRAZO</span><strong>Somente Crediário e Boleto</strong><p>Vendas em Dinheiro, PIX, Débito, Crédito, Voucher e demais modalidades à vista não entram em Contas a Receber.</p></div>
      <div className="erp-term-destinations"><span>Recebimento</span><b>Conta Bancária</b><i>ou</i><b>Caixa Interno</b></div>
    </section>

    <section className="erp-module-card erp-receivable-filters">
      <div className="erp-receivable-filter-head"><div><h2>Filtros de Contas a Receber</h2><p>Consulte parcelas de vendas a prazo por emissão, modalidade, cliente, vencimento e quitação.</p></div><div className="erp-receivable-actions"><button type="button" className="erp-row-action" onClick={clear}>Limpar</button><button type="button" className="erp-primary" disabled={pending} onClick={()=>load()}>{pending?'Consultando...':'Aplicar filtros'}</button></div></div>
      <div className="erp-receivable-filter-grid">
        <fieldset><legend>Data de emissão</legend><label>De<input type="date" value={filters.issuedFrom||''} onChange={e=>set('issuedFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.issuedTo||''} onChange={e=>set('issuedTo',e.target.value)}/></label></fieldset>
        <label>Modalidade<select value={filters.documentType||''} onChange={e=>set('documentType',e.target.value)}><option value="">Crediário + Boleto</option><option value="crediario">Crediário</option><option value="boleto">Boleto</option></select></label>
        <label>Cliente<select value={filters.customerId||''} onChange={e=>set('customerId',e.target.value)}><option value="">Todos os clientes</option>{customers.filter(c=>c.active!==false).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name||'Cliente')}{c.document?` — ${String(c.document)}`:''}</option>)}</select></label>
        <fieldset><legend>Data de vencimento</legend><label>De<input type="date" value={filters.dueFrom||''} onChange={e=>set('dueFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.dueTo||''} onChange={e=>set('dueTo',e.target.value)}/></label></fieldset>
        <fieldset><legend>Data de quitação</legend><label>De<input type="date" value={filters.paidFrom||''} onChange={e=>set('paidFrom',e.target.value)}/></label><label>Até<input type="date" value={filters.paidTo||''} onChange={e=>set('paidTo',e.target.value)}/></label></fieldset>
      </div>
      {message&&<p className="erp-message">{message}</p>}
    </section>

    {selected&&<section className="erp-module-card erp-settlement-panel">
      <div className="erp-receivable-filter-head"><div><h2>Receber / quitar título</h2><p>{String(selected.customer||'Cliente')} · {docLabel(selected.document_type)} · parcela {String(selected.installment||'—')}/{String(selected.installments||'—')} · saldo {money(selected.remaining)}</p></div><button type="button" className="erp-ghost" onClick={()=>setSelected(null)}>Fechar</button></div>
      <div className="erp-settlement-grid">
        <label>Valor recebido<input type="number" min="0.01" max={Number(selected.remaining||0)} step="0.01" value={settleAmount} onChange={e=>setSettleAmount(Number(e.target.value))}/></label>
        <label>Data do recebimento<input type="date" value={settleDate} onChange={e=>setSettleDate(e.target.value)}/></label>
        <label>Forma de recebimento<select value={method} onChange={e=>changeMethod(e.target.value)}>{settlementMethods.map(m=><option key={String(m.code)} value={String(m.code)}>{String(m.name)}</option>)}</select></label>
        <label>Destino do recebimento<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Selecione...</option>{destinationAccounts.map(a=><option key={String(a.id)} value={String(a.id)}>{a.account_type==='internal_cash'?'Caixa Interno':'Conta Bancária'} · {String(a.name)} · saldo {money(a.balance)}</option>)}</select></label>
        <div className="erp-destination-info"><span>{destinationAccounts.find(a=>String(a.id)===accountId)?.account_type==='internal_cash'?'CAIXA INTERNO':'CONTA BANCÁRIA'}</span><b>{String(destinationAccounts.find(a=>String(a.id)===accountId)?.name||'Selecione o destino')}</b><small>{destinationAccounts.find(a=>String(a.id)===accountId)?.account_type==='internal_cash'?'Caixa financeiro do ThorGestão; não altera a sessão operacional do PDV.':'O recebimento será lançado no livro financeiro desta conta para conciliação.'}</small></div>
        <label className="wide">Observação<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opcional: NSU, comprovante, referência do recebimento..."/></label>
      </div>
      {method!=='cash'&&!bankOnly.length&&<p className="erp-message">Cadastre ao menos uma conta em Financeiro → Contas Bancárias para receber por {String(settlementMethods.find(m=>String(m.code)===method)?.name??method)}.</p>}
      <div className="erp-settlement-actions"><button type="button" className="erp-primary" disabled={!canSettle||settling} onClick={settle}>{settling?'Registrando...':settleAmount+0.001>=Number(selected.remaining||0)?'✓ Quitar título':'✓ Registrar recebimento parcial'}</button></div>
    </section>}

    <section className="erp-module-card erp-receivable-list-card">
      <div className="erp-receivable-summary"><div><span>Parcelas a prazo</span><b>{rows.filter(r=>String(r.status)!=='cancelled').length}</b></div><div><span>Valor total</span><b>{money(totals.amount)}</b></div><div><span>Valor recebido</span><b>{money(totals.paid)}</b></div><div><span>Saldo a receber</span><b>{money(Math.max(totals.amount-totals.paid,0))}</b></div></div>
      {rows.length===0?<p className="erp-empty">Nenhum título de Crediário ou Boleto encontrado para os filtros selecionados.</p>:<div className="erp-receivable-table-shell"><table className="erp-data-table erp-receivable-table"><thead><tr><th>Emissão</th><th>Modalidade</th><th>Cliente / operação</th><th>Vencimento</th><th>Parcela</th><th>Valor</th><th>Saldo</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map(row=>{const status=String(row.status||'open');const canReceive=!['paid','cancelled'].includes(status)&&Number(row.remaining||0)>0;const canReverse=status!=='cancelled';return <tr key={String(row.id)} className={status==='cancelled'?'row-reversed':''}><td>{date(row.issued_at)}</td><td><span className={`erp-doc-chip doc-${String(row.document_type)}`}>{docLabel(row.document_type)}</span></td><td className="erp-customer-operation"><b>{String(row.customer||'—')}</b><small>Operação #{String(row.sale_number||'—')}</small></td><td>{date(row.due_date)}</td><td>{row.installment?`${String(row.installment)}/${String(row.installments||row.installment)}`:'—'}</td><td><b>{money(row.amount)}</b></td><td><b>{money(row.remaining)}</b></td><td><span className={`erp-fin-status status-${status}`}>{statusLabel(status)}</span></td><td><div className="erp-receivable-row-actions"><button type="button" className="erp-action-btn action-view" title="Ver detalhes da conta" aria-label="Ver detalhes da conta" disabled={detailLoadingId===String(row.id)} onClick={()=>void openDetails(row)}><span>🔎</span><em>{detailLoadingId===String(row.id)?'...':'Detalhes'}</em></button>{canReceive&&<button type="button" className="erp-action-btn action-receive" title="Receber ou quitar" onClick={()=>openSettlement(row)}><span>✓</span><em>Receber</em></button>}{canReverse&&<button type="button" className="erp-action-btn action-reverse" title="Estornar conta" onClick={()=>askReverse(row)}><span>↶</span><em>Estornar</em></button>}</div></td></tr>})}</tbody></table></div>}
    </section>

    {detail&&<div className="erp-detail-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><section className="erp-detail-modal" role="dialog" aria-modal="true" aria-label="Detalhes da conta a receber">
      <header className="erp-detail-header"><div><span>DETALHES DA CONTA</span><h2>{String(detailTitle.customer||'Cliente')}</h2><p>{docLabel(detailTitle.document_type)} · Parcela {String(detailTitle.installment||'—')}/{String(detailTitle.installments||'—')} · Operação #{String(detailOperation.number||'—')}</p></div><button type="button" className="erp-detail-close" onClick={()=>setDetail(null)} aria-label="Fechar">×</button></header>
      <div className="erp-detail-kpis"><div><span>Valor da parcela</span><b>{money(detailTitle.amount)}</b></div><div><span>Recebido</span><b>{money(detailReceipt.active_total)}</b></div><div><span>Saldo</span><b>{money(detailTitle.remaining)}</b></div><div><span>Status</span><b>{statusLabel(detailStatus)}</b></div></div>
      <div className="erp-detail-grid">
        <article className="erp-detail-card"><div className="erp-detail-card-title"><span>01</span><div><h3>Operação</h3><p>Origem da conta</p></div></div><dl><div><dt>Data</dt><dd>{date(detailOperation.operation_at)}</dd></div><div><dt>Hora</dt><dd>{time(detailOperation.operation_at)}</dd></div><div><dt>Operação</dt><dd>Venda a prazo #{String(detailOperation.number||'—')}</dd></div><div><dt>Modalidade</dt><dd>{docLabel(detailTitle.document_type)}</dd></div><div><dt>Operador</dt><dd>{String(detailOperation.operator||'—')}</dd></div><div><dt>Total da venda</dt><dd>{money(detailOperation.total)}</dd></div></dl></article>
        <article className={`erp-detail-card erp-nfce-card ${detailNfce.has_nfce?'has-doc':'no-doc'}`}><div className="erp-detail-card-title"><span>02</span><div><h3>NFC-e</h3><p>Situação fiscal da operação</p></div></div>{detailNfce.has_nfce?<dl><div><dt>Possui NFC-e?</dt><dd>Sim</dd></div><div><dt>Status</dt><dd>{String(detailNfce.status||'—')}</dd></div><div><dt>Número / série</dt><dd>{String(detailNfce.number||'—')} / {String(detailNfce.series||'—')}</dd></div><div><dt>Autorização</dt><dd>{dateTime(detailNfce.authorization_at)}</dd></div><div className="wide"><dt>Chave de acesso</dt><dd className="erp-access-key">{String(detailNfce.access_key||'—')}</dd></div></dl>:<div className="erp-no-nfce"><strong>Não</strong><p>Esta operação não possui NFC-e vinculada.</p></div>}</article>
      </div>
      <article className="erp-detail-card erp-products-card"><div className="erp-detail-card-title"><span>03</span><div><h3>Produtos da operação</h3><p>{detailProducts.length} item(ns) encontrado(s)</p></div></div>{detailProducts.length===0?<p className="erp-empty">Nenhum produto localizado.</p>:<table className="erp-detail-products"><thead><tr><th>Produto</th><th>SKU</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>{detailProducts.map((item,i)=><tr key={String(item.id||i)}><td>{String(item.description||'Produto')}</td><td>{String(item.sku||'—')}</td><td>{Number(item.quantity||0).toLocaleString('pt-BR')} {String(item.unit||'')}</td><td>{money(item.unit_price)}</td><td><b>{money(item.total)}</b></td></tr>)}</tbody></table>}</article>
      <article className="erp-detail-card erp-receipts-card"><div className="erp-detail-card-title"><span>04</span><div><h3>Recebimentos</h3><p>Histórico financeiro da parcela</p></div><strong className={detailReceipt.ever_received?'yes':'no'}>{detailReceipt.ever_received?'Teve recebimento':'Sem recebimento'}</strong></div>{detailReceipts.length===0?<div className="erp-no-receipt"><b>Não</b><span>Nenhum recebimento foi registrado para esta conta.</span></div>:<div className="erp-receipt-history">{detailReceipts.map((receipt,i)=><div key={String(receipt.id||i)} className={`erp-receipt-entry ${String(receipt.status)==='reversed'?'reversed':''}`}><div><b>{money(receipt.amount)}</b><span>{methodLabel(receipt.payment_method)} · {String(receipt.account||'Conta financeira')}</span></div><div><b>{String(receipt.status)==='reversed'?'Estornado':'Recebido'}</b><span>{dateTime(String(receipt.status)==='reversed'?receipt.reversed_at:receipt.settled_at)}</span></div>{String(receipt.status)==='reversed'&&receipt.reversal_reason&&<small>Motivo: {String(receipt.reversal_reason)}</small>}</div>)}</div>}</article>
      {detailStatus==='cancelled'&&<div className="erp-reversal-banner"><b>Conta estornada</b><span>{String(detailTitle.reversal_reason||'Estorno financeiro registrado.')}</span></div>}
      <footer className="erp-detail-footer"><div><small>O estorno financeiro não cancela automaticamente a venda nem a NFC-e.</small></div><div>{!['paid','cancelled'].includes(detailStatus)&&Number(detailTitle.remaining||0)>0&&<button type="button" className="erp-detail-receive" onClick={()=>openSettlement(detailRow)}>✓ Receber / quitar</button>}{detailStatus!=='cancelled'&&<button type="button" className="erp-detail-reverse" onClick={()=>askReverse(detailRow)}>↶ Estornar conta</button>}</div></footer>
    </section></div>}

    {reverseTarget&&<div className="erp-detail-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!reversing)setReverseTarget(null)}}><section className="erp-reverse-modal" role="dialog" aria-modal="true" aria-label="Estornar conta a receber"><div className="erp-reverse-icon">↶</div><h2>Estornar esta conta?</h2><p>A parcela será marcada como <b>Estornada</b>. Se houver recebimento, o ThorGestão criará a movimentação financeira inversa e manterá o histórico original.</p><div className="erp-reverse-warning"><b>Importante</b><span>A venda e a NFC-e não serão canceladas por esta ação.</span></div><label>Motivo do estorno<textarea autoFocus rows={3} value={reverseReason} onChange={e=>setReverseReason(e.target.value)} placeholder="Ex.: título lançado indevidamente, negociação cancelada..."/></label><div className="erp-reverse-actions"><button type="button" className="erp-ghost" disabled={reversing} onClick={()=>setReverseTarget(null)}>Voltar</button><button type="button" className="erp-danger" disabled={reversing||reverseReason.trim().length<3} onClick={()=>void reverseReceivable()}>{reversing?'Estornando...':'↶ Confirmar estorno'}</button></div></section></div>}
  </div>;
}
