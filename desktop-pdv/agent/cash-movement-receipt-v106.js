const WIDTH = 44;

const ascii = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7E]/g, '');

const fit = (value) => ascii(value).slice(0, WIDTH).padEnd(WIDTH, ' ');
const center = (value) => {
  const text = ascii(value).slice(0, WIDTH);
  const left = Math.max(Math.floor((WIDTH - text.length) / 2), 0);
  return ' '.repeat(left) + text + ' '.repeat(Math.max(WIDTH - left - text.length, 0));
};
const money = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
const json = (value, fallback = {}) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const wrap = (value) => {
  const words = ascii(value).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word.slice(0, WIDTH);
    else if (`${current} ${word}`.length <= WIDTH) current += ` ${word}`;
    else { lines.push(fit(current)); current = word.slice(0, WIDTH); }
  }
  if (current) lines.push(fit(current));
  return lines.length ? lines : [fit('-')];
};

function installCashMovementReceiptV106(ThorAgent) {
  if (ThorAgent.prototype.__cashMovementReceiptV106) return;
  ThorAgent.prototype.__cashMovementReceiptV106 = true;

  const originalCashMovement = ThorAgent.prototype.cashMovement;

  ThorAgent.prototype.cashMovement = async function (input = {}) {
    const movementType = String(input.movementType || input.movement_type || '').trim();
    const amount = Number(input.amount || 0);
    const reason = String(input.notes || input.reason || '').trim().replace(/\s+/g, ' ');

    if (!['supply', 'withdrawal'].includes(movementType)) throw new Error('invalid_cash_movement_type');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid_cash_movement_amount');
    if (!reason) throw new Error('cash_movement_reason_required');

    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');

    const result = await originalCashMovement.call(this, {
      ...input,
      movementType,
      amount,
      notes: reason,
    });

    const row = result?.eventId
      ? this.store.db.prepare('select payload,created_at from queue where id=? limit 1').get(String(result.eventId))
      : null;
    const payload = json(row?.payload, {});
    const occurredAt = String(payload.occurred_at || row?.created_at || new Date().toISOString());
    const receipt = {
      event_id: result?.eventId || '',
      movement_type: movementType,
      amount,
      reason,
      operator_id: operator.id,
      operator_name: operator.name || 'Operador',
      occurred_at: occurredAt,
      supervisor_name: input.supervisorAuthorization?.supervisor_name || payload.supervisor_authorization?.supervisor_name || '',
      cash_open_event_id: payload.cash_open_event_id || this.store.get('cash_open_event_id') || '',
    };

    return { ...result, receipt };
  };

  ThorAgent.prototype.cashMovementDocument = function (receipt = {}) {
    const type = String(receipt.movement_type || receipt.movementType || '').trim();
    const isSupply = type === 'supply';
    const isWithdrawal = type === 'withdrawal';
    if (!isSupply && !isWithdrawal) throw new Error('invalid_cash_movement_type');

    const context = json(this.store.get('context', '{}'), {});
    const title = isSupply ? 'COMPROVANTE DE SUPRIMENTO' : 'COMPROVANTE DE SANGRIA';
    const action = isSupply ? 'ENTRADA DE DINHEIRO' : 'RETIRADA DE DINHEIRO';
    const occurredAt = new Date(receipt.occurred_at || Date.now());
    const reason = String(receipt.reason || receipt.notes || '').trim() || '-';
    const strong = '='.repeat(WIDTH);
    const sep = '-'.repeat(WIDTH);
    const lines = [
      strong,
      center(context.company_name || 'THORPDV'),
      context.branch_name ? center(context.branch_name) : null,
      center(title),
      strong,
      fit(`TIPO: ${action}`),
      fit(`VALOR: ${money(receipt.amount)}`),
      sep,
      ...wrap(`OPERADOR: ${receipt.operator_name || 'Operador'}`),
      fit(`DATA/HORA: ${occurredAt.toLocaleString('pt-BR')}`),
    ].filter(Boolean);

    if (receipt.supervisor_name) lines.push(...wrap(`AUTORIZADO POR: ${receipt.supervisor_name}`));
    lines.push(sep, fit('MOTIVO:'), ...wrap(reason), sep);
    if (receipt.event_id) lines.push(...wrap(`CONTROLE: ${receipt.event_id}`));
    lines.push(center('MOVIMENTACAO REGISTRADA NO THORPDV'), strong, '', '', '');

    const text = lines.join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Consolas,monospace;padding:18px;color:#111}pre{white-space:pre-wrap;font-size:12px;line-height:1.35}</style></head><body><pre>${text.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</pre></body></html>`;
    return {
      kind: 'text', width: WIDTH, text, html,
      title: isSupply ? 'Suprimento de Caixa' : 'Sangria de Caixa',
      filename: `ThorPDV-${isSupply ? 'Suprimento' : 'Sangria'}-${Date.now()}.pdf`,
      receipt,
    };
  };
}

module.exports = { installCashMovementReceiptV106 };
