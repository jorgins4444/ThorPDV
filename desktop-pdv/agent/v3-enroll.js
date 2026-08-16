const os = require('os');
const hardware = require('./hardware');
const { version: APP_VERSION } = require('../package.json');

function requestTimeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('enrollment_timeout')), ms));
}

function installEnrollV3(ThorAgent) {
  ThorAgent.prototype.enroll = async function ({ code, name }) {
    const body = {
      code,
      machineId: hardware.machineId(),
      name: name || `ThorPDV - ${os.hostname()}`,
      hostname: os.hostname(),
      appVersion: APP_VERSION,
      capabilities: {
        offline: true,
        printing: process.platform === 'win32',
        serial: process.platform === 'win32',
        fiscalMenu: true,
        returns: true,
        pdf: true,
        configurableShortcuts: true,
        operators: true,
        mandatoryOperatorLogin: true,
        multiPayment: true,
        cashDrawer: true,
        scale: true,
        tefBridge: true,
        profilePermissions: true,
        stockConsistency: true,
        syncBackoff: true,
        cashReconciliation: true,
        cashCloseReceipt: true,
        autoSyncFiveMinutes: true,
        syncAfterOperatorLogin: true,
        manualSyncImmediate: true,
        operatorSyncProgress: true,
        searchOnlySaleCatalog: true,
        fullProductCatalogScreen: true,
        lazyCashOpening: true,
        cashClosedScreen: true,
        operatorReloginAfterClose: true,
        launchedItemsDetail: true,
        nonBlockingActivation: true,
        nonBlockingLogin: true,
      },
    };

    const request = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${this.apiBase}/api/pdv/enroll`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'enrollment_failed');
        return data;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('enrollment_timeout');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();

    const data = await Promise.race([request, requestTimeout(9000)]);

    this.store.set('device_token', this.codec.encrypt(data.device_token));
    this.store.set('device_id', data.device_id);
    this.store.set('pairing_invalidated', 'false');
    this.store.set('pairing_invalidated_code', '');
    this.store.set('pairing_invalidated_at', '');
    this.store.set('last_sync_error', '');
    this.sync.appVersion = APP_VERSION;

    // A ativação termina aqui. O primeiro pull pode levar alguns segundos, mas
    // isso jamais deve manter o usuário preso na tela de ativação.
    this.sync.start();

    const status = await this.status();
    return {
      ...status,
      enrolled: true,
      activation: { ok: true, backgroundSync: true, deviceId: data.device_id },
    };
  };
}

module.exports = { installEnrollV3 };