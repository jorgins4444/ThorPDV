'use client';

import { FormEvent, useMemo, useState } from 'react';
import { addFinancialMovement, financialAccountsData, saveFinancialAccount, transferFinancialFunds } from './financial-accounts-actions';

type Row=Record<string,unknown>;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const dirLabel=(v:unknown)=>String(v)==='credit'?'Crédito / Entrada':'Débito / Saída';

export function FinancialAccountsWorkspace({initial}:{initial:Record<string,unknown>}){
  const [accounts,setAccounts]=useState<Row[]>((initial.accounts as Row[])??[]);
  const [transactions,setTransactions]=useState<Row[]>((initial.transactions as Row[])??[]);
  const [summary,setSummary]=useState<Row>((initial.summary as Row)??{});
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  const active=useMemo(()=>accounts.filter(a=>a.active!==false),[accounts]);
  async function refresh(){const r=await financialAccountsData();if(r.ok){setAccounts((r.accounts as Row[])??[]);setTransactions((r.transactions as Row[])??[]);setSummary((r.summary as Row)??{})}}

  async function accountSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await saveFinancialAccount({name:String(fd.get('name')??''),bank_code:String(fd.get('bank_code')??''),agency:String(fd.get('agency')??''),account_number:String(fd.get('account_number')??''),opening_balance:Number(fd.get('opening_balance')??0),notes:String(fd.get('notes')??''),active:true});setSaving(false);if(r.ok){setMessage('Conta bancária cadastrada.');e.currentTarget.reset();await refresh()}else setMessage(`Não foi possível cadastrar: ${String(r.error??'erro')}`)}

  async function movementSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await addFinancialMovement({bank_account_id:String(fd.get('bank_account_id')??''),transaction_date:String(fd.get('transaction_date')??''),direction:String(fd.get('direction')??'credit'),amount:Number(fd.get('amount')??0),description:String(fd.get('description')??''),payment_method:String(fd.get('payment_method')??''),external_id:String(fd.get('external_id')??''),notes:String(fd.get('notes')??''),reconciled:false});setSaving(false);if(r.ok){setMessage('Movimento registrado e disponível para conciliação.');e.currentTarget.reset();await refresh()}else setMessage(`Não foi possível lançar: ${String(r.error??'erro')}`)}

  async function transferSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await transferFinancialFunds(String(fd.get('source')??''),String(fd.get('destination')??''),Number(fd.get('amount')??0),String(fd.get('description')??''),String(fd.get('transaction_date')??''));setSaving(false);if(r.ok){setMessage('Transferência concluída com débito na origem e crédito no destino.');e.currentTarget.reset();await refresh()}else setMessage(`Não foi possível transferir: ${String(r.error??'erro')}`)}

  return <div className="erp-financial-accounts">
    <section className="erp-finance-summary">
      <div><span>Saldo total</span><b>{money(summary.total_balance)}</b></div>
      <div><span>Caixa Interno</span><b>{money(summary.internal_cash)}</b></div>
      <div><span>Contas bancárias</span><b>{money(summary.bank_balance)}</b></div>
      <div><span>Entradas hoje</span><b>{money(summary.credits_today)}</b></div>
      <div><span>Saídas hoje</span><b>{money(summary.debits_today)}</b></div>
    </section>

    <div className="erp-finance-grid">
      <section className="erp-module-card"><div className="erp-advanced-head"><h2>Contas</h2><p>O Caixa Interno é sistêmico. Crie contas bancárias para PIX, cartões, depósitos e conciliação.</p></div><div className="erp-account-cards">{accounts.map(a=><article key={String(a.id)} className={a.account_type==='internal_cash'?'internal':''}><small>{a.account_type==='internal_cash'?'Caixa do sistema':String(a.bank_code??'Conta bancária')}</small><h3>{String(a.name)}</h3><strong>{money(a.balance)}</strong><span>{a.account_type==='bank'?`Ag. ${String(a.agency??'—')} · Conta ${String(a.account_number??'—')}`:'Receitas e despesas em dinheiro'}</span></article>)}</div></section>

      <section className="erp-module-card"><div className="erp-advanced-head"><h2>Nova conta bancária</h2><p>Cadastre uma conta real para receber, pagar, transferir e conciliar.</p></div><form className="erp-form-grid" onSubmit={accountSubmit}><label>Nome<input required name="name" placeholder="Ex.: Banco do Brasil - Principal"/></label><label>Código do banco<input name="bank_code" placeholder="001, 237, 341, 260..."/></label><label>Agência<input name="agency"/></label><label>Conta<input name="account_number"/></label><label>Saldo inicial<input name="opening_balance" type="number" step="0.01" defaultValue="0"/></label><label className="wide">Observações<input name="notes"/></label><button className="erp-primary" disabled={saving}>{saving?'Salvando...':'Cadastrar conta'}</button></form></section>

      <section className="erp-module-card"><div className="erp-advanced-head"><h2>Creditar / Debitar</h2><p>Lançamento manual para extrato, ajustes e posterior conciliação bancária.</p></div><form className="erp-form-grid" onSubmit={movementSubmit}><label>Conta<select required name="bank_account_id"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)} — {money(a.balance)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()}/></label><label>Movimento<select name="direction"><option value="credit">Crédito / Entrada</option><option value="debit">Débito / Saída</option></select></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01"/></label><label>Forma / meio<input name="payment_method" placeholder="PIX, TED, tarifa, dinheiro..."/></label><label>ID externo<input name="external_id" placeholder="NSU, ID banco, documento..."/></label><label className="wide">Descrição<input required name="description" placeholder="Descrição do lançamento"/></label><label className="wide">Observações<input name="notes"/></label><button className="erp-primary" disabled={saving||!active.length}>Registrar movimento</button></form></section>

      <section className="erp-module-card"><div className="erp-advanced-head"><h2>Transferir fundos</h2><p>Move saldo entre Caixa Interno e contas bancárias ou entre duas contas, sem gerar receita/despesa.</p></div><form className="erp-form-grid" onSubmit={transferSubmit}><label>Conta de origem<select required name="source"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)} — {money(a.balance)}</option>)}</select></label><label>Conta de destino<select required name="destination"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()}/></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01"/></label><label className="wide">Descrição<input name="description" placeholder="Ex.: Depósito do caixa no banco"/></label><button className="erp-primary" disabled={saving||active.length<2}>Transferir</button></form></section>
    </div>

    {message&&<p className="erp-message">{message}</p>}
    <section className="erp-module-card"><div className="erp-advanced-head"><h2>Livro financeiro</h2><p>Movimentações automáticas e manuais de todas as contas.</p></div><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Tipo</th><th>Forma</th><th>Valor</th><th>Origem</th><th>Conciliação</th></tr></thead><tbody>{transactions.length===0?<tr><td colSpan={8} className="erp-empty">Nenhuma movimentação financeira.</td></tr>:transactions.map((t,i)=><tr key={String(t.id??i)}><td>{date(t.transaction_date)}</td><td>{String(t.account??'—')}</td><td>{String(t.description??'—')}</td><td>{dirLabel(t.direction)}</td><td>{String(t.payment_method??'—')}</td><td className={String(t.direction)==='credit'?'erp-credit':'erp-debit'}>{String(t.direction)==='credit'?'+ ':'- '}{money(t.amount)}</td><td>{String(t.origin_type??'manual')}</td><td>{t.reconciled?'Conciliado':'Pendente'}</td></tr>)}</tbody></table></div></section>
  </div>;
}
