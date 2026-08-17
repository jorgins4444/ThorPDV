const crypto = require('crypto');

const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const clean = (value) => String(value ?? '').trim();
const json = (value, fallback = {}) => { try { return JSON.parse(String(value || '')); } catch { return fallback; } };

function installReceivableIdempotencyV115(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__receivableIdempotencyV115) return;
  ThorAgent.prototype.__receivableIdempotencyV115 = true;

  ThorAgent.prototype.receiveReceivables = async function (payload = {}) {
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');

    const commandPayload = {
      customer_id: payload.customerId || payload.customer_id || null,
      operator_user_id: operator.id,
      payment_method: clean(payload.paymentMethod || payload.payment_method || 'cash'),
      notes: clean(payload.notes || ''),
      items: Array.isArray(payload.items) ? payload.items.map((item) => ({
        financial_entry_id: item.financialEntryId || item.financial_entry_id,
        amount: num(item.amount),
      })).sort((a,b)=>String(a.financial_entry_id||'').localeCompare(String(b.financial_entry_id||''))) : [],
    };

    const fingerprint = JSON.stringify(commandPayload);
    const key = 'receivable_pending_operation_v115';
    const previous = json(this.store.get(key, '{}'), {});
    const operationId = previous.fingerprint === fingerprint && previous.id
      ? String(previous.id)
      : crypto.randomUUID();
    this.store.set(key, JSON.stringify({ id:operationId, fingerprint, created_at:new Date().toISOString() }));

    try {
      const response = await this.sync.request('/api/pdv/push', {
        events:[{ id:operationId, type:'receivable_receive', payload:commandPayload }],
      });
      const row = (response.results || []).find((item) => String(item.id) === operationId) || (response.results || [])[0];
      if (!row) throw new Error('receivable_empty_response');
      if (row.status !== 'processed') throw new Error(row.error || row.result?.error || 'receivable_receive_failed');
      if (row.result?.ok === false) throw new Error(row.result.error || 'receivable_receive_failed');
      this.store.set(key, '');
      return row.result || {};
    } catch (error) {
      // Se houve timeout depois de o servidor processar a baixa, mantemos o mesmo
      // id para que a tentativa seguinte recupere o recibo já criado em vez de
      // aplicar novamente um pagamento parcial.
      throw error;
    }
  };
}

module.exports = { installReceivableIdempotencyV115 };
