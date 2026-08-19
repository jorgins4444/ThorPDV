const { version: DESKTOP_VERSION } = require('../package.json');

const WIDTH = 44;
const TIME_ZONE = 'America/Fortaleza';

const PAYMENT_LABELS = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  voucher: 'Voucher',
  store_credit: 'Créd. loja',
  store_credit_voucher: 'Vale Crédito',
  term_sale: 'Venda a prazo',
  boleto: 'Boleto',
  cashback: 'Cashback',
  other: 'Outros',
};

const number = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const money = (value) => number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word.slice(0, width);
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current.padEnd(width, ' '));
      current = word.slice(0, width);
    }
  }
  if (current) lines.push(current.padEnd(width, ' '));
  return lines;
}

function pair(label, value) {
  const right = clean(value);
  const available = Math.max(WIDTH - right.length - 1, 8);
  const left = clean(label).slice(0, available);
  if (left.length + 1 + right.length <= WIDTH) return `${left.padEnd(WIDTH - right.length - 1, ' ')} ${right}`;
  return `${clean(label).slice(0, WIDTH)}\n${padLeft(right, WIDTH)}`;
}

function dateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function businessDate(summary) {
  const explicit = clean(summary?.business_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    const [year, month, day] = explicit.split('-');
    return `${day}/${month}/${year}`;
  }
  const source = summary?.opened_at || summary?.closed_at;
  if (!source) return '-';
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return clean(source);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day:'2-digit', month:'2-digit', year:'numeric' }).format(date);
}

function first(context, keys) {
  for (const key of keys) {
    const value = clean(context?.[key]);
    if (value) return value;
  }
  return '';
}

function companyAddress(context) {
  const direct = first(context, ['branch_address', 'address', 'company_address']);
  if (direct) return direct;
  const street = first(context, ['branch_street', 'street']);
  const numberValue = first(context, ['branch_number', 'number']);
  const district = first(context, ['branch_district', 'district']);
  const city = first(context, ['branch_city', 'city']);
  const state = first(context, ['branch_state', 'state']);
  const postal = first(context, ['branch_postal_code', 'postal_code', 'zip_code']);
  return [
    [street, numberValue].filter(Boolean).join(', '),
    district,
    [city, state].filter(Boolean).join('/'),
    postal ? `CEP ${postal}` : '',
  ].filter(Boolean).join(' - ');
}

function shortId(value) {
  const normalized = clean(value);
  if (!normalized) return '-';
  return normalized.length > 16 ? normalized.slice(0, 8).toUpperCase() : normalized.toUpperCase();
}

function paymentName(row) {
  const method = clean(row?.method);
  return clean(row?.name) || PAYMENT_LABELS[method] || method || 'Forma';
}

function paymentRows(summary) {
  if (Array.isArray(summary?.counted_payments) && summary.counted_payments.length) {
    return summary.counted_payments.map((row) => ({
      method: clean(row.method),
      name: paymentName(row),
      expected: number(row.expected),
      counted: number(row.counted),
      difference: number(row.difference),
      count: number(row.count),
    }));
  }
  return (Array.isArray(summary?.payments) ? summary.payments : []).map((row) => ({
    method: clean(row.method),
    name: paymentName(row),
    expected: number(row.amount),
    counted: number(row.amount),
    difference: 0,
    count: number(row.count),
  }));
}

function paymentTableLine(label, expected, counted, difference) {
  // 11 + 1 + 10 + 1 + 10 + 1 + 10 = 44 colunas.
  return `${padRight(label, 11)} ${padLeft(money(expected), 10)} ${padLeft(money(counted), 10)} ${padLeft(money(difference), 10)}`;
}

function sourceLabel(value) {
  const source = clean(value);
  if (source === 'server') return 'ThorGestão';
  if (source === 'server+local') return 'Gestão + local pendente';
  if (source === 'local') return 'ThorPDV local/offline';
  return source || 'ThorPDV';
}

function addPair(lines, label, value) {
  const formatted = pair(label, value);
  lines.push(...formatted.split('\n'));
}

