'use strict';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const OFFLINE_GRACE_MS = 12 * 60 * 60 * 1000;
const DENIED = new Set(['device_blocked','device_reconnect_required','license_blocked','license_inactive','license_expired','pdv_module_disabled','invalid_device','license_not_found']);

function installDeviceAccessV133(ThorAgent) {
  const originalStart = ThorAgent.prototype.start;
  const originalStatus = ThorAgent.prototype.status;
  const originalEnroll = ThorAgent.prototype.enroll;
  const originalEvent = ThorAgent.prototype.event;

  ThorAgent.prototype.deviceAccess = function () {
    const reason = this.store.get('device_access_denied', '');
    const checked = Number(this.store.get('device_access_validated_at', '0'));
    const now = Date.now();
    const lastObserved = Number(this.store.get('device_access_last_observed_at', '0'));
    const clockRollback = checked > now + 60 * 1000 || lastObserved > now + 60 * 1000;
    const expired = !checked || now - checked > OFFLINE_GRACE_MS || clockRollback;
    return { allowed: Boolean(this.deviceToken()) && !reason && !expired,
      reason: reason || (clockRollback ? 'device_clock_invalid' : expired ? 'offline_authorization_expired' : ''),
      reconnectRequired: reason === 'device_reconnect_required' || reason === 'invalid_device',
      lastValidatedAt: checked ? new Date(checked).toISOString() : null,
      offlineDeadline: checked ? new Date(checked + OFFLINE_GRACE_MS).toISOString() : null,
      checkIntervalMs: CHECK_INTERVAL_MS };
  };

  ThorAgent.prototype.checkDeviceAccess = async function (force = false) {
    if (!this.deviceToken()) return this.deviceAccess();
    if (this._deviceAccessChecking) return this._deviceAccessChecking;
    if (!force && Date.now() - Number(this.store.get('device_access_checked_at', '0')) < CHECK_INTERVAL_MS)
      return this.deviceAccess();
    this._deviceAccessChecking = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(this.apiBase.replace(new RegExp('/ + '/api/pdv/license/status', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + this.deviceToken(), 'content-type': 'application/json' },
          body: '{}', signal: controller.signal, cache: 'no-store'
        });
        const result = await response.json();
        if (result.ok && response.ok) {
          this.store.set('device_access_validated_at', String(Date.now()));
          this.store.set('device_access_last_observed_at', String(Date.now()));
          this.store.set('device_access_denied', '');
          if (!this.sync.timer) this.sync.start();
        } else if (DENIED.has(String(result.error || ''))) {
          this.store.set('device_access_denied', String(result.error));
          this.sync.stop();
        } else if (response.status === 401 || response.status === 403) {
          this.store.set('device_access_denied', 'device_authorization_denied');
          this.sync.stop();
        }
      } catch (_) {
        // Network outages do not renew authorization. The original 12h deadline remains.
      } finally {
        clearTimeout(timeout);
        this.store.set('device_access_checked_at', String(Date.now()));
      }
      return this.deviceAccess();
    })();
    try { return await this._deviceAccessChecking; }
    finally { this._deviceAccessChecking = null; }
  };

  ThorAgent.prototype.requireDeviceAccess = function () {
    const state = this.deviceAccess();
    if (!state.allowed) throw new Error(state.reason || 'device_access_denied');
    this.store.set('device_access_last_observed_at', String(Math.max(Date.now(), Number(this.store.get('device_access_last_observed_at', '0')))));
  };

  ThorAgent.prototype.start = async function (...args) {
    await originalStart.apply(this, args);
    await this.checkDeviceAccess(true);
    if (this.deviceToken()) {
      this._deviceAccessTimer = setInterval(() => {
        this.checkDeviceAccess(true).catch(() => {});
      }, CHECK_INTERVAL_MS);
      this._deviceAccessTimer.unref?.();
    }
  };
  const originalStop = ThorAgent.prototype.stop;
  ThorAgent.prototype.stop = async function (...args) {
    clearInterval(this._deviceAccessTimer);
    return originalStop.apply(this, args);
  };
  ThorAgent.prototype.status = async function (...args) {
    const result = await originalStatus.apply(this, args);
    const access = this.deviceAccess();
    return { ...result, enrolled: result.enrolled && !access.reconnectRequired, deviceAccess: access };
  };
  ThorAgent.prototype.enroll = async function (...args) {
    const result = await originalEnroll.apply(this, args);
    this.store.set('device_access_denied', '');
    this.store.set('device_access_last_observed_at', '0');
    this.store.set('device_access_checked_at', '0');
    await this.checkDeviceAccess(true);
    return this.status();
  };

  // A guard in the agent prevents bypassing the renderer through IPC or shortcuts.
  ThorAgent.prototype.event = function (...args) {
    this.requireDeviceAccess();
    return originalEvent.apply(this, args);
  };
  const guarded = [
    'openCash','cashMovement','finalizeSale','completeSale','returnSale',
    'cancelSale','closeCash','closeHistoricalCash','catalogLocalSave',
    'setCommercialContext','createPreSale','savePreSale','confirmPreSale',
    'adjustStock','updateProductPrice'
  ];
  for (const name of guarded) {
    const original = ThorAgent.prototype[name];
    if (typeof original !== 'function') continue;
    ThorAgent.prototype[name] = function (...args) {
      this.requireDeviceAccess();
      return original.apply(this, args);
    };
  }

  // SyncEngine is an instance, so install the transport guard during startup.
  const startWithSyncGuard = ThorAgent.prototype.start;
  ThorAgent.prototype.start = async function (...args) {
    if (!this.sync._deviceAccessGuardInstalled) {
      const request = this.sync.request.bind(this.sync);
      this.sync.request = async (pathname, body) => {
        if (!this.deviceAccess().allowed) throw new Error(this.deviceAccess().reason || 'device_access_denied');
        try { return await request(pathname, body); }
        catch (error) {
          const code = String(error?.message || '');
          if (DENIED.has(code) || code === 'device_authorization_denied') {
            this.store.set('device_access_denied', code);
            this.sync.stop();
          }
          throw error;
        }
      };
      this.sync._deviceAccessGuardInstalled = true;
    }
    return startWithSyncGuard.apply(this, args);
  };
}

