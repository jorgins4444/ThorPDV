'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import {
  erpClassifyReceivable,
  erpCreateReceivable,
  erpReceivableDetail,
  erpReceivablesList,
  erpReverseReceivable,
  erpSettleReceivable,
  type ReceivableFilters,
} from './receivables-actions';

type Row = Record<string, unknown>;
type Props = {
  initial: Row[];
  customers: Row[];
  accounts: Row[];
  paymentMethods: Row[];
  categories: Row[];
  costCenters: Row[];
};
type Stats = { overdue: number; overdueValue: number; open: number; openValue: number; paid: number; total: number };

const money = (v: unknown) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const text = (v: unknown) => (v == null ? '' : String(v));
const date = (v: unknown) => {
  if (!v) return '—';
  const raw = String(v);
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('pt-BR');
};
const dateTime = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
const today = () => new Date().toISOString().slice(0, 10);
const statusLabel = (s: unknown) => ({ open: 'Aberto', partial: 'Aberto', overdue: 'Vencido', paid: 'Quitado', cancelled: 'Estornado' }[String(s)] || String(s || '—'));
const docLabel = (s: unknown) => (String(s) === 'boleto' ? 'Boleto' : 'Crediário');
const methodLabel = (s: unknown) => ({ cash: 'Dinheiro', pix: 'PIX', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', voucher: 'Voucher', bank_transfer: 'Transferência', bank_slip: 'Boleto' }[String(s)] || String(s || '—'));
const empty: ReceivableFilters = { customerName: '', status: '', documentType: '', customerId: '', issuedFrom: '', issuedTo: '', dueFrom: '', dueTo: '', paidFrom: '', paidTo: '' };
const errorLabel = (value: unknown) => {
  const e = String(value || 'erro');
  const map: Record<string, string> = {
    invalid_document_type: 'Selecione Boleto ou Crediário.',
    invalid_amount: 'Informe um valor maior que zero.',
    due_date_required: 'Informe o vencimento.',
    description_required: 'Informe uma descrição para o lançamento.',
    customer_not_found: 'Selecione um cliente ativo.',
    insufficient_crediario_credit: 'O cliente não possui Crédito em loja suficiente para este Crediário.',
    invalid_settlement_amount: 'Valor de recebimento inválido.',
    reversal_reason_required: 'Informe o motivo do estorno.',
    financial_entry_not_found: 'Conta não encontrada ou já estornada.',
    invalid_payment_method: 'Forma de recebimento indisponível.',
    invalid_financial_category: 'Selecione uma categoria financeira válida para receitas.',
    invalid_chart_account: 'A categoria escolhida não possui uma conta gerencial válida.',
    invalid_cost_center: 'Selecione um centro de custo válido.',
  };
  return map[e] || e;
};

export function ReceivablesWorkspaceV2({ initial, customers, accounts, paymentMethods, categories, costCenters }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [filters, setFilters] = useState<ReceivableFilters>(empty);
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Row | null>(null);
  const [classifyTarget, setClassifyTarget] = useState<Row | null>(null);
  const [settleAmount, setSettleAmount] = useState(0);
  const [settleDate, setSettleDate] = useState(today());
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [settling, setSettling] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState('');
  const [reverseTarget, setReverseTarget] = useState<Row | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newDoc, setNewDoc] = useState<'boleto' | 'crediario'>('boleto');
  const [newCustomer, setNewCustomer] = useState('');

  const activeCustomers = useMemo(() => customers.filter(c => c.active !== false), [customers]);
  const internalCash = useMemo(() => accounts.find(a => a.active !== false && String(a.account_type) === 'internal_cash'), [accounts]);
  const methods = useMemo(() => {
    const list = paymentMethods.filter(m => !['term_sale', 'store_credit'].includes(String(m.code)));
    return list.length ? list : [{ code: 'cash', name: 'Dinheiro' }];
  }, [paymentMethods]);
  const receivableCategories = useMemo(() => categories.filter(c => c.active !== false && ['receivable', 'both'].includes(text(c.entry_type))), [categories]);
  const activeCenters = useMemo(() => costCenters.filter(c => c.active !== false), [costCenters]);
  const defaultCategory = useMemo(() => receivableCategories.find(c => text(c.code) === 'SALES') ?? receivableCategories[0], [receivableCategories]);
  const defaultCenter = useMemo(() => activeCenters.find(c => c.is_default === true) ?? activeCenters[0], [activeCenters]);
  const selectedCustomer = useMemo(() => activeCustomers.find(c => String(c.id) === newCustomer), [activeCustomers, newCustomer]);
  const stats = useMemo(() => rows.reduce<Stats>((a, r) => {
    const s = String(r.status);
    if (s === 'overdue') { a.overdue += 1; a.overdueValue += Number(r.remaining || 0); }
    if (s === 'open' || s === 'partial') { a.open += 1; a.openValue += Number(r.remaining || 0); }
    if (s === 'paid') a.paid += 1;
    if (s !== 'cancelled') a.total += Number(r.remaining || 0);
    return a;
  }, { overdue: 0, overdueValue: 0, open: 0, openValue: 0, paid: 0, total: 0 }), [rows]);
  const activeFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);
  const detailTitle = (detail?.title as Row | undefined) || {};
  const detailReceipts = Array.isArray(detail?.receipts) ? detail.receipts as Row[] : [];

  const set = (key: keyof ReceivableFilters, value: string) => setFilters(v => ({ ...v, [key]: value }));
  const load = (next: ReceivableFilters = filters) => startTransition(async () => {
    const r = await erpReceivablesList(next);
    if (r.ok) { setRows(r.data); setMessage(''); } else setMessage(errorLabel(r.error));
  });
  const clear = () => { setFilters(empty); load(empty); };
  const reload = async () => { const r = await erpReceivablesList(filters); if (r.ok) setRows(r.data); };

  async function createReceivable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setMessage('');
    const r = await erpCreateReceivable({
      customer_id: newCustomer,
      document_type: newDoc,
      description: String(fd.get('description') || ''),
      reference: String(fd.get('reference') || ''),
      issued_at: String(fd.get('issued_at') || today()),
      due_date: String(fd.get('due_date') || ''),
      amount: Number(fd.get('amount') || 0),
      installment: Number(fd.get('installment') || 1),
      installments: Number(fd.get('installments') || 1),
      notes: String(fd.get('notes') || ''),
      financial_category_id: String(fd.get('financial_category_id') || ''),
      cost_center_id: String(fd.get('cost_center_id') || ''),
    });
    setSaving(false);
    if (!r.ok) { setMessage(errorLabel(r.error)); return; }
    setCreateOpen(false);
    setNewCustomer('');
    setNewDoc('boleto');
    setMessage(`${docLabel(r.document_type)} criado, classificado e pronto para cobrança. ${newDoc === 'boleto' ? 'O título já pode entrar em Remessa/Retorno.' : 'O valor foi reservado no Crédito em loja do cliente.'}`);
    await reload();
  }

  async function classifyReceivable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!classifyTarget) return;
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setMessage('');
    const r = await erpClassifyReceivable(String(classifyTarget.id), {
      financial_category_id: String(fd.get('financial_category_id') || ''),
      cost_center_id: String(fd.get('cost_center_id') || ''),
    });
    setSaving(false);
    if (!r.ok) { setMessage(errorLabel(r.error)); return; }
    setClassifyTarget(null);
    setMessage('Classificação gerencial da conta a receber atualizada.');
    await reload();
  }

  function openSettlement(row: Row) {
    setSelected(row);
    setSettleAmount(Number(row.remaining || 0));
    setSettleDate(today());
    setMethod(String(methods.find(m => String(m.code) === 'cash')?.code || methods[0]?.code || 'cash'));
    setNotes('');
  }
  async function settle() {
    if (!selected) return;
    setSettling(true); setMessage('');
    const r = await erpSettleReceivable(String(selected.id), {
      amount: settleAmount,
      payment_method: method,
      destination_type: 'bank_account',
      bank_account_id: String(internalCash?.id || ''),
      cash_session_id: null,
      settled_at: `${settleDate}T12:00:00-03:00`,
      notes,
    });
    setSettling(false);
    if (!r.ok) { setMessage(errorLabel(r.error)); return; }
    setSelected(null);
    setMessage('Recebimento registrado no Caixa Interno. O fechamento do caixa do PDV não foi alterado.');
    await reload();
  }
  async function openDetail(row: Row) {
    setDetailLoading(String(row.id));
    const r = await erpReceivableDetail(String(row.id));
    setDetailLoading('');
    if (r.ok) setDetail(r); else setMessage(errorLabel(r.error));
  }
  async function reverse() {
    if (!reverseTarget || reverseReason.trim().length < 3) return;
    setReversing(true);
    const r = await erpReverseReceivable(String(reverseTarget.id), reverseReason.trim());
    setReversing(false);
    if (!r.ok) { setMessage(errorLabel(r.error)); return; }
    setReverseTarget(null);
    setMessage('Conta estornada e histórico financeiro preservado.');
    await reload();
  }

  return <div className="recv2">
    <section className="recv2-head">
      <div><span>FINANCEIRO</span><h2>Contas a Receber</h2><p>Boleto e Crediário em uma carteira única, agora ligados à classificação gerencial.</p></div>
      <div className="recv2-head-actions"><button type="button" className="recv2-filter-btn" onClick={() => setFilterOpen(v => !v)}>⌕ Filtros {activeFilterCount ? `(${activeFilterCount})` : ''}</button><button type="button" className="recv2-primary" onClick={() => setCreateOpen(true)}>＋ Novo lançamento</button></div>
    </section>
    {message && <div className="recv2-message"><span>{message}</span><button type="button" onClick={() => setMessage('')}>×</button></div>}
    <section className="recv2-stats"><article className="danger"><span>Vencidos</span><strong>{stats.overdue}</strong><small>{money(stats.overdueValue)} em atraso</small></article><article><span>Em aberto</span><strong>{stats.open}</strong><small>{money(stats.openValue)} a vencer</small></article><article><span>Quitados</span><strong>{stats.paid}</strong><small>no resultado atual</small></article><article><span>Saldo da carteira</span><strong>{money(stats.total)}</strong><small>aberto + vencido</small></article></section>

    {filterOpen && <section className="recv2-filters"><header><div><b>Filtros</b><span>Use somente quando precisar refinar a carteira.</span></div><button type="button" onClick={() => setFilterOpen(false)}>×</button></header><div className="recv2-filter-grid"><label className="wide">Nome do cliente<input value={filters.customerName || ''} onChange={e => set('customerName', e.target.value)} placeholder="Digite parte do nome..." /></label><label>Status<select value={filters.status || ''} onChange={e => set('status', e.target.value)}><option value="">Todos</option><option value="overdue">Vencido</option><option value="open">Aberto</option><option value="paid">Quitado</option><option value="cancelled">Estornado</option></select></label><label>Documento<select value={filters.documentType || ''} onChange={e => set('documentType', e.target.value)}><option value="">Boleto + Crediário</option><option value="boleto">Boleto</option><option value="crediario">Crediário</option></select></label><label>Cliente<select value={filters.customerId || ''} onChange={e => set('customerId', e.target.value)}><option value="">Todos</option>{activeCustomers.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select></label><label>Vencimento de<input type="date" value={filters.dueFrom || ''} onChange={e => set('dueFrom', e.target.value)} /></label><label>Vencimento até<input type="date" value={filters.dueTo || ''} onChange={e => set('dueTo', e.target.value)} /></label><label>Emissão de<input type="date" value={filters.issuedFrom || ''} onChange={e => set('issuedFrom', e.target.value)} /></label><label>Emissão até<input type="date" value={filters.issuedTo || ''} onChange={e => set('issuedTo', e.target.value)} /></label></div><footer><button type="button" onClick={clear}>Limpar</button><button type="button" className="recv2-primary" disabled={pending} onClick={() => load()}>{pending ? 'Consultando...' : 'Aplicar filtros'}</button></footer></section>}

    <section className="recv2-card">
      <div className="recv2-list-head"><div><b>Carteira de recebimentos</b><span>Categoria, conta gerencial e centro de custo acompanham cada título.</span></div><span>{rows.length} título(s)</span></div>
      {rows.length === 0 ? <div className="recv2-empty">Nenhuma conta encontrada.</div> : <div className="recv2-table-wrap"><table><thead><tr><th>Cliente / descrição</th><th>Documento</th><th>Classificação</th><th>Vencimento</th><th>Valor</th><th>Saldo</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map(row => {
        const s = String(row.status);
        const overdue = s === 'overdue';
        const canReceive = !['paid', 'cancelled'].includes(s) && Number(row.remaining || 0) > 0;
        return <tr key={String(row.id)} className={overdue ? 'is-overdue' : s === 'cancelled' ? 'is-cancelled' : ''}>
          <td><b>{String(row.customer || 'Cliente')}</b><span>{String(row.description || '—')}</span><small>{row.manual ? 'Lançamento manual' : `Venda #${String(row.sale_number || '—')}`} · emissão {date(row.issued_at)}</small></td>
          <td><span className={`recv2-doc ${String(row.document_type)}`}>{docLabel(row.document_type)}</span></td>
          <td><b>{text(row.financial_category) || 'Sem categoria'}</b><span>{text(row.account_code)} {text(row.account)}</span><small>{text(row.cost_center) || 'Sem centro de custo'}</small></td>
          <td>{overdue ? <span className="recv2-due-alert"><i>⚠</i>{date(row.due_date)}</span> : <span className="recv2-due">{date(row.due_date)}</span>}</td>
          <td><b>{money(row.amount)}</b></td><td><b>{money(row.remaining)}</b></td>
          <td><span className={`recv2-status ${s}`}>{statusLabel(s)}</span></td>
          <td><div className="recv2-row-actions"><button type="button" disabled={detailLoading === String(row.id)} onClick={() => void openDetail(row)}>Detalhes</button><button type="button" onClick={() => setClassifyTarget(row)}>Classificar</button>{canReceive && <button type="button" className="receive" onClick={() => openSettlement(row)}>Receber</button>}{s !== 'cancelled' && <button type="button" className="more" onClick={() => { setReverseTarget(row); setReverseReason(''); }}>Estornar</button>}</div></td>
        </tr>;
      })}</tbody></table></div>}
    </section>

    {createOpen && <div className="recv2-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setCreateOpen(false); }}><section className="recv2-modal create"><header><div><span>NOVO LANÇAMENTO</span><h3>Conta a Receber</h3><p>Crie um Boleto ou Crediário já classificado para os relatórios gerenciais.</p></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header><form onSubmit={createReceivable}><div className="recv2-doc-switch"><button type="button" className={newDoc === 'boleto' ? 'active' : ''} onClick={() => setNewDoc('boleto')}><b>▤ Boleto</b><small>Elegível para Remessa / Retorno</small></button><button type="button" className={newDoc === 'crediario' ? 'active' : ''} onClick={() => setNewDoc('crediario')}><b>◫ Crediário</b><small>Exige Crédito em loja disponível</small></button></div><div className="recv2-form-grid"><label className="wide">Cliente<select required value={newCustomer} onChange={e => setNewCustomer(e.target.value)}><option value="">Selecione o cliente...</option>{activeCustomers.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}{c.document ? ` · ${String(c.document)}` : ''}</option>)}</select></label>{newDoc === 'crediario' && <div className="recv2-credit-box wide"><span>Crédito em loja disponível</span><b>{money(selectedCustomer?.store_credit_balance)}</b><small>O lançamento só será gravado se houver saldo suficiente. A quitação recompõe este crédito.</small></div>}<label className="wide">Descrição<input name="description" required placeholder="Ex.: Mensalidade, serviço prestado, venda externa..." /></label><label>Referência / documento<input name="reference" placeholder="Ex.: OS 1254, contrato 18..." /></label><label>Valor<input name="amount" required type="number" min="0.01" step="0.01" placeholder="0,00" /></label><label>Data de emissão<input name="issued_at" type="date" defaultValue={today()} /></label><label>Vencimento<input name="due_date" required type="date" /></label><label>Parcela<input name="installment" type="number" min="1" defaultValue="1" /></label><label>Total de parcelas<input name="installments" type="number" min="1" defaultValue="1" /></label><label className="wide">Categoria financeira<select required name="financial_category_id" defaultValue={text(defaultCategory?.id)}><option value="">Selecione...</option>{receivableCategories.map(c => <option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)} → {text(c.account_name)}</option>)}</select></label><label className="wide">Centro de custo<select name="cost_center_id" defaultValue={text(defaultCenter?.id)}><option value="">Automático pela filial</option>{activeCenters.map(c => <option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch) ? ` · ${text(c.branch)}` : ''}</option>)}</select></label><label className="wide">Observação<textarea name="notes" rows={3} placeholder="Informações adicionais sobre a cobrança..." /></label></div><div className="recv2-cash-note"><b>Destino após quitação: Caixa Interno</b><span>A classificação gerencial alimenta DRE e relatórios; o recebimento continua fora do fechamento da sessão de caixa do PDV.</span></div><footer><button type="button" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="recv2-primary" disabled={saving || !newCustomer || !defaultCategory}>{saving ? 'Salvando...' : 'Criar conta a receber'}</button></footer></form></section></div>}

    {classifyTarget && <div className="recv2-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) setClassifyTarget(null); }}><section className="recv2-modal create"><header><div><span>CLASSIFICAÇÃO GERENCIAL</span><h3>{text(classifyTarget.customer) || 'Conta a receber'}</h3><p>{text(classifyTarget.description)} · {money(classifyTarget.amount)}</p></div><button type="button" onClick={() => setClassifyTarget(null)}>×</button></header><form onSubmit={classifyReceivable}><div className="recv2-form-grid"><label className="wide">Categoria financeira<select required name="financial_category_id" defaultValue={text(classifyTarget.financial_category_id) || text(defaultCategory?.id)}><option value="">Selecione...</option>{receivableCategories.map(c => <option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)} → {text(c.account_name)}</option>)}</select></label><label className="wide">Centro de custo<select name="cost_center_id" defaultValue={text(classifyTarget.cost_center_id) || text(defaultCenter?.id)}><option value="">Automático / manter atual</option>{activeCenters.map(c => <option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch) ? ` · ${text(c.branch)}` : ''}</option>)}</select></label></div><div className="recv2-cash-note"><b>Conta gerencial derivada da categoria</b><span>Ao alterar a categoria, a conta vinculada a ela é aplicada automaticamente.</span></div><footer><button type="button" onClick={() => setClassifyTarget(null)}>Cancelar</button><button className="recv2-primary" disabled={saving}>{saving ? 'Salvando...' : 'Atualizar classificação'}</button></footer></form></section></div>}

    {selected && <div className="recv2-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !settling) setSelected(null); }}><section className="recv2-modal settle"><header><div><span>RECEBIMENTO</span><h3>{String(selected.customer || 'Cliente')}</h3><p>{String(selected.description || '')} · saldo {money(selected.remaining)}</p></div><button type="button" onClick={() => setSelected(null)}>×</button></header><div className="recv2-form-grid"><label>Valor recebido<input type="number" min="0.01" max={Number(selected.remaining || 0)} step="0.01" value={settleAmount} onChange={e => setSettleAmount(Number(e.target.value))} /></label><label>Data<input type="date" value={settleDate} onChange={e => setSettleDate(e.target.value)} /></label><label>Forma<select value={method} onChange={e => setMethod(e.target.value)}>{methods.map(m => <option key={String(m.code)} value={String(m.code)}>{String(m.name || methodLabel(m.code))}</option>)}</select></label><div className="recv2-fixed-destination"><span>DESTINO</span><b>Caixa Interno</b><small>{String(internalCash?.name || 'Caixa Interno')} · fora do fechamento do PDV</small></div><label className="wide">Observação<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comprovante, observação, referência..." /></label></div><footer><button type="button" onClick={() => setSelected(null)}>Cancelar</button><button className="recv2-primary" disabled={settling || settleAmount <= 0} onClick={() => void settle()}>{settling ? 'Registrando...' : settleAmount + 0.001 >= Number(selected.remaining || 0) ? 'Quitar título' : 'Registrar parcial'}</button></footer></section></div>}

    {detail && <div className="recv2-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDetail(null); }}><section className="recv2-modal detail"><header><div><span>DETALHES</span><h3>{String(detailTitle.customer || 'Cliente')}</h3><p>{docLabel(detailTitle.document_type)} · {String(detailTitle.description || '')}</p></div><button type="button" onClick={() => setDetail(null)}>×</button></header><div className="recv2-detail-kpis"><div><span>Valor</span><b>{money(detailTitle.amount)}</b></div><div><span>Saldo</span><b>{money(detailTitle.remaining)}</b></div><div><span>Vencimento</span><b>{date(detailTitle.due_date)}</b></div><div><span>Status</span><b>{statusLabel(detailTitle.status)}</b></div></div><div className="recv2-detail-info"><div><span>Emissão</span><b>{date(detailTitle.issued_at)}</b></div><div><span>Origem</span><b>{String(detailTitle.origin) === 'manual_receivable' ? 'Lançamento manual' : 'Venda a prazo'}</b></div><div><span>Referência</span><b>{String(detailTitle.reference || '—')}</b></div><div><span>Quitação</span><b>{dateTime(detailTitle.paid_at)}</b></div></div><section className="recv2-receipts"><h4>Histórico de recebimentos</h4>{detailReceipts.length === 0 ? <p>Nenhum recebimento registrado.</p> : detailReceipts.map((r, i) => <article key={String(r.id || i)}><div><b>{money(r.amount)}</b><span>{methodLabel(r.payment_method)} · {String(r.account || 'Caixa Interno')}</span></div><div><b>{String(r.status) === 'reversed' ? 'Estornado' : 'Recebido'}</b><span>{dateTime(String(r.status) === 'reversed' ? r.reversed_at : r.settled_at)}</span></div></article>)}</section></section></div>}

    {reverseTarget && <div className="recv2-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !reversing) setReverseTarget(null); }}><section className="recv2-modal reverse"><header><div><span>ESTORNO</span><h3>Estornar conta a receber?</h3><p>{String(reverseTarget.customer || '')} · {money(reverseTarget.amount)}</p></div><button type="button" onClick={() => setReverseTarget(null)}>×</button></header><p className="recv2-warning">O histórico será preservado. Se for Crediário sujeito ao Crédito em loja, o limite remanescente será liberado novamente.</p><label>Motivo do estorno<textarea autoFocus rows={3} value={reverseReason} onChange={e => setReverseReason(e.target.value)} placeholder="Informe o motivo..." /></label><footer><button type="button" onClick={() => setReverseTarget(null)}>Voltar</button><button className="recv2-danger" disabled={reversing || reverseReason.trim().length < 3} onClick={() => void reverse()}>{reversing ? 'Estornando...' : 'Confirmar estorno'}</button></footer></section></div>}
  </div>;
}
