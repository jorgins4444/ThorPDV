const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_SHORTCUTS = {
  cash: 'F7',
  pix: 'F8',
  debit_card: 'F9',
  credit_card: 'F10',
  voucher: 'F11',
};

class Store {
  constructor(dataDir) {
    this.dbPath=path.join(dataDir, 'thorpdv-local.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      create table if not exists settings(key text primary key,value text);
      create table if not exists products(
        id text primary key,sku text,name text not null,unit text,group_id text,sale_price real not null default 0,
        active integer not null default 1,barcodes text not null default '[]',updated_at text,
        production_mode text not null default 'stock',production_printer text not null default '',production_sector text not null default '',
        production_description text not null default '',auto_print_production integer not null default 1,production_yield real not null default 1,
        production_composition text not null default '[]'
      );
      create index if not exists idx_products_name on products(name collate nocase);
      create index if not exists idx_products_sku on products(sku collate nocase);
      create table if not exists product_barcodes(barcode text primary key,product_id text not null);
      create index if not exists idx_product_barcodes_product on product_barcodes(product_id);
      create table if not exists inventory(product_id text primary key,quantity real not null default 0,reserved_quantity real not null default 0,updated_at text);
      create table if not exists price_items(product_id text primary key,price real not null);
      create table if not exists promotions(id text primary key,name text,rules text not null,valid_from text,valid_to text,updated_at text);
      create table if not exists customers(id text primary key,name text not null,document text,email text,phone text,active integer not null default 1,updated_at text);
      create index if not exists idx_customers_name on customers(name);
      create table if not exists queue(id text primary key,type text not null,payload text not null,state text not null default 'pending',attempts integer not null default 0,last_error text,created_at text not null,updated_at text not null);
      create index if not exists idx_queue_state on queue(state,created_at);
      create table if not exists receipts(id text primary key,event_id text not null,total real not null,payload text not null,server_sale_id text,server_number text,created_at text not null);
      create index if not exists idx_receipts_event on receipts(event_id);
      create index if not exists idx_receipts_server_sale on receipts(server_sale_id);
      create table if not exists server_sales(id text primary key,client_event_id text,number text,status text,total real not null default 0,payload text not null,created_at text not null,updated_at text not null);
      create index if not exists idx_server_sales_number on server_sales(number);
      create index if not exists idx_server_sales_event on server_sales(client_event_id);
      create table if not exists performance_metrics(
        id integer primary key autoincrement,name text not null,duration_ms real not null,
        metadata text not null default '{}',created_at text not null
      );
      create index if not exists idx_performance_metrics_time on performance_metrics(created_at desc);
      create index if not exists idx_performance_metrics_name on performance_metrics(name,created_at desc);
    `);

    // Migração incremental para instalações anteriores sem apagar o SQLite do caixa.
    const cols = new Set(this.db.prepare('pragma table_info(products)').all().map((x) => x.name));
    const add = (name, definition) => { if (!cols.has(name)) this.db.exec(`alter table products add column ${name} ${definition}`); };
    add('production_mode', "text not null default 'stock'");
    add('production_printer', "text not null default ''");
    add('production_sector', "text not null default ''");
    add('production_description', "text not null default ''");
    add('auto_print_production', 'integer not null default 1');
    add('production_yield', 'real not null default 1');
    add('production_composition', "text not null default '[]'");
  }

  close() { this.db.close(); }
  metric(name,durationMs,metadata={}) {
    try {
      this.db.prepare('insert into performance_metrics(name,duration_ms,metadata,created_at) values(?,?,?,?)')
        .run(String(name),Math.max(0,Number(durationMs)||0),JSON.stringify(metadata||{}),new Date().toISOString());
      this.db.prepare('delete from performance_metrics where id in (select id from performance_metrics order by id desc limit -1 offset 5000)').run();
    } catch {}
  }
  recentMetrics(limit=200) {
    return this.db.prepare('select name,duration_ms,metadata,created_at from performance_metrics order by id desc limit ?').all(Math.min(Math.max(Number(limit)||200,1),1000)).map(row=>({...row,metadata:JSON.parse(row.metadata||'{}')}));
  }
  get(key, fallback = '') { const row = this.db.prepare('select value from settings where key=?').get(key); return row ? row.value : fallback; }
  set(key, value) { this.db.prepare('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value').run(key, String(value ?? '')); }

  settings() {
    let shortcuts = { ...DEFAULT_SHORTCUTS };
    try { shortcuts = { ...shortcuts, ...JSON.parse(this.get('payment_shortcuts', '{}') || '{}') }; } catch {}
    return {
      printerName: this.get('printer_name') || '',
      printMode: this.get('print_mode', 'ask') || 'ask',
      printDocument: this.get('print_document', 'ask') || 'ask',
      shortcuts,
    };
  }

  saveSettings(input = {}) {
    if (Object.prototype.hasOwnProperty.call(input, 'printerName')) this.set('printer_name', input.printerName || '');
    if (Object.prototype.hasOwnProperty.call(input, 'printMode')) this.set('print_mode', ['ask','direct','never'].includes(input.printMode) ? input.printMode : 'ask');
    if (Object.prototype.hasOwnProperty.call(input, 'printDocument')) this.set('print_document', ['ask','pre_sale','nfce'].includes(input.printDocument) ? input.printDocument : 'ask');
    if (input.shortcuts && typeof input.shortcuts === 'object') this.set('payment_shortcuts', JSON.stringify({ ...DEFAULT_SHORTCUTS, ...input.shortcuts }));
    return this.settings();
  }

  applyPull(data) {
    const tx = this.db.transaction(() => {
      const productStmt = this.db.prepare(`insert into products(
          id,sku,name,unit,group_id,sale_price,active,barcodes,updated_at,
          production_mode,production_printer,production_sector,production_description,auto_print_production,production_yield,production_composition
        ) values(
          @id,@sku,@name,@unit,@group_id,@sale_price,@active,@barcodes,@updated_at,
          @production_mode,@production_printer,@production_sector,@production_description,@auto_print_production,@production_yield,@production_composition
        )
        on conflict(id) do update set
          sku=excluded.sku,name=excluded.name,unit=excluded.unit,group_id=excluded.group_id,sale_price=excluded.sale_price,
          active=excluded.active,barcodes=excluded.barcodes,updated_at=excluded.updated_at,
          production_mode=excluded.production_mode,production_printer=excluded.production_printer,production_sector=excluded.production_sector,
          production_description=excluded.production_description,auto_print_production=excluded.auto_print_production,
          production_yield=excluded.production_yield,production_composition=excluded.production_composition`);
      for (const p of data.products || []) productStmt.run({
        id:p.id,
        sku:p.sku || '',
        name:p.name,
        unit:p.unit || 'UN',
        group_id:p.group_id || '',
        sale_price:Number(p.sale_price||0),
        active:p.active===false?0:1,
        barcodes:JSON.stringify(p.barcodes||[]),
        updated_at:p.updated_at||'',
        production_mode:String(p.production_mode||'stock'),
        production_printer:String(p.production_printer||''),
        production_sector:String(p.production_sector||''),
        production_description:String(p.production_description||''),
        auto_print_production:p.auto_print_production===false?0:1,
        production_yield:Number(p.production_yield||1),
        production_composition:JSON.stringify(p.composition||[]),
      });
      const barcodeDelete=this.db.prepare('delete from product_barcodes where product_id=?');
      const barcodeInsert=this.db.prepare('insert into product_barcodes(barcode,product_id) values(?,?) on conflict(barcode) do update set product_id=excluded.product_id');
      for(const p of data.products||[]){
        barcodeDelete.run(String(p.id));
        const codes=new Set([p.sku,...(p.barcodes||[])].map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
        for(const code of codes)barcodeInsert.run(code,String(p.id));
      }
      const stockStmt = this.db.prepare(`insert into inventory(product_id,quantity,reserved_quantity,updated_at) values(@product_id,@quantity,@reserved_quantity,@updated_at)
        on conflict(product_id) do update set quantity=excluded.quantity,reserved_quantity=excluded.reserved_quantity,updated_at=excluded.updated_at`);
      for (const i of data.inventory || []) stockStmt.run({ product_id:i.product_id, quantity:Number(i.quantity||0), reserved_quantity:Number(i.reserved_quantity||0), updated_at:i.updated_at||'' });
      const customerStmt = this.db.prepare(`insert into customers(id,name,document,email,phone,active,updated_at) values(@id,@name,@document,@email,@phone,@active,@updated_at)
        on conflict(id) do update set name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,active=excluded.active,updated_at=excluded.updated_at`);
      for (const c of data.customers || []) customerStmt.run({ id:c.id, name:c.name, document:c.document||'', email:c.email||'', phone:c.phone||'', active:c.active===false?0:1, updated_at:c.updated_at||'' });
      this.db.prepare('delete from price_items').run();
      const priceStmt = this.db.prepare('insert into price_items(product_id,price) values(?,?)');
      for (const p of data.price_items || []) priceStmt.run(p.product_id, Number(p.price||0));
      this.db.prepare('delete from promotions').run();
      const promoStmt = this.db.prepare('insert into promotions(id,name,rules,valid_from,valid_to,updated_at) values(?,?,?,?,?,?)');
      for (const p of data.promotions || []) promoStmt.run(p.id,p.name||'',JSON.stringify(p.rules||{}),p.valid_from||'',p.valid_to||'',p.updated_at||'');

      const saleStmt = this.db.prepare(`insert into server_sales(id,client_event_id,number,status,total,payload,created_at,updated_at) values(@id,@client_event_id,@number,@status,@total,@payload,@created_at,@updated_at)
        on conflict(id) do update set client_event_id=excluded.client_event_id,number=excluded.number,status=excluded.status,total=excluded.total,payload=excluded.payload,updated_at=excluded.updated_at`);
      const now = new Date().toISOString();
      for (const s of data.sales_history || []) saleStmt.run({ id:String(s.id), client_event_id:s.client_event_id?String(s.client_event_id):'', number:s.number==null?'':String(s.number), status:String(s.status||''), total:Number(s.total||0), payload:JSON.stringify(s), created_at:String(s.created_at||s.completed_at||now), updated_at:now });

      if (data.context) this.set('context', JSON.stringify(data.context));
      if (data.cursor) this.set('cursor', data.cursor);
    });
    tx();
  }

  searchProducts(query = '', limit = 50) {
    const started=Date.now();
    const q=String(query).trim().toLowerCase();
    const select=`select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price
      from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id`;
    let rows;
    if(!q) rows=this.db.prepare(`${select} where p.active=1 order by p.name collate nocase limit ?`).all(limit);
    else {
      rows=this.db.prepare(`${select} left join product_barcodes pb on pb.product_id=p.id
        where p.active=1 and (pb.barcode=? or p.sku=? collate nocase or p.name like ? collate nocase)
        group by p.id order by case when pb.barcode=? then 0 when p.sku=? collate nocase then 1 else 2 end,p.name collate nocase limit ?`)
        .all(q,q,`${q}%`,q,q,limit);
      if(!rows.length&&q.length>=3) rows=this.db.prepare(`${select} where p.active=1 and p.name like ? collate nocase order by p.name collate nocase limit ?`).all(`%${q}%`,limit);
    }
    this.metric('search.products',Date.now()-started,{queryLength:q.length,rows:rows.length});
    return rows.map(this.inflateProduct);
  }

  inflateProduct(row) { return { ...row, barcodes: JSON.parse(row.barcodes || '[]') }; }
  product(id) { const row=this.db.prepare(`select p.*,coalesce(i.quantity,0) quantity,coalesce(pi.price,p.sale_price) base_price from products p left join inventory i on i.product_id=p.id left join price_items pi on pi.product_id=p.id where p.id=?`).get(id); return row?this.inflateProduct(row):null; }
  promotions() { return this.db.prepare('select * from promotions').all().map((p)=>({ ...p, rules:JSON.parse(p.rules||'{}') })); }
  searchCustomers(query='') { const q=`%${String(query).trim().toLowerCase()}%`; return this.db.prepare(`select * from customers where active=1 and (lower(name) like ? or lower(coalesce(document,'')) like ?) order by name limit 30`).all(q,q); }
  adjustInventory(productId, delta) { this.db.prepare(`insert into inventory(product_id,quantity,reserved_quantity,updated_at) values(?,?,0,?) on conflict(product_id) do update set quantity=quantity+excluded.quantity,updated_at=excluded.updated_at`).run(productId,Number(delta),new Date().toISOString()); }

  enqueue(event) { const now=new Date().toISOString(); this.db.prepare('insert into queue(id,type,payload,state,attempts,created_at,updated_at) values(?,?,?,\'pending\',0,?,?)').run(event.id,event.type,JSON.stringify(event.payload||{}),now,now); return event; }
  pending(limit=100) { return this.db.prepare(`select * from queue where state='pending' order by created_at,rowid limit ?`).all(limit).map((q)=>({ id:q.id,type:q.type,payload:JSON.parse(q.payload),attempts:q.attempts })); }
  markProcessed(id,result) { this.db.prepare(`update queue set state='synced',last_error=null,updated_at=? where id=?`).run(new Date().toISOString(),id); if (result?.sale_id) this.db.prepare('update receipts set server_sale_id=coalesce(server_sale_id,?),server_number=case when ?<>\'\' then ? else server_number end where event_id=?').run(String(result.sale_id),String(result.number||''),String(result.number||''),id); }
  markRejected(id,error) { this.db.prepare(`update queue set state='rejected',attempts=attempts+1,last_error=?,updated_at=? where id=?`).run(String(error||'rejected'),new Date().toISOString(),id); }
  markRetry(id,error) { this.db.prepare(`update queue set attempts=attempts+1,last_error=?,updated_at=? where id=?`).run(String(error||'sync_error'),new Date().toISOString(),id); }
  queueStats() { return this.db.prepare(`select state,count(*) count from queue group by state`).all().reduce((a,r)=>(a[r.state]=r.count,a),{pending:0,rejected:0,synced:0}); }

  saveReceipt(eventId,total,payload) { const id=crypto.randomUUID(); this.db.prepare('insert into receipts(id,event_id,total,payload,created_at) values(?,?,?,?,?)').run(id,eventId,total,JSON.stringify(payload),new Date().toISOString()); this.set('last_receipt_id',id); return id; }
  lastReceipt() { const id=this.get('last_receipt_id'); const row=id?this.db.prepare('select * from receipts where id=?').get(id):null; return row?{...row,payload:JSON.parse(row.payload)}:null; }
  receiptByEvent(eventId) { const row=this.db.prepare('select * from receipts where event_id=?').get(eventId); return row?{...row,payload:JSON.parse(row.payload)}:null; }

  fiscalSales(query='') {
    const q=String(query||'').trim().toLowerCase();
    const serverRows=this.db.prepare('select * from server_sales order by datetime(created_at) desc limit 250').all().map(r=>JSON.parse(r.payload));
    const byKey=new Map(serverRows.map(s=>[String(s.id),{...s,source:'server'}]));
    const eventKeys=new Set(serverRows.map(s=>String(s.client_event_id||'')).filter(Boolean));
    const localRows=this.db.prepare('select * from receipts order by datetime(created_at) desc limit 250').all();
    for(const r of localRows){
      if(r.server_sale_id && byKey.has(String(r.server_sale_id))) continue;
      if(eventKeys.has(String(r.event_id))) continue;
      const p=JSON.parse(r.payload||'{}');
      byKey.set(`local:${r.event_id}`,{
        id:r.server_sale_id||null,
        local_key:`local:${r.event_id}`,
        client_event_id:r.event_id,
        number:r.server_number||null,
        status:p.local_status||'pending_sync',
        subtotal:p.subtotal||p.total||0,
        discount:p.discount||0,
        total:r.total,
        created_at:r.created_at,
        completed_at:p.createdAt||r.created_at,
        customer_name:'',
        items:p.items||[],
        payments:p.payments||[],
        operator:p.operator||null,
        seller:p.seller||null,
        seller_user_id:p.seller_user_id||null,
        seller_name:p.seller_name||'',
        fiscal:p.fiscal||null,
        returned_total:Number(p.returned_total||0),
        source:'local',
      });
    }
    let rows=[...byKey.values()].sort((a,b)=>new Date(b.completed_at||b.created_at||0)-new Date(a.completed_at||a.created_at||0));
    if(q) rows=rows.filter(s=>[s.number,s.customer_name,s.id,s.client_event_id,s.status,s.fiscal?.access_key].some(v=>String(v||'').toLowerCase().includes(q)));
    return rows.slice(0,250);
  }

  fiscalSale(key) {
    const raw=String(key||'');
    const lookup=raw.startsWith('local:')?raw.slice(6):raw;
    const server=this.db.prepare('select payload from server_sales where id=? or client_event_id=? or number=? limit 1').get(lookup,lookup,lookup);
    if(server) return {...JSON.parse(server.payload),source:'server'};
    const r=this.db.prepare('select * from receipts where event_id=? or id=? or server_sale_id=? or server_number=? limit 1').get(lookup,lookup,lookup,lookup);
    if(!r) return null;
    const p=JSON.parse(r.payload||'{}');
    return {id:r.server_sale_id||null,local_key:`local:${r.event_id}`,client_event_id:r.event_id,number:r.server_number||null,status:p.local_status||'pending_sync',subtotal:p.subtotal||p.total||0,discount:p.discount||0,total:r.total,created_at:r.created_at,completed_at:p.createdAt||r.created_at,items:p.items||[],payments:p.payments||[],operator:p.operator||null,seller:p.seller||null,seller_user_id:p.seller_user_id||null,seller_name:p.seller_name||'',fiscal:p.fiscal||null,returned_total:Number(p.returned_total||0),source:'local'};
  }

  patchLocalSale(sale, patch) {
    if(!sale) return;
    if(sale.source==='local' || !sale.id){
      const r=this.receiptByEvent(String(sale.client_event_id||''));
      if(!r) return;
      const payload={...r.payload,...patch};
      this.db.prepare('update receipts set payload=? where event_id=?').run(JSON.stringify(payload),r.event_id);
      return;
    }
    const row=this.db.prepare('select payload from server_sales where id=?').get(String(sale.id));
    if(!row) return;
    const payload={...JSON.parse(row.payload),...patch};
    this.db.prepare('update server_sales set status=?,total=?,payload=?,updated_at=? where id=?').run(String(payload.status||sale.status||''),Number(payload.total||sale.total||0),JSON.stringify(payload),new Date().toISOString(),String(sale.id));
  }
}

module.exports = { Store, DEFAULT_SHORTCUTS };
