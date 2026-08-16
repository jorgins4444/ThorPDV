const crypto = require('crypto');
const hardware = require('./hardware');

const WIDTH = 44;
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const ascii = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
const fit = (value) => ascii(value).slice(0, WIDTH).padEnd(WIDTH, ' ');
const center = (value) => {
  const text = ascii(value).slice(0, WIDTH);
  const left = Math.max(Math.floor((WIDTH - text.length) / 2), 0);
  return ' '.repeat(left) + text + ' '.repeat(Math.max(WIDTH - left - text.length, 0));
};
const money = (value) => `R$ ${round2(value).toFixed(2).replace('.', ',')}`;
const qtyText = (value) => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const json = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
};
const wrap44 = (value) => {
  const words = ascii(value).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word.slice(0, WIDTH);
    else if (`${current} ${word}`.length <= WIDTH) current += ` ${word}`;
    else { lines.push(fit(current)); current = word.slice(0, WIDTH); }
  }
  if (current) lines.push(fit(current));
  return lines;
};

function voucherNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const random = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return `VC${yy}${mm}${dd}${hh}${mi}${random}`;
}

function ensureSchema(store) {
  const customerCols = new Set(store.db.prepare('pragma table_info(customers)').all().map((row) => row.name));
  if (!customerCols.has('store_credit_balance')) store.db.exec('alter table customers add column store_credit_balance real not null default 0');
  store.db.exec(`
    create table if not exists store_credit_vouchers(
      voucher_number text primary key,
      id text,
      original_amount real not null default 0,
      used_amount real not null default 0,
      status text not null default 'active',
      guest_name text not null default '',
      guest_document text not null default '',
      sale_number text not null default '',
      source text not null default 'local',
      issued_at text not null,
      updated_at text not null,
      metadata text not null default '{}'
    );
    create index if not exists idx_local_credit_voucher_status on store_credit_vouchers(status,updated_at);
  `);
  const voucherCols = new Set(store.db.prepare('pragma table_info(store_credit_vouchers)').all().map((row) => row.name));
  if (!voucherCols.has('metadata')) store.db.exec("alter table store_credit_vouchers add column metadata text not null default '{}'");
}

