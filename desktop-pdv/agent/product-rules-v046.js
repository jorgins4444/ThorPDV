const { installCustomerCreditRules } = require('./customer-credit-v050');
const { installScaleLabelRules } = require('./scale-label-v060');

function normalizedWeighableQuantity(product, value) {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return quantity;
  const unit = String(product?.unit || '').trim().toUpperCase();
  const weighable = Boolean(product?.is_weighable) || Boolean(product?.fractioned) || Boolean(product?.label_scale);
  const stock = Math.max(Number(product?.quantity || 0), 0);
  const kilograms = Math.round((quantity / 1000) * 1000) / 1000;
  if (weighable && unit === 'KG' && Number.isInteger(quantity) && quantity >= 50 && stock > 0 && quantity > stock + 0.0001 && kilograms > 0 && kilograms <= stock + 0.0001) return kilograms;
  return quantity;
}

function allowNegativeStock(agent) {
  try {
    const context = JSON.parse(agent.store.get('context', '{}') || '{}');
    return context?.pdv_parameters?.allow_negative_stock === true || context?.allow_negative_stock === true;
  } catch { return false; }
}

function installProductRules(ThorAgent, Store) {
  if (ThorAgent.prototype.__productRulesV046) return;
  ThorAgent.prototype.__productRulesV046 = true;
  installCustomerCreditRules(ThorAgent, Store);
  installScaleLabelRules(ThorAgent, Store);
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
        stmt.run(weighable ? 1 : 0,(weighable || product.fractioned === true) ? 1 : 0,product.prompt_quantity === true ? 1 : 0,product.allow_discount === false ? 0 : 1,String(product.id));
      }
    });
    tx();
  };

  Store.prototype.inflateProduct = function (row) {
    const product = originalInflateProduct.call(this, row);
    return {...product,is_weighable:Boolean(product.is_weighable),fractioned:Boolean(product.is_weighable)||Boolean(product.fractioned),prompt_quantity:Boolean(product.prompt_quantity),allow_discount:product.allow_discount!==0,label_scale:Boolean(product.label_scale),product_code:Number(product.product_code||0)};
  };

  ThorAgent.prototype.quoteSale = function (items = [], discount = 0) {
    const normalized = (Array.isArray(items) ? items : []).map((item) => {
      const product = this.store.product(item.productId);
      if (!product || !product.active) return item;
      const quantity = normalizedWeighableQuantity(product, item.quantity);
      if (quantity <= 0) return item;
      const allowsFraction = Boolean(product.is_weighable) || Boolean(product.fractioned);
      if (!allowsFraction && Math.abs(quantity - Math.round(quantity)) > 0.000001) throw new Error('fractional_quantity_not_allowed');
      if (Number(item.discount || 0) > 0 && product.allow_discount === false) throw new Error('product_discount_not_allowed');
      return quantity === Number(item.quantity || 0) ? item : { ...item, quantity };
    });

    if (!allowNegativeStock(this)) {
      const totals = new Map();
      for (const item of normalized) {
        const id=String(item.productId||'');
        if(id)totals.set(id,(totals.get(id)||0)+Number(item.quantity||0));
      }
      for(const [id,requested] of totals.entries()){
        const product=this.store.product(id);
        if(!product||String(product.production_mode||'stock')==='on_demand')continue;
        const available=Number(product.quantity||0);
        if(requested>available+0.000001){
          const unit=String(product.unit||'UN').toUpperCase();
          const name=String(product.name||product.sku||'Produto').replace(/\|/g,' ');
          throw new Error(`insufficient_stock_at_location|${name}|${requested}|${available}|${unit}`);
        }
      }
    }

    return originalQuoteSale.call(this, normalized, discount);
  };
}

module.exports = { installProductRules, normalizedWeighableQuantity, allowNegativeStock };
