const WIDTH = 44;

const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const money = (value) => num(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rule = (char = '-') => char.repeat(WIDTH);
const padLeft = (value, width) => clean(value).slice(-width).padStart(width, ' ');

function center(value) {
  const text = clean(value).slice(0, WIDTH);
  const left = Math.max(Math.floor((WIDTH - text.length) / 2), 0);
  return `${' '.repeat(left)}${text}`.padEnd(WIDTH, ' ');
}

function pair(label, value) {
  const right = clean(value);
  const room = Math.max(WIDTH - right.length - 1, 8);
  const left = clean(label).slice(0, room);
  if (left.length + right.length + 1 <= WIDTH) return `${left.padEnd(WIDTH - right.length - 1, ' ')} ${right}`;
  return `${clean(label).slice(0, WIDTH)}\n${padLeft(right, WIDTH)}`;
}

function installCashCloseReceivableV115(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__cashCloseReceivableV115) return;
  ThorAgent.prototype.__cashCloseReceivableV115 = true;
  const previous = ThorAgent.prototype.cashCloseDocument;
  if (typeof previous !== 'function') return;

  ThorAgent.prototype.cashCloseDocument = function (summaryInput = null) {
    const doc = previous.call(this, summaryInput);
    const summary = doc?.summary || summaryInput || {};
    const total = num(summary.receivable_received_total);
    const count = Math.trunc(num(summary.receivable_receipt_count));
    if (!doc || doc.kind !== 'text' || total <= 0.009) return doc;

    const receiptMethods = Array.isArray(summary.receivable_payments) ? summary.receivable_payments : [];
    const insert = [
      rule('-'),
      center('RECEBIMENTOS DE CREDIÁRIO'),
      pair(`Recebimentos (${count})`, `R$ ${money(total)}`),
    ];
    for (const row of receiptMethods) {
      const name = clean(row.name) || clean(row.method) || 'Forma';
      insert.push(pair(name, `R$ ${money(row.amount)}`));
    }
    insert.push(pair('Em dinheiro na gaveta', `R$ ${money(summary.receivable_received_cash)}`));
    insert.push('Somente recebimentos em dinheiro compõem o'.padEnd(WIDTH, ' '));
    insert.push('numerário esperado da gaveta.'.padEnd(WIDTH, ' '));

    const lines = String(doc.text || '').split('\n');
    let marker = lines.findIndex((line) => clean(line) === 'DEVOLUÇÕES E VALES');
    if (marker < 0) marker = lines.findIndex((line) => clean(line) === 'CONFERÊNCIA DA GAVETA');
    if (marker >= 0 && marker > 0 && /^[-=]{20,}$/.test(clean(lines[marker - 1]))) marker -= 1;
    if (marker < 0) marker = Math.max(lines.length - 8, 0);
    lines.splice(marker, 0, ...insert);

    return { ...doc, text:lines.join('\n') };
  };
}

module.exports = { installCashCloseReceivableV115 };
