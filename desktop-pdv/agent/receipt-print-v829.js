const { execFile } = require('child_process');

function psQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message || 'raw_print_failed').trim()));
      resolve(String(stdout || '').trim());
    });
  });
}

function rawPrinterScript(printerName, base64, documentName = 'ThorPDV Cupom') {
  const printer = psQuote(printerName);
  const payload = psQuote(base64);
  const name = psQuote(documentName);
  return `$src=@'
using System;
using System.Runtime.InteropServices;
public class ThorReceiptRawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
 [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool ClosePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In,MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndDocPrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 count, out Int32 written);
 public static bool Send(string printer, byte[] bytes, string docName) {
   IntPtr h;
   if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
   var di = new DOCINFOA { pDocName=docName, pDataType="RAW" };
   bool ok = StartDocPrinter(h, 1, di);
   if (ok) {
     StartPagePrinter(h);
     IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
     Marshal.Copy(bytes, 0, p, bytes.Length);
     int written = 0;
     ok = WritePrinter(h, p, bytes.Length, out written) && written == bytes.Length;
     Marshal.FreeCoTaskMem(p);
     EndPagePrinter(h);
     EndDocPrinter(h);
   }
   ClosePrinter(h);
   return ok;
 }
}
'@; Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue; $b=[Convert]::FromBase64String('${payload}'); if(-not [ThorReceiptRawPrinter]::Send('${printer}',$b,'${name}')){throw 'raw_print_failed'}`;
}

function ascii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/[\t]+/g, ' ');
}

