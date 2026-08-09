const { installCustomerCreditRules } = require('./customer-credit-v050');

function installProductRules(ThorAgent, Store) {
  installCustomerCreditRules(ThorAgent, Store);
  const originalMigrate = Store.prototype.migrate;
  const originalApplyPull = Store.prototype.applyPull;
  const originalInflateProduct = Store.prototype.inflateProduct;
  const originalQuoteSale = ThorAgent.prototype.quoteSale;

  Store.prototype.migrate = function () {
    originalMigrate.call(this);
    const cols = new Set(this.db.prepare('pragma table_info(products)').all().map((row) => row.name));
    const add = (name, definition) => { if (!cols.has(name)) this.db.exec(`alter table products add column ${name} ${definition}`); };
    add('is_weighable', 'integer not null default 0');
    add('fractioned', 'integer not null default 0');
    add('prompt_quantity', 'integer not null default 0');
    add('allow_discount', 'integer not null default 1');
  };

  Store.prototype.applyPull = function (data) {
    originalApplyPull.call(this, data);
    const rows = Array.isArray(data?.products) ? data.products : [];
    if (!rows.length) return;
    const stmt = this.db.prepare(`update products set is_weighable=?, fractioned=?, prompt_quantity=?, allow_discount=? where id=?`);
    const tx = this.db.transaction(() => {
      for (const product of rows) {
        const weighable = product.is_weighable === true;
        stmt.run(
          weighable ? 1 : 0,
          (weighable || product.fractioned === true) ? 1 : 0,
          product.prompt_quantity === true ? 1 : 0,
          product.allow_discount === false ? 0 : 1,
          String(product.id)
        );
      }
    });
    tx();
  };

  Store.prototype.inflateProduct = function (row) {
    const product = originalInflateProduct.call(this, row);
    return {
      ...product,
      is_weighable: Boolean(product.is_weighable),
      fractioned: Boolean(product.is_weighable) || Boolean(product.fractioned),
      prompt_quantity: Boolean(product.prompt_quantity),
      allow_discount: product.allow_discount !== 0,
    };
  };

  ThorAgent.prototype.quoteSale = function (items = [], discount = 0) {
    for (const item of Array.isArray(items) ? items : []) {
      const product = this.store.product(item.productId);
      if (!product || !product.active) continue;
      const quantity = Number(item.quantity || 0);
      if (quantity <= 0) continue;
      const allowsFraction = Boolean(product.is_weighable) || Boolean(product.fractioned);
      if (!allowsFraction && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
        throw new Error('fractional_quantity_not_allowed');
      }
      if (Number(item.discount || 0) > 0 && product.allow_discount === false) {
        throw new Error('product_discount_not_allowed');
      }
    }
    return originalQuoteSale.call(this, items, discount);
  };
}

module.exports = { installProductRules };
