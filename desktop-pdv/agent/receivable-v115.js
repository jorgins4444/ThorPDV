const { version: DESKTOP_VERSION } = require('../package.json');

const WIDTH = 44;
const TIME_ZONE = 'America/Fortaleza';

const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const money = (value) => num(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const padRight = (value, width) => clean(value).slice(0, width).padEnd(width, ' ');
const padLeft = (value, width) => clean(value).slice(-width).padStart(width, ' ');
const rule = (char = '-') => char.repeat(WIDTH);

function center(value) {
  const text = clean(value).slice(0, WIDTH);
  const left = Math.max(Math.floor((WIDTH - text.length) / 2), 0);
  return `${' '.repeat(left)}${text}`.padEnd(WIDTH, ' ');
}

function wrap(value, width = WIDTH) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word.slice(0, width);
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { lines.push(current); current = word.slice(0, width); }
  }
  if (current) lines.push(current);
  return lines;
}

function pair(label, value) {
  const right = clean(value);
  const room = Math.max(WIDTH - right.length - 1, 8);
  const left = clean(label).slice(0, room);
  if (left.length + right.length + 1 <= WIDTH) return `${left.padEnd(WIDTH - right.length - 1, ' ')} ${right}`;
  return `${clean(label).slice(0, WIDTH)}\n${padLeft(right, WIDTH)}`;
}

function brDate(value) {
  if (!value) return '-';
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day:'2-digit', month:'2-digit', year:'2-digit' }).format(date);
}

function brDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit',
  }).format(date);
}

function first(context, keys) {
  for (const key of keys) {
    const value = clean(context?.[key]);
    if (value) return value;
  }
  return '';
}

function addressOf(source = {}) {
  const direct = first(source, ['branch_address', 'address', 'company_address']);
  if (direct) return direct;
  const street = first(source, ['branch_street', 'street']);
  const numberValue = first(source, ['branch_number', 'number']);
  const district = first(source, ['branch_district', 'district']);
  const city = first(source, ['branch_city', 'city']);
  const state = first(source, ['branch_state', 'state']);
  const postal = first(source, ['branch_postal_code', 'postal_code', 'zip_code']);
  return [[street, numberValue].filter(Boolean).join(', '), district, [city, state].filter(Boolean).join('/'), postal ? `CEP ${postal}` : ''].filter(Boolean).join(' - ');
}

function customerAddress(customer = {}) {
  return [[clean(customer.street), clean(customer.number)].filter(Boolean).join(', '), clean(customer.complement), clean(customer.district), [clean(customer.city), clean(customer.state)].filter(Boolean).join('/'), clean(customer.postal_code) ? `CEP ${clean(customer.postal_code)}` : ''].filter(Boolean).join(' - ');
}

function paymentLabel(receipt) {
  const labels = { cash:'Dinheiro', pix:'PIX', debit_card:'Cartão de débito', credit_card:'Cartão de crédito', other:'Outros' };
  return clean(receipt?.payment_method_name) || labels[clean(receipt?.payment_method)] || clean(receipt?.payment_method) || 'Pagamento';
}

