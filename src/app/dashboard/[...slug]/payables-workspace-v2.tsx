'use client';

import { FormEvent, useMemo, useState } from 'react';
import { payableCreate, payableSettle, payablesFinancialContext, payablesList } from './payables-actions';

type Row=Record<string,unknown>;
type PayableRow=Row&{remaining:number;operational_status:string};
type Modal='new'|'settle'|null;
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v??0)||0;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(num(v));
const date=(v:unknown)=>v?new Date(`${text(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const statusLabel:Record<string,string>={open:'Em aberto',partial:'Parcial',paid:'Pago',overdue:'Vencido',cancelled:'Cancelado'};

export function PayablesWorkspaceV2({initial,suppliers,accounts,paymentMethods}:{initial:Row[];suppliers:Row[];accounts:Row[];paymentMethods:Row[]}){
  const [rows,setRows]=useState(initial);
  const [financialAccounts,setFinancialAccounts]=useState(accounts);
  const [methods,setMethods]=useState(paymentMethods);
  const [modal,setModal]=useState<Modal>(null);
  const [selected,setSelected]=useState<Row|null>(null);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('open');
  const [supplierId,setSupplierId]=useState('');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [settlementAccount,setSettlementAccount]=useState('');
  const [settlementMethod,setSettlementMethod]=useState('');

  const activeAccounts=useMemo(()=>financialAccounts.filter(a=>a.active!==false),[financialAccounts]);
  const allowedMethods=useMemo(()=>methods.filter(m=>!['term_sale','store_credit','store_credit_voucher'].includes(text(m.code))),[methods]);

  const enriched=useMemo<PayableRow[]>(()=>rows.map(r=>{
    const remaining=Math.max(num(r.amount)-num(r.paid_amount),0);
    const overdue=remaining>0.009&&text(r.status)!=='cancelled'&&Boolean(text(r.due_date))&&text(r.due_date)<today();
    return {...r,remaining,operational_status:overdue?'overdue':text(r.status)} as PayableRow;
  }),[rows]);

  const filtered=useMemo(()=>enriched.filter(r=>{
    const q=query.trim().toLowerCase();
    const matchQuery=!q||[r.description,r.supplier,r.due_date].some(v=>text(v).toLowerCase().includes(q));
    const matchSupplier=!supplierId||text(r.supplier_id)===supplierId;
    const op=text(r.operational_status);
    const matchStatus=!status||(status==='open'?['open','partial','overdue'].includes(op):op===status);
    return matchQuery&&matchSupplier&&matchStatus;
  }),[enriched,query,supplierId,status]);

  const summary=useMemo(()=>{
    const live=enriched.filter(r=>text(r.status)!=='cancelled');
    return {
      open:live.filter(r=>['open','partial','overdue'].includes(text(r.operational_status))).reduce((s,r)=>s+num(r.remaining),0),
      overdue:live.filter(r=>text(r.operational_status)==='overdue').reduce((s,r)=>s+num(r.remaining),0),
      paid:live.filter(r=>text(r.status)==='paid').reduce((s,r)=>s+num(r.paid_amount),0),
      count:live.filter(r=>['open','partial','overdue'].includes(text(r.operational_status))).length,
    };
  },[enriched]);

  async function refresh(){
    const [list,context]=await Promise.all([payablesList(),payablesFinancialContext()]);
    if(list.ok)setRows(list.data);
    if(context.ok){setFinancialAccounts(context.accounts);setMethods(context.payment_methods);}
  }

  function openNew(){setMessage('');setSelected(null);setModal('new');}
  function openSettle(row:Row){
    setMessage('');setSelected(row);setModal('settle');
    const bank=activeAccounts.find(a=>text(a.account_type)==='bank')??activeAccounts[0];
    setSettlementAccount(text(bank?.id));
    const preferred=allowedMethods.find(m=>text(m.code)==='pix')??allowedMethods[0];
    setSettlementMethod(text(preferred?.code));
  }

  async function createSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setMessage('');
    const fd=new FormData(e.currentTarget);
    const r=await payableCreate({
      description:text(fd.get('description')),
      supplier_id:text(fd.get('supplier_id')),
      amount:Number(fd.get('amount')??0),
      due_date:text(fd.get('due_date')),
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível lançar a conta: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setMessage('Conta a pagar lançada com sucesso.');
  }

  async function settleSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!selected)return;
    const fd=new FormData(e.currentTarget);
    const account=activeAccounts.find(a=>text(a.id)===text(fd.get('bank_account_id')));
    const method=text(fd.get('payment_method'));
    if(text(account?.account_type)==='internal_cash'&&method!=='cash'){
      setMessage('O Caixa Interno aceita pagamento em Dinheiro. Para PIX/cartão/transferência escolha uma conta bancária.');return;
    }
    setSaving(true);setMessage('');
    const r=await payableSettle(text(selected.id),{
      amount:Number(fd.get('amount')??0),
      payment_method:method,
      destination_type:'bank_account',
      bank_account_id:text(fd.get('bank_account_id')),
      settled_at:text(fd.get('settled_at')),
      notes:text(fd.get('notes')),
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível registrar o pagamento: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setSelected(null);setMessage(`Pagamento registrado. Saldo restante: ${money(r.remaining)}.`);
  }

  const remaining=selected?Math.max(num(selected.amount)-num(selected.paid_amount),0):0;

  return <div className="payables-v2">
    <section className="payables-hero">
      <article><span>Saldo a pagar</span><strong>{money(summary.open)}</strong><small>{summary.count} título(s) em aberto</small></article>
      <article className="danger"><span>Vencido</span><strong>{money(summary.overdue)}</strong><small>prioridade de pagamento</small></article>
      <article><span>Total já pago</span><strong>{money(summary.paid)}</strong><small>títulos carregados na consulta</small></article>
      <article><span>Contas financeiras</span><strong>{activeAccounts.length}</strong><small>destinos disponíveis para baixa</small></article>
    </section>

    <section className="payables-card">
      <header className="payables-header"><div><small>FINANCEIRO / CONTAS A PAGAR</small><h2>Obrigações e pagamentos</h2><p>Compras já alimentam este módulo automaticamente. Lançamentos manuais usam o mesmo motor financeiro e a mesma conciliação bancária.</p></div><div className="payables-actions"><button className="secondary" onClick={()=>void refresh()}>↻ Atualizar</button><button className="primary" onClick={openNew}>＋ Nova conta a pagar</button></div></header>
      {message&&<div className="payables-message">{message}<button onClick={()=>setMessage('')}>×</button></div>}
      <div className="payables-filters">
        <label className="search">Pesquisar<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Descrição ou fornecedor..."/></label>
        <label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Pendentes</option><option value="overdue">Vencidas</option><option value="partial">Parciais</option><option value="paid">Pagas</option><option value="cancelled">Canceladas</option><option value="">Todas</option></select></label>
        <label>Fornecedor<select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Todos</option>{suppliers.filter(s=>s.active!==false).map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</select></label>
        <button onClick={()=>{setQuery('');setStatus('open');setSupplierId('')}}>Limpar</button>
      </div>
      <div className="payables-table-wrap"><table><thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Descrição</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th><th></th></tr></thead><tbody>
        {filtered.length===0?<tr><td colSpan={8} className="empty">Nenhuma conta encontrada.</td></tr>:filtered.map((r,i)=>{
          const op=text(r.operational_status);const canPay=['open','partial','overdue'].includes(op)&&num(r.remaining)>0.009;
          return <tr key={text(r.id)||String(i)} className={op==='overdue'?'overdue':''}><td><b>{date(r.due_date)}</b></td><td>{text(r.supplier)||'Sem fornecedor'}</td><td>{text(r.description)||'—'}</td><td>{money(r.amount)}</td><td>{money(r.paid_amount)}</td><td><strong>{money(r.remaining)}</strong></td><td><span className={`payables-status ${op}`}>{statusLabel[op]||op}</span></td><td>{canPay?<button className="pay" onClick={()=>openSettle(r)}>Pagar</button>:<span className="muted">—</span>}</td></tr>;
        })}
      </tbody></table></div>
      <footer><span>{filtered.length} registro(s) exibido(s)</span><span>Baixas alimentam Contas Bancárias e Conciliação automaticamente</span></footer>
    </section>

    {modal==='new'&&<div className="payables-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="payables-modal"><header><div><small>NOVO LANÇAMENTO</small><h2>Conta a pagar</h2><p>Use para despesas e obrigações que não vieram automaticamente de Compras.</p></div><button onClick={()=>setModal(null)}>×</button></header><form onSubmit={createSubmit}><label className="wide">Descrição<input required name="description" placeholder="Ex.: Energia elétrica - Agosto"/></label><label className="wide">Fornecedor<select required name="supplier_id"><option value="">Selecione...</option>{suppliers.filter(s=>s.active!==false).map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</select></label><label>Valor<input required name="amount" type="number" min="0.01" step="0.01"/></label><label>Vencimento<input required name="due_date" type="date" defaultValue={today()}/></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Salvando...':'Lançar conta'}</button></div></form></section></div>}

    {modal==='settle'&&selected&&<div className="payables-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="payables-modal settle"><header><div><small>BAIXA FINANCEIRA</small><h2>Registrar pagamento</h2><p>{text(selected.supplier)||'Fornecedor'} · vencimento {date(selected.due_date)}</p></div><button onClick={()=>setModal(null)}>×</button></header><div className="settle-summary"><span>Valor original <b>{money(selected.amount)}</b></span><span>Já pago <b>{money(selected.paid_amount)}</b></span><span>Saldo atual <strong>{money(remaining)}</strong></span></div><form onSubmit={settleSubmit}><label>Valor pago<input required name="amount" type="number" min="0.01" max={remaining} step="0.01" defaultValue={remaining.toFixed(2)}/></label><label>Data do pagamento<input required name="settled_at" type="datetime-local" defaultValue={`${today()}T12:00`}/></label><label className="wide">Conta de saída<select required name="bank_account_id" value={settlementAccount} onChange={e=>{setSettlementAccount(e.target.value);const a=activeAccounts.find(x=>text(x.id)===e.target.value);if(text(a?.account_type)==='internal_cash')setSettlementMethod('cash')}}><option value="">Selecione...</option>{activeAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · saldo {money(a.balance)}</option>)}</select></label><label className="wide">Forma de pagamento<select required name="payment_method" value={settlementMethod} onChange={e=>setSettlementMethod(e.target.value)}><option value="">Selecione...</option>{allowedMethods.map(m=><option key={text(m.code)} value={text(m.code)}>{text(m.name)}</option>)}</select></label><label className="wide">Observação<textarea name="notes" placeholder="Comprovante, referência bancária ou observação do pagamento"/></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Registrando...':'Confirmar pagamento'}</button></div></form></section></div>}
  </div>;
}
