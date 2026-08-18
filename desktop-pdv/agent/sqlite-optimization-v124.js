const crypto = require('crypto');

function installSqliteOptimizationV124(Store) {
  const originalMigrate = Store.prototype.migrate;

  Store.prototype._pdvStatement = function (key, sql) {
    if (!this._pdvStatements) this._pdvStatements = new Map();
    if (!this._pdvStatements.has(key)) this._pdvStatements.set(key, this.db.prepare(sql));
    return this._pdvStatements.get(key);
  };

  Store.prototype.migrate = function () {
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -32768');
    this.db.pragma('wal_autocheckpoint = 1000');
    try { this.db.pragma('mmap_size = 134217728'); } catch {}
    originalMigrate.call(this);
    this.db.exec(`
      create index if not exists idx_products_active_name on products(active,name collate nocase);
      create index if not exists idx_products_active_sku on products(active,sku collate nocase);
      create index if not exists idx_customers_active_name on customers(active,name collate nocase);
      create index if not exists idx_customers_active_document on customers(active,document collate nocase);
      create index if not exists idx_queue_state_type_created on queue(state,type,created_at);
      create index if not exists idx_queue_type_created on queue(type,created_at);
      create index if not exists idx_receipts_created on receipts(created_at desc);
      create index if not exists idx_receipts_server_number on receipts(server_number);
      create index if not exists idx_server_sales_created on server_sales(created_at desc);
      create index if not exists idx_server_sales_status_created on server_sales(status,created_at desc);
    `);
    this._pdvStatements = new Map();
    const last = Number(this.get('sqlite_last_optimize_at', '0') || 0);
    if (!last || Date.now() - last > 86400000) {
      const started = Date.now();
      try {
        this.db.pragma('optimize');
        this.set('sqlite_last_optimize_at', String(Date.now()));
        this.metric('db.optimize', Date.now() - started, { mode: 'startup_daily' });
      } catch {}
    }
  };

  Store.prototype.get = function (key, fallback = '') {
    const row = this._pdvStatement('settings.get', 'select value from settings where key=?').get(key);
    return row ? row.value : fallback;
  };
  Store.prototype.set = function (key, value) {
    this._pdvStatement('settings.set', 'insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value')
      .run(key, String(value ?? ''));
  };
  Store.prototype.enqueue = function (event) {
    const now = new Date().toISOString();
    this._pdvStatement('queue.enqueue', "insert into queue(id,type,payload,state,attempts,created_at,updated_at) values(?,?,?,'pending',0,?,?)")
      .run(event.id, event.type, JSON.stringify(event.payload || {}), now, now);
    return event;
  };
  Store.prototype.adjustInventory = function (productId, delta) {
    this._pdvStatement('inventory.adjust', 'insert into inventory(product_id,quantity,reserved_quantity,updated_at) values(?,?,0,?) on conflict(product_id) do update set quantity=quantity+excluded.quantity,updated_at=excluded.updated_at')
      .run(productId, Number(delta), new Date().toISOString());
  };
  Store.prototype.saveReceipt = function (eventId, total, payload) {
    const id = crypto.randomUUID();
    this._pdvStatement('receipts.insert', 'insert into receipts(id,event_id,total,payload,created_at) values(?,?,?,?,?)')
      .run(id, eventId, total, JSON.stringify(payload), new Date().toISOString());
    this.set('last_receipt_id', id);
    return id;
  };
  Store.prototype.receiptByEvent = function (eventId) {
    const row = this._pdvStatement('receipts.by_event', 'select * from receipts where event_id=?').get(eventId);
    return row ? { ...row, payload: JSON.parse(row.payload) } : null;
  };
  Store.prototype.product = function (id) {
    const row = this._pdvStatement('products.by_id', 'select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id where p.id=?').get(id);
    return row ? this.inflateProduct(row) : null;
  };
  Store.prototype.promotions = function () {
    return this._pdvStatement('promotions.all', 'select * from promotions').all().map((row) => ({ ...row, rules: JSON.parse(row.rules || '{}') }));
  };
  Store.prototype.searchCustomers = function (query = '') {
    const q = `%${String(query).trim().toLowerCase()}%`;
    return this._pdvStatement('customers.search', "select * from customers where active=1 and (name like ? collate nocase or coalesce(document,'') like ? collate nocase) order by name collate nocase limit 30").all(q, q);
  };
  Store.prototype.searchProducts = function (query = '', limit = 50) {
    const started = Date.now();
    const q = String(query).trim().toLowerCase();
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 5000);
    let rows;
    if (!q) {
      rows = this._pdvStatement('products.active', 'select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id where p.active=1 order by p.name collate nocase limit ?').all(capped);
    } else {
      rows = this._pdvStatement('products.exact_prefix', `select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price
        from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id
        left join product_barcodes pb on pb.product_id=p.id
        where p.active=1 and (pb.barcode=? or p.sku=? collate nocase or p.name like ? collate nocase)
        group by p.id order by case when pb.barcode=? then 0 when p.sku=? collate nocase then 1 else 2 end,p.name collate nocase limit ?`).all(q, q, `${q}%`, q, q, capped);
      if (!rows.length && q.length >= 3) rows = this._pdvStatement('products.contains', 'select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id where p.active=1 and p.name like ? collate nocase order by p.name collate nocase limit ?').all(`%${q}%`, capped);
    }
    this.metric('db.search_products', Date.now() - started, { queryLength: q.length, rows: rows.length });
    return rows.map((row) => this.inflateProduct(row));
  };

  Store.prototype.commitSaleLocal = function ({ event, inventory = [], total, receipt }) {
    const started = Date.now();
    const transaction = this.db.transaction(() => {
      this.enqueue(event);
      for (const item of inventory) this.adjustInventory(item.productId, -Number(item.quantity || 0));
      this.saveReceipt(event.id, total, receipt);
    });
    transaction();
    this.metric('db.sale_commit', Date.now() - started, { items: inventory.length, total: Number(total || 0) });
    return event;
  };

  const previousFiscalSales = Store.prototype.fiscalSales;
  Store.prototype.fiscalSales = function (query = '') {
    const started = Date.now();
    const rows = previousFiscalSales.call(this, query);
    this.metric('fiscal.history_query', Date.now() - started, { queryLength:String(query || '').length, rows:rows.length });
    return rows;
  };
  const previousFiscalSale = Store.prototype.fiscalSale;
  Store.prototype.fiscalSale = function (key) {
    const started = Date.now();
    const row = previousFiscalSale.call(this, key);
    this.metric('fiscal.sale_detail', Date.now() - started, { found:Boolean(row) });
    return row;
  };

  Store.prototype.sqliteHealth = function () {
    return {
      journal_mode: this.db.pragma('journal_mode', { simple: true }),
      synchronous: this.db.pragma('synchronous', { simple: true }),
      busy_timeout: this.db.pragma('busy_timeout', { simple: true }),
      cache_size: this.db.pragma('cache_size', { simple: true }),
      foreign_keys: this.db.pragma('foreign_keys', { simple: true }),
    };
  };
}

module.exports = { installSqliteOptimizationV124 };
