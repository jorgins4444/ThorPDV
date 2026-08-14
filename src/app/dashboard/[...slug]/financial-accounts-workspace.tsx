'use client';

import { FormEvent, useMemo, useState } from 'react';
import { addFinancialMovement, financialAccountsData, saveFinancialAccount, transferFinancialFunds } from './financial-accounts-actions';

type Row=Record<string,unknown>;
type Operation='account'|'movement'|'transfer'|null;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const dirLabel=(v:unknown)=>String(v)==='credit'?'Entrada':'Saída';
const paymentMethodLabels:Record<string,string>={cash:'Dinheiro',pix:'PIX',credit:'Crédito',credit_card:'Cartão de crédito',debit:'Débito',debit_card:'Cartão de débito',voucher:'Voucher',store_credit:'Crediário',cashback:'Cashback',bank_slip:'Boleto',boleto:'Boleto',term_sale:'Venda a prazo',transfer:'Transferência',bank_transfer:'Transferência bancária',ted:'TED',doc:'DOC',check:'Cheque',cheque:'Cheque'};
const originLabels:Record<string,string>={sale_payment:'Pagamento de venda',sale_payment_reversal:'Estorno de pagamento de venda',financial_settlement:'Baixa financeira',financial_settlement_reversal:'Estorno de baixa financeira',manual:'Lançamento manual',transfer:'Transferência entre contas',bank_transfer:'Transferência bancária',cash_movement:'Movimento de caixa',receivable:'Recebimento',payable:'Pagamento',financial_entry:'Lançamento financeiro',purchase_payment:'Pagamento de compra',sale_refund:'Estorno de venda',cash_close:'Fechamento de caixa',opening_balance:'Saldo inicial',bank_fee:'Tarifa bancária'};
const friendlyCode=(v:unknown,map:Record<string,string>)=>{const key=String(v??'').trim();if(!key)return '—';return map[key]??key.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase())};
const paymentMethodLabel=(v:unknown)=>friendlyCode(v,paymentMethodLabels);
const originLabel=(v:unknown)=>friendlyCode(v,originLabels);

