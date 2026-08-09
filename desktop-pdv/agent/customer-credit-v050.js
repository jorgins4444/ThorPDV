function installCustomerCreditRules(ThorAgent, Store) {
  const originalMigrate = Store.prototype.migrate;
  const originalApplyPull = Store.prototype.applyPull;
  const originalFiscalSales = Store.prototype.fiscalSales;
  const originalFiscalSale = Store.prototype.fiscalSale;
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalReturnSale = ThorAgent.prototype.returnSale;

  Store.prototype.migrate = function () {
    originalMigrate.call(this);
    const cols = new Set(this.db.prepare('pragma table_info(customers)').all().map((row) => row.name));
    const add = (name, definition) => { if (!cols.has(name)) this.db.exec(`alter table customers add column ${name} ${definition}`); };
    add('type', "text not null default 'individual'");
    add('trade_name', "text not null default ''");
    add('birth_date', "text not null default ''");
    add('state_registration', "text not null default ''");
    add('postal_code', "text not null default ''");
    add('street', "text not null default ''");
    add('number', "text not null default ''");
    add('complement', "text not null default ''");
    add('district', "text not null default ''");
    add('city', "text not null default ''");
    add('state', "text not null default ''");
    add('ibge_city_code', "text not null default ''");
    add('store_credit_balance', 'real not null default 0');
    this.db.exec('create index if not exists idx_customers_document on customers(document);');
  };

  Store.prototype.applyPull = function (data) {
    originalApplyPull.call(this, data);
    const rows = Array.isArray(data?.customers) ? data.customers : [];
    if (!rows.length) return;
    const stmt = this.db.prepare(`update customers set
      type=?,trade_name=?,birth_date=?,state_registration=?,postal_code=?,street=?,number=?,complement=?,district=?,city=?,state=?,ibge_city_code=?,store_credit_balance=?
      where id=?`);
    const tx = this.db.transaction(() => {
      for (const customer of rows) {
        stmt.run(
          String(customer.type || 'individual'), String(customer.trade_name || ''), String(customer.birth_date || ''),
          String(customer.state_registration || ''), String(customer.postal_code || ''), String(customer.street || ''),
          String(customer.number || ''), String(customer.complement || ''), String(customer.district || ''),
          String(customer.city || ''), String(customer.state || ''), String(customer.ibge_city_code || ''),
          Number(customer.store_credit_balance || 0), String(customer.id)
        );
      }
    });
    tx();
  };

  Store.prototype.searchCustomers = function (query = '') {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return this.db.prepare('select * from customers where active=1 order by name limit 40').all();
    const digits = q.replace(/\D/g, '');
    const like = `%${q}%`;
    const docLike = `%${digits || q}%`;
    return this.db.prepare(`select * from customers where active=1 and (
      lower(name) like ? or lower(coalesce(trade_name,'')) like ? or lower(coalesce(document,'')) like ? or
      lower(coalesce(phone,'')) like ? or lower(coalesce(email,'')) like ?
    ) order by case when lower(coalesce(document,''))=? then 0 when lower(name)=? then 1 else 2 end,name limit 40`)
      .all(like, like, docLike, like, like, digits, q);
  };

  Store.prototype.customer = function (id) {
    if (!id) return null;
    return this.db.prepare('select * from customers where id=? limit 1').get(String(id)) || null;
  };

  Store.prototype.adjustCustomerCredit = function (customerId, delta) {
    if (!customerId || !Number.isFinite(Number(delta))) return null;
    this.db.prepare('update customers set store_credit_balance=max(store_credit_balance+?,0) where id=?').run(Number(delta), String(customerId));
    return this.customer(customerId);
  };

  function enrichSale(store, sale) {
    if (!sale) return sale;
    let customerId = sale.customer_id || null;
    if (!customerId && sale.client_event_id) {
      const receipt = store.receiptByEvent(String(sale.client_event_id));
      customerId = receipt?.payload?.customerId || receipt?.payload?.customer_id || null;
    }
    if (!customerId) return sale;
    const customer = store.customer(customerId);
    return {
      ...sale,
      customer_id: customerId,
      customer_name: sale.customer_name || customer?.name || '',
      customer_store_credit_balance: Number(customer?.store_credit_balance || 0),
    };
  }

  Store.prototype.fiscalSales = function (query = '') {
    return originalFiscalSales.call(this, query).map((sale) => enrichSale(this, sale));
  };

  Store.prototype.fiscalSale = function (key) {
    return enrichSale(this, originalFiscalSale.call(this, key));
  };

  ThorAgent.prototype.finalizeSale = async function (payload = {}) {
    const creditPayments = (Array.isArray(payload.payments) ? payload.payments : []).filter((payment) => payment?.method === 'store_credit');
    const creditAmount = creditPayments.reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0);
    let customer = null;
    if (creditAmount > 0) {
      if (!payload.customerId) throw new Error('store_credit_requires_customer');
      customer = this.store.customer(payload.customerId);
      if (!customer) throw new Error('customer_not_found');
      if (Number(customer.store_credit_balance || 0) + 0.001 < creditAmount) throw new Error('insufficient_store_credit');
    }
    const result = await originalFinalizeSale.call(this, payload);
    if (creditAmount > 0 && customer) this.store.adjustCustomerCredit(customer.id, -creditAmount);
    return result;
  };

  ThorAgent.prototype.returnSale = async function (payload = {}) {
    if (payload.refundMethod !== 'store_credit') return originalReturnSale.call(this, payload);
    const sale = this.store.fiscalSale(payload.saleKey);
    if (!sale) throw new Error('sale_not_found');
    const customerId = sale.customer_id || null;
    if (!customerId) throw new Error('store_credit_requires_customer');
    const customer = this.store.customer(customerId);
    if (!customer) throw new Error('customer_not_found');
    const result = await originalReturnSale.call(this, payload);
    const updated = this.store.adjustCustomerCredit(customerId, Math.max(Number(result.estimatedTotal || 0), 0));
    return { ...result, storeCreditCustomerId: customerId, storeCreditBalance: Number(updated?.store_credit_balance || 0) };
  };
}

module.exports = { installCustomerCreditRules };