function installCashCloseReceiptV112(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__cashCloseReceiptV112) return;
  ThorAgent.prototype.__cashCloseReceiptV112 = true;
  const original = ThorAgent.prototype.cashCloseDocument;

  ThorAgent.prototype.cashCloseDocument = function (summaryInput = null) {
    try {
      const summary = summaryInput || this.lastCashCloseSummary?.();
      if (!summary) throw new Error('cash_close_receipt_not_found');
      const context = (() => {
        try { return JSON.parse(this.store.get('context', '{}') || '{}'); }
        catch { return {}; }
      })();
      const operatorName = clean(summary.operator?.name || summary.operator_name || 'Operador');
      const company = first(context, ['company_trade_name', 'trade_name', 'company_name', 'legal_name']) || 'ThorPDV';
      const legalName = first(context, ['company_name', 'legal_name']);
      const branch = first(context, ['branch_name', 'store_name']);
      const cnpj = first(context, ['company_cnpj', 'company_document', 'cnpj', 'tax_id']);
      const ie = first(context, ['company_state_registration', 'state_registration', 'ie']);
      const address = companyAddress(context);
      const pos = first(context, ['pos_name', 'pos_code', 'terminal_name', 'terminal_code']) || 'PDV';
      const shift = clean(summary.shift_number || summary.turn_number || summary.shift || '');
      const session = shortId(summary.cash_session_id || summary.client_event_id || summary.close_event_id);
      const payments = paymentRows(summary);
      const difference = number(summary.difference);
      const lines = [];

      lines.push(center(company));
      if (legalName && legalName.toLowerCase() !== company.toLowerCase()) lines.push(...wrap(legalName));
      if (cnpj || ie) {
        if (cnpj) addPair(lines, 'CNPJ:', cnpj);
        if (ie) addPair(lines, 'IE:', ie);
      }
      if (branch) lines.push(...wrap(`Filial: ${branch}`));
      if (address) lines.push(...wrap(address));
      lines.push(rule('='));
      lines.push(center('FECHAMENTO DE CAIXA'));
      lines.push(center('CONFERÊNCIA DO OPERADOR'));
      lines.push(rule('-'));
      addPair(lines, 'Data movimento', businessDate(summary));
      addPair(lines, 'Operador', operatorName);
      addPair(lines, 'Terminal', pos);
      if (shift) addPair(lines, 'Turno', shift);
      addPair(lines, 'Sessão', session);
      addPair(lines, 'Abertura', dateTime(summary.opened_at));
      addPair(lines, 'Fechamento', dateTime(summary.closed_at || new Date().toISOString()));
      addPair(lines, 'Origem', sourceLabel(summary.source));

      lines.push(rule('-'));
      lines.push(center('RESUMO DO MOVIMENTO'));
      addPair(lines, `Vendas (${Math.trunc(number(summary.sales_count))})`, `R$ ${money(summary.sales_total)}`);
      if (number(summary.term_sales_total)) addPair(lines, 'Venda a prazo', `R$ ${money(summary.term_sales_total)}`);
      if (number(summary.receivable_received)) addPair(lines, 'Recebimentos', `R$ ${money(summary.receivable_received)}`);
      addPair(lines, 'Fundo inicial', `R$ ${money(summary.opening_amount)}`);
      addPair(lines, 'Vendas em dinheiro', `R$ ${money(summary.cash_payments)}`);
      addPair(lines, 'Suprimentos', `R$ ${money(summary.supply)}`);
      addPair(lines, 'Sangrias', `R$ ${money(summary.withdrawal)}`);
      if (number(summary.expense)) addPair(lines, 'Despesas', `R$ ${money(summary.expense)}`);
      if (number(summary.refund)) addPair(lines, 'Devoluções em dinheiro', `R$ ${money(summary.refund)}`);

      lines.push(rule('-'));
      lines.push(center('FORMAS DE PAGAMENTO - R$'));
      lines.push(`${padRight('FORMA', 11)} ${padLeft('SISTEMA', 10)} ${padLeft('CONF.', 10)} ${padLeft('DIF.', 10)}`);
      if (payments.length) {
        for (const row of payments) lines.push(paymentTableLine(row.name, row.expected, row.counted, row.difference));
      } else {
        lines.push(center('SEM PAGAMENTOS NO PERÍODO'));
      }

      lines.push(rule('-'));
      lines.push(center('DEVOLUÇÕES E VALES'));
      addPair(lines, `Devoluções (${Math.trunc(number(summary.returns_count))})`, `R$ ${money(summary.returns_total)}`);
      addPair(lines, 'Crédito em cliente', `R$ ${money(summary.return_customer_credit_total)}`);
      addPair(lines, 'Vales emitidos', `R$ ${money(summary.return_voucher_issued_total)}`);
      addPair(lines, 'Vales em aberto', `R$ ${money(summary.return_voucher_outstanding)}`);
      addPair(lines, 'Vale usado no caixa', `R$ ${money(summary.voucher_used_total)}`);
      lines.push(...wrap('Créditos e vales de devolução não alteram o dinheiro físico da gaveta no momento da emissão.'));

      lines.push(rule('='));
      lines.push(center('CONFERÊNCIA DA GAVETA'));
      addPair(lines, 'Dinheiro esperado', `R$ ${money(summary.expected_cash)}`);
      addPair(lines, 'Dinheiro contado', `R$ ${money(summary.closing_amount)}`);
      addPair(lines, 'DIFERENÇA', `R$ ${money(difference)}`);
      lines.push(center(Math.abs(difference) <= 0.009 ? 'CAIXA CONFERIDO - SEM DIFERENÇA' : 'ATENÇÃO - DIVERGÊNCIA NO CAIXA'));

      if (number(summary.pending_events) || number(summary.rejected_events)) {
        lines.push(rule('-'));
        lines.push(center('SITUAÇÃO DA SINCRONIZAÇÃO'));
        addPair(lines, 'Pendentes', String(Math.trunc(number(summary.pending_events))));
        addPair(lines, 'Com erro', String(Math.trunc(number(summary.rejected_events))));
      }

      if (clean(summary.notes)) {
        lines.push(rule('-'));
        lines.push('OBSERVAÇÃO');
        lines.push(...wrap(summary.notes));
      }

      lines.push(rule('-'));
      lines.push(...wrap('Declaro que conferi os valores, movimentações e formas de pagamento apresentados neste fechamento.'));
      if (Math.abs(difference) > 0.009) lines.push(...wrap(`Declaro ciência da diferença de R$ ${money(difference)} registrada nesta conferência.`));
      lines.push('');
      lines.push('');
      lines.push(rule('_'));
      lines.push(center('ASSINATURA DO OPERADOR'));
      lines.push(...wrap(`Nome: ${operatorName}`));
      lines.push(...wrap(`Data/Hora: ${dateTime(summary.closed_at || new Date().toISOString())}`));
      lines.push(rule('-'));
      addPair(lines, 'Controle', shortId(summary.close_event_id || summary.client_event_id));
      lines.push(center(`ThorPDV v${DESKTOP_VERSION}`));
      lines.push(center('DOCUMENTO DE CONFERÊNCIA DE CAIXA'));
      lines.push('', '', '');

      const text = lines.join('\n');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{margin:2mm}
        html,body{margin:0;padding:0;background:#fff;color:#000}
        body{width:72mm;margin:0 auto;padding:2mm 1mm;font-family:"Courier New",Consolas,monospace}
        pre{margin:0;white-space:pre-wrap;word-break:normal;font-family:inherit;font-size:10.5px;line-height:1.28;font-weight:500}
      </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
      return {
        kind: 'text',
        text,
        html,
        title: 'Fechamento de Caixa',
        filename: `ThorPDV-Fechamento-${Date.now()}.pdf`,
        summary,
      };
    } catch (error) {
      if (typeof original === 'function') return original.call(this, summaryInput);
      throw error;
    }
  };
}

module.exports = { installCashCloseReceiptV112 };