function digits(value) { return String(value ?? '').replace(/\D/g, ''); }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function quantity(value) {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 3, maximumFractionDigits: 3 });
}
function dateTime(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? String(value || '') : d.toLocaleString('pt-BR');
}
function formatCnpj(value) {
  const v = digits(value);
  return v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(value || '');
}
function groupAccessKey(value) {
  const v = digits(value);
  return v.replace(/(.{4})(?=.)/g, '$1 ').trim();
}
function fit(value, width) {
  const s = ascii(value).replace(/\s+/g, ' ').trim();
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : `${s.slice(0, width - 1)}~`;
}
function center(value, width) {
  const s = fit(value, width);
  const left = Math.max(Math.floor((width - s.length) / 2), 0);
  return `${' '.repeat(left)}${s}`.padEnd(width, ' ');
}
function leftRight(left, right, width) {
  const r = ascii(right).trim();
  const available = Math.max(width - r.length - 1, 1);
  const l = fit(left, available);
  return `${l}${' '.repeat(Math.max(width - l.length - r.length, 1))}${r}`.slice(0, width);
}
function wrap(value, width) {
  const clean = ascii(value).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines = [];
  let line = '';
  for (const wordRaw of words) {
    let word = wordRaw;
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const paymentLabels = {
  cash:'DINHEIRO', pix:'PIX', debit_card:'DEBITO', credit_card:'CREDITO', voucher:'VOUCHER', store_credit:'CREDITO LOJA', other:'OUTROS',
};

function appendItemsAndTotals(lines, sale, width) {
  const sep = '-'.repeat(width);
  const strong = '='.repeat(width);
  lines.push(sep);
  lines.push(width === 65 ? leftRight('PRODUTO / QTD x UNITARIO', 'TOTAL', width) : 'ITENS');
  lines.push(sep);

  let itemIndex = 0;
  for (const item of sale?.items || []) {
    itemIndex += 1;
    const name = item?.name || item?.description || item?.sku || 'ITEM';
    const qty = Number(item?.quantity || 0);
    const price = Number(item?.unit_price ?? item?.unitPrice ?? 0);
    const discount = Number(item?.discount || 0);
    const lineTotal = Number(item?.total ?? (qty * price - discount));
    const prefix = `${itemIndex}. `;
    const nameLines = wrap(name, Math.max(width - prefix.length, 8));
    lines.push(`${prefix}${nameLines[0]}`.slice(0, width));
    for (const extra of nameLines.slice(1)) lines.push(`${' '.repeat(prefix.length)}${extra}`.slice(0, width));
    const unit = fit(item?.unit || 'UN', 4);
    lines.push(leftRight(`   ${quantity(qty)} ${unit} x ${money(price)}`, money(lineTotal), width));
    if (discount > 0) lines.push(leftRight('   DESCONTO', `-${money(discount)}`, width));
  }

  lines.push(strong);
  const gross = (sale?.items || []).reduce((sum, item) => sum + Number(item?.quantity || 0) * Number(item?.unit_price ?? item?.unitPrice ?? 0), 0);
  const subtotal = Number(sale?.subtotal ?? gross);
  const discount = Number(sale?.discount || 0);
  const surcharge = Number(sale?.surcharge || 0);
  if (discount > 0 || surcharge > 0) lines.push(leftRight('SUBTOTAL', `R$ ${money(subtotal)}`, width));
  if (discount > 0) lines.push(leftRight('DESCONTO', `R$ ${money(discount)}`, width));
  if (surcharge > 0) lines.push(leftRight('ACRESCIMO', `R$ ${money(surcharge)}`, width));
  lines.push(leftRight('TOTAL', `R$ ${money(sale?.total || 0)}`, width));

  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  if (payments.length) {
    lines.push(sep);
    lines.push('PAGAMENTO');
    for (const p of payments) lines.push(leftRight(paymentLabels[p?.method] || String(p?.method || 'PAGAMENTO').toUpperCase(), `R$ ${money(p?.amount || 0)}`, width));
  }
}

function issuerLines(context, width) {
  const lines = [];
  const trade = context?.company_trade_name || context?.company_name || context?.branch_name || '';
  const legal = context?.company_legal_name || '';
  const cnpj = context?.branch_cnpj || context?.company_cnpj || '';
  const ie = context?.company_state_registration || '';
  const street = [context?.branch_street, context?.branch_number].filter(Boolean).join(', ');
  const city = [context?.branch_district, context?.branch_city, context?.branch_state].filter(Boolean).join(' - ');
  if (trade) lines.push(center(trade, width));
  if (legal && legal !== trade) for (const line of wrap(legal, width)) lines.push(center(line, width));
  const docs = [cnpj ? `CNPJ ${formatCnpj(cnpj)}` : '', ie ? `IE ${ie}` : ''].filter(Boolean).join(' - ');
  if (docs) lines.push(center(docs, width));
  const address = [street, context?.branch_complement, city, context?.branch_postal_code ? `CEP ${context.branch_postal_code}` : ''].filter(Boolean).join(' - ');
  if (address) for (const line of wrap(address, width)) lines.push(center(line, width));
  return lines;
}

function buildReceipt(sale, columns) {
  const width = columns === 65 ? 65 : 44;
  const strong = '='.repeat(width);
  const sep = '-'.repeat(width);
  const context = sale?.context || {};
  const lines = [];
  lines.push(center('THORPDV', width));
  lines.push(...issuerLines(context, width));
  lines.push(center('COMPROVANTE / PRE-VENDA', width));
  lines.push(center('DOCUMENTO NAO FISCAL', width));
  lines.push(strong);
  const saleNo = sale?.number || sale?.client_event_id || sale?.id || '';
  lines.push(leftRight('VENDA', fit(saleNo, Math.max(width - 8, 8)), width));
  lines.push(leftRight('DATA', dateTime(sale?.completed_at || sale?.created_at), width));
  appendItemsAndTotals(lines, sale, width);
  if (sale?.customer_name || sale?.consumer_document) {
    lines.push(sep);
    if (sale.customer_name) for (const line of wrap(`CLIENTE: ${sale.customer_name}`, width)) lines.push(line);
    if (sale.consumer_document) lines.push(`CPF/CNPJ: ${sale.consumer_document}`.slice(0, width));
  }
  lines.push(strong);
  lines.push(center('DOCUMENTO NAO FISCAL', width));
  lines.push(center('OBRIGADO PELA PREFERENCIA', width));
  lines.push('');
  return lines.map(line => String(line).slice(0, width)).join('\n');
}

function buildNfceReceipt(sale, columns) {
  const width = columns === 65 ? 65 : 44;
  const strong = '='.repeat(width);
  const sep = '-'.repeat(width);
  const fiscal = sale?.fiscal || {};
  const context = sale?.context || {};
  const lines = [];
  lines.push(...issuerLines(context, width));
  lines.push(strong);
  lines.push(center('DANFE NFC-e', width));
  for (const line of wrap('Documento Auxiliar da Nota Fiscal de Consumidor Eletronica', width)) lines.push(center(line, width));
  lines.push(center(`NFC-e ${fiscal.number || sale?.number || ''}  Serie ${fiscal.series || ''}`, width));
  if (String(fiscal.environment || '').toLowerCase() !== 'production') {
    lines.push(strong);
    lines.push(center('EMITIDA EM AMBIENTE DE HOMOLOGACAO', width));
    lines.push(center('SEM VALOR FISCAL', width));
  }
  if (String(fiscal.status || '').toLowerCase() === 'cancelled') {
    lines.push(strong);
    lines.push(center('NFC-e CANCELADA', width));
  }
  appendItemsAndTotals(lines, sale, width);
  lines.push(sep);
  if (sale?.consumer_document) lines.push(center(`CONSUMIDOR: ${sale.consumer_document}`, width));
  else lines.push(center('CONSUMIDOR NAO IDENTIFICADO', width));
  lines.push(center(`EMISSAO: ${dateTime(fiscal.authorization_at || sale?.completed_at || sale?.created_at)}`, width));
  lines.push(sep);
  lines.push(center('CONSULTE PELA CHAVE DE ACESSO', width));
  for (const line of wrap(groupAccessKey(fiscal.access_key), width)) lines.push(center(line, width));
  if (fiscal.protocol) for (const line of wrap(`PROTOCOLO: ${fiscal.protocol}`, width)) lines.push(center(line, width));
  if (fiscal.authorization_at) lines.push(center(`AUTORIZACAO: ${dateTime(fiscal.authorization_at)}`, width));
  if (fiscal.cancellation_protocol) for (const line of wrap(`PROTOCOLO CANCELAMENTO: ${fiscal.cancellation_protocol}`, width)) lines.push(center(line, width));
  if (fiscal.cancellation_at) lines.push(center(`CANCELAMENTO: ${dateTime(fiscal.cancellation_at)}`, width));
  lines.push(strong);
  lines.push(center('QR CODE PARA CONSULTA DA NFC-e', width));
  lines.push('');
  return lines.map(line => String(line).slice(0, width)).join('\n');
}

function htmlForReceipt(text, columns) {
  const width = columns === 65 ? 65 : 44;
  const escaped = String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:6mm}body{font-family:Consolas,'Courier New',monospace;margin:0;color:#111}pre{width:${width}ch;max-width:100%;white-space:pre;font-size:${width===65?'9px':'11px'};line-height:1.25;margin:0 auto}</style></head><body><pre>${escaped}</pre></body></html>`;
}

function qrEscPos(data) {
  const raw = Buffer.from(String(data || ''), 'utf8');
  if (!raw.length) return Buffer.alloc(0);
  const storeLength = raw.length + 3;
  const pL = storeLength & 0xff;
  const pH = (storeLength >> 8) & 0xff;
  return Buffer.concat([
    Buffer.from([0x1b, 0x61, 0x01]),
    Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    raw,
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    Buffer.from([0x1b, 0x61, 0x00]),
  ]);
}

function escposPayload(text, columns, qrCodeUrl = '') {
  const font = columns === 65 ? 1 : 0;
  const body = Buffer.from(`${ascii(text).replace(/\r/g, '')}\n`, 'ascii');
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x00]),
    Buffer.from([0x1b, 0x4d, font]),
    Buffer.from([0x1b, 0x21, font ? 0x01 : 0x00]),
    Buffer.from([0x1b, 0x32]),
    body,
    qrEscPos(qrCodeUrl),
    qrCodeUrl ? Buffer.from([0x0a, 0x0a]) : Buffer.alloc(0),
    Buffer.from([0x1b, 0x64, 0x04]),
    Buffer.from([0x1d, 0x56, 0x42, 0x00]),
  ]);
}

