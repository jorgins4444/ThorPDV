const { Store } = require('./store');
const { installProductRules } = require('./product-rules-v046');

function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }, obj) ?? fallback;
}

function installAdvancedPermissions(ThorAgent) {
  installProductRules(ThorAgent, Store);
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalAuthorizeSupervisor = ThorAgent.prototype.authorizeSupervisor;

  function validateSupervisor(agent, supervisorAuthorization, requestedPercent, errorCode = 'discount_exceeds_supervisor_limit') {
    const auth = supervisorAuthorization || null;
    if (!auth?.supervisor_user_id) throw new Error('supervisor_authorization_required');
    const supervisor = agent._staffUsersWithHash().find((user) => String(user.id) === String(auth.supervisor_user_id));
    if (!supervisor || !getPath(supervisor, 'permissions.supervisor.authorize', false)) throw new Error('invalid_supervisor_authorization');
    const supervisorOverride = Boolean(getPath(supervisor, 'permissions.discount.override_limit', false));
    const supervisorLimit = Number(getPath(supervisor, 'permissions.discount.max_percent', 0) || 0);
    if (!supervisorOverride && requestedPercent > supervisorLimit + 0.0001) throw new Error(errorCode);
    return auth;
  }

  ThorAgent.prototype.authorizeSupervisor = function (payload = {}) {
    const result = originalAuthorizeSupervisor.call(this, payload);
    if (String(payload.action || '').startsWith('discount')) {
      const supervisor = this._staffUsersWithHash().find((user) => String(user.id) === String(payload.userId));
      const requestedPercent = Math.max(Number(payload.requestedValue || 0), 0);
      const override = Boolean(getPath(supervisor || {}, 'permissions.discount.override_limit', false));
      const limit = Number(getPath(supervisor || {}, 'permissions.discount.max_percent', 0) || 0);
      if (!override && requestedPercent > limit + 0.0001) throw new Error('discount_exceeds_supervisor_limit');
    }
    return result;
  };

  ThorAgent.prototype._validateAdjustmentAuthorization = function ({ operator, subtotal, discount, surcharge, supervisorAuthorization }) {
    const saleDiscount = Math.max(Number(discount || 0), 0);
    const saleSurcharge = Math.max(Number(surcharge || 0), 0);

    if (saleDiscount > 0 && !getPath(operator || {}, 'permissions.discount.apply', true)) throw new Error('discount_not_allowed');

    const discountPct = subtotal > 0 ? (saleDiscount / subtotal) * 100 : 0;
    const surchargePct = subtotal > 0 ? (saleSurcharge / subtotal) * 100 : 0;
    const discountLimit = Number(getPath(operator || {}, 'permissions.discount.max_percent', 0) || 0);
    const surchargeLimit = Number(getPath(operator || {}, 'permissions.surcharge.max_percent', 0) || 0);
    const canOverrideDiscount = Boolean(getPath(operator || {}, 'permissions.discount.override_limit', false));

    const needsDiscountSupervisor = discountPct > discountLimit + 0.0001 && !canOverrideDiscount;
    const needsSurchargeSupervisor = surchargePct > surchargeLimit + 0.0001;
    if (!needsDiscountSupervisor && !needsSurchargeSupervisor) return null;

    const auth = supervisorAuthorization || null;
    if (!auth?.supervisor_user_id) throw new Error('supervisor_authorization_required');
    const supervisor = this._staffUsersWithHash().find((user) => String(user.id) === String(auth.supervisor_user_id));
    if (!supervisor || !getPath(supervisor, 'permissions.supervisor.authorize', false)) throw new Error('invalid_supervisor_authorization');

    if (needsDiscountSupervisor) validateSupervisor(this, auth, discountPct);
    if (needsSurchargeSupervisor) {
      const supervisorLimit = Number(getPath(supervisor, 'permissions.surcharge.max_percent', 0) || 0);
      if (surchargePct > supervisorLimit + 0.0001) throw new Error('surcharge_exceeds_supervisor_limit');
    }
    return auth;
  };

  ThorAgent.prototype.finalizeSale = async function (payload = {}) {
    const operator = this.currentOperator();
    if (!operator) throw new Error('operator_required');

    const canDiscount = Boolean(getPath(operator, 'permissions.discount.apply', true));
    const canOverrideDiscount = Boolean(getPath(operator, 'permissions.discount.override_limit', false));
    const discountLimit = Number(getPath(operator, 'permissions.discount.max_percent', 0) || 0);
    let highestItemDiscountPct = 0;

    for (const input of Array.isArray(payload.items) ? payload.items : []) {
      const itemDiscount = Math.max(Number(input.discount || 0), 0);
      if (itemDiscount <= 0) continue;
      if (!canDiscount) throw new Error('item_discount_not_allowed');

      const product = this.store.product(input.productId);
      if (!product || !product.active) throw new Error('product_not_found');
      if (product.allow_discount === false) throw new Error('product_discount_not_allowed');
      const quantity = Number(input.quantity || 0);
      if (quantity <= 0) throw new Error('invalid_quantity');
      const unitPrice = Number(this.resolvePrice(product, quantity) || 0);
      const gross = quantity * unitPrice;
      if (itemDiscount > gross + 0.001) throw new Error('invalid_item_discount');
      const percent = gross > 0 ? (itemDiscount / gross) * 100 : 0;
      highestItemDiscountPct = Math.max(highestItemDiscountPct, percent);
    }

    if (highestItemDiscountPct > discountLimit + 0.0001 && !canOverrideDiscount) {
      validateSupervisor(this, payload.supervisorAuthorization, highestItemDiscountPct);
    }

    return originalFinalizeSale.call(this, payload);
  };
}

module.exports = { installAdvancedPermissions };