function resolveVoucherLine(saleItems, requested = {}) {
  const rows = Array.isArray(saleItems) ? saleItems : [];
  if (requested.sale_item_id) {
    const row = rows.find((item) => String(item.sale_item_id || '') === String(requested.sale_item_id));
    if (row) return row;
  }
  const lineIndex = Number(requested.line_index);
  if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < rows.length) return rows[lineIndex];
  if (requested.product_id) {
    const matches = rows.filter((item) => String(item.product_id || '') === String(requested.product_id));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function returnItemMetadata(sale, requestedItems = []) {
  const saleItems = Array.isArray(sale?.items) ? sale.items : [];
  return (Array.isArray(requestedItems) ? requestedItems : []).map((requested) => {
    const original = resolveVoucherLine(saleItems, requested) || {};
    const quantity = Number(requested.quantity || 0);
    const originalQuantity = Number(original.quantity || 0);
    const originalTotal = Number(original.total ?? (originalQuantity * Number(original.unit_price || 0)));
    const unitNet = originalQuantity > 0 ? originalTotal / originalQuantity : Number(original.unit_price || 0);
    return {
      sale_item_id: original.sale_item_id || requested.sale_item_id || null,
      product_id: original.product_id || requested.product_id || null,
      sku: original.sku || original.code || '',
      name: original.name || original.description || original.sku || 'Item',
      unit: original.unit || '',
      quantity,
      unit_price: round2(unitNet),
      total: round2(quantity * unitNet),
    };
  });
}

function installStoreCreditReturnV105(ThorAgent, Store) {
  const originalMigrate = Store.prototype.migrate;
  Store.prototype.migrate = function () {
    originalMigrate.call(this);
    ensureSchema(this);
  };

  const originalApplyPull = Store.prototype.applyPull;
  Store.prototype.applyPull = function (data) {
    originalApplyPull.call(this, data);
    ensureSchema(this);
    const customers = Array.isArray(data?.customers) ? data.customers : [];
    const updateCustomer = this.db.prepare('update customers set store_credit_balance=? where id=?');
    for (const customer of customers) updateCustomer.run(Math.max(Number(customer.store_credit_balance || 0), 0), String(customer.id));

    if (Array.isArray(data?.store_credit_vouchers)) {
      this.db.prepare("delete from store_credit_vouchers where source='server'").run();
      const existing = this.db.prepare('select metadata,sale_number from store_credit_vouchers where voucher_number=? limit 1');
      const upsert = this.db.prepare(`insert into store_credit_vouchers(
        voucher_number,id,original_amount,used_amount,status,guest_name,guest_document,sale_number,source,issued_at,updated_at,metadata
      ) values(?,?,?,?,?,?,?,?,?,?,?,?) on conflict(voucher_number) do update set
        id=excluded.id,original_amount=excluded.original_amount,used_amount=excluded.used_amount,status=excluded.status,
        guest_name=excluded.guest_name,guest_document=excluded.guest_document,sale_number=excluded.sale_number,source='server',
        issued_at=excluded.issued_at,updated_at=excluded.updated_at,metadata=excluded.metadata`);
      for (const voucher of data.store_credit_vouchers) {
        const number = String(voucher.voucher_number || '').toUpperCase();
        if (!number) continue;
        const previous = existing.get(number) || {};
        const serverMeta = json(voucher.metadata, {});
        const mergedMeta = {
          ...json(previous.metadata, {}),
          ...serverMeta,
          ...(voucher.source_return_id ? { source_return_id:voucher.source_return_id } : {}),
        };
        const saleNumber = String(voucher.sale_number || serverMeta.sale_number || previous.sale_number || '');
        upsert.run(
          number, String(voucher.id || ''), Number(voucher.original_amount || 0), Number(voucher.used_amount || 0),
          String(voucher.status || 'active'), String(voucher.guest_name || ''), String(voucher.guest_document || ''), saleNumber, 'server',
          String(voucher.issued_at || new Date().toISOString()), String(voucher.updated_at || new Date().toISOString()), JSON.stringify(mergedMeta)
        );
      }
    }
  };

  Store.prototype.customer = function (id) {
    if (!id) return null;
    ensureSchema(this);
    return this.db.prepare('select * from customers where id=? limit 1').get(String(id)) || null;
  };

  Store.prototype.adjustCustomerCredit = function (customerId, delta) {
    if (!customerId || !Number.isFinite(Number(delta))) return null;
    ensureSchema(this);
    this.db.prepare('update customers set store_credit_balance=max(store_credit_balance+?,0) where id=?').run(round2(delta), String(customerId));
    return this.customer(customerId);
  };

  Store.prototype.storeCreditVoucher = function (number) {
    ensureSchema(this);
    const normalized = String(number || '').trim().toUpperCase();
    if (!normalized) return null;
    const row = this.db.prepare('select * from store_credit_vouchers where upper(voucher_number)=? limit 1').get(normalized);
    if (!row) return null;
    return {
      ...row,
      metadata: json(row.metadata, {}),
      original_amount:Number(row.original_amount || 0),
      used_amount:Number(row.used_amount || 0),
      remaining:Math.max(Number(row.original_amount || 0) - Number(row.used_amount || 0), 0),
    };
  };

  Store.prototype.saveStoreCreditVoucher = function (voucher) {
    ensureSchema(this);
    const now = new Date().toISOString();
    const number = String(voucher.voucher_number || '').trim().toUpperCase();
    if (!number) throw new Error('store_credit_voucher_number_required');
    const previous = this.storeCreditVoucher(number);
    const metadata = { ...(previous?.metadata || {}), ...json(voucher.metadata, {}) };
    this.db.prepare(`insert into store_credit_vouchers(voucher_number,id,original_amount,used_amount,status,guest_name,guest_document,sale_number,source,issued_at,updated_at,metadata)
      values(?,?,?,?,?,?,?,?,?,?,?,?) on conflict(voucher_number) do update set original_amount=excluded.original_amount,used_amount=excluded.used_amount,status=excluded.status,
      guest_name=excluded.guest_name,guest_document=excluded.guest_document,sale_number=excluded.sale_number,source=excluded.source,updated_at=excluded.updated_at,metadata=excluded.metadata`).run(
      number, String(voucher.id || previous?.id || ''), Number(voucher.original_amount || 0), Number(voucher.used_amount || 0), String(voucher.status || 'active'),
      String(voucher.guest_name || ''), String(voucher.guest_document || ''), String(voucher.sale_number || ''), String(voucher.source || 'local'),
      String(voucher.issued_at || previous?.issued_at || now), now, JSON.stringify(metadata)
    );
    return this.storeCreditVoucher(number);
  };

  Store.prototype.consumeStoreCreditVoucher = function (number, amount) {
    const voucher = this.storeCreditVoucher(number);
    if (!voucher) throw new Error('store_credit_voucher_not_found');
    if (voucher.status !== 'active') throw new Error('store_credit_voucher_not_active');
    const value = round2(amount);
    if (value <= 0 || value > voucher.remaining + 0.001) throw new Error('insufficient_store_credit_voucher');
    const used = round2(voucher.used_amount + value);
    const status = used >= voucher.original_amount - 0.001 ? 'redeemed' : 'active';
    this.db.prepare('update store_credit_vouchers set used_amount=?,status=?,updated_at=? where voucher_number=?').run(used, status, new Date().toISOString(), voucher.voucher_number);
    return this.storeCreditVoucher(voucher.voucher_number);
  };

  const originalReturnSale = ThorAgent.prototype.returnSale;
  ThorAgent.prototype.returnSale = async function (payload = {}) {
    const sale = this.fiscalSale(payload.saleKey);
    if (!sale) throw new Error('sale_not_found');
    const automaticCustomerId = sale.customer_id || null;
    const customerId = automaticCustomerId || payload.returnCustomerId || null;
    let customer = null;
    if (customerId) {
      customer = this.store.customer(customerId);
      if (!customer) throw new Error('return_customer_not_found');
    }

    const guestName = customer ? '' : String(payload.guestName || '').trim();
    const guestDocument = customer ? '' : String(payload.guestDocument || '').replace(/\D/g, '');
    if (!customer && !guestName && !guestDocument) throw new Error('return_customer_identification_required');
    const number = customer ? '' : String(payload.voucherNumber || voucherNumber()).toUpperCase();

    // A devolução em Vale Crédito precisa passar pelo núcleo neutro da devolução.
    // Isso evita que regras antigas de "crédito de cliente" bloqueiem uma pessoa
    // sem cadastro com store_credit_requires_customer.
    const executeReturn = typeof this._returnSaleCore === 'function'
      ? this._returnSaleCore.bind(this)
      : originalReturnSale.bind(this);

    const result = await executeReturn({
      ...payload,
      refundMethod: 'store_credit',
      returnCustomerId: customerId,
      guestName,
      guestDocument,
      voucherNumber: number,
    });
    const value = round2(result.estimatedTotal || 0);
    if (customer) {
      const updated = this.store.adjustCustomerCredit(customer.id, value);
      return { ...result, refundMethod:'store_credit', storeCreditCustomerId:customer.id, storeCreditCustomerName:customer.name, storeCreditBalance:Number(updated?.store_credit_balance || 0) };
    }

    const operator = this.currentOperator?.() || null;
    const issuedAt = new Date().toISOString();
    const metadata = {
      origin:'sale_return',
      sale_id:sale.id || null,
      sale_number:sale.number || '',
      sale_client_event_id:sale.client_event_id || null,
      return_event_id:result.eventId || null,
      operator_user_id:operator?.id || null,
      operator_name:operator?.name || '',
      reason:String(payload.reason || '').trim(),
      items:returnItemMetadata(sale, payload.items || []),
      issued_at:issuedAt,
    };

    const voucher = this.store.saveStoreCreditVoucher({
      voucher_number:number,
      original_amount:value,
      used_amount:0,
      status:'active',
      guest_name:guestName,
      guest_document:guestDocument,
      sale_number:sale.number || '',
      source:'local',
      issued_at:issuedAt,
      metadata,
    });
    return { ...result, refundMethod:'store_credit', voucher };
  };

  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  ThorAgent.prototype.finalizeSale = async function (payload = {}) {
    const voucherTotals = new Map();
    for (const payment of Array.isArray(payload.payments) ? payload.payments : []) {
      if (payment?.method !== 'store_credit_voucher') continue;
      const number = String(payment?.metadata?.voucher_number || '').trim().toUpperCase();
      if (!number) throw new Error('store_credit_voucher_number_required');
      voucherTotals.set(number, round2((voucherTotals.get(number) || 0) + Number(payment.amount || 0)));
    }
    for (const [number, amount] of voucherTotals) {
      const voucher = this.store.storeCreditVoucher(number);
      if (!voucher) throw new Error('store_credit_voucher_not_found');
      if (voucher.status !== 'active') throw new Error('store_credit_voucher_not_active');
      if (amount > voucher.remaining + 0.001) throw new Error('insufficient_store_credit_voucher');
    }
    const result = await originalFinalizeSale.call(this, payload);
    for (const [number, amount] of voucherTotals) this.store.consumeStoreCreditVoucher(number, amount);
    return result;
  };

  ThorAgent.prototype.storeCreditVoucher = function (number) {
    const voucher = this.store.storeCreditVoucher(number);
    if (!voucher) throw new Error('store_credit_voucher_not_found');
    return voucher;
  };

  ThorAgent.prototype.storeCreditVoucherDocument = function (input) {
    const voucher = typeof input === 'string' ? this.storeCreditVoucher(input) : input;
    if (!voucher?.voucher_number) throw new Error('store_credit_voucher_not_found');

    const metadata = json(voucher.metadata, {});
    const remaining = voucher.remaining == null
      ? Math.max(Number(voucher.original_amount || 0) - Number(voucher.used_amount || 0), 0)
      : Number(voucher.remaining || 0);
    const used = Math.max(Number(voucher.used_amount || 0), 0);
    const sep = '-'.repeat(WIDTH);
    const strong = '='.repeat(WIDTH);
    const context = json(this.store.get('context', '{}'), {});
    const company = context.company_trade_name || context.company_name || 'THORPDV';
    const branch = context.branch_name || '';
    const companyDocument = context.company_document || context.company_cnpj || context.cnpj || '';
    const terminal = context.pos_name || context.register_name || context.device_name || '';
    const issued = new Date(voucher.issued_at || metadata.issued_at || Date.now());
    const items = Array.isArray(metadata.items) ? metadata.items : [];

    const lines = [strong, center(company)];
    if (branch) lines.push(center(branch));
    if (companyDocument) lines.push(...wrap44(`CNPJ/CPF: ${companyDocument}`));
    lines.push(center('VALE CREDITO'), center('DEVOLUCAO DE VENDA'), strong);
    lines.push(...wrap44(`VALE: ${voucher.voucher_number}`));
    lines.push(fit(`EMISSAO: ${issued.toLocaleString('pt-BR')}`));
    if (voucher.sale_number || metadata.sale_number) lines.push(fit(`VENDA: ${voucher.sale_number || metadata.sale_number}`));
    if (metadata.return_event_id) lines.push(...wrap44(`EVENTO DEVOLUCAO: ${metadata.return_event_id}`));
    lines.push(sep);

    lines.push(center('BENEFICIARIO'));
    if (voucher.guest_name) lines.push(...wrap44(`NOME: ${voucher.guest_name}`));
    if (voucher.guest_document) lines.push(...wrap44(`DOCUMENTO: ${voucher.guest_document}`));
    if (!voucher.guest_name && !voucher.guest_document) lines.push(fit('PESSOA SEM CADASTRO'));
    if (metadata.operator_name) lines.push(...wrap44(`OPERADOR: ${metadata.operator_name}`));
    if (terminal) lines.push(...wrap44(`TERMINAL: ${terminal}`));
    if (metadata.reason) {
      lines.push(sep, fit('MOTIVO DA DEVOLUCAO:'));
      lines.push(...wrap44(metadata.reason));
    }

    if (items.length) {
      lines.push(sep, center('ITENS DEVOLVIDOS'));
      items.forEach((item, index) => {
        lines.push(...wrap44(`${index + 1}. ${item.name || item.sku || 'ITEM'}`));
        if (item.sku) lines.push(...wrap44(`COD/SKU: ${item.sku}`));
        const unit = item.unit ? ` ${item.unit}` : '';
        lines.push(fit(`QTD: ${qtyText(item.quantity)}${unit}`));
        lines.push(fit(`UNITARIO: ${money(item.unit_price)}`));
        lines.push(fit(`TOTAL ITEM: ${money(item.total)}`));
      });
    }

    lines.push(strong);
    lines.push(fit(`VALOR DO VALE: ${money(voucher.original_amount)}`));
    lines.push(fit(`VALOR UTILIZADO: ${money(used)}`));
    lines.push(fit(`SALDO DISPONIVEL: ${money(remaining)}`));
    lines.push(strong);
    lines.push(...wrap44('APRESENTE O NUMERO DESTE VALE NO MOMENTO DA COMPRA.'));
    lines.push(...wrap44('USO PARCIAL PERMITIDO. GUARDE ESTE COMPROVANTE ATE UTILIZAR TODO O SALDO.'));
    lines.push(sep, center('DOCUMENTO NAO FISCAL'), center('THORPDV'), strong, '', '', '');
    return { kind:'text', width:WIDTH, text:lines.join('\n'), voucher:{ ...voucher, metadata } };
  };

  ThorAgent.prototype.printStoreCreditVoucher = async function (input) {
    const doc = this.storeCreditVoucherDocument(input);
    const target = this.settings().printerName;
    if (!target) throw new Error('printer_not_configured');
    if (target === '__PDF__') throw new Error('thermal_printer_required');
    await hardware.printText(target, doc.text);
    return { ok:true, target, voucher_number:doc.voucher.voucher_number, width:WIDTH };
  };
}

module.exports = { installStoreCreditReturnV105 };
