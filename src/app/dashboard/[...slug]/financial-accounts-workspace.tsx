'use client';

import { FormEvent, useMemo, useState } from 'react';
import { addFinancialMovement, financialAccountsData, saveFinancialAccount, transferFinancialFunds } from './financial-accounts-actions';

type Row = Record<string, unknown>;
type Operation = 'account' | 'movement' | 'transfer' | null;

const money = (v: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v ?? 0));
const date = (v: unknown) => v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const today = () => new Date().toISOString().slice(0, 10);
const text = (v: unknown) => v == null ? '' : String(v);
const dirLabel = (v: unknown) => String(v) === 'credit' ? 'Entrada' : 'Saída';

const bankNames: Record<string, string> = {
  '341': 'Itaú',
  '237': 'Bradesco',
  '001': 'Banco do Brasil',
  '104': 'CAIXA',
  '033': 'Santander',
};

const bankCnabStatus: Record<string, { title: string; detail: string }> = {
  '341': { title: 'Itaú CNAB 240 / 400', detail: 'Remessa, retorno e boleto habilitados' },
  '237': { title: 'Bradesco CNAB 400', detail: 'Operacional · CNAB 240 em preparação' },
  '001': { title: 'Banco do Brasil', detail: 'Banco cadastrado · CNAB será habilitado na etapa específica' },
  '104': { title: 'CAIXA', detail: 'Banco cadastrado · CNAB será habilitado na etapa específica' },
  '033': { title: 'Santander', detail: 'Banco cadastrado · CNAB será habilitado na etapa específica' },
};

const paymentMethodLabels: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', credit: 'Crédito', credit_card: 'Cartão de crédito', debit: 'Débito', debit_card: 'Cartão de débito', voucher: 'Voucher', store_credit: 'Crediário', cashback: 'Cashback', bank_slip: 'Boleto', boleto: 'Boleto', term_sale: 'Venda a prazo', transfer: 'Transferência', bank_transfer: 'Transferência bancária', ted: 'TED', doc: 'DOC', check: 'Cheque', cheque: 'Cheque',
};

const originLabels: Record<string, string> = {
  sale_payment: 'Pagamento de venda', sale_payment_reversal: 'Estorno de pagamento de venda', financial_settlement: 'Baixa financeira', financial_settlement_reversal: 'Estorno de baixa financeira', manual: 'Lançamento manual', transfer: 'Transferência entre contas', bank_transfer: 'Transferência bancária', cash_movement: 'Movimento de caixa', receivable: 'Recebimento', payable: 'Pagamento', financial_entry: 'Lançamento financeiro', purchase_payment: 'Pagamento de compra', sale_refund: 'Estorno de venda', cash_close: 'Fechamento de caixa', opening_balance: 'Saldo inicial', bank_fee: 'Tarifa bancária',
};

const friendly = (v: unknown, map: Record<string, string>) => {
  const key = text(v).trim();
  return map[key] || key.replace(/_/g, ' ') || '—';
};

const accountError = (value: unknown) => {
  const code = text(value);
  const map: Record<string, string> = {
    account_name_required: 'Informe o nome da conta.',
    bank_account_not_found: 'A conta bancária não foi encontrada.',
    system_account_is_read_only: 'A conta interna do sistema não pode ser alterada.',
    invalid_cnab_layout: 'O layout CNAB selecionado é inválido.',
    invalid_session: 'Sua sessão expirou. Entre novamente no sistema.',
  };
  return map[code] || code || 'Erro não identificado.';
};

