'use strict';

const crypto = require('crypto');

const trim = (v, max = 250) => String(v ?? '').trim().slice(0, max);
const digits = v => String(v ?? '').replace(/\D/g, '');
const numeric = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('invalid_' + label);
  return n;
};
function validCpf(input) {
  const value = digits(input);
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const check = length => {
    const sum = [...value.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return check(9) === Number(value[9]) && check(10) === Number(value[10]);
}
function validCnpj(input) {
  const value = digits(input);
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const check = (length, weights) => {
    const sum = [...value.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return check(12, [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(value[12])
    && check(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(value[13]);
}

function installCatalogLocalFirstV0930(ThorAgent, Store) {
  if (Store.prototype.__catalogLocalFirstV0930) return;
  Store.prototype.__catalogLocalFirstV0930 = true;
  const migrate = Store.prototype.migrate;
  Store.prototype.migrate = function(...args) {
    const result = migrate.apply(this, args);
    const customerColumns = new Set(this.db.prepare('pragma table_info(customers)').all().map(row => row.name));
    if (!customerColumns.has('type')) this.db.exec("alter table customers add column type text not null default 'PF'");
    const productColumns = new Set(this.db.prepare('pragma table_info(products)').all().map(row => row.name));
    if (!productColumns.has('category_name')) this.db.exec("alter table products add column category_name text not null default ''");
    this.db.exec(`
      create table if not exists catalog_outbox (
        event_id text primary key, kind text not null, payload text not null,
        state text not null default 'pending', error text,
        attempts integer not null default 0,
        created_at text not null, updated_at text not null
      );
      create index if not exists catalog_outbox_state_time
        on catalog_outbox(state,created_at);
    `);
    return result;
  };

  Store.prototype.catalogOutbox = function(limit=50) {
    return this.db.prepare("select * from catalog_outbox where state in ('pending','retry') order by created_at,rowid limit ?")
      .all(limit).map(row => ({...row,payload:JSON.parse(row.payload)}));
  };
  Store.prototype.catalogHistory = function(limit=50) {
    return this.db.prepare('select event_id,kind,state,error,attempts,created_at,updated_at from catalog_outbox order by created_at desc,rowid desc limit ?').all(limit);
  };
  Store.prototype.catalogSetState = function(eventId, state, error='') {
    this.db.prepare('update catalog_outbox set state=?,error=?,attempts=attempts+1,updated_at=? where event_id=?')
      .run(state,trim(error,240),new Date().toISOString(),eventId);
  };

  Store.prototype.catalogApplyLocal = function(kind, input) {
    const eventId = crypto.randomUUID();
    const id = trim(input.id || crypto.randomUUID(), 80);
    const now = new Date().toISOString();
    const payload = {...input,id,operator_user_id:String(input.operator_user_id||'')};
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid_record_id');
    const save = this.db.transaction(() => {
      if (kind === 'customer_save') {
        payload.name = trim(input.name,240);
        payload.document = digits(input.document);
        payload.type = input.type === 'PJ' ? 'PJ' : 'PF';
        payload.email = trim(input.email,240);
        payload.phone = trim(input.phone,40);
        if (!payload.name) throw new Error('customer_name_required');
        if (payload.document && !(payload.type === 'PJ' ? validCnpj(payload.document) : validCpf(payload.document))) {
          throw new Error('invalid_document');
        }
        const duplicate = payload.document && this.db.prepare('select id from customers where document=? and id<>?').get(payload.document,id);
        if (duplicate) throw new Error('document_already_registered');
        this.db.prepare(`insert into customers(id,name,document,email,phone,active,updated_at,type)
          values(?,?,?,?,?,1,?,?)
          on conflict(id) do update set name=excluded.name,document=excluded.document,
            email=excluded.email,phone=excluded.phone,type=excluded.type,updated_at=excluded.updated_at`)
          .run(id,payload.name,payload.document,payload.email,payload.phone,now,payload.type);
      } else if (kind === 'product_create') {
        payload.name = trim(input.name,240);
        payload.unit = trim(input.unit||'UN',4).toUpperCase();
        payload.category = trim(input.category,150);
        payload.ncm = digits(input.ncm);
        payload.cost_price = numeric(input.cost_price,'cost_price');
        payload.sale_price = numeric(input.sale_price,'sale_price');
        payload.sku = 'LOC-' + id.slice(0,8);
        if (!payload.name) throw new Error('product_name_required');
        if (!['UN','KG','G','L','ML','CX','PC','FD','MT'].includes(payload.unit)) throw new Error('invalid_unit');
        if (payload.ncm && !/^\d{8}$/.test(payload.ncm)) throw new Error('invalid_ncm');
        if (payload.cost_price<0 || payload.sale_price<0) throw new Error('invalid_price');
        this.db.prepare(`insert into products(
          id,sku,name,unit,group_id,sale_price,active,barcodes,updated_at,cost_price,ncm,category_name
        ) values(?,?,?,?,?, ?,1,'[]',?,?,?,?)`)
          .run(id,payload.sku,payload.name,payload.unit,'',payload.sale_price,now,payload.cost_price,payload.ncm,payload.category);
        this.db.prepare('insert or ignore into product_barcodes(barcode,product_id) values(?,?)').run(payload.sku.toLowerCase(),id);
      } else if (kind === 'product_price') {
        payload.sale_price = numeric(input.sale_price,'sale_price');
        if (payload.sale_price<0) throw new Error('invalid_price');
        const updated = this.db.prepare('update products set sale_price=?,updated_at=? where id=?')
          .run(payload.sale_price,now,id);
        if (!updated.changes) throw new Error('product_not_found');
        // The default price table takes precedence over products.sale_price in the sale screen.
        this.db.prepare('update price_items set price=? where product_id=?').run(payload.sale_price,id);
      } else if (kind === 'stock_adjust') {
        payload.delta = numeric(input.delta,'quantity');
        payload.reason = trim(input.reason,180);
        if (!payload.delta || Math.abs(payload.delta)>9999999) throw new Error('invalid_quantity');
        if (!payload.reason) throw new Error('reason_required');
        if (!this.db.prepare('select id from products where id=?').get(id)) throw new Error('product_not_found');
        const stock = this.db.prepare('select quantity from inventory where product_id=?').get(id);
        const next = Number(stock?.quantity||0) + payload.delta;
        if (next < 0) throw new Error('insufficient_stock');
        this.db.prepare(`insert into inventory(product_id,quantity,reserved_quantity,updated_at)
          values(?,?,0,?) on conflict(product_id) do update set quantity=excluded.quantity,updated_at=excluded.updated_at`)
          .run(id,next,now);
      } else throw new Error('unsupported_catalog_action');
      this.db.prepare(`insert into catalog_outbox(event_id,kind,payload,state,attempts,created_at,updated_at)
        values(?,?,?,'pending',0,?,?)`).run(eventId,kind,JSON.stringify(payload),now,now);
    });
    save();
    return {ok:true,id,event_id:eventId,state:'pending',message:'Salvo no caixa; sincronização pendente.'};
  };

  const originalApplyPull = Store.prototype.applyPull;
  Store.prototype.applyPull = function(data) {
    const result = originalApplyPull.call(this,data);
    // Preserve optimistic edits until confirmed by the authoritative server.
    const pending = this.catalogOutbox(1000);
    const tx = this.db.transaction(() => {
      for (const entry of pending) {
        const p = entry.payload;
        const now = entry.created_at;
        if (entry.kind==='customer_save') {
          this.db.prepare(`insert into customers(id,name,document,email,phone,active,updated_at,type)
            values(?,?,?,?,?,1,?,?) on conflict(id) do update set
            name=excluded.name,document=excluded.document,email=excluded.email,
            phone=excluded.phone,type=excluded.type,updated_at=excluded.updated_at`)
            .run(p.id,p.name,p.document||'',p.email||'',p.phone||'',now,p.type||'PF');
        } else if (entry.kind==='product_create') {
          const found=this.db.prepare('select id from products where id=?').get(p.id);
          if (!found) this.db.prepare(`insert into products(id,sku,name,unit,group_id,sale_price,active,barcodes,updated_at,cost_price,ncm,category_name)
            values(?,?,?,?,?, ?,1,'[]',?,?,?,?)`)
            .run(p.id,p.sku,p.name,p.unit,'',p.sale_price,now,p.cost_price,p.ncm,p.category||'');
        } else if (entry.kind==='product_price') {
          this.db.prepare('update products set sale_price=? where id=?').run(p.sale_price,p.id);
          this.db.prepare('update price_items set price=? where product_id=?').run(p.sale_price,p.id);
        } else if (entry.kind==='stock_adjust') {
          // Inventory is server-authoritative. An optimistic stock delta must not be
          // applied twice. A pending adjustment is only replayed if server pull
          // carried a fresh balance for its product; otherwise retain local value.
          if ((data.inventory||[]).some(i=>String(i.product_id)===String(p.id))) {
            this.db.prepare('update inventory set quantity=quantity+? where product_id=?').run(p.delta,p.id);
          }
        }
      }
    });
    tx();
    return result;
  };

  const agent = ThorAgent.prototype;
  agent.catalogLocalSave = function(kind,input={}) {
    const paths = {customer_save:'customer.create',product_create:'product.create',product_price:'product.price_edit',stock_adjust:'stock.adjust'};
    const permission = paths[kind];
    if (!permission) throw new Error('unsupported_catalog_action');
    if (!this._profileAllows?.(permission,false)) throw new Error('permission_denied');
    const operator = this.currentOperator?.();
    if (!operator?.id) throw new Error('operator_required');
    const result = this.store.catalogApplyLocal(kind,{...input,operator_user_id:operator.id});
    setTimeout(()=>this.flushCatalogOutbox().catch(()=>{}),300);
    return result;
  };
  agent.catalogOutboxStatus = function() { return this.store.catalogHistory(100); };
  agent.flushCatalogOutbox = async function() {
    if (this._catalogFlushing) return {ok:false,error:'sync_in_progress'};
    if (!this.deviceToken?.()) return {ok:false,error:'device_not_enrolled'};
    this._catalogFlushing = true;
    let done=0,failed=0;
    try {
      const items = this.store.catalogOutbox(50);
      for (const row of items) {
        try {
          const result=await this.sync.request('/api/pdv/catalog-mutation', {
            event_id:row.event_id,kind:row.kind,payload:row.payload,
          });
          if (result?.ok) {
            this.store.catalogSetState(row.event_id,'synced','');
            done++;
          } else {
            this.store.catalogSetState(row.event_id,'rejected',result?.error||'server_rejected');
            failed++;
            // A dependent operation cannot be sent until the previous one is resolved.
            break;
          }
        } catch(error) {
          this.store.catalogSetState(row.event_id,'retry',String(error?.message||'connection_failed'));
          failed++;
          break;
        }
      }
    } finally { this._catalogFlushing=false; }
    if (done && !this.sync.running) {
      this.store.set('cursor','');
      void this.sync.run(true).catch(()=>{});
    }
    return {ok:failed===0,done,failed};
  };
  const oldStart=agent.start;
  agent.start=async function(...args) {
    const result=await oldStart.apply(this,args);
    clearInterval(this._catalogInterval);
    this._catalogInterval=setInterval(()=>this.flushCatalogOutbox().catch(()=>{}),30000);
    this._catalogInterval.unref?.();
    setTimeout(()=>this.flushCatalogOutbox().catch(()=>{}),1500);
    return result;
  };
  const oldStop=agent.stop;
  agent.stop=async function(...args) {
    clearInterval(this._catalogInterval);
    return oldStop.apply(this,args);
  };
}

module.exports={installCatalogLocalFirstV0930,validCpf,validCnpj};
