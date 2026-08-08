function installSyncPolicy(ThorAgent) {
  const originalLoginOperator = ThorAgent.prototype.loginOperator;

  ThorAgent.prototype.loginOperator = async function (payload = {}) {
    const first = await originalLoginOperator.call(this, payload);

    const sync = await this.sync.run(true);
    if (sync?.ok) {
      try {
        const refreshed = await originalLoginOperator.call(this, payload);
        return { ...refreshed, sync: { ok: true, at: this.store.get('last_sync_at') || null } };
      } catch (error) {
        this.store.set('current_operator_id', '');
        throw error;
      }
    }

    return {
      ...first,
      sync: {
        ok: false,
        offline: true,
        error: sync?.error || 'sync_unavailable',
      },
    };
  };

  ThorAgent.prototype.manualSync = async function () {
    const operator = this.currentOperator?.();
    if (operator && typeof this._profileAllows === 'function' && !this._profileAllows('sync.manual', true)) {
      throw new Error('manual_sync_not_allowed');
    }
    return this.sync.run(true);
  };

  ThorAgent.prototype.syncPolicy = function () {
    return {
      intervalMs: Number(this.sync?.intervalMs || 300000),
      intervalMinutes: Math.round(Number(this.sync?.intervalMs || 300000) / 60000),
      syncAfterOperatorLogin: true,
      manualSyncForced: true,
    };
  };
}

module.exports = { installSyncPolicy };