export function FinancialAccountsWorkspace({ initial }: { initial: Record<string, unknown> }) {
  const [accounts, setAccounts] = useState<Row[]>((initial.accounts as Row[]) ?? []);
  const [transactions, setTransactions] = useState<Row[]>((initial.transactions as Row[]) ?? []);
  const [summary, setSummary] = useState<Row>((initial.summary as Row) ?? {});
  const [message, setMessage] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [editingAccount, setEditingAccount] = useState<Row | null>(null);
  const [tab, setTab] = useState<'accounts' | 'transactions'>('accounts');
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [reconcileFilter, setReconcileFilter] = useState('');

  const active = useMemo(() => accounts.filter(a => a.active !== false), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter(a => a.account_type === 'bank'), [accounts]);
  const filteredTransactions = useMemo(() => transactions.filter(t => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [t.account, t.description, t.payment_method, t.external_id, t.origin_type, friendly(t.payment_method, paymentMethodLabels), friendly(t.origin_type, originLabels)].some(v => String(v ?? '').toLowerCase().includes(q));
    const matchesAccount = !accountFilter || String(t.bank_account_id ?? t.account_id ?? '') === accountFilter || String(t.account ?? '') === accountFilter;
    const matchesDirection = !directionFilter || String(t.direction) === directionFilter;
    const matchesReconcile = !reconcileFilter || (reconcileFilter === 'yes' ? t.reconciled === true : t.reconciled !== true);
    return matchesQuery && matchesAccount && matchesDirection && matchesReconcile;
  }), [transactions, query, accountFilter, directionFilter, reconcileFilter]);

  async function refresh() {
    const r = await financialAccountsData();
    if (r.ok) {
      setAccounts((r.accounts as Row[]) ?? []);
      setTransactions((r.transactions as Row[]) ?? []);
      setSummary((r.summary as Row) ?? {});
    }
    return r;
  }

  function openOperation(value: Operation) {
    setEditingAccount(null);
    setModalMessage('');
    setMessage('');
    setOperation(value);
  }

  function openAccountEditor(account: Row) {
    if (account.is_system === true || account.account_type === 'internal_cash') return;
    setEditingAccount(account);
    setModalMessage('');
    setMessage('');
    setOperation('account');
  }

  function closeOperation() {
    setOperation(null);
    setEditingAccount(null);
    setModalMessage('');
  }

  function finish(value: string) {
    setMessage(value);
    closeOperation();
  }

  async function accountSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const isEditing = Boolean(editingAccount?.id);
    setSaving(true);
    setModalMessage('');

    try {
      const payload: Record<string, unknown> = {
        name: text(fd.get('name')).trim(),
        bank_code: text(fd.get('bank_code')).trim(),
        agency: text(fd.get('agency')).trim(),
        agency_digit: text(fd.get('agency_digit')).trim(),
        account_number: text(fd.get('account_number')).trim(),
        account_digit: text(fd.get('account_digit')).trim(),
        wallet: text(fd.get('wallet')).trim(),
        agreement: text(fd.get('agreement')).trim(),
        beneficiary_code: text(fd.get('beneficiary_code')).trim(),
        default_layout: text(fd.get('default_layout')).trim(),
        notes: text(fd.get('notes')),
        active: isEditing ? fd.get('active') === 'on' : true,
      };
      if (isEditing) payload.id = text(editingAccount?.id);
      else payload.opening_balance = Number(fd.get('opening_balance') ?? 0);

      const r = await saveFinancialAccount(payload);
      if (!r.ok) {
        setModalMessage(`Não foi possível ${isEditing ? 'salvar as alterações' : 'cadastrar a conta'}: ${accountError(r.error)}`);
        return;
      }

      if (!isEditing) form.reset();
      await refresh();
      finish(isEditing ? 'Conta bancária atualizada com sucesso.' : 'Conta bancária cadastrada com sucesso.');
    } catch (error) {
      setModalMessage(`Não foi possível ${isEditing ? 'salvar as alterações' : 'cadastrar a conta'}: ${error instanceof Error ? error.message : 'erro inesperado'}`);
    } finally {
      setSaving(false);
    }
  }

  async function movementSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setSaving(true);
    setModalMessage('');
    try {
      const r = await addFinancialMovement({ bank_account_id: text(fd.get('bank_account_id')), transaction_date: text(fd.get('transaction_date')), direction: text(fd.get('direction')) || 'credit', amount: Number(fd.get('amount') ?? 0), description: text(fd.get('description')), payment_method: text(fd.get('payment_method')), external_id: text(fd.get('external_id')), notes: text(fd.get('notes')), reconciled: false });
      if (!r.ok) {
        setModalMessage(`Não foi possível lançar: ${text(r.error || 'erro')}`);
        return;
      }
      form.reset();
      await refresh();
      finish('Movimento registrado e enviado para conciliação.');
    } catch (error) {
      setModalMessage(`Não foi possível lançar: ${error instanceof Error ? error.message : 'erro inesperado'}`);
    } finally {
      setSaving(false);
    }
  }

  async function transferSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setSaving(true);
    setModalMessage('');
    try {
      const r = await transferFinancialFunds(text(fd.get('source')), text(fd.get('destination')), Number(fd.get('amount') ?? 0), text(fd.get('description')), text(fd.get('transaction_date')));
      if (!r.ok) {
        setModalMessage(`Não foi possível transferir: ${text(r.error || 'erro')}`);
        return;
      }
      form.reset();
      await refresh();
      finish('Transferência concluída com sucesso.');
    } catch (error) {
      setModalMessage(`Não foi possível transferir: ${error instanceof Error ? error.message : 'erro inesperado'}`);
    } finally {
      setSaving(false);
    }
  }

  return <div className="bank-studio">
    <section className="bank-hero">
      <div className="bank-hero-main"><span>POSIÇÃO CONSOLIDADA</span><strong>{money(summary.total_balance)}</strong><small>Saldo disponível somando Caixa Interno e contas bancárias.</small></div>
      <div className="bank-hero-metrics"><div><span>Caixa Interno</span><b>{money(summary.internal_cash)}</b></div><div><span>Saldo em bancos</span><b>{money(summary.bank_balance)}</b></div><div className="positive"><span>Entradas hoje</span><b>+ {money(summary.credits_today)}</b></div><div className="negative"><span>Saídas hoje</span><b>- {money(summary.debits_today)}</b></div></div>
    </section>

    <section className="bank-commandbar">
      <div><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>Contas <small>{accounts.length}</small></button><button className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}>Movimentações <small>{transactions.length}</small></button></div>
      <div className="bank-actions"><a className="secondary" href="/dashboard/financeiro/remessa-retorno">⇄ Remessa / Retorno</a><button className="secondary" onClick={() => void refresh()}>↻ Atualizar</button><button className="secondary" onClick={() => openOperation('transfer')} disabled={active.length < 2}>⇄ Transferir</button><button className="secondary" onClick={() => openOperation('movement')} disabled={!active.length}>＋ Lançamento</button><button className="primary" onClick={() => openOperation('account')}>＋ Nova conta</button></div>
    </section>

    {message ? <div className="bank-message" onClick={() => setMessage('')}><span>{message}</span><b>×</b></div> : null}

    {tab === 'accounts' ? <section className="bank-section">
      <div className="bank-section-head"><div><span>CONTAS FINANCEIRAS</span><h2>Onde está o seu dinheiro</h2><p>Cadastre e edite contas bancárias e use Remessa / Retorno para cobrança registrada por arquivo.</p></div><div className="bank-count"><b>{active.length}</b><span>contas ativas</span></div></div>
      <div className="bank-account-grid">{accounts.map(a => {
        const internal = a.account_type === 'internal_cash';
        const code = text(a.bank_code);
        const integration = bankCnabStatus[code];
        return <article key={text(a.id)} className={`bank-account ${internal ? 'internal' : ''} ${a.active === false ? 'inactive' : ''}`}>
          <header><div className="bank-account-icon">{internal ? '$' : '▣'}</div><div><small>{internal ? 'CAIXA INTERNO' : `${bankNames[code] || 'BANCO'} · ${code || '—'}`}</small><h3>{text(a.name)}</h3></div><span className="bank-status">{a.active === false ? 'Inativa' : 'Ativa'}</span></header>
          <strong>{money(a.balance)}</strong>
          <div className="bank-account-meta">{internal ? <span>Receitas e despesas movimentadas em dinheiro.</span> : <><span>Agência <b>{text(a.agency) || '—'}{text(a.agency_digit) ? `-${text(a.agency_digit)}` : ''}</b></span><span>Conta <b>{text(a.account_number) || '—'}{text(a.account_digit) ? `-${text(a.account_digit)}` : ''}</b></span>{text(a.wallet) ? <span>Carteira <b>{text(a.wallet)}</b></span> : null}</>}</div>
          {!internal ? <div className="bank-account-actions"><button type="button" onClick={() => openAccountEditor(a)}>✎ Editar conta</button></div> : <div className="bank-account-actions system"><span>Conta interna protegida pelo sistema</span></div>}
          {!internal && integration ? <div className="bank-account-integration connected"><div><span>COBRANÇA POR ARQUIVO</span><b>{integration.title}</b><small>{integration.detail}</small></div><a href="/dashboard/financeiro/remessa-retorno">Abrir Remessa / Retorno</a></div> : null}
        </article>;
      })}</div>
      {bankAccounts.length === 0 ? <div className="bank-empty"><b>Nenhuma conta bancária cadastrada</b><span>Cadastre sua primeira conta para organizar recebimentos e conciliação.</span><button onClick={() => openOperation('account')}>＋ Cadastrar conta</button></div> : null}
    </section> : null}

    {tab === 'transactions' ? <section className="bank-section">
      <div className="bank-section-head"><div><span>LIVRO FINANCEIRO</span><h2>Movimentações das contas</h2><p>Consulte entradas, saídas, transferências e lançamentos disponíveis para conciliação.</p></div><div className="bank-count"><b>{filteredTransactions.length}</b><span>registros exibidos</span></div></div>
      <div className="bank-filters"><label className="search">Pesquisar<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Descrição, forma, origem..." /></label><label>Conta<select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="">Todas</option>{active.map(a => <option key={text(a.id)} value={text(a.id)}>{text(a.name)}</option>)}</select></label><label>Tipo<select value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}><option value="">Todos</option><option value="credit">Entradas</option><option value="debit">Saídas</option></select></label><label>Conciliação<select value={reconcileFilter} onChange={e => setReconcileFilter(e.target.value)}><option value="">Todas</option><option value="yes">Conciliadas</option><option value="no">Pendentes</option></select></label><button onClick={() => { setQuery(''); setAccountFilter(''); setDirectionFilter(''); setReconcileFilter(''); }}>Limpar</button></div>
      <div className="bank-table"><table><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Movimento</th><th>Forma</th><th>Valor</th><th>Origem</th><th>Status</th></tr></thead><tbody>{filteredTransactions.length === 0 ? <tr><td colSpan={8} className="erp-empty">Nenhuma movimentação encontrada.</td></tr> : filteredTransactions.map((t, i) => <tr key={text(t.id ?? i)}><td>{date(t.transaction_date)}</td><td><b>{text(t.account) || '—'}</b></td><td>{text(t.description) || '—'}</td><td><span className={`bank-direction ${text(t.direction)}`}>{dirLabel(t.direction)}</span></td><td>{friendly(t.payment_method, paymentMethodLabels)}</td><td className={text(t.direction) === 'credit' ? 'erp-credit' : 'erp-debit'}>{text(t.direction) === 'credit' ? '+ ' : '- '}{money(t.amount)}</td><td>{friendly(t.origin_type, originLabels)}</td><td><span className={`bank-reconcile ${t.reconciled ? 'done' : 'pending'}`}>{t.reconciled ? 'Conciliado' : 'Pendente'}</span></td></tr>)}</tbody></table></div>
    </section> : null}

    {operation ? <div className="bank-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeOperation(); }}><section className="bank-modal">
      <header><div><span>{operation === 'account' ? (editingAccount ? 'EDIÇÃO' : 'CADASTRO') : operation === 'movement' ? 'MOVIMENTAÇÃO' : 'TRANSFERÊNCIA'}</span><h2>{operation === 'account' ? (editingAccount ? 'Editar conta bancária' : 'Nova conta bancária') : operation === 'movement' ? 'Registrar lançamento' : 'Transferir entre contas'}</h2><p>{operation === 'account' ? (editingAccount ? 'Atualize os dados bancários e o status da conta. O Caixa Interno não pode ser editado.' : 'Cadastre os dados bancários. Os campos de cobrança serão utilizados nos layouts CNAB compatíveis.') : operation === 'movement' ? 'Inclua um crédito ou débito manual para posterior conciliação.' : 'Movimente saldo entre duas contas sem gerar receita ou despesa.'}</p></div><button type="button" onClick={closeOperation}>×</button></header>
      {modalMessage ? <div className="bank-inline-message">{modalMessage}</div> : null}

      {operation === 'account' ? <form key={editingAccount ? text(editingAccount.id) : 'new-account'} className="bank-form" onSubmit={accountSubmit}>
        <label className="wide">Nome da conta<input required name="name" defaultValue={text(editingAccount?.name)} placeholder="Ex.: Bradesco - Conta Principal" /></label>
        <label className="wide">Banco<select required name="bank_code" defaultValue={text(editingAccount?.bank_code) || '237'}><option value="237">237 · Bradesco</option><option value="341">341 · Itaú</option><option value="001">001 · Banco do Brasil</option><option value="104">104 · CAIXA</option><option value="033">033 · Santander</option></select></label>
        <label>Agência<input required name="agency" defaultValue={text(editingAccount?.agency)} placeholder="Ex.: 1234" /></label>
        <label>DV agência<input name="agency_digit" defaultValue={text(editingAccount?.agency_digit)} placeholder="Ex.: 0" /></label>
        <label>Conta<input required name="account_number" defaultValue={text(editingAccount?.account_number)} placeholder="Sem pontuação" /></label>
        <label>DV conta<input name="account_digit" defaultValue={text(editingAccount?.account_digit)} placeholder="Ex.: 5" /></label>
        <label>Carteira<input name="wallet" defaultValue={text(editingAccount?.wallet)} placeholder="Ex.: 19, 109..." /></label>
        <label>Convênio<input name="agreement" defaultValue={text(editingAccount?.agreement)} placeholder="Quando exigido pelo banco" /></label>
        <label className="wide">Código do beneficiário<input name="beneficiary_code" defaultValue={text(editingAccount?.beneficiary_code)} placeholder="Código fornecido pelo banco para cobrança" /></label>
        <label>Layout preferencial<select name="default_layout" defaultValue={text(editingAccount?.default_layout) || 'cnab400'}><option value="cnab400">CNAB 400</option><option value="cnab240">CNAB 240</option></select></label>
        {editingAccount ? <label>Saldo atual<input value={Number(editingAccount.balance ?? 0)} type="number" step="0.01" readOnly disabled /></label> : <label>Saldo inicial<input name="opening_balance" type="number" step="0.01" defaultValue="0" /></label>}
        {editingAccount ? <label className="bank-checkbox wide"><input type="checkbox" name="active" defaultChecked={editingAccount.active !== false} /><span>Conta ativa</span></label> : null}
        <label className="wide">Observações<textarea name="notes" defaultValue={text(editingAccount?.notes)} placeholder="Informações adicionais da conta" /></label>
        <div className="bank-form-actions"><button type="button" onClick={closeOperation}>Cancelar</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Salvando...' : editingAccount ? 'Salvar alterações' : 'Cadastrar conta'}</button></div>
      </form> : null}

      {operation === 'movement' ? <form className="bank-form" onSubmit={movementSubmit}><label className="wide">Conta<select required name="bank_account_id"><option value="">Selecione...</option>{active.map(a => <option key={text(a.id)} value={text(a.id)}>{text(a.name)} — {money(a.balance)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()} /></label><label>Movimento<select name="direction"><option value="credit">Crédito / Entrada</option><option value="debit">Débito / Saída</option></select></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01" /></label><label>Forma / meio<input name="payment_method" placeholder="PIX, TED, tarifa..." /></label><label className="wide">Descrição<input required name="description" placeholder="Descrição do lançamento" /></label><label>ID externo<input name="external_id" placeholder="NSU, ID banco..." /></label><label>Observações<input name="notes" /></label><div className="bank-form-actions"><button type="button" onClick={closeOperation}>Cancelar</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Registrar movimento'}</button></div></form> : null}

      {operation === 'transfer' ? <form className="bank-form" onSubmit={transferSubmit}><label className="wide">Conta de origem<select required name="source"><option value="">Selecione...</option>{active.map(a => <option key={text(a.id)} value={text(a.id)}>{text(a.name)} — {money(a.balance)}</option>)}</select></label><label className="wide">Conta de destino<select required name="destination"><option value="">Selecione...</option>{active.map(a => <option key={text(a.id)} value={text(a.id)}>{text(a.name)}</option>)}</select></label><label>Data<input required type="date" name="transaction_date" defaultValue={today()} /></label><label>Valor<input required type="number" name="amount" min="0.01" step="0.01" /></label><label className="wide">Descrição<input name="description" placeholder="Ex.: Depósito do caixa no banco" /></label><div className="bank-form-actions"><button type="button" onClick={closeOperation}>Cancelar</button><button type="submit" className="primary" disabled={saving || active.length < 2}>{saving ? 'Transferindo...' : 'Transferir'}</button></div></form> : null}
    </section></div> : null}
  </div>;
}