async function printReceiptRaw(printerName, text, columns, options = {}) {
  if (process.platform !== 'win32') throw new Error('printing_requires_windows');
  if (!printerName || printerName === '__PDF__') throw new Error('printer_not_configured');
  const payload = escposPayload(text, columns, options.qrCodeUrl || '');
  await powershell(rawPrinterScript(printerName, payload.toString('base64'), options.documentName || 'ThorPDV Cupom'));
  return true;
}

function installReceiptPrintingV829(ThorAgent, Store) {
  if (!ThorAgent || !Store || ThorAgent.prototype.__receiptPrintV829) return;

  const originalSettings = Store.prototype.settings;
  const originalSaveSettings = Store.prototype.saveSettings;
  Store.prototype.settings = function (...args) {
    const base = originalSettings.apply(this, args);
    const stored = Number(this.get('receipt_columns', '44'));
    return { ...base, receiptColumns: stored === 65 ? 65 : 44 };
  };
  Store.prototype.saveSettings = function (input = {}) {
    if (Object.prototype.hasOwnProperty.call(input, 'receiptColumns')) this.set('receipt_columns', Number(input.receiptColumns) === 65 ? '65' : '44');
    return originalSaveSettings.call(this, input);
  };

  const originalDocumentData = ThorAgent.prototype.documentData;
  ThorAgent.prototype.documentData = function (saleKey, type = 'pre_sale') {
    const base = originalDocumentData.call(this, saleKey, type);
    if (type === 'nfce' || base?.kind === 'remote_pdf') return base;
    const columns = Number(this.settings()?.receiptColumns) === 65 ? 65 : 44;
    const context = base.sale?.context || (() => { try { return JSON.parse(this.store.get('context', '{}') || '{}'); } catch { return {}; } })();
    const sale = { ...(base.sale || {}), context };
    const text = buildReceipt(sale, columns);
    return { ...base, sale, kind:'text', text, html:htmlForReceipt(text, columns), receiptColumns:columns };
  };

  ThorAgent.prototype.printDocument = async function (saleKey, type = 'pre_sale') {
    const target = this.store.settings().printerName;
    if (!target) throw new Error('printer_not_configured');
    if (target === '__PDF__') throw new Error('pdf_requires_ui');
    const columns = Number(this.settings()?.receiptColumns) === 65 ? 65 : 44;

    if (type === 'nfce') {
      const sale = this.fiscalSale(saleKey);
      const fiscal = sale?.fiscal || {};
      if (!['authorized','cancelled'].includes(String(fiscal.status || ''))) throw new Error('nfce_not_authorized');
      if (digits(fiscal.access_key).length !== 44) throw new Error('nfce_access_key_unavailable');
      if (!String(fiscal.qr_code_url || '').trim()) throw new Error('nfce_qr_code_unavailable_sync');
      const context = sale.context || (() => { try { return JSON.parse(this.store.get('context', '{}') || '{}'); } catch { return {}; } })();
      const thermalSale = { ...sale, context };
      const text = buildNfceReceipt(thermalSale, columns);
      await printReceiptRaw(target, text, columns, { qrCodeUrl:String(fiscal.qr_code_url), documentName:`ThorPDV DANFE NFC-e ${fiscal.number || sale.number || ''}` });
      return { ok:true, target, mode:'raw_escpos_nfce', columns, accessKey:fiscal.access_key };
    }

    const doc = this.documentData(saleKey, type);
    await printReceiptRaw(target, doc.text, columns, { documentName:'ThorPDV Cupom Nao Fiscal' });
    return { ok:true, target, mode:'raw_escpos', columns };
  };

  ThorAgent.prototype.__receiptPrintV829 = true;
}

module.exports = { installReceiptPrintingV829, buildReceipt, buildNfceReceipt, escposPayload, qrEscPos };