function installReceivableV115(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__receivableV115) return;
  ThorAgent.prototype.__receivableV115 = true;

  ThorAgent.prototype.receivables = async function (query = '', customerId = null) {
    const result = await this.sync.control('receivables_query', { query: clean(query), customer_id: customerId || null });
    if (result?.ok === false) throw new Error(result.error || 'receivables_query_failed');
    return result || { ok: true, customers: [], entries: [] };
  };

  ThorAgent.prototype.receiveReceivables = async function (payload = {}) {
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    const result = await this.sync.control('receivable_receive', {
      customer_id: payload.customerId || payload.customer_id || null,
      operator_user_id: operator.id,
      payment_method: clean(payload.paymentMethod || payload.payment_method || 'cash'),
      notes: clean(payload.notes || ''),
      items: Array.isArray(payload.items) ? payload.items.map((item) => ({
        financial_entry_id: item.financialEntryId || item.financial_entry_id,
        amount: Math.round(num(item.amount) * 100) / 100,
      })) : [],
    });
    if (result?.ok === false) throw new Error(result.error || 'receivable_receive_failed');
    return result;
  };

  ThorAgent.prototype.receivableReceiptDocument = function (receiptInput = null) {
    const receipt = receiptInput?.receipt || receiptInput;
    if (!receipt?.id) throw new Error('receivable_receipt_not_found');
    const context = (() => { try { return JSON.parse(this.store.get('context', '{}') || '{}'); } catch { return {}; } })();
    const customer = receipt.customer || {};
    const company = first(context, ['company_trade_name','trade_name','company_name','legal_name']) || 'ThorPDV';
    const legal = first(context, ['company_name','legal_name']);
    const cnpj = first(context, ['company_cnpj','company_document','cnpj','tax_id']);
    const ie = first(context, ['company_state_registration','state_registration','ie']);
    const branch = first(context, ['branch_name','store_name']);
    const issuerAddress = addressOf(context);
    const terminal = first(context, ['pos_name','pos_code','terminal_name','terminal_code']) || 'PDV';
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    const lines = [];
    const receiptDate = brDateTime(receipt.created_at);
    const pendingAfter = num(receipt.pending_total_after);
    const balanceBefore = pendingAfter + num(receipt.total_amount);

    lines.push(receiptDate);
    lines.push(center(company));
    if (legal && legal.toLowerCase() !== company.toLowerCase()) lines.push(...wrap(legal));
    if (branch) lines.push(...wrap(`Filial: ${branch}`));
    if (issuerAddress) lines.push(...wrap(issuerAddress));
    if (cnpj) lines.push(pair('CNPJ:', cnpj));
    if (ie) lines.push(pair('IE:', ie));
    lines.push(pair('Caixa:', terminal));
    lines.push(pair('Recebimento:', String(receipt.number || '-')));
    lines.push(rule('-'));
    lines.push(center('*** COMPROVANTE DE RECEBIMENTO ***'));
    lines.push(rule('-'));

    lines.push(...wrap(`Cliente: ${clean(customer.name || 'Cliente')}`));
    if (clean(customer.document)) lines.push(pair('CPF/CNPJ:', clean(customer.document)));
    if (clean(customer.phone)) lines.push(pair('Telefone:', clean(customer.phone)));
    const customerAddr = customerAddress(customer);
    if (customerAddr) lines.push(...wrap(`Endereco: ${customerAddr}`));
    lines.push(pair('Saldo anterior:', `R$ ${money(balanceBefore)}`));
    lines.push(rule('-'));

    lines.push(`${padRight('VENC.', 8)} ${padRight('PARC', 6)} ${padLeft('ANTES', 12)} ${padLeft('RECEB.', 14)}`);
    lines.push(rule('-'));
    for (const item of items) {
      const installment = item.installment && item.installments ? `${item.installment}/${item.installments}` : '-';
      lines.push(`${padRight(brDate(item.due_date), 8)} ${padRight(installment, 6)} ${padLeft(money(item.remaining_before), 12)} ${padLeft(money(item.amount_applied), 14)}`);
      const sale = item.sale_number ? `Venda #${item.sale_number}` : clean(item.description || 'Conta do crediario');
      lines.push(...wrap(`${sale} - Saldo: R$ ${money(item.remaining_after)}`));
    }

    lines.push(rule('-'));
    lines.push(pair('TOTAL RECEBIDO:', `R$ ${money(receipt.total_amount)}`));
    lines.push(pair('Forma:', paymentLabel(receipt)));
    lines.push(pair('Operador:', clean(receipt.operator_name || 'Operador')));

    const paidCount = items.filter((item) => num(item.remaining_after) <= 0.009).length;
    const partialCount = items.length - paidCount;
    lines.push(pair('Parcelas quitadas:', String(paidCount)));
    if (partialCount) lines.push(pair('Parcelas parciais:', String(partialCount)));

    lines.push(rule('-'));
    lines.push(center('SITUACAO APOS O RECEBIMENTO'));
    lines.push(pair('Parcelas pendentes:', String(Number(receipt.pending_count_after || 0))));
    lines.push(pair('Saldo pendente:', `R$ ${money(pendingAfter)}`));
    if (clean(receipt.notes)) {
      lines.push(rule('-'));
      lines.push(...wrap(`Obs.: ${receipt.notes}`));
    }

    lines.push(rule('-'));
    lines.push(center('DOCUMENTO NAO FISCAL'));
    lines.push(center('GUARDE ESTE COMPROVANTE'));
    lines.push(pair('Controle:', clean(receipt.client_event_id || receipt.id).slice(0, 12).toUpperCase()));
    lines.push(center(`ThorPDV v${DESKTOP_VERSION}`));
    lines.push('', '');

    const text = lines.join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:80mm auto;margin:0}
      html{margin:0!important;padding:0!important;width:80mm!important;background:#fff!important}
      body{box-sizing:border-box!important;margin:0!important;padding:2mm 4mm 2mm 2mm!important;width:80mm!important;min-width:80mm!important;max-width:80mm!important;background:#fff!important;color:#000!important;overflow:visible!important}
      pre{display:block!important;box-sizing:border-box!important;width:44ch!important;max-width:70mm!important;margin:0 auto!important;padding:0!important;white-space:pre!important;overflow:visible!important;color:#000!important;background:transparent!important;font-family:Consolas,"Lucida Console","Courier New",monospace!important;font-size:9.2px!important;line-height:1.22!important;font-weight:600!important;letter-spacing:0!important;text-align:left!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;

    return { kind:'text', text, html, title:`Recebimento #${receipt.number || ''}`, filename:`ThorPDV-Recebimento-${receipt.number || Date.now()}.pdf`, receipt };
  };
}

module.exports = { installReceivableV115 };
