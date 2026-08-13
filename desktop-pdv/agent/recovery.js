function installSyncRecovery(ThorAgent) {
  ThorAgent.prototype.syncDiagnostics = function () {
    const rows = this.store.db.prepare(`
      select id,type,state,attempts,last_error,created_at,updated_at
      from queue
      where state in ('pending','rejected')
      order by datetime(created_at),rowid
      limit 200
    `).all();
    return {
      stats: this.store.queueStats(),
      lastSyncAt: this.store.get('last_sync_at') || null,
      lastError: this.store.get('last_sync_error') || null,
      events: rows,
    };
  };

  ThorAgent.prototype.recoverSync = async function (eventId = null) {
    const token = this.deviceToken();
    if (!token) throw new Error('not_enrolled');
    const selected = String(eventId || '').replace(/^local:/, '').trim();
    const body = selected ? { event_ids: [selected] } : {};
    const response = await fetch(`${this.apiBase.replace(/\/$/,'')}/api/pdv/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `http_${response.status}`);

    const now = new Date().toISOString();
    const reset = selected
      ? this.store.db.prepare(`update queue set state='pending',last_error=null,updated_at=? where state='rejected' and id=?`).run(now, selected)
      : this.store.db.prepare(`update queue set state='pending',last_error=null,updated_at=? where state='rejected'`).run(now);
    this.store.set('last_sync_error', '');
    const sync = await this.sync.run(true);
    const diagnostics = this.syncDiagnostics();
    const failed = selected ? diagnostics.events.find((event) => String(event.id) === selected && event.state === 'rejected') : null;
    return {
      ok: Boolean(sync?.ok) && !failed,
      error: failed?.last_error || (!sync?.ok ? sync?.error : null),
      resetLocalEvents: Number(reset.changes || 0),
      clearedServerRejections: Number(data.cleared_server_rejections || 0),
      selectedEventId: selected || null,
      diagnostics,
      sync,
    };
  };

  ThorAgent.prototype.disconnectDevice = async function () {
    this.sync.stop();
    this.store.set('device_token', '');
    this.store.set('device_id', '');
    this.store.set('cursor', '');
    this.store.set('last_sync_error', '');
    this.store.set('current_operator_id', '');
    return { ok: true, queue: this.store.queueStats(), preservedLocalData: true };
  };
}

module.exports = { installSyncRecovery };
