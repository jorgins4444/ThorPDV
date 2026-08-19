const { Store } = require('./store');

function parse(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function patchReceipt(db, eventId, patch) {
  const row = db.prepare('select payload from receipts where event_id=?').get(String(eventId || ''));
  if (!row) return;
  const payload = { ...parse(row.payload, {}), ...patch };
  db.prepare('update receipts set payload=? where event_id=?').run(JSON.stringify(payload), String(eventId));
}

function onDemandComponentDeltas(store, productId, soldQuantity) {
  const product = store.product(String(productId || ''));
  if (!product || String(product.production_mode || 'stock') !== 'on_demand') return null;
  const list = parse(product.production_composition, []);
  const yieldQty = Math.max(Number(product.production_yield || 1), 0.000001);
  const factor = Math.abs(Number(soldQuantity || 0)) / yieldQty;
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && c.deduct_stock !== false && c.component_product_id)
    .map((c) => ({
      productId: String(c.component_product_id),
      quantity: Math.abs(Number(c.quantity || 0) * (1 + Math.max(Number(c.waste_percent || 0), 0) / 100) * factor),
    }))
    .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);
}

function pendingInventoryDeltas(store) {
  const deltas = new Map();
  const add = (productId, qty) => {
    if (!productId || !Number.isFinite(Number(qty))) return;
    const key = String(productId);
    deltas.set(key, (deltas.get(key) || 0) + Number(qty));
  };

  const events = store.db.prepare(`
    select id,type,payload,state
    from queue
    where state in ('pending','rejected')
      and type in ('sale_completed','sale_return','sale_cancel')
    order by datetime(created_at),rowid
  `).all();

  for (const event of events) {
    const payload = parse(event.payload, {});
    if (event.type === 'sale_completed') {
      for (const item of payload.items || []) {
        const components = onDemandComponentDeltas(store, item.product_id, item.quantity);
        if (components) {
          for (const component of components) add(component.productId, -component.quantity);
        } else {
          add(item.product_id, -Math.abs(Number(item.quantity || 0)));
        }
      }
      continue;
    }
    if (event.type === 'sale_return') {
      // Devolução de item preparado sob demanda é financeira e não recompõe produto acabado/insumos.
      for (const item of payload.items || []) {
        const product = store.product(String(item.product_id || ''));
        if (product && String(product.production_mode || 'stock') === 'on_demand') continue;
        add(item.product_id, Math.abs(Number(item.quantity || 0)));
      }
      continue;
    }
    if (event.type === 'sale_cancel') {
      const sourceEventId = payload.sale_client_event_id || '';
      let receipt = sourceEventId ? store.db.prepare('select payload from receipts where event_id=?').get(String(sourceEventId)) : null;
      if (!receipt && payload.sale_id) {
        const sale = store.db.prepare('select payload from server_sales where id=?').get(String(payload.sale_id));
        if (sale) receipt = sale;
      }
      const original = parse(receipt?.payload, {});
      for (const item of original.items || []) {
        const product = store.product(String(item.product_id || ''));
        if (product && String(product.production_mode || 'stock') === 'on_demand') continue;
        add(item.product_id, Math.abs(Number(item.quantity || 0)));
      }
    }
  }
  return deltas;
}

function installDataConsistency(ThorAgent) {
  if (!Store.prototype.__thorConsistencyInstalled) {
    Object.defineProperty(Store.prototype, '__thorConsistencyInstalled', { value: true });

    const originalProcessed = Store.prototype.markProcessed;
    Store.prototype.markProcessed = function (id, result) {
      originalProcessed.call(this, id, result);
      patchReceipt(this.db, id, { local_status: 'synced', sync_error: null, synced_at: new Date().toISOString() });
    };

    const originalRejected = Store.prototype.markRejected;
    Store.prototype.markRejected = function (id, error) {
      originalRejected.call(this, id, error);
      patchReceipt(this.db, id, { local_status: 'rejected', sync_error: String(error || 'rejected') });
    };

    const originalRetry = Store.prototype.markRetry;
    Store.prototype.markRetry = function (id, error) {
      originalRetry.call(this, id, error);
      patchReceipt(this.db, id, { local_status: 'pending_sync', sync_error: String(error || 'sync_error') });
    };

    const originalApplyPull = Store.prototype.applyPull;
    Store.prototype.applyPull = function (data) {
      originalApplyPull.call(this, data);

      // Se o servidor já devolveu a venda, confirma a fila local mesmo que a resposta do push tenha se perdido.
      const reconciled = this.db.prepare(`
        select q.id,s.id sale_id,s.number
        from queue q
        join server_sales s on s.client_event_id=q.id
        where q.type='sale_completed' and q.state in ('pending','rejected')
      `).all();
      for (const row of reconciled) this.markProcessed(row.id, { sale_id: row.sale_id, number: row.number });

      // Um pull completo não pode apagar do saldo local as vendas ainda não sincronizadas.
      // Para produtos sob demanda, a pendência corresponde aos ingredientes da ficha técnica.
      const pulledIds = new Set((data.inventory || []).map((item) => String(item.product_id || '')).filter(Boolean));
      if (pulledIds.size) {
        const deltas = pendingInventoryDeltas(this);
        const update = this.db.prepare('update inventory set quantity=quantity+?,updated_at=? where product_id=?');
        const now = new Date().toISOString();
        for (const [productId, delta] of deltas.entries()) {
          if (pulledIds.has(productId) && Math.abs(delta) > 0.0000001) update.run(delta, now, productId);
        }
      }
    };

    Store.prototype.inventorySyncDiagnostics = function () {
      const deltas = pendingInventoryDeltas(this);
      return [...deltas.entries()].map(([product_id, pending_delta]) => ({ product_id, pending_delta }));
    };
  }

  ThorAgent.prototype.syncNow = function () {
    return this.sync.run(true);
  };

  const originalStatus = ThorAgent.prototype.status;
  ThorAgent.prototype.status = async function () {
    const status = await originalStatus.call(this);
    return {
      ...status,
      syncHealth: {
        consecutiveFailures: Number(this.sync.failures || 0),
        backoffUntil: this.sync.backoffUntil ? new Date(this.sync.backoffUntil).toISOString() : null,
        lastPushAt: this.store.get('last_push_at') || null,
        lastPullAt: this.store.get('last_pull_at') || null,
        lastHeartbeatAt: this.store.get('last_heartbeat_at') || null,
        pendingInventoryDeltas: this.store.inventorySyncDiagnostics(),
      },
    };
  };
}

module.exports = { installDataConsistency };
