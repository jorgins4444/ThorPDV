function installProductCatalogV110(ThorAgent, Store) {
  if (!Store || Store.prototype.__productCatalogV110Installed) return;
  Store.prototype.__productCatalogV110Installed = true;

  function ensureCatalogColumns(store) {
    const cols = new Set(store.db.prepare('pragma table_info(products)').all().map((x) => x.name));
    if (!cols.has('product_code')) store.db.exec("alter table products add column product_code text not null default ''");
    if (!cols.has('ncm')) store.db.exec("alter table products add column ncm text not null default ''");
  }

  const originalApplyPull = Store.prototype.applyPull;
  Store.prototype.applyPull = function applyPullV110(data) {
    ensureCatalogColumns(this);
    const result = originalApplyPull.call(this, data);
    const products = Array.isArray(data?.products) ? data.products : [];
    if (products.length) {
      const update = this.db.prepare("update products set product_code=?,ncm=? where id=?");
      const tx = this.db.transaction((rows) => {
        for (const p of rows) update.run(String(p?.product_code || ''), String(p?.ncm || ''), String(p?.id || ''));
      });
      tx(products);
    }
    return result;
  };

  Store.prototype.searchProducts = function searchProductsV110(query = '', limit = 50) {
    ensureCatalogColumns(this);
    const q = String(query).trim().toLowerCase();
    const base = `select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price
      from products p
      left join inventory i on i.product_id=p.id
      left join price_items pi on pi.product_id=p.id`;

    if (!q) {
      return this.db.prepare(`${base} where p.active=1 order by p.name limit ?`).all(limit).map(this.inflateProduct);
    }

    const like = `%${q}%`;
    return this.db.prepare(`${base}
      where p.active=1 and (
        lower(p.name) like ? or
        lower(coalesce(p.product_code,'')) like ? or
        lower(coalesce(p.sku,'')) like ? or
        lower(coalesce(p.ncm,'')) like ? or
        lower(p.barcodes) like ?
      )
      order by
        case
          when lower(coalesce(p.product_code,''))=? then 0
          when lower(coalesce(p.sku,''))=? then 1
          else 2
        end,
        p.name
      limit ?`).all(like, like, like, like, like, q, q, limit).map(this.inflateProduct);
  };

  if (ThorAgent && !ThorAgent.prototype.__productCatalogV110StartInstalled) {
    ThorAgent.prototype.__productCatalogV110StartInstalled = true;
    const originalStart = ThorAgent.prototype.start;
    ThorAgent.prototype.start = async function startProductCatalogV110(...args) {
      ensureCatalogColumns(this.store);
      if (this.store.get('product_catalog_v110_full_pull') !== '1') {
        this.store.set('cursor', '');
        this.store.set('product_catalog_v110_full_pull', '1');
      }
      return originalStart.apply(this, args);
    };
  }
}

module.exports = { installProductCatalogV110 };
