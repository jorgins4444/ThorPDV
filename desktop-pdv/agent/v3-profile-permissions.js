function getPath(obj, path, fallback = undefined) {
  return path.split('.').reduce((value, key) => (value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined), obj) ?? fallback;
}

function timeoutResult(ms) {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: false, pending: true, error: 'sync_continuing' }), ms));
}

function installProfilePermissions(ThorAgent) {
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalBeginPayment = ThorAgent.prototype.beginIntegratedPayment;
  const originalReadScale = ThorAgent.prototype.readScale;
  const originalOpenDrawer = ThorAgent.prototype.openDrawer;
  const originalRequestNfce = ThorAgent.prototype.requestNfce;
  const originalFiscalSales = ThorAgent.prototype.fiscalSales;
  const originalFiscalSale = ThorAgent.prototype.fiscalSale;
  const originalLoginOperator = ThorAgent.prototype.loginOperator;
  const originalSaveSettings = ThorAgent.prototype.saveSettings;
  const originalSaveV3Settings = ThorAgent.prototype.saveV3Settings;
  const originalSetPrinter = ThorAgent.prototype.setPrinter;

  ThorAgent.prototype._profileValue = function (path, fallback = undefined) {
    const operator = this.currentOperator?.();
    if (!operator) return fallback;
    return getPath(operator.permissions || {}, path, fallback);
  };

  ThorAgent.prototype._profileAllows = function (path, fallback = false) {
    return Boolean(this._profileValue(path, fallback));
  };

  ThorAgent.prototype._requireProfilePermission = function (path, error = 'permission_denied') {
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    if (!this._profileAllows(path, false)) throw new Error(error);
    return operator;
  };

  ThorAgent.prototype.loginOperator = async function (payload = {}) {
    // A autenticação local precisa ser imediata. A sincronização de entrada é
    // importante, mas nunca deve manter a tela presa indefinidamente em 100%.
    const localLogin = await originalLoginOperator.call(this, payload);
    const syncPromise = Promise.resolve(this.sync.run(true)).catch((error) => ({ ok: false, error: error?.message || 'sync_unavailable' }));
    const sync = await Promise.race([syncPromise, timeoutResult(14000)]);

    if (sync?.pending) {
      // O sync real continua em segundo plano. Se ele descobrir um bloqueio de
      // licença, o license-guard derruba a sessão imediatamente.
      syncPromise.catch(() => {});
      return {
        ...localLogin,
        sync: { ok: false, pending: true, background: true, error: 'sync_continuing' },
      };
    }

    if (sync?.ok) {
      try {
        const refreshedLogin = await originalLoginOperator.call(this, payload);
        return {
          ...refreshedLogin,
          sync: { ok: true, at: this.store.get('last_sync_at') || null },
        };
      } catch (error) {
        this.store.set('current_operator_id', '');
        throw error;
      }
    }

    return {
      ...localLogin,
      sync: { ok: false, offline: true, error: sync?.error || 'sync_unavailable' },
    };
  };

  ThorAgent.prototype.finalizeSale = async function (payload = {}) {
    const operator = this._requireProfilePermission('sale.create', 'operator_not_allowed_to_sell');
    if ((payload.customerId || payload.consumerDocument) && !this._profileAllows('customer.identify', true)) throw new Error('operator_not_allowed_to_identify_customer');
    for (const payment of payload.payments || []) {
      const method = String(payment.method || '');
      if (method && !this._profileAllows(`payment.${method}`, true)) throw new Error(`payment_method_not_allowed:${method}`);
      if (payment.integrated && !this._profileAllows('payment.integrated', true)) throw new Error('integrated_payment_not_allowed');
    }
    return originalFinalizeSale.call(this, { ...payload, operatorUserId: operator.id });
  };

  ThorAgent.prototype.beginIntegratedPayment = async function (payload = {}) {
    this._requireProfilePermission('payment.integrated', 'integrated_payment_not_allowed');
    const method = String(payload.method || '');
    if (method && !this._profileAllows(`payment.${method}`, true)) throw new Error(`payment_method_not_allowed:${method}`);
    return originalBeginPayment.call(this, payload);
  };

  ThorAgent.prototype.readScale = async function () {
    this._requireProfilePermission('hardware.scale', 'scale_not_allowed');
    return originalReadScale.call(this);
  };

  ThorAgent.prototype.manualOpenDrawer = async function () {
    this._requireProfilePermission('hardware.manual_drawer', 'manual_drawer_not_allowed');
    return originalOpenDrawer.call(this);
  };

  ThorAgent.prototype.requestNfce = async function (payload = {}) {
    const operator = this._requireProfilePermission('fiscal.request_nfce', 'nfce_request_not_allowed');
    const result = await originalRequestNfce.call(this, payload);
    if (result?.eventId) {
      const pending = this.store.pending(20).find((event) => event.id === result.eventId);
      if (pending) {
        const merged = { ...pending.payload, operator_user_id: operator.id };
        this.store.db.prepare('update queue set payload=?,updated_at=? where id=?').run(JSON.stringify(merged), new Date().toISOString(), result.eventId);
      }
    }
    return result;
  };

  ThorAgent.prototype.fiscalSales = function (query = '') {
    this._requireProfilePermission('fiscal.view', 'fiscal_menu_not_allowed');
    return originalFiscalSales.call(this, query);
  };

  ThorAgent.prototype.fiscalSale = function (key) {
    this._requireProfilePermission('fiscal.view', 'fiscal_menu_not_allowed');
    return originalFiscalSale.call(this, key);
  };

  ThorAgent.prototype.saveSettings = function (input = {}) {
    this._requireProfilePermission('settings.edit', 'settings_edit_not_allowed');
    return originalSaveSettings.call(this, input);
  };

  ThorAgent.prototype.saveV3Settings = function (input = {}) {
    this._requireProfilePermission('settings.edit', 'settings_edit_not_allowed');
    return originalSaveV3Settings.call(this, input);
  };

  ThorAgent.prototype.setPrinter = function (name) {
    this._requireProfilePermission('settings.edit', 'settings_edit_not_allowed');
    return originalSetPrinter.call(this, name);
  };

  ThorAgent.prototype.manualSync = async function () {
    const operator = this.currentOperator?.();
    if (operator && !this._profileAllows('sync.manual', true)) throw new Error('manual_sync_not_allowed');
    return this.sync.run(true);
  };

  ThorAgent.prototype.canPrint = function (type = 'pre_sale', reprint = false) {
    if (reprint && !this._profileAllows('print.reprint', false)) return false;
    if (type === 'nfce') {
      if (reprint && !this._profileAllows('fiscal.reprint', false)) return false;
      return this._profileAllows('print.nfce', false);
    }
    return this._profileAllows('print.receipt', false);
  };
}

module.exports = { installProfilePermissions };