export function FinancialAccountsWorkspace({initial}:{initial:Record<string,unknown>}){
  const [accounts,setAccounts]=useState<Row[]>((initial.accounts as Row[])??[]);
  const [transactions,setTransactions]=useState<Row[]>((initial.transactions as Row[])??[]);
  const [summary,setSummary]=useState<Row>((initial.summary as Row)??{});
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [operation,setOperation]=useState<Operation>(null);
  const [tab,setTab]=useState<'accounts'|'transactions'>('accounts');
  const [query,setQuery]=useState('');
  const [accountFilter,setAccountFilter]=useState('');
  const [directionFilter,setDirectionFilter]=useState('');
  const [reconcileFilter,setReconcileFilter]=useState('');

  const active=useMemo(()=>accounts.filter(a=>a.active!==false),[accounts]);
  const bankAccounts=useMemo(()=>accounts.filter(a=>a.account_type==='bank'),[accounts]);
  const filteredTransactions=useMemo(()=>transactions.filter(t=>{
    const q=query.trim().toLowerCase();
    const matchesQuery=!q||[t.account,t.description,t.payment_method,t.external_id,t.origin_type,paymentMethodLabel(t.payment_method),originLabel(t.origin_type)].some(v=>String(v??'').toLowerCase().includes(q));
    const matchesAccount=!accountFilter||String(t.bank_account_id??t.account_id??'')===accountFilter||String(t.account??'')===accountFilter;
    const matchesDirection=!directionFilter||String(t.direction)===directionFilter;
    const matchesReconcile=!reconcileFilter||(reconcileFilter==='yes'?t.reconciled===true:t.reconciled!==true);
    return matchesQuery&&matchesAccount&&matchesDirection&&matchesReconcile;
  }),[transactions,query,accountFilter,directionFilter,reconcileFilter]);

  async function refresh(){const r=await financialAccountsData();if(r.ok){setAccounts((r.accounts as Row[])??[]);setTransactions((r.transactions as Row[])??[]);setSummary((r.summary as Row)??{})}}
  function finish(ok:boolean,text:string){setMessage(text);if(ok)setOperation(null)}

  async function accountSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await saveFinancialAccount({name:String(fd.get('name')??''),bank_code:String(fd.get('bank_code')??''),agency:String(fd.get('agency')??''),account_number:String(fd.get('account_number')??''),opening_balance:Number(fd.get('opening_balance')??0),notes:String(fd.get('notes')??''),active:true});setSaving(false);if(r.ok){e.currentTarget.reset();await refresh();finish(true,'Conta bancária cadastrada com sucesso.')}else finish(false,`Não foi possível cadastrar: ${String(r.error??'erro')}`)}
  async function movementSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await addFinancialMovement({bank_account_id:String(fd.get('bank_account_id')??''),transaction_date:String(fd.get('transaction_date')??''),direction:String(fd.get('direction')??'credit'),amount:Number(fd.get('amount')??0),description:String(fd.get('description')??''),payment_method:String(fd.get('payment_method')??''),external_id:String(fd.get('external_id')??''),notes:String(fd.get('notes')??''),reconciled:false});setSaving(false);if(r.ok){e.currentTarget.reset();await refresh();finish(true,'Movimento registrado e enviado para conciliação.')}else finish(false,`Não foi possível lançar: ${String(r.error??'erro')}`)}
  async function transferSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const r=await transferFinancialFunds(String(fd.get('source')??''),String(fd.get('destination')??''),Number(fd.get('amount')??0),String(fd.get('description')??''),String(fd.get('transaction_date')??''));setSaving(false);if(r.ok){e.currentTarget.reset();await refresh();finish(true,'Transferência concluída com sucesso.')}else finish(false,`Não foi possível transferir: ${String(r.error??'erro')}`)}

  return <div className="bank-studio">
    <section className="bank-hero">
      <div className="bank-hero-main"><span>POSIÇÃO CONSOLIDADA</span><strong>{money(summary.total_balance)}</strong><small>Saldo disponível somando Caixa Interno e contas bancárias.</small></div>
      <div className="bank-hero-metrics">
        <div><span>Caixa Interno</span><b>{money(summary.internal_cash)}</b></div>
        <div><span>Saldo em bancos</span><b>{money(summary.bank_balance)}</b></div>
        <div className="positive"><span>Entradas hoje</span><b>+ {money(summary.credits_today)}</b></div>
        <div className="negative"><span>Saídas hoje</span><b>- {money(summary.debits_today)}</b></div>
      </div>
    </section>

    <section className="bank-commandbar">
      <div>
        <button className={tab==='accounts'?'active':''} onClick={()=>setTab('accounts')}>Contas <small>{accounts.length}</small></button>
        <button className={tab==='transactions'?'active':''} onClick={()=>setTab('transactions')}>Movimentações <small>{transactions.length}</small></button>
      </div>
      <div className="bank-actions">
        <button className="secondary" onClick={()=>void refresh()}>↻ Atualizar</button>
        <button className="secondary" onClick={()=>setOperation('transfer')} disabled={active.length<2}>⇄ Transferir</button>
        <button className="secondary" onClick={()=>setOperation('movement')} disabled={!active.length}>＋ Lançamento</button>
        <button className="primary" onClick={()=>setOperation('account')}>＋ Nova conta</button>
      </div>
    </section>

    {message?<div className="bank-message" onClick={()=>setMessage('')}><span>{message}</span><b>×</b></div>:null}

    {tab==='accounts'?<section className="bank-section">
      <div className="bank-section-head"><div><span>CONTAS FINANCEIRAS</span><h2>Onde está o seu dinheiro</h2><p>O Caixa Interno é sistêmico. As demais contas representam bancos e instituições usadas na operação.</p></div><div className="bank-count"><b>{active.length}</b><span>contas ativas</span></div></div>
      <div className="bank-account-grid">
        {accounts.map(a=>{
          const internal=a.account_type==='internal_cash';
          return <article key={String(a.id)} className={`bank-account ${internal?'internal':''} ${a.active===false?'inactive':''}`}>
            <header><div className="bank-account-icon">{internal?'$':'▣'}</div><div><small>{internal?'CAIXA INTERNO':`BANCO ${String(a.bank_code??'—')}`}</small><h3>{String(a.name)}</h3></div><span className="bank-status">{a.active===false?'Inativa':'Ativa'}</span></header>
            <strong>{money(a.balance)}</strong>
            <div className="bank-account-meta">
              {internal?<span>Receitas e despesas movimentadas em dinheiro.</span>:<><span>Agência <b>{String(a.agency??'—')}</b></span><span>Conta <b>{String(a.account_number??'—')}</b></span></>}
            </div>
          </article>})}
      </div>
      {bankAccounts.length===0?<div className="bank-empty"><b>Nenhuma conta bancária cadastrada</b><span>Cadastre sua primeira conta para organizar PIX, depósitos, cartões e conciliação.</span><button onClick={()=>setOperation('account')}>＋ Cadastrar conta</button></div>:null}
    </section>:null}

    {tab==='transactions'?<section className="bank-section">
      <div className="bank-section-head"><div><span>LIVRO FINANCEIRO</span><h2>Movimentações das contas</h2><p>Consulte entradas, saídas, transferências e lançamentos disponíveis para conciliação.</p></div><div className="bank-count"><b>{filteredTransactions.length}</b><span>registros exibidos</span></div></div>
      <div className="bank-filters">
        <label className="search">Pesquisar<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Descrição, forma, origem..."/></label>
        <label>Conta<select value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">Todas</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></label>
        <label>Tipo<select value={directionFilter} onChange={e=>setDirectionFilter(e.target.value)}><option value="">Todos</option><option value="credit">Entradas</option><option value="debit">Saídas</option></select></label>
        <label>Conciliação<select value={reconcileFilter} onChange={e=>setReconcileFilter(e.target.value)}><option value="">Todas</option><option value="yes">Conciliadas</option><option value="no">Pendentes</option></select></label>
        <button onClick={()=>{setQuery('');setAccountFilter('');setDirectionFilter('');setReconcileFilter('')}}>Limpar</button>
      </div>
      <div className="bank-table"><table><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Movimento</th><th>Forma</th><th>Valor</th><th>Origem</th><th>Status</th></tr></thead><tbody>{filteredTransactions.length===0?<tr><td colSpan={8} className="erp-empty">Nenhuma movimentação encontrada.</td></tr>:filteredTransactions.map((t,i)=><tr key={String(t.id??i)}><td>{date(t.transaction_date)}</td><td><b>{String(t.account??'—')}</b></td><td>{String(t.description??'—')}</td><td><span className={`bank-direction ${String(t.direction)}`}>{dirLabel(t.direction)}</span></td><td>{paymentMethodLabel(t.payment_method)}</td><td className={String(t.direction)==='credit'?'erp-credit':'erp-debit'}>{String(t.direction)==='credit'?'+ ':'- '}{money(t.amount)}</td><td>{originLabel(t.origin_type)}</td><td><span className={`bank-reconcile ${t.reconciled?'done':'pending'}`}>{t.reconciled?'Conciliado':'Pendente'}</span></td></tr>)}</tbody></table></div>
    </section>:null}

    {operation?<div className="bank-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOperation(null)}}><section className="bank-modal">
      <header><div><span>{operation==='account'?'CADASTRO':operation==='movement'?'MOVIMENTAÇÃO':'TRANSFERÊNCIA'}</span><h2>{operation==='account'?'Nova conta bancária':operation==='movement'?'Registrar lançamento':'Transferir entre contas'}</h2><p>{operation==='account'?'Cadastre uma conta real usada na operação financeira.':operation==='movement'?'Inclua um crédito ou débito manual para posterior conciliação.':'Movimente saldo entre duas contas sem gerar receita ou despesa.'}</p></div><button onClick={()=>setOperation(null)}>×</button></header>
      {operation==='account'?<form className="bank-form" onSubmit={accountSubmit}><label className="wide">Nome da conta<input required name="name" placeholder="Ex.: Banco do Brasil - Principal"/></label><label>Código do banco<input name="bank_code" placeholder="001, 237, 341, 260..."/></label><label>Agência<input name="agency" placeholder="Ex.: 1234-5"/></label><label>Conta<input name="account_number" placeholder="Ex.: 12345-6"/></label><label>Saldo inicial<input name="opening_balance" type="number" step="0.01" defaultValue="0"/></label><label className="wide">Observações<textarea name="notes" placeholder="Informações adicionais da conta"/></label><div className="bank-form-actions"><button type="button" onClick={()=>setOperation(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Salvando...':'Cadastrar conta'}</button></div></form>:null}
      {operation==='movement'?<form className="bank-form" onSubmit={movementSubmit}><label className="wide">Conta<select required name="bank_account_id"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)} — {money(a.balance)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()}/></label><label>Movimento<select name="direction"><option value="credit">Crédito / Entrada</option><option value="debit">Débito / Saída</option></select></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01"/></label><label>Forma / meio<input name="payment_method" placeholder="PIX, TED, tarifa..."/></label><label className="wide">Descrição<input required name="description" placeholder="Descrição do lançamento"/></label><label>ID externo<input name="external_id" placeholder="NSU, ID banco..."/></label><label>Observações<input name="notes"/></label><div className="bank-form-actions"><button type="button" onClick={()=>setOperation(null)}>Cancelar</button><button className="primary" disabled={saving}>Registrar movimento</button></div></form>:null}
      {operation==='transfer'?<form className="bank-form" onSubmit={transferSubmit}><label className="wide">Conta de origem<select required name="source"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)} — {money(a.balance)}</option>)}</select></label><label className="wide">Conta de destino<select required name="destination"><option value="">Selecione...</option>{active.map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()}/></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01"/></label><label className="wide">Descrição<input name="description" placeholder="Ex.: Depósito do caixa no banco"/></label><div className="bank-form-actions"><button type="button" onClick={()=>setOperation(null)}>Cancelar</button><button className="primary" disabled={saving||active.length<2}>Transferir</button></div></form>:null}
    </section></div>:null}
  </div>;
}