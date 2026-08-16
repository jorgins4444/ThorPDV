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
      updated_at text not null
    );
    create index if not exists idx_local_credit_voucher_status on store_credit_vouchers(status,updated_at);
  `);
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
      const upsert = this.db.prepare(`insert into store_credit_vouchers(
        voucher_number,id,original_amount,used_amount,status,guest_name,guest_document,sale_number,source,issued_at,updated_at
      ) values(?,?,?,?,?,?,?,?,?,?,?) on conflict(voucher_number) do update set
        id=excluded.id,original_amount=excluded.original_amount,used_amount=excluded.used_amount,status=excluded.status,
        guest_name=excluded.guest_name,guest_document=excluded.guest_document,source='server',issued_at=excluded.issued_at,updated_at=excluded.updated_at`);
      for (const voucher of data.store_credit_vouchers) upsert.run(
        String(voucher.voucher_number || '').toUpperCase(), String(voucher.id || ''), Number(voucher.original_amount || 0), Number(voucher.used_amount || 0),
        String(voucher.status || 'active'), String(voucher.guest_name || ''), String(voucher.guest_document || ''), '', 'server',
        String(voucher.issued_at || new Date().toISOString()), String(voucher.updated_at || new Date().toISOString())
      );
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
    return { ...row, original_amount:Number(row.original_amount || 0), used_amount:Number(row.used_amount || 0), remaining:Math.max(Number(row.original_amount || 0) - Number(row.used_amount || 0), 0) };
  };

  Store.prototype.saveStoreCreditVoucher = function (voucher) {
    ensureSchema(this);
    const now = new Date().toISOString();
    this.db.prepare(`insert into store_credit_vouchers(voucher_number,id,original_amount,used_amount,status,guest_name,guest_document,sale_number,source,issued_at,updated_at)
      values(?,?,?,?,?,?,?,?,?,?,?) on conflict(voucher_number) do update set original_amount=excluded.original_amount,used_amount=excluded.used_amount,status=excluded.status,
      guest_name=excluded.guest_name,guest_document=excluded.guest_document,sale_number=excluded.sale_number,updated_at=excluded.updated_at`).run(
      String(voucher.voucher_number).toUpperCase(), String(voucher.id || ''), Number(voucher.original_amount || 0), Number(voucher.used_amount || 0), String(voucher.status || 'active'),
      String(voucher.guest_name || ''), String(voucher.guest_document || ''), String(voucher.sale_number || ''), String(voucher.source || 'local'), String(voucher.issued_at || now), now
    );
    return this.storeCreditVoucher(voucher.voucher_number);
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

    const result = await originalReturnSale.call(this, {
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

    const voucher = this.store.saveStoreCreditVoucher({
      voucher_number:number,original_amount:value,used_amount:0,status:'active',guest_name:guestName,guest_document:guestDocument,
      sale_number:sale.number || '',source:'local',issued_at:new Date().toISOString(),
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
    const remaining = voucher.remaining == null ? Math.max(Number(voucher.original_amount || 0) - Number(voucher.used_amount || 0), 0) : Number(voucher.remaining || 0);
    const sep = '-'.repeat(WIDTH);
    const strong = '='.repeat(WIDTH);
    const context = JSON.parse(this.store.get('context', '{}') || '{}');
    const lines = [strong, center(context.company_name || 'THORPDV'), center('VALE CREDITO'), strong];
    lines.push(...wrap44(`VALE: ${voucher.voucher_number}`));
    lines.push(fit(`VALOR ORIGINAL: ${money(voucher.original_amount)}`));
    lines.push(fit(`SALDO:          ${money(remaining)}`));
    lines.push(sep);
    if (voucher.guest_name) lines.push(...wrap44(`CLIENTE: ${voucher.guest_name}`));
    if (voucher.guest_document) lines.push(...wrap44(`DOCUMENTO: ${voucher.guest_document}`));
    if (voucher.sale_number) lines.push(...wrap44(`ORIGEM: DEVOLUCAO VENDA ${voucher.sale_number}`));
    const issued = new Date(voucher.issued_at || Date.now());
    lines.push(fit(`EMISSAO: ${issued.toLocaleString('pt-BR')}`));
    lines.push(sep);
    lines.push(...wrap44('APRESENTE ESTE VALE NO MOMENTO DA COMPRA.'));
    lines.push(...wrap44('USO PARCIAL PERMITIDO. GUARDE O VALE ATE UTILIZAR TODO O SALDO.'));
    lines.push(sep, center('DOCUMENTO NAO FISCAL'), strong, '', '', '');
    return { kind:'text', width:WIDTH, text:lines.join('\n'), voucher };
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
