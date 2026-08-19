const bcrypt = require('bcryptjs');

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function installOperatorLoginFastV090(ThorAgent) {
  if (ThorAgent.prototype.__operatorLoginFastV090) return;
  ThorAgent.prototype.__operatorLoginFastV090 = true;

  ThorAgent.prototype.loginOperator = function (payload = {}) {
    if (this.store.get('pairing_invalidated', 'false') === 'true') throw new Error('pairing_reconnect_required');
    if (this.store.get('license_blocked', 'false') === 'true') throw new Error('license_blocked');

    const userId = String(payload.userId || '').trim();
    const pin = String(payload.pin || '');
    const rows = typeof this._staffUsersWithHash === 'function'
      ? this._staffUsersWithHash()
      : parseJson(this.store.get('staff_users', '[]'), []);
    const row = rows.find((user) => String(user?.id || '') === userId);

    if (!row || row.active === false) throw new Error('operator_not_found');
    if (!row.pin_hash) throw new Error('operator_pin_not_configured');
    if (!bcrypt.compareSync(pin, String(row.pin_hash))) throw new Error('invalid_operator_pin');

    this.store.set('current_operator_id', row.id);
    const { pin_hash, ...operator } = row;

    // Rede, licença e sincronização jamais fazem parte do caminho crítico do login.
    setTimeout(() => {
      try {
        if (typeof this.checkLicenseOnline === 'function') {
          void this.checkLicenseOnline({ force: true, timeoutMs: 2500 })
            .then((decision) => this._applyLicenseDecision?.(decision))
            .catch(() => {});
        }
      } catch {}
      try {
        if (!this.sync?.running) void this.sync?.run?.(true);
      } catch {}
    }, 0);

    return {
      ok: true,
      operator,
      sync: {
        ok: true,
        pending: true,
        background: true,
        at: this.store.get('last_sync_at') || null,
      },
    };
  };
}

module.exports = { installOperatorLoginFastV090 };
