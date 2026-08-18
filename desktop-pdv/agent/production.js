const hardware = require('./hardware');
const { BackgroundTaskQueue } = require('./background-queue');
const productionQueues = new WeakMap();

function ensureColumns(db) {
  const cols = new Set(db.prepare('pragma table_info(products)').all().map((x) => x.name));
  const add = (name, type, def = '') => { if (!cols.has(name)) db.exec(`alter table products add column ${name} ${type}${def ? ` default ${def}` : ''}`); };
  add('production_mode', 'text', "'stock'");
  add('production_printer', 'text', "''");
  add('production_sector', 'text', "''");
  add('production_description', 'text', "''");
  add('auto_print_production', 'integer', '1');
  add('production_yield', 'real', '1');
  add('production_composition', 'text', "'[]'");
}

function composition(product) {
  try { return JSON.parse(product?.production_composition || '[]'); } catch { return []; }
}

function componentDeltas(product, soldQuantity) {
  const yieldQty = Math.max(Number(product?.production_yield || 1), 0.000001);
  const factor = Number(soldQuantity || 0) / yieldQty;
  return composition(product)
    .filter((c) => c && c.deduct_stock !== false && c.component_product_id)
    .map((c) => ({
      productId: String(c.component_product_id),
      quantity: Math.abs(Number(c.quantity || 0) * (1 + Math.max(Number(c.waste_percent || 0), 0) / 100) * factor),
    }))
    .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);
}

function kitchenText({ eventId, context, operator, product, item, notes }) {
  const lines = [];
  lines.push('THORPDV - ORDEM DE PRODUCAO');
  lines.push(String(context.branch_name || context.company_name || ''));
  lines.push('==========================================');
  lines.push(`PEDIDO: ${String(eventId || '').slice(0, 8).toUpperCase()}`);
  lines.push(`DATA: ${new Date().toLocaleString('pt-BR')}`);
  if (operator?.name) lines.push(`OPERADOR: ${operator.name}`);
  if (product.production_sector) lines.push(`SETOR: ${product.production_sector}`);
  lines.push('------------------------------------------');
  lines.push(`${Number(item.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} x ${product.name || item.name || 'ITEM'}`);
  if (product.production_description) {
    lines.push('');
    lines.push('PREPARO / OBSERVACAO DO PRODUTO:');
    lines.push(String(product.production_description));
  }
  if (notes) {
    lines.push('');
    lines.push('OBSERVACAO DO PEDIDO:');
    lines.push(String(notes));
  }
  lines.push('==========================================');
  lines.push('\n\n\n');
  return lines.join('\n');
}

function installProductionPrinting(ThorAgent) {
  const originalStart = ThorAgent.prototype.start;
  const originalFinalize = ThorAgent.prototype.finalizeSale;
  const originalCancel = ThorAgent.prototype.cancelSale;
  const originalReturn = ThorAgent.prototype.returnSale;

  ThorAgent.prototype.start = async function (...args) {
    ensureColumns(this.store.db);
    if (!this.store.__productionPullWrapped) {
      const originalApply = this.store.applyPull.bind(this.store);
      this.store.applyPull = (data) => {
        originalApply(data);
        ensureColumns(this.store.db);
        const stmt = this.store.db.prepare(`update products set production_mode=?,production_printer=?,production_sector=?,production_description=?,auto_print_production=?,production_yield=?,production_composition=? where id=?`);
        const tx = this.store.db.transaction(() => {
          for (const p of data.products || []) stmt.run(
            String(p.production_mode || 'stock'),
            String(p.production_printer || ''),
            String(p.production_sector || ''),
            String(p.production_description || ''),
            p.auto_print_production === false ? 0 : 1,
            Number(p.production_yield || 1),
            JSON.stringify(p.composition || []),
            String(p.id),
          );
        });
        tx();
      };
      this.store.__productionPullWrapped = true;
    }
    return originalStart.apply(this, args);
  };

  ThorAgent.prototype.finalizeSale = async function (payload) {
    const result = await originalFinalize.call(this, payload);
    const operator = this.currentOperator?.() || null;
    const context = (() => { try { return JSON.parse(this.store.get('context', '{}') || '{}'); } catch { return {}; } })();
    const outputs = [];
    for (const item of result.receipt?.items || []) {
      const product = this.store.product(String(item.product_id || ''));
      if (!product || String(product.production_mode || 'stock') !== 'on_demand') continue;

      // O produto final é preparado para a venda: neutraliza a baixa do estoque acabado
      // feita pelo fluxo comum e baixa localmente os componentes da ficha técnica.
      this.store.adjustInventory(String(item.product_id), Number(item.quantity || 0));
      for (const delta of componentDeltas(product, item.quantity)) this.store.adjustInventory(delta.productId, -delta.quantity);

      if (Number(product.auto_print_production ?? 1) !== 1) {
        outputs.push({ productId: product.id, productName: product.name, skipped: true, reason: 'auto_print_disabled' });
        continue;
      }
      const printer = String(product.production_printer || '').trim();
      if (!printer) {
        outputs.push({ productId: product.id, productName: product.name, ok: false, error: 'production_printer_not_configured' });
        continue;
      }
      let queue=productionQueues.get(this);
      if(!queue){
        queue=new BackgroundTaskQueue({concurrency:2,metric:(name,duration,metadata)=>this.store.metric(name,duration,metadata)});
        productionQueues.set(this,queue);
      }
      const content=kitchenText({eventId:result.eventId,context,operator,product,item,notes:payload?.notes||''});
      const queued=queue.add('print.production',()=>hardware.printText(printer,content),{printer,productId:product.id,eventId:result.eventId});
      outputs.push({productId:product.id,productName:product.name,printer,queued:true,queueId:queued.id});
    }
    return { ...result, productionPrints: outputs };
  };

  ThorAgent.prototype.cancelSale = async function (payload) {
    const sale = payload?.saleKey ? this.fiscalSale(payload.saleKey) : null;
    const onDemand = (sale?.items || []).filter((item) => {
      const product = this.store.product(String(item.product_id || ''));
      return product && String(product.production_mode || 'stock') === 'on_demand';
    }).map((item) => ({ productId: String(item.product_id), quantity: Number(item.quantity || 0) }));
    const result = await originalCancel.call(this, payload);
    // O cancelamento comum adiciona o item vendido de volta ao estoque local.
    // Para item preparado sob demanda isso seria incorreto, então neutralizamos.
    for (const item of onDemand) this.store.adjustInventory(item.productId, -Math.abs(item.quantity));
    return result;
  };

  ThorAgent.prototype.returnSale = async function (payload) {
    const sale = payload?.saleKey ? this.fiscalSale(payload.saleKey) : null;
    const onDemandReturns = [];
    for (const requested of payload?.items || []) {
      const original = (sale?.items || []).find((item) => String(item.sale_item_id || item.product_id) === String(requested.sale_item_id || requested.product_id));
      if (!original?.product_id) continue;
      const product = this.store.product(String(original.product_id));
      if (product && String(product.production_mode || 'stock') === 'on_demand') onDemandReturns.push({ productId: String(original.product_id), quantity: Math.abs(Number(requested.quantity || 0)) });
    }
    const result = await originalReturn.call(this, payload);
    // Devolução financeira de alimento preparado não cria estoque de produto acabado.
    for (const item of onDemandReturns) this.store.adjustInventory(item.productId, -item.quantity);
    return result;
  };
}

module.exports = { installProductionPrinting, componentDeltas };
