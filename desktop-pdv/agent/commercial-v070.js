const { Store } = require('./store');

function json(value, fallback) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function text(value) { return String(value ?? '').trim(); }
function money(value) { return num(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function center(value, width = 42) { const s = text(value); if (s.length >= width) return s.slice(0, width); return `${' '.repeat(Math.floor((width-s.length)/2))}${s}`; }

function installCommercialV070(ThorAgent) {
  const originalMigrate = Store.prototype.migrate;
  const originalApplyPull = Store.prototype.applyPull;
  const originalResolvePrice = ThorAgent.prototype.resolvePrice;
  const originalEvent = ThorAgent.prototype.event;
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalCashMovement = ThorAgent.prototype.cashMovement;

  Store.prototype.migrate = function () {
    originalMigrate.call(this);
    this.db.exec(`
      create table if not exists sales_orders_local(
        id text primary key, number integer, status text not null default 'open', customer_id text, customer_name text,
        payment_condition text, payment_method text, term_method text, total real not null default 0,
        payload text not null default '{}', updated_at text
      );
      create index if not exists idx_sales_orders_local_number on sales_orders_local(number);
      create index if not exists idx_sales_orders_local_status on sales_orders_local(status,updated_at);
      create table if not exists payment_terms_local(
        id text primary key, name text not null, method text not null, installments integer not null default 1,
        first_due_days integer not null default 30, interval_days integer not null default 30,
        interest_percent real not null default 0, active integer not null default 1, payload text not null default '{}'
      );
    `);
  };

  Store.prototype.applyPull = function (data) {
    originalApplyPull.call(this, data);
    const orders = Array.isArray(data?.sales_orders) ? data.sales_orders : [];
    const terms = Array.isArray(data?.payment_terms) ? data.payment_terms : [];
    const tx = this.db.transaction(() => {
      if (orders.length) {
        const stmt = this.db.prepare(`insert into sales_orders_local(id,number,status,customer_id,customer_name,payment_condition,payment_method,term_method,total,payload,updated_at)
          values(@id,@number,@status,@customer_id,@customer_name,@payment_condition,@payment_method,@term_method,@total,@payload,@updated_at)
          on conflict(id) do update set number=excluded.number,status=excluded.status,customer_id=excluded.customer_id,customer_name=excluded.customer_name,
          payment_condition=excluded.payment_condition,payment_method=excluded.payment_method,term_method=excluded.term_method,total=excluded.total,payload=excluded.payload,updated_at=excluded.updated_at`);
        for (const order of orders) stmt.run({
          id:String(order.id), number:Number(order.number||0), status:String(order.status||'open'), customer_id:String(order.customer_id||''), customer_name:String(order.customer_name||''),
          payment_condition:String(order.payment_condition||'immediate'), payment_method:String(order.payment_method||''), term_method:String(order.term_method||''), total:num(order.total),
          payload:JSON.stringify(order), updated_at:String(order.updated_at||new Date().toISOString())
        });
      }
      if (Array.isArray(data?.payment_terms)) {
        this.db.prepare('delete from payment_terms_local').run();
        const stmt = this.db.prepare(`insert into payment_terms_local(id,name,method,installments,first_due_days,interval_days,interest_percent,active,payload)
          values(@id,@name,@method,@installments,@first_due_days,@interval_days,@interest_percent,@active,@payload)`);
        for (const term of terms) stmt.run({ id:String(term.id), name:String(term.name||''), method:String(term.method||''), installments:Number(term.installments||1), first_due_days:Number(term.first_due_days??30), interval_days:Number(term.interval_days??30), interest_percent:num(term.interest_percent), active:term.active===false?0:1, payload:JSON.stringify(term) });
      }
    });
    tx();
  };

  Store.prototype.salesOrders = function (query = '') {
    const q = text(query).toLowerCase();
    const rows = q
      ? this.db.prepare(`select * from sales_orders_local where status='open' and (cast(number as text) like ? or lower(customer_name) like ? or lower(payload) like ?) order by number desc limit 80`).all(`%${q}%`,`%${q}%`,`%${q}%`)
      : this.db.prepare(`select * from sales_orders_local where status='open' order by number desc limit 80`).all();
    return rows.map(row => json(row.payload, row));
  };
  Store.prototype.salesOrder = function (idOrNumber) {
    const key = text(idOrNumber);
    const row = /^\d+$/.test(key)
      ? this.db.prepare(`select * from sales_orders_local where (id=? or number=?) and status='open' limit 1`).get(key,Number(key))
      : this.db.prepare(`select * from sales_orders_local where id=? and status='open' limit 1`).get(key);
    return row ? json(row.payload, row) : null;
  };
  Store.prototype.paymentTerms = function () {
    return this.db.prepare(`select * from payment_terms_local where active=1 order by method,name`).all().map(row => json(row.payload, row));
  };

  ThorAgent.prototype.salesOrders = function (query = '') { return this.store.salesOrders(query); };
  ThorAgent.prototype.paymentTerms = function () { return this.store.paymentTerms(); };

  ThorAgent.prototype.setCommercialContext = function (input = {}) {
    const order = input.salesOrderId ? this.store.salesOrder(input.salesOrderId) : null;
    let term = input.term && typeof input.term === 'object' ? { ...input.term } : null;
    if (!term && order?.payment_condition === 'term') {
      term = {
        payment_term_id: order.payment_term_id || null,
        method: order.term_method || null,
        installments: Number(order.installments || 1),
        first_due_days: Number(order.first_due_days ?? 30),
        interval_days: Number(order.interval_days ?? 30),
        interest_percent: num(order.interest_percent),
      };
    }
    this._commercialV070 = { salesOrderId: order?.id || input.salesOrderId || null, order, term };
    return { ok:true, order, term };
  };

  ThorAgent.prototype.resolvePrice = function (product, qty) {
    const order = this._commercialV070?.order;
    if (order?.items) {
      const item = order.items.find(x => String(x.product_id) === String(product?.id));
      if (item && num(item.unit_price) >= 0) return num(item.unit_price);
    }
    return originalResolvePrice.call(this, product, qty);
  };

  ThorAgent.prototype.event = function (type, payload) {
    if (type === 'sale_completed' && this._commercialV070) {
      payload = { ...payload };
      if (this._commercialV070.salesOrderId) payload.sales_order_id = this._commercialV070.salesOrderId;
      if (this._commercialV070.term) payload.term = this._commercialV070.term;
    }
    return originalEvent.call(this, type, payload);
  };

  ThorAgent.prototype.finalizeSale = async function (input = {}) {
    const ctx = this._commercialV070 || null;
    try {
      if (ctx?.order && String(input.customerId || '') !== String(ctx.order.customer_id || '')) throw new Error('sales_order_customer_mismatch');
      const quote = this.quoteCheckout({ items:input.items || [], discount:input.discount || 0, surcharge:input.surcharge || 0 });
      const paid = (input.payments || []).reduce((sum,p) => sum + num(p.amount), 0);
      const remaining = Math.max(num(quote.total)-paid,0);
      if (ctx?.term) {
        if (!input.customerId) throw new Error('term_sale_requires_customer');
        if (remaining <= 0.009) throw new Error('term_sale_has_no_financed_balance');
      } else if (remaining > 0.01) {
        throw new Error('term_required_for_unpaid_balance');
      }
      const result = await originalFinalizeSale.call(this, input);
      if (result?.eventId && ctx) {
        const receipt = this.store.receiptByEvent(result.eventId);
        if (receipt) {
          const payload = { ...receipt.payload, salesOrderId:ctx.salesOrderId || null, term:ctx.term || null };
          this.store.db.prepare('update receipts set payload=? where event_id=?').run(JSON.stringify(payload), result.eventId);
        }
      }
      return result;
    } finally {
      this._commercialV070 = null;
    }
  };

  ThorAgent.prototype.cashMovement = async function (input = {}) {
    const kind = String(input.movementType || '');
    const reason = text(input.notes);
    const amount = num(input.amount);
    if (!['supply','withdrawal'].includes(kind)) throw new Error('invalid_cash_movement');
    if (amount <= 0) throw new Error('invalid_amount');
    if (reason.length < 15) throw new Error('cash_movement_reason_min_15');
    const operator = this.currentOperator?.();
    const result = await originalCashMovement.call(this, { ...input, notes:reason });
    const context = json(this.store.get('context','{}'),{});
    return { ...result, receipt:{ eventId:result.eventId, movementType:kind, amount, reason, operatorName:operator?.name || '', operatorId:operator?.id || '', terminal:context.pos_name || context.device_name || '', company:context.company_trade_name || context.company_name || '', branch:context.branch_name || '', createdAt:new Date().toISOString(), context } };
  };

  ThorAgent.prototype.cashMovementDocument = function (receipt = {}) {
    const kind = receipt.movementType === 'supply' ? 'SUPRIMENTO' : 'SANGRIA';
    const lines = [];
    lines.push(center(receipt.company || 'THORPDV'));
    if (receipt.branch) lines.push(center(receipt.branch));
    lines.push('-'.repeat(42));
    lines.push(center(`COMPROVANTE DE ${kind}`));
    lines.push(center('DOCUMENTO NAO FISCAL'));
    lines.push('-'.repeat(42));
    lines.push(`Operacao: ${kind}`);
    lines.push(`Valor: R$ ${money(receipt.amount)}`);
    lines.push(`Data: ${new Date(receipt.createdAt || Date.now()).toLocaleString('pt-BR')}`);
    if (receipt.operatorName) lines.push(`Operador: ${receipt.operatorName}`);
    if (receipt.terminal) lines.push(`Terminal: ${receipt.terminal}`);
    lines.push('-'.repeat(42));
    lines.push('MOTIVO:');
    const words = text(receipt.reason).split(/\s+/); let current='';
    for(const word of words){ if(!current) current=word; else if(`${current} ${word}`.length<=42) current+=` ${word}`; else {lines.push(current);current=word;} } if(current) lines.push(current);
    lines.push('-'.repeat(42));
    lines.push(`Evento: ${text(receipt.eventId).slice(0,36)}`);
    lines.push(center('THORPDV - CONTROLE DE CAIXA'));
    lines.push(''); lines.push('');
    const body = lines.join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:3mm}body{width:72mm;margin:0 auto;font:10.5px/1.3 "Courier New",monospace;color:#111}.r div{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><div class="r">${lines.map(x=>`<div>${esc(x)||'&nbsp;'}</div>`).join('')}</div></body></html>`;
    return { kind:'text', text:body, html, title:`Comprovante ${kind}`, filename:`ThorPDV-${kind}-${Date.now()}.pdf` };
  };
}

module.exports = { installCommercialV070 };
