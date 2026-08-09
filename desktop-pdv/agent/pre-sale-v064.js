function installPreSaleReceipt(ThorAgent) {
  const originalDocumentData = ThorAgent.prototype.documentData;

  ThorAgent.prototype.documentData = function (saleKey, type = 'pre_sale') {
    if (type !== 'pre_sale') return originalDocumentData.call(this, saleKey, type);
    const base = originalDocumentData.call(this, saleKey, type);
    return buildPreSaleDocument(this, base.sale);
  };
}

const WIDTH = 42;
const SEP = '-'.repeat(WIDTH);

function text(value) { return String(value ?? '').trim(); }
function number(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function money(value) { return number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qty(value) { return number(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }); }
function digits(value) { return text(value).replace(/\D/g, ''); }
function cnpj(value) { const d = digits(value); return d.length === 14 ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}` : text(value); }
function cep(value) { const d = digits(value); return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : text(value); }
function center(value, width = WIDTH) { const s = text(value); if (s.length >= width) return s.slice(0, width); const left = Math.floor((width - s.length) / 2); return `${' '.repeat(left)}${s}`; }
function right(value, width) { const s = text(value); return s.length >= width ? s.slice(-width) : `${' '.repeat(width - s.length)}${s}`; }
function wrap(value, width = WIDTH) {
  const words = text(value).replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return [''];
  const lines = []; let current = '';
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => line.length <= width ? [line] : Array.from({ length: Math.ceil(line.length / width) }, (_, i) => line.slice(i * width, (i + 1) * width)));
}
function paymentLabel(method) {
  const labels = { cash:'Dinheiro', pix:'PIX', debit_card:'Cartao debito', credit_card:'Cartao credito', voucher:'Voucher', store_credit:'Credito em loja', other:'Outros' };
  return labels[text(method)] || text(method).replace(/_/g, ' ') || 'Pagamento';
}
function contextOf(agent, sale) {
  if (sale?.context && typeof sale.context === 'object') return sale.context;
  try { return JSON.parse(agent.store.get('context', '{}') || '{}'); } catch { return {}; }
}
function productOf(agent, item) {
  try { return item?.product_id && agent.store?.product ? agent.store.product(String(item.product_id)) : null; } catch { return null; }
}
function customerOf(agent, sale) {
  try { return sale?.customer_id && agent.store?.customer ? agent.store.customer(String(sale.customer_id)) : null; } catch { return null; }
}
function branchAddress(context) {
  const first = [text(context.branch_street), text(context.branch_number)].filter(Boolean).join(', ');
  const second = [text(context.branch_district), text(context.branch_city), text(context.branch_state)].filter(Boolean).join(' - ');
  const postal = cep(context.branch_postal_code);
  return [first, [second, postal].filter(Boolean).join(' - ')].filter(Boolean);
}
function buildPreSaleDocument(agent, sale) {
  if (!sale) throw new Error('receipt_not_found');
  const context = contextOf(agent, sale);
  const customer = customerOf(agent, sale);
  const items = Array.isArray(sale.items) ? sale.items : [];
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  const lines = [];

  const company = text(context.company_trade_name || context.company_name || context.company_legal_name || 'THORPDV');
  const legal = text(context.company_legal_name);
  lines.push(center(company));
  if (legal && legal.toLowerCase() !== company.toLowerCase()) lines.push(center(legal));
  const companyCnpj = cnpj(context.branch_cnpj || context.company_cnpj);
  const ie = text(context.company_state_registration);
  if (companyCnpj || ie) lines.push([companyCnpj ? `CNPJ: ${companyCnpj}` : '', ie ? `IE: ${ie}` : ''].filter(Boolean).join('  '));
  for (const addressLine of branchAddress(context)) lines.push(...wrap(addressLine));
  if (text(context.company_phone)) lines.push(`Fone: ${text(context.company_phone)}`);

  lines.push(SEP);
  lines.push(center('CUPOM DE PRE-VENDA'));
  lines.push(center('DOCUMENTO NAO FISCAL'));
  lines.push(SEP);

  const saleId = text(sale.number || sale.client_event_id || sale.id);
  if (saleId) lines.push(`Venda: ${saleId.length > 30 ? saleId.slice(0, 30) : saleId}`);
  const date = new Date(sale.completed_at || sale.created_at || Date.now());
  lines.push(`Data: ${Number.isNaN(date.getTime()) ? text(sale.completed_at || sale.created_at) : date.toLocaleString('pt-BR')}`);
  if (text(sale.operator_name)) lines.push(`Operador: ${text(sale.operator_name)}`);
  const customerName = text(sale.customer_name || customer?.name);
  const consumerDoc = text(sale.consumer_document || customer?.document);
  if (customerName) lines.push(...wrap(`Cliente: ${customerName}`));
  if (consumerDoc) lines.push(`CPF/CNPJ: ${consumerDoc}`);

  lines.push(SEP);
  lines.push('PRODUTO');
  lines.push('QTD/UN          V.UN            V.TOTAL');
  lines.push(SEP);

  let computedSubtotal = 0;
  let totalQuantity = 0;
  for (const item of items) {
    const product = productOf(agent, item);
    const productCode = text(item.product_code || product?.product_code || '');
    const sku = text(item.sku || product?.sku || '');
    const name = text(item.name || item.description || product?.name || sku || 'ITEM');
    const unit = text(item.unit || product?.unit || 'UN').toUpperCase();
    const quantity = number(item.quantity);
    const unitPrice = number(item.unit_price ?? item.unitPrice ?? product?.base_price ?? product?.sale_price);
    const discount = Math.max(number(item.discount), 0);
    const lineTotal = item.total != null ? number(item.total) : Math.max(quantity * unitPrice - discount, 0);
    computedSubtotal += lineTotal;
    totalQuantity += quantity;

    const itemHead = `${productCode ? `${productCode} ` : ''}${name}${sku && sku !== productCode ? ` [Ref. ${sku}]` : ''}`;
    for (const itemLine of wrap(itemHead)) lines.push(itemLine);
    const left = `${qty(quantity)} ${unit} x ${money(unitPrice)}`;
    const rightValue = money(lineTotal);
    const spaces = Math.max(WIDTH - left.length - rightValue.length, 1);
    lines.push(`${left}${' '.repeat(spaces)}${rightValue}`.slice(0, WIDTH));
    if (discount > 0) lines.push(`${'Desconto item'}${right(`- ${money(discount)}`, WIDTH - 13)}`.slice(0, WIDTH));
  }

  lines.push(SEP);
  lines.push(`Qtde. total de itens${right(String(items.length), WIDTH - 20)}`.slice(0, WIDTH));
  lines.push(`Quantidade total${right(qty(totalQuantity), WIDTH - 16)}`.slice(0, WIDTH));
  const subtotal = number(sale.subtotal) || computedSubtotal + Math.max(number(sale.discount), 0) - Math.max(number(sale.surcharge), 0);
  if (number(sale.discount) > 0 || number(sale.surcharge) > 0) lines.push(`Subtotal R$${right(money(subtotal), WIDTH - 11)}`.slice(0, WIDTH));
  if (number(sale.discount) > 0) lines.push(`Desconto R$${right(`- ${money(sale.discount)}`, WIDTH - 11)}`.slice(0, WIDTH));
  if (number(sale.surcharge) > 0) lines.push(`Acrescimo R$${right(money(sale.surcharge), WIDTH - 12)}`.slice(0, WIDTH));
  lines.push(`VALOR TOTAL R$${right(money(sale.total || computedSubtotal), WIDTH - 14)}`.slice(0, WIDTH));

  if (payments.length) {
    lines.push(SEP);
    lines.push('FORMA PAGAMENTO                 VALOR R$');
    for (const payment of payments) {
      const label = paymentLabel(payment.method);
      const value = money(payment.amount);
      const spaces = Math.max(WIDTH - label.length - value.length, 1);
      lines.push(`${label}${' '.repeat(spaces)}${value}`.slice(0, WIDTH));
    }
  }

  lines.push(SEP);
  lines.push(center('PRE-VENDA - NAO E DOCUMENTO FISCAL'));
  lines.push(center('SEM VALOR FISCAL'));
  lines.push(center('Obrigado, volte sempre!'));
  lines.push('');
  lines.push('');

  const receiptText = lines.join('\n');
  const htmlLines = lines.map((line) => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:3mm}*{box-sizing:border-box}body{margin:0 auto;padding:0;width:72mm;color:#111;background:#fff;font-family:"Courier New",Consolas,monospace;font-size:10.5px;line-height:1.28}.receipt{width:100%}.receipt div{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><div class="receipt">${htmlLines}</div></body></html>`;
  return { kind:'text', text:receiptText, html, title:`Pre-venda ${sale.number || ''}`, filename:`ThorPDV-PreVenda-${sale.number || Date.now()}.pdf`, sale };
}

module.exports = { installPreSaleReceipt, buildPreSaleDocument };
