const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class ThorUpdater {
  constructor({ agent, appVersion, apiBase, userDataDir, tempDir, onProgress = () => {}, quit = () => {} }) {
    this.agent = agent;
    this.appVersion = String(appVersion || '0.0.0');
    this.apiBase = String(apiBase || '').replace(/\/+$/, '');
    this.userDataDir = userDataDir;
    this.tempDir = tempDir;
    this.onProgress = onProgress;
    this.quit = quit;
    this.state = { checking: false, installing: false, lastCheck: null, available: null, error: null };
    this.markerPath = path.join(this.userDataDir, 'pending-update.json');
  }

  token() { return this.agent?.deviceToken?.() || ''; }

  emit(stage, data = {}) {
    const payload = { stage, at: new Date().toISOString(), ...data };
    try { this.onProgress(payload); } catch {}
    return payload;
  }

  async post(endpoint, body) {
    const token = this.token();
    if (!token) throw new Error('update_device_not_enrolled');
    const response = await fetch(`${this.apiBase}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `update_http_${response.status}`);
    return data;
  }

  async report(targetVersion, eventType, details = {}) {
    try {
      return await this.post('/api/pdv/update/report', { targetVersion, eventType, details });
    } catch {
      return null;
    }
  }

  async check({ silent = false } = {}) {
    if (this.state.checking) return this.state.available || { ok: true, update_available: false, current_version: this.appVersion };
    this.state.checking = true;
    this.state.error = null;
    if (!silent) this.emit('checking', { currentVersion: this.appVersion });
    try {
      const data = await this.post('/api/pdv/update/check', { currentVersion: this.appVersion });
      this.state.available = data;
      this.state.lastCheck = new Date().toISOString();
      if (!silent) this.emit(data.update_available ? 'available' : 'current', data);
      return data;
    } catch (error) {
      this.state.error = String(error?.message || error);
      if (!silent) this.emit('error', { error: this.state.error });
      throw error;
    } finally {
      this.state.checking = false;
    }
  }

  updateInfo() {
    return { ...this.state, currentVersion: this.appVersion };
  }

  async syncBeforeInstall() {
    this.emit('syncing', { message: 'Sincronizando dados antes da atualização.' });
    await this.agent.manualSync();
    const stats = this.agent.store?.queueStats?.() || { pending: 0, rejected: 0 };
    if (Number(stats.pending || 0) > 0) throw new Error('update_pending_sync');
    return stats;
  }

  async downloadAndVerify(release) {
    const url = String(release?.download_url || '');
    const expected = String(release?.sha256 || '').toLowerCase();
    const version = String(release?.version || '');
    if (!/^https:\/\//i.test(url)) throw new Error('update_https_required');
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('update_sha256_invalid');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('update_version_invalid');

    const destination = path.join(this.tempDir, `ThorPDV-Desktop-${version}-x64.exe`);
    try { fs.unlinkSync(destination); } catch {}
    this.emit('downloading', { version, progress: 0 });
    await this.report(version, 'download_started', { url });

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`update_download_http_${response.status}`);
    const total = Number(response.headers.get('content-length') || release?.package_size || 0);
    const file = fs.createWriteStream(destination);
    const hash = crypto.createHash('sha256');
    const reader = response.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        hash.update(chunk);
        received += chunk.length;
        if (!file.write(chunk)) await new Promise(resolve => file.once('drain', resolve));
        if (total > 0) this.emit('downloading', { version, received, total, progress: Math.min(99, Math.round(received * 100 / total)) });
      }
      await new Promise((resolve, reject) => file.end(err => err ? reject(err) : resolve()));
    } catch (error) {
      file.destroy();
      try { fs.unlinkSync(destination); } catch {}
      throw error;
    }

    const actual = hash.digest('hex').toLowerCase();
    await this.report(version, 'downloaded', { bytes: received, sha256: actual });
    if (actual !== expected) {
      try { fs.unlinkSync(destination); } catch {}
      await this.report(version, 'failed', { stage: 'verify', expected, actual, error: 'sha256_mismatch' });
      throw new Error('update_sha256_mismatch');
    }
    this.emit('verified', { version, progress: 100, sha256: actual });
    await this.report(version, 'verified', { bytes: received, sha256: actual });
    return destination;
  }

  async install() {
    if (this.state.installing) throw new Error('update_already_installing');
    this.state.installing = true;
    this.state.error = null;
    let targetVersion = '';
    try {
      const info = await this.check({ silent: true });
      if (!info?.update_available || !info?.release) throw new Error('update_not_available');
      targetVersion = String(info.target_version || info.release.version || '');
      this.emit('preparing', { currentVersion: this.appVersion, targetVersion, direction: info.direction });
      const queue = await this.syncBeforeInstall();
      const installer = await this.downloadAndVerify(info.release);
      const marker = {
        fromVersion: this.appVersion,
        targetVersion,
        direction: info.direction || 'upgrade',
        installer,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.markerPath, JSON.stringify(marker, null, 2), 'utf8');
      await this.report(targetVersion, 'installing', { fromVersion: this.appVersion, direction: info.direction, queue });
      this.emit('installing', { targetVersion, direction: info.direction });
      const child = spawn(installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      setTimeout(() => this.quit(), 400);
      return { ok: true, installing: true, targetVersion };
    } catch (error) {
      const message = String(error?.message || error);
      this.state.error = message;
      if (targetVersion) await this.report(targetVersion, 'failed', { stage: 'install', error: message });
      this.emit('error', { error: message, targetVersion });
      throw error;
    } finally {
      this.state.installing = false;
    }
  }

  async finalizePending() {
    let marker;
    try { marker = JSON.parse(fs.readFileSync(this.markerPath, 'utf8')); } catch { return null; }
    if (!marker?.targetVersion) return null;
    if (String(marker.targetVersion) === this.appVersion) {
      await this.report(this.appVersion, 'installed', { fromVersion: marker.fromVersion, direction: marker.direction });
      try { fs.unlinkSync(this.markerPath); } catch {}
      this.emit('installed', { fromVersion: marker.fromVersion, targetVersion: this.appVersion, direction: marker.direction });
      try { await this.agent.manualSync(); } catch {}
      return { ok: true, installed: true, version: this.appVersion };
    }
    const age = Date.now() - Date.parse(marker.createdAt || 0);
    if (Number.isFinite(age) && age > 15 * 60 * 1000) {
      await this.report(String(marker.targetVersion), 'failed', { stage: 'restart_verify', runningVersion: this.appVersion, expectedVersion: marker.targetVersion });
      try { fs.unlinkSync(this.markerPath); } catch {}
    }
    return { ok: false, installed: false, expected: marker.targetVersion, running: this.appVersion };
  }
}

module.exports = { ThorUpdater };
