const crypto = require('crypto');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

const PAYMENT_LABELS = {
  cash: 'Dinheiro', pix: 'PIX', debit_card: 'Cartao de debito', credit_card: 'Cartao de credito', voucher: 'Voucher', store_credit: 'Credito em loja', term_sale: 'Venda a Prazo', other: 'Outros',
};

function money(value) { return Number(value || 0); }
function json(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }

function installCashClosing(ThorAgent) {
  const originalCashMovement = ThorAgent.prototype.cashMovement;
  const originalReturnSale = ThorAgent.prototype.returnSale;

  ThorAgent.prototype._localCashSummary = function ({ onlyUnsynced = false } = {}) {
    const openId = this.store.get('cash_open_event_id') || '';
    if (!openId) throw new Error('cash_not_open');
    const openRow = this.store.db.prepare("select * from queue where id=? and type='cash_open' limit 1").get(openId);
    const openedAt = openRow?.created_at || new Date(0).toISOString();
    const openPayload = json(openRow?.payload, {});
    const rows = this.store.db.prepare('select * from queue where datetime(created_at)>=datetime(?) order by datetime(created_at),rowid').all(openedAt);
    const payments = new Map();
    const movements = { supply: 0, withdrawal: 0, expense: 0, refund: 0 };
    let salesCount = 0, salesTotal = 0, pendingEvents = 0, rejectedEvents = 0;

    for (const row of rows) {
      if (onlyUnsynced && row.state === 'synced') continue;
      const payload = json(row.payload, {});
      if (row.state === 'pending') pendingEvents++;
      if (row.state === 'rejected') rejectedEvents++;
      if (row.type === 'sale_completed' && (!payload.cash_open_event_id || String(payload.cash_open_event_id) === String(openId))) {
        salesCount++;
        const total = (payload.items || []).reduce((sum, item) => sum + money(item.quantity) * money(item.unit_price) - money(item.discount), 0) - money(payload.discount) + money(payload.surcharge);
        salesTotal += Math.max(total, 0);
        for (const payment of payload.payments || []) payments.set(payment.method, money(payments.get(payment.method)) + money(payment.amount));
      }
      if (row.type === 'cash_movement' && (!payload.cash_open_event_id || String(payload.cash_open_event_id) === String(openId))) {
        const type = String(payload.movement_type || '');
        if (Object.prototype.hasOwnProperty.call(movements, type)) movements[type] += money(payload.amount);
      }
      if (row.type === 'sale_return' && String(payload.refund_method || '') === 'cash' && (!payload.cash_open_event_id || String(payload.cash_open_event_id) === String(openId))) movements.refund += money(payload.refund_amount);
    }

    const paymentRows = [...payments.entries()].map(([method, amount]) => ({ method, amount, count: 0 }));
    const cashPayments = money(payments.get('cash'));
    const opening = money(openPayload.opening_amount);
    return {
      ok: true, source: 'local', cash_session_id: null, client_event_id: openId, opened_at: openedAt, opening_amount: opening,
      sales_count: salesCount, sales_total: salesTotal, payments: paymentRows,
      movements: Object.entries(movements).filter(([,amount]) => amount).map(([movement_type, amount]) => ({ movement_type, amount, count: 0 })),
      cash_payments: cashPayments, supply: movements.supply, withdrawal: movements.withdrawal, expense: movements.expense, refund: movements.refund,
      expected_cash: opening + cashPayments + movements.supply - movements.withdrawal - movements.expense - movements.refund,
      pending_events: pendingEvents, rejected_events: rejectedEvents,
    };
  };

  ThorAgent.prototype.cashClosingPreview = async function () {
    const localAll = this._localCashSummary();
    const token = this.deviceToken();
    if (!token) return localAll;
    try {
      await this.sync.run(true);
      const response = await fetch(`${this.apiBase.replace(/\/$/,'')}/api/pdv/cash/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' });
      const server = await response.json().catch(() => ({}));
      if (!response.ok || !server.ok) throw new Error(server.error || `http_${response.status}`);
      const unsynced = this._localCashSummary({ onlyUnsynced: true });
      const mergedPayments = new Map((server.payments || []).map((p) => [String(p.method), money(p.amount)]));
      for (const p of unsynced.payments || []) mergedPayments.set(String(p.method), money(mergedPayments.get(String(p.method))) + money(p.amount));
      const extraCash = money((unsynced.payments || []).find((p) => p.method === 'cash')?.amount);
      const result = {
        ...server,
        source: (unsynced.pending_events || unsynced.rejected_events) ? 'server+local' : 'server',
        payments: [...mergedPayments.entries()].map(([method, amount]) => ({ method, amount })),
        sales_count: money(server.sales_count) + money(unsynced.sales_count), sales_total: money(server.sales_total) + money(unsynced.sales_total),
        cash_payments: money(server.cash_payments) + extraCash,
        supply: money(server.supply) + money(unsynced.supply), withdrawal: money(server.withdrawal) + money(unsynced.withdrawal),
        expense: money(server.expense) + money(unsynced.expense), refund: money(server.refund) + money(unsynced.refund),
        pending_events: unsynced.pending_events, rejected_events: unsynced.rejected_events,
      };
      result.expected_cash = money(result.opening_amount) + result.cash_payments + result.supply - result.withdrawal - result.expense - result.refund;
      return result;
    } catch (error) {
      return { ...localAll, source: 'local', warning: error.message || 'server_preview_unavailable' };
    }
  };

  ThorAgent.prototype.cashMovement = async function (payload = {}) {
    const openId = this.store.get('cash_open_event_id') || '';
    const result = await originalCashMovement.call(this, payload);
    if (result?.eventId && openId) {
      const row = this.store.db.prepare('select payload from queue where id=?').get(result.eventId);
      const merged = { ...json(row?.payload, {}), cash_open_event_id: openId };
      this.store.db.prepare('update queue set payload=?,updated_at=? where id=?').run(JSON.stringify(merged), new Date().toISOString(), result.eventId);
    }
    return result;
  };

  ThorAgent.prototype.returnSale = async function (payload = {}) {
    const openId = this.store.get('cash_open_event_id') || '';
    const result = await originalReturnSale.call(this, payload);
    if (result?.eventId) {
      const row = this.store.db.prepare('select payload from queue where id=?').get(result.eventId);
      const merged = { ...json(row?.payload, {}), cash_open_event_id: openId || null, refund_amount: money(result.estimatedTotal) };
      this.store.db.prepare('update queue set payload=?,updated_at=? where id=?').run(JSON.stringify(merged), new Date().toISOString(), result.eventId);
    }
    return result;
  };

  ThorAgent.prototype.closeCash = async function (payload = {}) {
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    if (!operator.permissions?.cash?.close) throw new Error('operator_not_allowed_to_close_cash');
    const openId = this.store.get('cash_open_event_id') || '';
    if (!openId) throw new Error('cash_not_open');
    const preview = payload.reconciliation || await this.cashClosingPreview();
    const closedAt = new Date().toISOString();
    const summary = {
      ...preview,
      closing_amount: money(payload.closingAmount),
      difference: money(payload.closingAmount) - money(preview.expected_cash),
      closed_at: closedAt,
      operator: { id: operator.id, name: operator.name },
      notes: String(payload.notes || ''),
    };
    const event = {
      id: crypto.randomUUID(), type: 'cash_close',
      payload: { closing_amount: money(payload.closingAmount), notes: String(payload.notes || ''), operator_user_id: operator.id, cash_open_event_id: openId, reconciliation: summary, occurred_at: closedAt },
    };
    this.store.enqueue(event);
    this.store.set('cash_open_event_id', '');
    summary.close_event_id = event.id;
    this.store.set('last_cash_close_summary', JSON.stringify(summary));
    this.sync.run(true).catch(() => {});
    return { ok: true, eventId: event.id, summary };
  };

  ThorAgent.prototype.lastCashCloseSummary = function () { return json(this.store.get('last_cash_close_summary', '{}'), null); };

  ThorAgent.prototype.cashCloseDocument = function (summaryInput = null) {
    const s = summaryInput || this.lastCashCloseSummary();
    if (!s) throw new Error('cash_close_receipt_not_found');
    const context = json(this.store.get('context', '{}'), {});
    const lines = [];
    lines.push('THORPDV');
    if (context.company_name) lines.push(context.company_name);
    if (context.branch_name) lines.push(context.branch_name);
    lines.push('COMPROVANTE DE FECHAMENTO DE CAIXA');
    lines.push('------------------------------------------');
    lines.push(`Abertura: ${s.opened_at ? new Date(s.opened_at).toLocaleString('pt-BR') : '-'}`);
    lines.push(`Fechamento: ${s.closed_at ? new Date(s.closed_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')}`);
    if (s.operator?.name) lines.push(`Operador: ${s.operator.name}`);
    lines.push(`Origem conferencia: ${s.source || 'local'}`);
    lines.push('------------------------------------------');
    lines.push(`Fundo inicial: R$ ${money(s.opening_amount).toFixed(2)}`);
    lines.push(`Vendas: ${Number(s.sales_count || 0)} | R$ ${money(s.sales_total).toFixed(2)}`);
    lines.push('FORMAS DE PAGAMENTO');
    if (Array.isArray(s.counted_payments) && s.counted_payments.length) {
      for (const p of s.counted_payments) lines.push(`${p.name || PAYMENT_LABELS[p.method] || p.method}: Sist R$ ${money(p.expected).toFixed(2)} | Conf R$ ${money(p.counted).toFixed(2)} | Dif R$ ${money(p.difference).toFixed(2)}`);
    } else {
      for (const p of s.payments || []) lines.push(`${p.name || PAYMENT_LABELS[p.method] || p.method}: R$ ${money(p.amount).toFixed(2)}`);
    }
    lines.push('MOVIMENTACOES DE CAIXA');
    lines.push(`Suprimentos: R$ ${money(s.supply).toFixed(2)}`);
    lines.push(`Sangrias: R$ ${money(s.withdrawal).toFixed(2)}`);
    if (money(s.expense)) lines.push(`Despesas: R$ ${money(s.expense).toFixed(2)}`);
    if (money(s.refund)) lines.push(`Devolucoes em dinheiro: R$ ${money(s.refund).toFixed(2)}`);
    lines.push('------------------------------------------');
    lines.push(`DINHEIRO ESPERADO: R$ ${money(s.expected_cash).toFixed(2)}`);
    lines.push(`DINHEIRO CONTADO: R$ ${money(s.closing_amount).toFixed(2)}`);
    lines.push(`DIFERENCA: R$ ${money(s.difference).toFixed(2)}`);
    if (Number(s.pending_events || 0) || Number(s.rejected_events || 0)) lines.push(`ATENCAO SYNC: ${Number(s.pending_events || 0)} pendente(s), ${Number(s.rejected_events || 0)} erro(s)`);
    if (s.notes) lines.push(`Obs.: ${s.notes}`);
    lines.push('------------------------------------------');
    lines.push('Fechamento registrado pelo ThorPDV');
    lines.push('\n\n');
    const text = lines.join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Consolas,monospace;padding:24px;color:#111}pre{white-space:pre-wrap;font-size:12px;line-height:1.45}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
    return { kind: 'text', text, html, title: 'Fechamento de Caixa', filename: `ThorPDV-Fechamento-${Date.now()}.pdf`, summary: s };
  };
}

module.exports = { installCashClosing, PAYMENT_LABELS };
