function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj) ?? fallback;
}

function resolveReturnLine(items, requested = {}) {
  const rows = Array.isArray(items) ? items : [];

  if (requested.sale_item_id) {
    const index = rows.findIndex((row) => String(row.sale_item_id || '') === String(requested.sale_item_id));
    if (index >= 0) return { original: rows[index], index };
  }

  const lineIndex = Number(requested.line_index);
  if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < rows.length) {
    const candidate = rows[lineIndex];
    if (!requested.product_id || String(candidate.product_id || '') === String(requested.product_id)) {
      return { original: candidate, index: lineIndex };
    }
  }

  if (requested.product_id) {
    const matches = rows
      .map((original, index) => ({ original, index }))
      .filter(({ original }) => String(original.product_id || '') === String(requested.product_id));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('return_item_ambiguous');
  }

  return null;
}

function installReturnFix(ThorAgent) {
  ThorAgent.prototype._returnSaleCore = async function ({
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

    const saleItems = Array.isArray(sale.items) ? sale.items : [];
    const byLine = new Map();

    for (const requested of items) {
      const resolved = resolveReturnLine(saleItems, requested);
      if (!resolved) throw new Error('sale_item_not_found');

      const qty = Number(requested.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('invalid_return_quantity');

      const previous = byLine.get(resolved.index);
      byLine.set(resolved.index, {
        ...resolved,
        quantity: Number(previous?.quantity || 0) + qty,
      });
    }

    const normalized = [];
    const increments = new Map();
    let localValue = 0;

    for (const [index, row] of byLine.entries()) {
      const original = row.original;
      const qty = row.quantity;
      const remaining = Math.max(Number(original.quantity || 0) - Number(original.returned_quantity || 0), 0);
      if (qty > remaining + 0.0001) throw new Error('return_quantity_exceeds_remaining');

      const unitNet = Number(original.quantity || 0) > 0
        ? Number(original.total ?? (Number(original.quantity || 0) * Number(original.unit_price || 0))) / Number(original.quantity || 1)
        : 0;

      localValue += qty * unitNet;
      increments.set(index, qty);
      normalized.push({
        sale_item_id: original.sale_item_id || null,
        product_id: original.product_id || null,
        line_index: index,
        quantity: qty,
      });
    }

    // O núcleo da devolução não decide como o crédito será materializado. Ele apenas
    // valida a venda, registra o evento e devolve o estoque. A camada de Crédito/Vale
    // escolhe se o valor vai para um cliente cadastrado ou para um Vale Crédito.
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

    for (const [index, qty] of increments.entries()) {
      const original = saleItems[index];
      if (original?.product_id) this.store.adjustInventory(String(original.product_id), qty);
    }

    const patchedItems = saleItems.map((original, index) => ({
      ...original,
      returned_quantity: Number(original.returned_quantity || 0) + Number(increments.get(index) || 0),
    }));

    this.store.patchLocalSale(sale, {
      returned_total: Number(sale.returned_total || 0) + Math.round(localValue * 100) / 100,
      local_status: 'return_pending',
      items: patchedItems,
    });

    return { ok: true, eventId: event.id, estimatedTotal: Math.round(localValue * 100) / 100 };
  };

  ThorAgent.prototype.returnSale = async function (payload = {}) {
    return this._returnSaleCore(payload);
  };
}

module.exports = { installReturnFix };
