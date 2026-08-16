function installReturnQuantityGuardV106(ThorAgent) {
  if (ThorAgent.prototype.__returnQuantityGuardV106) return;
  ThorAgent.prototype.__returnQuantityGuardV106 = true;

  const enrichItem = (agent, item = {}) => {
    const product = item.product_id ? agent.store.product(String(item.product_id)) : null;
    const isWeighable = Boolean(product?.is_weighable || item.is_weighable);
    const fractioned = Boolean(product?.fractioned || item.fractioned || isWeighable);
    return {
      ...item,
      unit: item.unit || product?.unit || '',
      is_weighable: isWeighable,
      fractioned,
      label_scale: Boolean(product?.label_scale || item.label_scale),
    };
  };

  const enrichSale = (agent, sale) => {
    if (!sale || typeof sale !== 'object') return sale;
    return { ...sale, items: (sale.items || []).map((item) => enrichItem(agent, item)) };
  };

  const originalFiscalSales = ThorAgent.prototype.fiscalSales;
  ThorAgent.prototype.fiscalSales = function (query = '') {
    const sales = originalFiscalSales.call(this, query);
    return (Array.isArray(sales) ? sales : []).map((sale) => enrichSale(this, sale));
  };

  const originalFiscalSale = ThorAgent.prototype.fiscalSale;
  ThorAgent.prototype.fiscalSale = function (key) {
    return enrichSale(this, originalFiscalSale.call(this, key));
  };

  const originalReturnSale = ThorAgent.prototype.returnSale;
  ThorAgent.prototype.returnSale = async function (payload = {}) {
    const sale = this.fiscalSale(payload.saleKey);
    if (!sale) throw new Error('sale_not_found');

    for (const requested of Array.isArray(payload.items) ? payload.items : []) {
      const original = (sale.items || []).find((item) =>
        String(item.sale_item_id || item.product_id) === String(requested.sale_item_id || requested.product_id)
      );
      if (!original) throw new Error('sale_item_not_found');

      const quantity = Number(requested.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('invalid_return_quantity');

      const product = original.product_id ? this.store.product(String(original.product_id)) : null;
      const allowsFraction = Boolean(product?.is_weighable || product?.fractioned || original.is_weighable || original.fractioned);
      if (!allowsFraction && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
        throw new Error('fractional_quantity_not_allowed');
      }
    }

    return originalReturnSale.call(this, payload);
  };
}

module.exports = { installReturnQuantityGuardV106 };
