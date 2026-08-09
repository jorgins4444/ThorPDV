function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }, obj) ?? fallback;
}

function installAdvancedPermissions(ThorAgent) {
  ThorAgent.prototype._validateAdjustmentAuthorization = function ({ operator, subtotal, discount, surcharge, supervisorAuthorization }) {
    const saleDiscount = Math.max(Number(discount || 0), 0);
    const saleSurcharge = Math.max(Number(surcharge || 0), 0);

    if (saleDiscount > 0 && !getPath(operator || {}, 'permissions.discount.apply', true)) {
      throw new Error('discount_not_allowed');
    }

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
    if (!supervisor || !getPath(supervisor, 'permissions.supervisor.authorize', false)) {
      throw new Error('invalid_supervisor_authorization');
    }

    if (needsDiscountSupervisor) {
      const supervisorLimit = Number(getPath(supervisor, 'permissions.discount.max_percent', 0) || 0);
      const supervisorOverride = Boolean(getPath(supervisor, 'permissions.discount.override_limit', false));
      if (!supervisorOverride && discountPct > supervisorLimit + 0.0001) throw new Error('discount_exceeds_supervisor_limit');
    }

    if (needsSurchargeSupervisor) {
      const supervisorLimit = Number(getPath(supervisor, 'permissions.surcharge.max_percent', 0) || 0);
      if (surchargePct > supervisorLimit + 0.0001) throw new Error('surcharge_exceeds_supervisor_limit');
    }

    return auth;
  };
}

module.exports = { installAdvancedPermissions };
