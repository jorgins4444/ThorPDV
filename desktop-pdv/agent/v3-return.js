function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj) ?? fallback;
}

function installReturnFix(ThorAgent) {
  ThorAgent.prototype.returnSale = async function ({
    saleKey,
    items,
    refundMethod = 'store_credit',
    reason = '',
    supervisorAuthorization = null,
    returnCustomerId = null,
    guestName = '',
    guestDocument = '',
    voucherNumber = '',
  }) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');
    const allowed = getPath(operator, 'permissions.sale.return', false);
    if (!allowed && !supervisorAuthorization?.supervisor_user_id) throw new Error('supervisor_authorization_required');

    const sale = this.fiscalSale(saleKey);
    if (String(sale.status) === 'cancelled' || String(sale.status) === 'cancel_pending') throw new Error('sale_cancelled');
    if (!Array.isArray(items) || !items.length) throw new Error('return_without_items');
    if (refundMethod !== 'store_credit') throw new Error('return_only_store_credit_allowed');

    const normalized = [];
    const increments = new Map();
    let localValue = 0;

    for (const item of items) {
      const original = (sale.items || []).find((i) => String(i.sale_item_id || i.product_id) === String(item.sale_item_id || item.product_id));
      if (!original) throw new Error('sale_item_not_found');
      const qty = Number(item.quantity || 0);
      if (qty <= 0) throw new Error('invalid_return_quantity');
      const remaining = Math.max(Number(original.quantity || 0) - Number(original.returned_quantity || 0), 0);
      if (qty > remaining + 0.0001) throw new Error('return_quantity_exceeds_remaining');
      const unitNet = Number(original.quantity || 0) > 0
        ? Number(original.total ?? (Number(original.quantity || 0) * Number(original.unit_price || 0))) / Number(original.quantity || 1)
        : 0;
      localValue += qty * unitNet;
      const itemKey = String(original.sale_item_id || original.product_id);
      increments.set(itemKey, (increments.get(itemKey) || 0) + qty);
      normalized.push({ sale_item_id: original.sale_item_id || null, product_id: original.product_id || null, quantity: qty });
      if (original.product_id) this.store.adjustInventory(String(original.product_id), qty);
    }

    const patchedItems = (sale.items || []).map((original) => {
      const itemKey = String(original.sale_item_id || original.product_id);
      return { ...original, returned_quantity: Number(original.returned_quantity || 0) + (increments.get(itemKey) || 0) };
    });
    this.store.patchLocalSale(sale, {
      returned_total: Number(sale.returned_total || 0) + Math.round(localValue * 100) / 100,
      local_status: 'return_pending',
      items: patchedItems,
    });

    const event = this.event('sale_return', {
      sale_id: sale.id || null,
      sale_client_event_id: sale.client_event_id || null,
      items: normalized,
      refund_method: 'store_credit',
      return_customer_id: returnCustomerId || null,
      guest_name: String(guestName || '').trim() || null,
      guest_document: String(guestDocument || '').replace(/\D/g, '') || null,
      voucher_number: String(voucherNumber || '').trim() || null,
      reason,
      operator_user_id: operator.id,
      supervisor_authorization: supervisorAuthorization,
    });

    return { ok: true, eventId: event.id, estimatedTotal: Math.round(localValue * 100) / 100 };
  };
}

module.exports = { installReturnFix };