module.exports = { installDeviceAccessV133, CHECK_INTERVAL_MS, OFFLINE_GRACE_MS };
), '') + '/api/pdv/license/status', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + this.deviceToken(), 'content-type': 'application/json' },
          body: '{}', signal: controller.signal, cache: 'no-store'
        });
        const result = await response.json();
        if (result.ok && response.ok) {
          this.store.set('device_access_validated_at', String(Date.now()));
          this.store.set('device_access_last_observed_at', String(Date.now()));
          this.store.set('device_access_denied', '');
          if (!this.sync.timer) this.sync.start();
        } else if (DENIED.has(String(result.error || ''))) {
          this.store.set('device_access_denied', String(result.error));
          this.sync.stop();
        } else if (response.status === 401 || response.status === 403) {
          this.store.set('device_access_denied', 'device_authorization_denied');
          this.sync.stop();
        }
      } catch (_) {
        // Network outages do not renew authorization. The original 12h deadline remains.
      } finally {
        clearTimeout(timeout);
        this.store.set('device_access_checked_at', String(Date.now()));
      }
      return this.deviceAccess();
    })();
    try { return await this._deviceAccessChecking; }
    finally { this._deviceAccessChecking = null; }
  };

  ThorAgent.prototype.requireDeviceAccess = function () {
    const state = this.deviceAccess();
    if (!state.allowed) throw new Error(state.reason || 'device_access_denied');
    this.store.set('device_access_last_observed_at', String(Math.max(Date.now(), Number(this.store.get('device_access_last_observed_at', '0')))));
  };

  ThorAgent.prototype.start = async function (...args) {
    await originalStart.apply(this, args);
    await this.checkDeviceAccess(true);
    if (this.deviceToken()) {
      this._deviceAccessTimer = setInterval(() => {
        this.checkDeviceAccess(true).catch(() => {});
      }, CHECK_INTERVAL_MS);
      this._deviceAccessTimer.unref?.();
    }
  };
  const originalStop = ThorAgent.prototype.stop;
  ThorAgent.prototype.stop = async function (...args) {
    clearInterval(this._deviceAccessTimer);
    return originalStop.apply(this, args);
  };
  ThorAgent.prototype.status = async function (...args) {
    const result = await originalStatus.apply(this, args);
    const access = this.deviceAccess();
    return { ...result, enrolled: result.enrolled && !access.reconnectRequired, deviceAccess: access };
  };
  ThorAgent.prototype.enroll = async function (...args) {
    const result = await originalEnroll.apply(this, args);
    this.store.set('device_access_denied', '');
    this.store.set('device_access_last_observed_at', '0');
    this.store.set('device_access_checked_at', '0');
    await this.checkDeviceAccess(true);
    return this.status();
  };

  // A guard in the agent prevents bypassing the renderer through IPC or shortcuts.
  ThorAgent.prototype.event = function (...args) {
    this.requireDeviceAccess();
    return originalEvent.apply(this, args);
  };
  const guarded = [
    'openCash','cashMovement','finalizeSale','completeSale','returnSale',
    'cancelSale','closeCash','closeHistoricalCash','catalogLocalSave',
    'setCommercialContext','createPreSale','savePreSale','confirmPreSale',
    'adjustStock','updateProductPrice'
  ];
  for (const name of guarded) {
    const original = ThorAgent.prototype[name];
    if (typeof original !== 'function') continue;
    ThorAgent.prototype[name] = function (...args) {
      this.requireDeviceAccess();
      return original.apply(this, args);
    };
  }

  // SyncEngine is an instance, so install the transport guard during startup.
  const startWithSyncGuard = ThorAgent.prototype.start;
  ThorAgent.prototype.start = async function (...args) {
    if (!this.sync._deviceAccessGuardInstalled) {
      const request = this.sync.request.bind(this.sync);
      this.sync.request = async (pathname, body) => {
        if (!this.deviceAccess().allowed) throw new Error(this.deviceAccess().reason || 'device_access_denied');
        try { return await request(pathname, body); }
        catch (error) {
          const code = String(error?.message || '');
          if (DENIED.has(code) || code === 'device_authorization_denied') {
            this.store.set('device_access_denied', code);
            this.sync.stop();
          }
          throw error;
        }
      };
      this.sync._deviceAccessGuardInstalled = true;
    }
    return startWithSyncGuard.apply(this, args);
  };
}

module.exports = { installDeviceAccessV133, CHECK_INTERVAL_MS, OFFLINE_GRACE_MS };
