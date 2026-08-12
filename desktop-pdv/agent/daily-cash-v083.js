const crypto = require('crypto');

const CASH_TIME_ZONE = 'America/Fortaleza';

function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function json(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function text(value) { return String(value ?? '').trim(); }
function businessDate(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CASH_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((x) => x.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function permitted(operator, path) {
  return path.split('.').reduce((value, key) => value && value[key], operator?.permissions) === true;
}

function installDailyCashV083(ThorAgent) {
  const originalStatus = ThorAgent.prototype.status;
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalCashMovement = ThorAgent.prototype.cashMovement;
  const originalReturnSale = ThorAgent.prototype.returnSale;
  const originalCloseCash = ThorAgent.prototype.closeCash;

  ThorAgent.prototype.cashBusinessDate = function (value = Date.now()) { return businessDate(value); };

  ThorAgent.prototype._cashOpenRow = function (eventId) {
    if (!eventId) return null;
    return this.store.db.prepare("select * from queue where id=? and type='cash_open' limit 1").get(String(eventId)) || null;
  };

  ThorAgent.prototype._cashOpenDate = function (eventId) {
    const row = this._cashOpenRow(eventId);
    if (!row) return '';
    const payload = json(row.payload, {});
    return text(payload.business_date) || businessDate(payload.occurred_at || row.created_at);
  };

  ThorAgent.prototype._normalizeCurrentCashDay = function () {
    const eventId = this.store.get('cash_open_event_id') || '';
    if (!eventId) return { eventId: '', today: businessDate(), rolledOver: false };
    const openedDate = this._cashOpenDate(eventId);
    const today = businessDate();
    if (openedDate && openedDate !== today) {
      this.store.set('last_overdue_cash_event_id', eventId);
      this.store.set('cash_open_event_id', '');
      return { eventId: '', previousEventId: eventId, previousBusinessDate: openedDate, today, rolledOver: true };
    }
    return { eventId, businessDate: openedDate || today, today, rolledOver: false };
  };

  ThorAgent.prototype._cashPaymentCatalog = function () {
    let configured = [];
    try { configured = this.salesOptions?.().payment_methods || []; } catch {}
    return configured.map((method) => ({
      method: text(method.code), name: text(method.name) || text(method.code), category: text(method.category) || 'other',
      sort_order: Number(method.sort_order || 100), amount: 0, count: 0,
    })).filter((method) => method.method);
  };

  ThorAgent.prototype._mergeCashPaymentRows = function (...groups) {
    const map = new Map();
    for (const row of this._cashPaymentCatalog()) map.set(row.method, { ...row });
    for (const group of groups) for (const row of group || []) {
      const method = text(row.method); if (!method) continue;
      const current = map.get(method) || { method, name: text(row.name) || method, category: text(row.category) || (method === 'term_sale' ? 'term' : 'other'), sort_order: Number(row.sort_order || (method === 'term_sale' ? 70 : 999)), amount: 0, count: 0 };
      current.name = text(row.name) || current.name;
      current.category = text(row.category) || current.category;
      current.sort_order = Number(row.sort_order ?? current.sort_order);
      current.amount += num(row.amount);
      current.count += Number(row.count || 0);
      map.set(method, current);
    }
    return [...map.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR'));
  };

  ThorAgent.prototype._dailyLocalCashSummary = function (cashOpenEventId, { onlyUnsynced = false } = {}) {
    const eventId = text(cashOpenEventId || this.store.get('cash_open_event_id'));
    if (!eventId) throw new Error('cash_not_open');
    const openRow = this._cashOpenRow(eventId);
    if (!openRow) throw new Error('cash_not_found');
    const openPayload = json(openRow.payload, {});
    const openedAt = openPayload.occurred_at || openRow.created_at;
    const sessionDate = text(openPayload.business_date) || businessDate(openedAt);
    const rows = this.store.db.prepare('select * from queue order by datetime(created_at),rowid').all();
    const payments = new Map();
    const paymentCounts = new Map();
    const movements = { supply: 0, withdrawal: 0, expense: 0, refund: 0, receivable: 0 };
    let salesCount = 0, salesTotal = 0, termSales = 0, termCount = 0, pendingEvents = 0, rejectedEvents = 0;

    const cancelledEvents = new Set();
    for (const row of rows) {
      if (row.type !== 'sale_cancel') continue;
      const payload = json(row.payload, {});
      if (payload.sale_client_event_id) cancelledEvents.add(String(payload.sale_client_event_id));
    }

    for (const row of rows) {
      const payload = json(row.payload, {});
      if (onlyUnsynced && row.state === 'synced') continue;
      if (String(payload.cash_open_event_id || '') !== eventId && row.id !== eventId) continue;
      if (row.state === 'pending') pendingEvents++;
      if (row.state === 'rejected') rejectedEvents++;

      if (row.type === 'sale_completed' && !cancelledEvents.has(String(row.id))) {
        salesCount++;
        const gross = (payload.items || []).reduce((sum, item) => sum + num(item.quantity) * num(item.unit_price) - num(item.discount), 0);
        const total = Math.max(gross - num(payload.discount) + num(payload.surcharge), 0);
        salesTotal += total;
        let paid = 0;
        for (const payment of payload.payments || []) {
          const method = text(payment.method) || 'other';
          const amount = num(payment.amount); paid += amount;
          payments.set(method, num(payments.get(method)) + amount);
          paymentCounts.set(method, Number(paymentCounts.get(method) || 0) + 1);
        }
        const financed = payload.term ? Math.max(total - paid, 0) : 0;
        if (financed > 0.009) { termSales += financed; termCount++; }
      }
      if (row.type === 'cash_movement') {
        const type = text(payload.movement_type);
        if (Object.prototype.hasOwnProperty.call(movements, type)) movements[type] += num(payload.amount);
      }
      if (row.type === 'sale_return' && text(payload.refund_method) === 'cash') movements.refund += num(payload.refund_amount);
    }

    const actualRows = [...payments.entries()].map(([method, amount]) => ({ method, amount, count: Number(paymentCounts.get(method) || 0) }));
    if (termSales > 0.009) actualRows.push({ method: 'term_sale', name: 'Venda a Prazo', category: 'term', sort_order: 70, amount: termSales, count: termCount });
    const paymentRows = this._mergeCashPaymentRows(actualRows);
    const cashPayments = num(payments.get('cash'));
    const opening = num(openPayload.opening_amount);
    const directClosed = Boolean(this.store.get(`cash_direct_closed_${eventId}`));
    const queuedClose = rows.find((row) => row.type === 'cash_close' && String(json(row.payload, {}).cash_open_event_id || '') === eventId);
    const status = directClosed || queuedClose ? 'closed' : (sessionDate < businessDate() ? 'pending_close' : 'open');

    return {
      ok: true, source: 'local', cash_session_id: null, client_event_id: eventId, business_date: sessionDate, status,
      opened_at: openedAt, opening_amount: opening, sales_count: salesCount, sales_total: salesTotal, payments: paymentRows,
      movements: Object.entries(movements).filter(([, amount]) => amount).map(([movement_type, amount]) => ({ movement_type, amount, count: 0 })),
      cash_payments: cashPayments, term_sales_total: termSales, supply: movements.supply, receivable_received: movements.receivable,
      withdrawal: movements.withdrawal, expense: movements.expense, refund: movements.refund,
      expected_cash: opening + cashPayments + movements.supply + movements.receivable - movements.withdrawal - movements.expense - movements.refund,
      pending_events: pendingEvents, rejected_events: rejectedEvents,
    };
  };

  ThorAgent.prototype._localCashSessions = function () {
    const rows = this.store.db.prepare("select * from queue where type='cash_open' order by datetime(created_at) desc,rowid desc limit 120").all();
    return rows.map((row) => {
      try {
        const summary = this._dailyLocalCashSummary(row.id);
        const operatorId = json(row.payload, {}).operator_user_id;
        const operator = this.staffUsers?.().find((u) => String(u.id) === String(operatorId));
        return { ...summary, operator_name: operator?.name || '', local_only: row.state !== 'synced' };
      } catch { return null; }
    }).filter(Boolean);
  };

  ThorAgent.prototype._localOverdueCashCount = function () {
    const today = businessDate();
    const opens = this.store.db.prepare("select id,payload,created_at from queue where type='cash_open'").all();
    const closeRows = this.store.db.prepare("select payload from queue where type='cash_close'").all();
    const closed = new Set(closeRows.map((row) => String(json(row.payload, {}).cash_open_event_id || '')).filter(Boolean));
    let count = 0;
    for (const row of opens) {
      if (closed.has(String(row.id)) || this.store.get(`cash_direct_closed_${row.id}`)) continue;
      const payload = json(row.payload, {});
      const date = text(payload.business_date) || businessDate(payload.occurred_at || row.created_at);
      if (date && date < today) count++;
    }
    return count;
  };

  ThorAgent.prototype.status = async function () {
    const rollover = this._normalizeCurrentCashDay();
    const result = await originalStatus.call(this);
    const overdue = this._localOverdueCashCount();
    return { ...result, cashOpenEventId: this.store.get('cash_open_event_id') || null, cashBusinessDate: businessDate(), cashDayRollover: rollover.rolledOver ? rollover : null, overdueCashCount: overdue };
  };

  ThorAgent.prototype.openCash = async function ({ openingAmount = 0, notes = '' } = {}) {
    this._normalizeCurrentCashDay();
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    if (!permitted(operator, 'cash.open')) throw new Error('operator_not_allowed_to_open_cash');
    if (this.store.get('cash_open_event_id')) throw new Error('cash_already_open');
    const id = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const event = { id, type: 'cash_open', payload: { opening_amount: Math.max(num(openingAmount), 0), notes: text(notes), operator_user_id: operator.id, business_date: businessDate(occurredAt), occurred_at: occurredAt } };
    this.store.enqueue(event);
    this.store.set('cash_open_event_id', id);
    this.sync.run().catch(() => {});
    return { ok: true, eventId: id, businessDate: event.payload.business_date };
  };

  ThorAgent.prototype._requireCurrentCashDay = function () {
    const state = this._normalizeCurrentCashDay();
    if (state.rolledOver) throw new Error('cash_day_expired');
    if (!state.eventId) throw new Error('cash_not_open');
    return state;
  };

  ThorAgent.prototype.finalizeSale = async function (input = {}) {
    this._requireCurrentCashDay();
    return originalFinalizeSale.call(this, input);
  };

  ThorAgent.prototype.cashMovement = async function (input = {}) {
    this._requireCurrentCashDay();
    return originalCashMovement.call(this, input);
  };

  ThorAgent.prototype.returnSale = async function (input = {}) {
    if (text(input.refundMethod || input.refund_method) === 'cash') this._requireCurrentCashDay();
    return originalReturnSale.call(this, input);
  };

  ThorAgent.prototype.closeCash = async function (input = {}) {
    this._requireCurrentCashDay();
    return originalCloseCash.call(this, input);
  };

  ThorAgent.prototype.cashClosingPreview = async function (options = {}) {
    const target = text(options.cashOpenEventId || this.store.get('cash_open_event_id'));
    let localAll = null;
    if (target) { try { localAll = this._dailyLocalCashSummary(target); } catch {} }
    const token = this.deviceToken();
    if (!token) {
      if (localAll) return localAll;
      throw new Error('cash_not_found');
    }
    try {
      await this.sync.run(true);
      const server = await this.sync.control('cash_preview_query', { cash_open_event_id: target || '' });
      let unsynced = null;
      if (target) { try { unsynced = this._dailyLocalCashSummary(target, { onlyUnsynced: true }); } catch {} }
      const payments = this._mergeCashPaymentRows(server.payments || [], unsynced?.payments || []);
      const extraCash = num((unsynced?.payments || []).find((p) => p.method === 'cash')?.amount);
      const result = {
        ...server,
        source: unsynced && (unsynced.pending_events || unsynced.rejected_events) ? 'server+local' : 'server',
        payments,
        sales_count: num(server.sales_count) + num(unsynced?.sales_count), sales_total: num(server.sales_total) + num(unsynced?.sales_total),
        cash_payments: num(server.cash_payments) + extraCash, term_sales_total: num(server.term_sales_total) + num(unsynced?.term_sales_total),
        supply: num(server.supply) + num(unsynced?.supply), receivable_received: num(server.receivable_received) + num(unsynced?.receivable_received),
        withdrawal: num(server.withdrawal) + num(unsynced?.withdrawal), expense: num(server.expense) + num(unsynced?.expense), refund: num(server.refund) + num(unsynced?.refund),
        pending_events: num(unsynced?.pending_events), rejected_events: num(unsynced?.rejected_events),
      };
      result.expected_cash = num(result.opening_amount) + result.cash_payments + result.supply + result.receivable_received - result.withdrawal - result.expense - result.refund;
      return result;
    } catch (error) {
      if (localAll) return { ...localAll, warning: error.message || 'server_preview_unavailable' };
      throw error;
    }
  };

  ThorAgent.prototype.cashSessions = async function (filters = {}) {
    this._normalizeCurrentCashDay();
    const local = this._localCashSessions();
    const token = this.deviceToken();
    let server = [];
    let serverDate = businessDate();
    if (token) {
      try {
        await this.sync.run(true);
        const data = await this.sync.control('cash_sessions_query', {
          from: filters.from || '', to: filters.to || '', status: filters.status || 'all',
        });
        server = data.sessions || [];
        serverDate = data.business_date || serverDate;
      } catch {}
    }
    const map = new Map();
    for (const row of local) map.set(String(row.client_event_id), row);
    for (const row of server) map.set(String(row.client_event_id), { ...(map.get(String(row.client_event_id)) || {}), ...row, local_only: false });
    let rows = [...map.values()];
    const from = text(filters.from), to = text(filters.to), status = text(filters.status || 'all');
    if (from) rows = rows.filter((row) => String(row.business_date || '') >= from);
    if (to) rows = rows.filter((row) => String(row.business_date || '') <= to);
    if (status && status !== 'all') rows = rows.filter((row) => status === 'open' ? ['open','pending_close'].includes(String(row.status)) : String(row.status) === status);
    rows.sort((a, b) => String(b.business_date || '').localeCompare(String(a.business_date || '')) || new Date(b.opened_at || 0) - new Date(a.opened_at || 0));
    return { ok: true, businessDate: serverDate, sessions: rows.slice(0, 120) };
  };

  ThorAgent.prototype.closeHistoricalCash = async function ({ cashOpenEventId, closingAmount = 0, notes = '', reconciliation = {} } = {}) {
    const eventId = text(cashOpenEventId);
    if (!eventId) throw new Error('cash_not_found');
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    if (!permitted(operator, 'cash.close')) throw new Error('operator_not_allowed_to_close_cash');
    if (!this.deviceToken()) throw new Error('historical_cash_close_requires_online');
    const data = await this.sync.control('cash_historical_close', {
      cash_open_event_id: eventId,
      closing_amount: num(closingAmount),
      notes: text(notes),
      operator_user_id: operator.id,
      reconciliation,
    });
    this.store.set(`cash_direct_closed_${eventId}`, data.closed_at || new Date().toISOString());
    const summary = { ...reconciliation, ...data, client_event_id: eventId, closing_amount: num(data.closing_amount ?? closingAmount), difference: num(data.difference), closed_at: data.closed_at || new Date().toISOString(), operator: { id: operator.id, name: operator.name }, notes: text(notes), source: 'server' };
    this.store.set('last_cash_close_summary', JSON.stringify(summary));
    return { ok: true, summary };
  };

}

module.exports = { installDailyCashV083, CASH_TIME_ZONE, businessDate };
