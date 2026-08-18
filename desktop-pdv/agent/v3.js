const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const hardware = require('./hardware');

function json(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj) ?? fallback;
}

function digits(value) { return String(value || '').replace(/\D/g, ''); }

function installThorAgentV3(ThorAgent) {
  const originalReturnSale = ThorAgent.prototype.returnSale;

  ThorAgent.prototype.v3Settings = function () {
    return {
      autoOpenDrawer: this.store.get('v3_auto_open_drawer', 'false') === 'true',
      drawerPrinter: this.store.get('v3_drawer_printer') || this.store.get('printer_name') || '',
      scalePort: this.store.get('v3_scale_port') || '',
      scaleBaud: Number(this.store.get('v3_scale_baud', '9600')) || 9600,
      scaleTimeoutMs: Number(this.store.get('v3_scale_timeout', '1500')) || 1500,
      localPaymentUrl: this.store.get('v3_local_payment_url') || '',
    };
  };

  ThorAgent.prototype.saveV3Settings = function (input = {}) {
    if (Object.prototype.hasOwnProperty.call(input, 'autoOpenDrawer')) this.store.set('v3_auto_open_drawer', input.autoOpenDrawer ? 'true' : 'false');
    if (Object.prototype.hasOwnProperty.call(input, 'drawerPrinter')) this.store.set('v3_drawer_printer', input.drawerPrinter || '');
    if (Object.prototype.hasOwnProperty.call(input, 'scalePort')) this.store.set('v3_scale_port', input.scalePort || '');
    if (Object.prototype.hasOwnProperty.call(input, 'scaleBaud')) this.store.set('v3_scale_baud', Number(input.scaleBaud || 9600));
    if (Object.prototype.hasOwnProperty.call(input, 'scaleTimeoutMs')) this.store.set('v3_scale_timeout', Number(input.scaleTimeoutMs || 1500));
    if (Object.prototype.hasOwnProperty.call(input, 'localPaymentUrl')) this.store.set('v3_local_payment_url', input.localPaymentUrl || '');
    return this.v3Settings();
  };

  ThorAgent.prototype.staffUsers = function () {
    const rows = json(this.store.get('staff_users', '[]'), []);
    return rows.map(({ pin_hash, ...u }) => u);
  };

  ThorAgent.prototype._staffUsersWithHash = function () {
    return json(this.store.get('staff_users', '[]'), []);
  };

  ThorAgent.prototype.currentOperator = function () {
    const id = this.store.get('current_operator_id') || '';
    if (!id) return null;
    const row = this._staffUsersWithHash().find((u) => String(u.id) === String(id));
    if (!row) { this.store.set('current_operator_id', ''); return null; }
    const { pin_hash, ...safe } = row;
    return safe;
  };

  ThorAgent.prototype.loginOperator = function ({ userId, pin }) {
    const row = this._staffUsersWithHash().find((u) => String(u.id) === String(userId));
    if (!row || !row.pin_hash) throw new Error('operator_pin_not_configured');
    if (!bcrypt.compareSync(String(pin || ''), String(row.pin_hash))) throw new Error('invalid_operator_pin');
    this.store.set('current_operator_id', row.id);
    const { pin_hash, ...safe } = row;
    return { ok: true, operator: safe };
  };

  ThorAgent.prototype.logoutOperator = function () {
    this.store.set('current_operator_id', '');
    return { ok: true };
  };

  ThorAgent.prototype.authorizeSupervisor = function ({ userId, pin, action, requestedValue = 0, reason = '' }) {
    const row = this._staffUsersWithHash().find((u) => String(u.id) === String(userId));
    if (!row || !row.pin_hash) throw new Error('supervisor_pin_not_configured');
    if (!bcrypt.compareSync(String(pin || ''), String(row.pin_hash))) throw new Error('invalid_supervisor_pin');
    if (!getPath(row, 'permissions.supervisor.authorize', false)) throw new Error('user_is_not_supervisor');
    return { ok: true, authorization: { supervisor_user_id: row.id, supervisor_name: row.name, action, requested_value: Number(requestedValue || 0), reason: String(reason || ''), authorized_at: new Date().toISOString() } };
  };

  ThorAgent.prototype.paymentIntegrations = function () {
    return json(this.store.get('payment_integrations', '[]'), []);
  };

  ThorAgent.prototype.beginIntegratedPayment = async function ({ method, amount }) {
    const value = Number(amount || 0);
    if (value <= 0) throw new Error('invalid_payment_amount');
    if (!['pix', 'credit_card', 'debit_card', 'voucher'].includes(method)) throw new Error('payment_method_not_integrated');
    const localUrl = this.v3Settings().localPaymentUrl.replace(/\/$/, '');
    if (localUrl) {
      const response = await fetch(`${localUrl}/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, amount: value, reference: `THOR-${Date.now()}` }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !['authorized', 'paid'].includes(String(data.status || ''))) throw new Error(data.error || 'payment_not_authorized');
      return { ok: true, integrated: true, method, amount: value, provider: data.provider || 'local_tef', externalId: data.external_id || data.externalId || null, txid: data.txid || null, status: data.status, metadata: data.metadata || {} };
    }
    const configured = this.paymentIntegrations().find((x) => x.enabled && String(x.provider || ''));
    if (configured) throw new Error('cloud_payment_adapter_pending_provider_credentials');
    throw new Error('payment_provider_not_configured');
  };

  ThorAgent.prototype.quoteCheckout = function ({ items = [], discount = 0, surcharge = 0 }) {
    const base = this.quoteSale(items, discount);
    const extra = Math.max(Number(surcharge || 0), 0);
    return { ...base, surcharge: extra, total: Math.max(Number(base.total || 0) + extra, 0) };
  };

  ThorAgent.prototype._operatorLimit = function (operator, type) {
    return Number(getPath(operator || {}, `permissions.${type}.max_percent`, 0) || 0);
  };

  ThorAgent.prototype._validateAdjustmentAuthorization = function ({ operator, subtotal, discount, surcharge, supervisorAuthorization }) {
    const discountPct = subtotal > 0 ? (Number(discount || 0) / subtotal) * 100 : 0;
    const surchargePct = subtotal > 0 ? (Number(surcharge || 0) / subtotal) * 100 : 0;
    const needsDiscount = discountPct > this._operatorLimit(operator, 'discount') + 0.0001;
    const needsSurcharge = surchargePct > this._operatorLimit(operator, 'surcharge') + 0.0001;
    if (!needsDiscount && !needsSurcharge) return null;
    const auth = supervisorAuthorization || null;
    if (!auth?.supervisor_user_id) throw new Error('supervisor_authorization_required');
    const sup = this._staffUsersWithHash().find((u) => String(u.id) === String(auth.supervisor_user_id));
    if (!sup || !getPath(sup, 'permissions.supervisor.authorize', false)) throw new Error('invalid_supervisor_authorization');
    if (needsDiscount && discountPct > Number(getPath(sup, 'permissions.discount.max_percent', 0)) + 0.0001) throw new Error('discount_exceeds_supervisor_limit');
    if (needsSurcharge && surchargePct > Number(getPath(sup, 'permissions.surcharge.max_percent', 0)) + 0.0001) throw new Error('surcharge_exceeds_supervisor_limit');
    return auth;
  };

  ThorAgent.prototype.finalizeSale = async function ({ items, customerId = null, consumerDocument = '', payments = [], discount = 0, surcharge = 0, supervisorAuthorization = null, notes = '' }) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    if (!getPath(operator, 'permissions.sale.create', false)) throw new Error('operator_not_allowed_to_sell');
    const cashOpenEventId = this.store.get('cash_open_event_id');
    if (!cashOpenEventId) throw new Error('cash_not_open');
    const document = digits(consumerDocument);
    if (document && ![11, 14].includes(document.length)) throw new Error('invalid_consumer_document');
    const quote = this.quoteCheckout({ items, discount, surcharge });
    if (!quote.items.length) throw new Error('empty_cart');
    const auth = this._validateAdjustmentAuthorization({ operator, subtotal: Number(quote.subtotal || 0), discount: Number(discount || 0), surcharge: Number(surcharge || 0), supervisorAuthorization });
    const normalizedPayments = (payments || []).map((p) => {
      const amount = Number(p.amount || 0);
      const tendered = p.method === 'cash' ? Number(p.tenderedAmount ?? p.tendered_amount ?? amount) : amount;
      const change = p.method === 'cash' ? Math.max(Number(p.changeAmount ?? p.change_amount ?? (tendered - amount)) || 0, 0) : 0;
      if (amount <= 0) throw new Error('invalid_payment_amount');
      if (p.method === 'cash' && tendered + 0.001 < amount) throw new Error('cash_tendered_below_applied');
      return { method: p.method, amount, tendered_amount: tendered, change_amount: change, provider: p.provider || null, external_id: p.externalId || p.external_id || null, txid: p.txid || null, metadata: { ...(p.metadata || {}), integrated: Boolean(p.integrated) } };
    });
    const paid = normalizedPayments.reduce((s, p) => s + p.amount, 0);
    if (paid > quote.total + 0.01) throw new Error('payment_exceeds_total');
    const payload = { cash_open_event_id: cashOpenEventId, operator_user_id: operator.id, customer_id: customerId || null, consumer_document: document || null, items: quote.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, unit_price: i.unitPrice, discount: i.discount })), payments: normalizedPayments, discount: Number(discount || 0), surcharge: Number(surcharge || 0), supervisor_authorization: auth, notes };
    const event = { id:crypto.randomUUID(), type:'sale_completed', payload:{ ...payload, occurred_at:new Date().toISOString() } };
    const receipt = { eventId: event.id, items: quote.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, unit_price: i.unitPrice, discount: i.discount, name: i.name, sku: i.sku, unit: i.unit, total: i.total })), subtotal: quote.subtotal, discount: Number(discount || 0), surcharge: Number(surcharge || 0), total: quote.total, payments: normalizedPayments, customerId, consumerDocument: document || null, operator: { id: operator.id, name: operator.name }, supervisorAuthorization: auth, createdAt: new Date().toISOString(), context: json(this.store.get('context', '{}'), {}), local_status: 'pending_sync', returned_total: 0 };
    this.store.commitSaleLocal({ event, inventory:quote.items, total:quote.total, receipt });
    setTimeout(() => this.sync.run().catch(() => {}), 600);
    if (this.v3Settings().autoOpenDrawer && normalizedPayments.some((p) => p.method === 'cash')) {
      setTimeout(() => this.openDrawer().catch(() => {}), 1500);
    }
    return { ok: true, eventId: event.id, subtotal: quote.subtotal, discount: Number(discount || 0), surcharge: Number(surcharge || 0), total: quote.total, paid, change: normalizedPayments.reduce((s, p) => s + Number(p.change_amount || 0), 0), receipt };
  };

  ThorAgent.prototype.openCash = async function ({ openingAmount = 0, notes = '' }) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    if (!getPath(operator, 'permissions.cash.open', false)) throw new Error('operator_not_allowed_to_open_cash');
    if (this.store.get('cash_open_event_id')) throw new Error('cash_already_open');
    const e = this.event('cash_open', { opening_amount: Number(openingAmount) || 0, notes, operator_user_id: operator.id });
    this.store.set('cash_open_event_id', e.id);
    return { ok: true, eventId: e.id };
  };

  ThorAgent.prototype.cashMovement = async function ({ movementType, amount, notes = '', supervisorAuthorization = null }) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    if (!this.store.get('cash_open_event_id')) throw new Error('cash_not_open');
    const allowed = getPath(operator, 'permissions.cash.movement', false);
    if (!allowed && !supervisorAuthorization?.supervisor_user_id) throw new Error('supervisor_authorization_required');
    return { ok: true, eventId: this.event('cash_movement', { movement_type: movementType, amount: Number(amount) || 0, notes, operator_user_id: operator.id, supervisor_authorization: supervisorAuthorization }).id };
  };

  ThorAgent.prototype.closeCash = async function ({ closingAmount = 0, notes = '' }) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    if (!getPath(operator, 'permissions.cash.close', false)) throw new Error('operator_not_allowed_to_close_cash');
    if (!this.store.get('cash_open_event_id')) throw new Error('cash_not_open');
    const e = this.event('cash_close', { closing_amount: Number(closingAmount) || 0, notes, operator_user_id: operator.id });
    this.store.set('cash_open_event_id', '');
    return { ok: true, eventId: e.id };
  };

  ThorAgent.prototype.cancelSale = async function ({ saleKey, saleClientEventId = null, saleId = null, reason = '', supervisorAuthorization = null }) {
  const operator = this.currentOperator();
  if (!operator) throw new Error('operator_required');
  const sale = saleKey ? this.fiscalSale(saleKey) : null;
  const allowed = getPath(operator, 'permissions.sale.cancel', false);
  if (!allowed && !supervisorAuthorization?.supervisor_user_id) throw new Error('supervisor_authorization_required');
  const normalizedReason = String(reason || '').trim().replace(/\s+/g, ' ');
  let fiscalCancellation = null;
  if (sale) {
    if (String(sale.status) === 'cancelled' || String(sale.status) === 'cancel_pending') throw new Error('sale_already_cancelled');
    if (Number(sale.returned_total || 0) > 0) throw new Error('sale_has_returns');
    if (sale.fiscal?.status === 'authorized') {
      if (normalizedReason.length < 15 || normalizedReason.length > 255) throw new Error('nfce_cancellation_reason_invalid');
      const authorizationAt = Date.parse(String(sale.fiscal.authorization_at || ''));
      const serverDeadline = Date.parse(String(sale.fiscal.cancel_deadline || ''));
      const deadline = Number.isFinite(serverDeadline) ? serverDeadline : (Number.isFinite(authorizationAt) ? authorizationAt + 30 * 60 * 1000 : NaN);
      if (!Number.isFinite(deadline)) throw new Error('nfce_cancellation_deadline_unavailable');
      if (Date.now() >= deadline) throw new Error('nfce_cancellation_window_expired');
      const token = this.deviceToken();
      if (!token) throw new Error('device_not_enrolled');
      const response = await fetch(`${this.apiBase}/api/pdv/fiscal/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fiscal_document_id: sale.fiscal.id,
          reason: normalizedReason,
          operator_user_id: operator.id,
          supervisor_user_id: supervisorAuthorization?.supervisor_user_id || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.cancelled) {
        const error = new Error(data.error || data.message || 'nfce_cancellation_failed');
        error.fiscal = data;
        throw error;
      }
      fiscalCancellation = data;
      const cancelledFiscal = {
        ...(sale.fiscal || {}),
        status: 'cancelled',
        cancellation_protocol: data.cancellation_protocol || sale.fiscal.cancellation_protocol || null,
        cancellation_at: data.cancellation_at || new Date().toISOString(),
        cStat: data.cStat || sale.fiscal.cStat || null,
        xMotivo: data.message || 'Cancelamento autorizado pela SEFAZ.',
        can_cancel: false,
      };
      this.store.patchLocalSale(sale, { fiscal: cancelledFiscal });
      sale.fiscal = cancelledFiscal;
    }
    for (const i of sale.items || []) if (i.product_id) this.store.adjustInventory(String(i.product_id), Number(i.quantity || 0));
    this.store.patchLocalSale(sale, { status: 'cancel_pending', local_status: 'cancel_pending' });
  }
  const e = this.event('sale_cancel', {
    sale_client_event_id: saleClientEventId || sale?.client_event_id || null,
    sale_id: saleId || sale?.id || null,
    reason: normalizedReason,
    operator_user_id: operator.id,
    supervisor_authorization: supervisorAuthorization,
    fiscal_cancellation: fiscalCancellation ? {
      document_id: sale?.fiscal?.id || null,
      cancellation_protocol: fiscalCancellation.cancellation_protocol || null,
      cancellation_at: fiscalCancellation.cancellation_at || null,
      cStat: fiscalCancellation.cStat || null,
    } : null,
  });
  const cancelledAt = new Date().toISOString();
  const context = sale?.context || json(this.store.get('context', '{}'), {});
  return {
    ok: true,
    eventId: e.id,
    fiscalCancellation,
    receipt: {
      event_id: e.id,
      sale_id: saleId || sale?.id || null,
      sale_client_event_id: saleClientEventId || sale?.client_event_id || null,
      sale_number: sale?.number || null,
      sale_completed_at: sale?.completed_at || sale?.created_at || null,
      cancelled_at: cancelledAt,
      reason: normalizedReason,
      total: Number(sale?.total || 0),
      customer_name: sale?.customer_name || sale?.customer?.name || 'Consumidor',
      items: Array.isArray(sale?.items) ? sale.items : [],
      payments: Array.isArray(sale?.payments) ? sale.payments : [],
      operator: { id: operator.id || null, name: operator.name || operator.full_name || 'Operador não identificado' },
      supervisor: supervisorAuthorization ? {
        id: supervisorAuthorization.supervisor_user_id || null,
        name: supervisorAuthorization.supervisor_name || supervisorAuthorization.user_name || supervisorAuthorization.name || '',
      } : null,
      fiscal: sale?.fiscal || null,
      fiscal_cancellation: fiscalCancellation,
      context,
    },
  };
};

  ThorAgent.prototype.saleCancellationDocument = function (receiptInput = {}) {
    const r = receiptInput || {};
    const context = r.context || json(this.store.get('context', '{}'), {});
    const width = 44;
    const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const center = (value) => { const text = clean(value).slice(0, width); return ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text; };
    const pair = (label, value) => { const left=clean(label),right=clean(value);return (left+' '.repeat(Math.max(1,width-left.length-right.length))+right).slice(0,width); };
    const wrap = (prefix, value) => {
      const words=clean(value).split(' ').filter(Boolean);if(!words.length)return [];
      const result=[];let line=prefix;
      for(const word of words){const next=line+(line===prefix?'':' ')+word;if(next.length>width){result.push(line);line=' '.repeat(prefix.length)+word;}else line=next;}
      if(line.trim())result.push(line);return result;
    };
    const brl = (value) => Number(value || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const date = r.cancelled_at ? new Date(r.cancelled_at) : new Date();
    const fiscal = r.fiscal || {};
    const cancellation = r.fiscal_cancellation || {};
    const company=context.company_name||context.tenant_name||context.organization_name||'THORPDV';
    const branch=context.branch_name||context.store_name||'';
    const pos=context.pos_name||context.pos_code||context.terminal_name||'PDV';
    const number=clean(r.sale_number||r.sale_client_event_id||r.sale_id||'LOCAL');
    const lines=[
      center(company),...(branch?[center(branch)]:[]),
      '-'.repeat(width),
      center('*** COMPROVANTE DE CANCELAMENTO ***'),
      '-'.repeat(width),
      pair('Venda:',number),
      pair('Data:',date.toLocaleDateString('pt-BR')),
      pair('Hora:',date.toLocaleTimeString('pt-BR')),
      pair('Caixa:',pos),
      ...wrap('Responsável: ',r.operator?.name||'Operador não identificado'),
      ...(r.supervisor?.name?wrap('Autorizado por: ',r.supervisor.name):[]),
      '-'.repeat(width),
      ...wrap('Cliente: ',r.customer_name||'Consumidor'),
      ...(r.sale_completed_at?[pair('Venda realizada:',new Date(r.sale_completed_at).toLocaleDateString('pt-BR'))]:[]),
      '-'.repeat(width),
      center('ITENS CANCELADOS')
    ];
    const items=Array.isArray(r.items)?r.items:[];
    if(!items.length)lines.push(center('Itens não disponíveis localmente'));
    for(const item of items){
      const qty=Number(item.quantity||0),unit=Number(item.unit_price??item.unitPrice??0),discount=Number(item.discount||0);
      lines.push(...wrap('',`${qty.toLocaleString('pt-BR',{maximumFractionDigits:3})}x ${item.name||item.description||item.sku||'ITEM'}`));
      lines.push(pair(`  Unit. R$ ${brl(unit)}`,`R$ ${brl(qty*unit-discount)}`));
    }
    lines.push('-'.repeat(width));
    const payments=Array.isArray(r.payments)?r.payments:[];
    if(payments.length){
      lines.push(center('FORMAS DE PAGAMENTO'));
      for(const payment of payments)lines.push(pair(clean(payment.name||payment.method||'Forma'),`R$ ${brl(payment.amount)}`));
      lines.push('-'.repeat(width));
    }
    lines.push(center('VALOR TOTAL CANCELADO'),center(`R$ ${brl(r.total)}`),'-'.repeat(width),center('MOTIVO DO CANCELAMENTO'),...wrap('',r.reason||'Não informado'),'-'.repeat(width));
    if(String(fiscal.status||'')==='cancelled'||cancellation.cancellation_protocol){
      lines.push(center('CANCELAMENTO FISCAL / NFC-e'));
      if(fiscal.number)lines.push(pair('NFC-e:',fiscal.number));
      if(fiscal.access_key)lines.push(...wrap('Chave: ',fiscal.access_key));
      if(cancellation.cancellation_protocol||fiscal.cancellation_protocol)lines.push(...wrap('Protocolo: ',cancellation.cancellation_protocol||fiscal.cancellation_protocol));
      if(cancellation.cStat||fiscal.cStat)lines.push(pair('cStat:',cancellation.cStat||fiscal.cStat));
      lines.push('-'.repeat(width));
    }
    lines.push('',center('________________________________'),center('ASSINATURA DO RESPONSÁVEL'),'',center('Cancelamento registrado pelo ThorPDV'),'','','');
    const text=lines.join('\n');
    const escape=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{width:80mm;margin:0;padding:0;background:#fff;color:#000}body{padding:4mm 3mm 8mm;font-family:"Courier New",Consolas,monospace}pre{width:100%;margin:0;white-space:pre-wrap;font-size:9.5px;line-height:1.35;font-weight:600}</style></head><body><pre>${escape(text)}</pre></body></html>`;
    return {kind:'text',text,html,title:'Comprovante de Cancelamento',filename:`ThorPDV-Cancelamento-${Date.now()}.pdf`,receipt:r};
  };

  ThorAgent.prototype.returnSale = async function (payload) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    const allowed = getPath(operator, 'permissions.sale.return', false);
    if (!allowed && !payload?.supervisorAuthorization?.supervisor_user_id) throw new Error('supervisor_authorization_required');
    const result = await originalReturnSale.call(this, payload);
    const pending = this.store.pending(5).find((e) => e.id === result.eventId);
    if (pending) {
      const merged = { ...pending.payload, operator_user_id: operator.id, supervisor_authorization: payload?.supervisorAuthorization || null };
      this.store.db.prepare('update queue set payload=?,updated_at=? where id=?').run(JSON.stringify(merged), new Date().toISOString(), result.eventId);
    }
    return result;
  };

  ThorAgent.prototype.openDrawer = async function () {
    const settings = this.v3Settings();
    const printer = settings.drawerPrinter || this.store.get('printer_name') || '';
    if (!printer || printer === '__PDF__') throw new Error('drawer_printer_not_configured');
    await hardware.openDrawer(printer);
    return { ok: true, printer };
  };

  ThorAgent.prototype.readScale = async function () {
    const settings = this.v3Settings();
    if (!settings.scalePort) throw new Error('scale_port_not_configured');
    const value = await hardware.readScale(settings.scalePort, settings.scaleBaud, settings.scaleTimeoutMs);
    return { ok: true, weight: value, port: settings.scalePort };
  };
}

module.exports = { installThorAgentV3 };
