function installScaleLabelRules(ThorAgent, Store) {
  const originalMigrate = Store.prototype.migrate;
  const originalApplyPull = Store.prototype.applyPull;
  const originalSearchProducts = Store.prototype.searchProducts;
  const originalV3Settings = ThorAgent.prototype.v3Settings;
  const originalSaveV3Settings = ThorAgent.prototype.saveV3Settings;

  Store.prototype.migrate = function () {
    originalMigrate.call(this);
    const cols = new Set(this.db.prepare('pragma table_info(products)').all().map((row) => row.name));
    const add = (name, definition) => { if (!cols.has(name)) this.db.exec(`alter table products add column ${name} ${definition}`); };
    add('product_code', 'integer not null default 0');
    add('label_scale', 'integer not null default 0');
    this.db.exec('create index if not exists idx_products_product_code on products(product_code);');
  };

  Store.prototype.applyPull = function (data) {
    originalApplyPull.call(this, data);
    const products = Array.isArray(data?.products) ? data.products : [];
    if (!products.length) return;
    const stmt = this.db.prepare('update products set product_code=?, label_scale=? where id=?');
    const tx = this.db.transaction(() => {
      for (const product of products) {
        stmt.run(Number(product.product_code || 0), product.label_scale === true ? 1 : 0, String(product.id));
      }
    });
    tx();
  };

  Store.prototype.searchProducts = function (query = '', limit = 50) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return originalSearchProducts.call(this, query, limit);
    const digits = q.replace(/\D/g, '');
    if (digits) {
      const exact = this.db.prepare(`select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price
        from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id
        where p.active=1 and p.product_code=? limit 1`).get(Number(digits));
      if (exact) {
        const rest = originalSearchProducts.call(this, query, Math.max(Number(limit || 50) - 1, 0))
          .filter((item) => String(item.id) !== String(exact.id));
        return [this.inflateProduct(exact), ...rest];
      }
    }
    return originalSearchProducts.call(this, query, limit);
  };

  ThorAgent.prototype.v3Settings = function () {
    const base = originalV3Settings.call(this);
    const digits = Number(this.store.get('v6_scale_label_code_digits', '5'));
    const mode = this.store.get('v6_scale_label_mode', 'weight');
    const prefix = String(this.store.get('v6_scale_label_prefix', '2') || '2').replace(/\D/g, '').slice(0, 1) || '2';
    return {
      ...base,
      scaleLabelEnabled: this.store.get('v6_scale_label_enabled', 'true') !== 'false',
      scaleLabelCodeDigits: [4, 5, 6].includes(digits) ? digits : 5,
      scaleLabelMode: ['weight', 'total_price'].includes(mode) ? mode : 'weight',
      scaleLabelPrefix: prefix,
    };
  };

  ThorAgent.prototype.saveV3Settings = function (input = {}) {
    if (Object.prototype.hasOwnProperty.call(input, 'scaleLabelEnabled')) this.store.set('v6_scale_label_enabled', input.scaleLabelEnabled ? 'true' : 'false');
    if (Object.prototype.hasOwnProperty.call(input, 'scaleLabelCodeDigits')) {
      const digits = Number(input.scaleLabelCodeDigits);
      this.store.set('v6_scale_label_code_digits', [4, 5, 6].includes(digits) ? digits : 5);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'scaleLabelMode')) this.store.set('v6_scale_label_mode', ['weight', 'total_price'].includes(input.scaleLabelMode) ? input.scaleLabelMode : 'weight');
    if (Object.prototype.hasOwnProperty.call(input, 'scaleLabelPrefix')) {
      const prefix = String(input.scaleLabelPrefix || '2').replace(/\D/g, '').slice(0, 1) || '2';
      this.store.set('v6_scale_label_prefix', prefix);
    }
    originalSaveV3Settings.call(this, input);
    return this.v3Settings();
  };
}

module.exports = { installScaleLabelRules };
