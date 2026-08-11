import QRCode from 'qrcode';
import { loadFiscalDelivery } from '@/lib/fiscal/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

const text = (value: unknown) => value == null ? '' : String(value);
const html = (value: unknown) => text(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[char] ?? char));
const money = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : '—';
const digits = (value: unknown) => text(value).replace(/\D/g, '');
const groupKey = (value: unknown) => digits(value).replace(/(.{4})(?=.)/g, '$1 ');
const cnpj = (value: unknown) => {
  const v = digits(value);
  return v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : text(value);
};
const cep = (value: unknown) => {
  const v = digits(value);
  return v.length === 8 ? v.replace(/^(\d{5})(\d{3})$/, '$1-$2') : text(value);
};

function address(branch: Row) {
  const line1 = [text(branch.street), text(branch.number)].filter(Boolean).join(', ');
  const line2 = [text(branch.district), text(branch.city), text(branch.state)].filter(Boolean).join(' - ');
  const line3 = text(branch.postal_code) ? `CEP ${cep(branch.postal_code)}` : '';
  return [line1, text(branch.complement), line2, line3].filter(Boolean).join(' · ');
}

const paymentNames: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito',
  voucher: 'Vale', store_credit: 'Crédito da loja', other: 'Outros',
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const delivery = await loadFiscalDelivery(request, id);
  if (!delivery.ok) {
    const status = delivery.error === 'fiscal_asset_auth_required' ? 401 : delivery.error === 'document_not_found' ? 404 : 403;
    return Response.json(delivery, { status });
  }

  const doc = (delivery.document ?? {}) as Row;
  const issuer = (delivery.issuer ?? {}) as Row;
  const branch = (delivery.branch ?? {}) as Row;
  const sale = (delivery.sale ?? {}) as Row;
  const items = Array.isArray(delivery.items) ? delivery.items : [];
  const payments = Array.isArray(delivery.payments) ? delivery.payments : [];
  const qrUrl = text(doc.qr_code_url);
  const qrData = qrUrl ? await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 }) : '';
  const cancelled = text(doc.status) === 'cancelled';
  const homologation = text(doc.environment) !== 'production';
  const issuerName = text(issuer.trade_name) || text(issuer.legal_name) || text(branch.name) || 'Emitente';
  const itemRows = items.map((item) => `<tr>
    <td><strong>${html(item.description)}</strong><small>${html(item.sku)}</small></td>
    <td class="r">${qty(item.quantity)} ${html(item.unit ?? '')}</td>
    <td class="r">${money(item.unit_price)}</td>
    <td class="r"><strong>${money(item.total)}</strong></td>
  </tr>`).join('');
  const paymentRows = payments.map((payment) => `<div class="payment"><span>${html(paymentNames[text(payment.method)] ?? payment.method)}</span><strong>R$ ${money(payment.amount)}</strong></div>`).join('');
  const cancelBlock = cancelled ? `<section class="cancelled-box"><strong>NFC-e CANCELADA</strong><span>Protocolo: ${html(doc.cancellation_protocol)}</span><span>Registro: ${html(dateTime(doc.cancellation_at))}</span></section>` : '';
  const homologBlock = homologation ? '<div class="homolog">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</div>' : '';
  const consumer = text(sale.consumer_document) ? `<div class="center tiny">Consumidor: ${html(sale.consumer_document)}</div>` : '<div class="center tiny">CONSUMIDOR NÃO IDENTIFICADO</div>';

  const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DANFE NFC-e ${html(doc.number)}</title><style>
    @page{size:80mm auto;margin:2mm}*{box-sizing:border-box}body{width:76mm;margin:0 auto;padding:1mm;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10px;line-height:1.25;background:#fff}
    .center{text-align:center}.issuer{font-size:15px;font-weight:800}.muted{font-size:9px}.tiny{font-size:9px}.sep{border-top:1px dashed #000;margin:5px 0}.title{font-weight:800;font-size:11px}.homolog,.cancelled-box{border:2px solid #000;padding:5px;margin:5px 0;text-align:center;font-weight:800}.cancelled-box{display:flex;flex-direction:column;gap:2px;font-size:11px}.cancelled-box strong{font-size:17px}.homolog{font-size:10px}
    table{width:100%;border-collapse:collapse;font-size:9px}th{border-bottom:1px solid #000;text-align:left;padding:3px 1px}td{vertical-align:top;padding:3px 1px;border-bottom:1px dotted #aaa}.r{text-align:right;white-space:nowrap}td small{display:block;font-size:8px}.totals{margin-top:5px}.total-line,.payment{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.grand{font-size:14px;font-weight:800;border-top:1px solid #000;padding-top:4px}.key{font-family:monospace;font-size:9px;word-break:break-word}.qr{width:38mm;height:38mm;display:block;margin:4px auto}.protocol{font-size:9px}.footer{margin-top:7px;font-size:8px;text-align:center}.cancel-watermark{position:fixed;top:42%;left:5%;right:5%;transform:rotate(-25deg);font-size:28px;font-weight:900;opacity:.11;text-align:center;pointer-events:none}
    @media screen{body{box-shadow:0 0 10px #bbb;margin:10px auto;padding:4mm}}
  </style></head><body>${cancelled ? '<div class="cancel-watermark">CANCELADA</div>' : ''}
    <header class="center"><div class="issuer">${html(issuerName)}</div><div>${html(text(issuer.legal_name) && text(issuer.legal_name) !== issuerName ? issuer.legal_name : '')}</div><div>CNPJ ${html(cnpj(issuer.cnpj))}${text(issuer.state_registration) ? ` · IE ${html(issuer.state_registration)}` : ''}</div><div class="muted">${html(address(branch))}</div></header>
    ${homologBlock}${cancelBlock}<div class="sep"></div>
    <div class="center title">DANFE NFC-e</div><div class="center tiny">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
    <div class="center tiny">NFC-e nº ${html(doc.number)} · Série ${html(doc.series)}</div><div class="sep"></div>
    <table><thead><tr><th>DESCRIÇÃO</th><th class="r">QTD</th><th class="r">UNIT.</th><th class="r">TOTAL</th></tr></thead><tbody>${itemRows || '<tr><td colspan="4">Itens indisponíveis.</td></tr>'}</tbody></table>
    <section class="totals"><div class="total-line"><span>Qtd. total de itens</span><strong>${items.length}</strong></div>${Number(sale.discount ?? 0) ? `<div class="total-line"><span>Descontos</span><strong>R$ ${money(sale.discount)}</strong></div>` : ''}${Number(sale.surcharge ?? 0) ? `<div class="total-line"><span>Acréscimos</span><strong>R$ ${money(sale.surcharge)}</strong></div>` : ''}<div class="total-line grand"><span>VALOR A PAGAR</span><strong>R$ ${money(sale.total)}</strong></div></section>
    <div class="sep"></div><div class="title">FORMA DE PAGAMENTO</div>${paymentRows || '<div class="payment"><span>Pagamento</span><strong>R$ ' + money(sale.total) + '</strong></div>'}
    <div class="sep"></div>${consumer}<div class="center tiny">Emissão: ${html(dateTime(doc.authorization_at))}</div>
    <div class="sep"></div><div class="center title">Consulte pela chave de acesso</div><div class="center key">${html(groupKey(doc.access_key))}</div>
    ${qrData ? `<img class="qr" alt="QR Code da NFC-e" src="${qrData}"/>` : '<div class="center tiny">QR Code indisponível</div>'}
    <div class="center protocol">Protocolo de autorização: <strong>${html(doc.protocol)}</strong></div><div class="center protocol">Data de autorização: ${html(dateTime(doc.authorization_at))}</div>
    ${cancelled ? `<div class="center protocol"><strong>Cancelamento: ${html(doc.cancellation_protocol)}</strong> · ${html(dateTime(doc.cancellation_at))}</div>` : ''}
    <div class="footer">ThorPDV · DANFE NFC-e gerado a partir do XML autorizado pela SEFAZ.</div>
  </body></html>`;

  return new Response(page, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
