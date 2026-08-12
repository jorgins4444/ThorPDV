const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installSyncPolicy(ThorAgent) {
  const originalLoginOperator = ThorAgent.prototype.loginOperator;
  const originalV3Settings = ThorAgent.prototype.v3Settings;
  const originalSaveV3Settings = ThorAgent.prototype.saveV3Settings;
  const originalFinalizeSale = ThorAgent.prototype.finalizeSale;
  const originalCashMovement = ThorAgent.prototype.cashMovement;
  const originalReturnSale = ThorAgent.prototype.returnSale;

  ThorAgent.prototype.v3Settings = function () {
    const base = originalV3Settings.call(this);
    return {
      ...base,
      askCashOpening: this.store.get('v3_ask_cash_opening', 'true') !== 'false',
    };
  };

  ThorAgent.prototype.saveV3Settings = function (input = {}) {
    const result = originalSaveV3Settings.call(this, input);
    if (Object.prototype.hasOwnProperty.call(input, 'askCashOpening')) {
      this.store.set('v3_ask_cash_opening', input.askCashOpening ? 'true' : 'false');
    }
    return { ...result, askCashOpening: this.store.get('v3_ask_cash_opening', 'true') !== 'false' };
  };

  ThorAgent.prototype.loginOperator = async function (payload = {}) {
    const first = await originalLoginOperator.call(this, payload);

    // Se um ciclo automático estiver em andamento, aguarda terminar para garantir
    // uma sincronização real e nova depois do PIN.
    const startedAt = Date.now();
    while (this.sync.running && Date.now() - startedAt < 20000) await sleep(100);

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

  ThorAgent.prototype._implicitCashOpen = function (reason = 'movement') {
    if (this.store.get('cash_open_event_id')) return { created: false, eventId: this.store.get('cash_open_event_id') };
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    const event = this.event('cash_open', {
      opening_amount: 0,
      notes: `Abertura automática no primeiro movimento (${reason})`,
      operator_user_id: operator.id,
      automatic: true,
      opening_mode: 'first_movement',
    });
    this.store.set('cash_open_event_id', event.id);
    return { created: true, eventId: event.id };
  };

  ThorAgent.prototype._rollbackImplicitCashOpen = function (eventId) {
    if (!eventId) return;
    if (String(this.store.get('cash_open_event_id') || '') === String(eventId)) {
      this.store.set('cash_open_event_id', '');
    }
    this.store.db.prepare("delete from queue where id=? and type='cash_open' and state='pending'").run(eventId);
  };

  // A primeira venda não pode ultrapassar a abertura do caixa na fila.
  // Se a abertura ainda estiver pendente, aguardamos o sync terminar e forçamos
  // uma rodada exclusiva antes de enfileirar sale_completed. Em modo offline a
  // venda continua permitida e será enviada depois, preservando o offline-first.
  ThorAgent.prototype._ensureCashOpenReadyForSale = async function () {
    const eventId = String(this.store.get('cash_open_event_id') || '');
    if (!eventId) return { ok: false, error: 'cash_not_open' };

    const getRow = () => this.store.db.prepare(
      "select id,type,state,last_error from queue where id=? and type='cash_open' limit 1"
    ).get(eventId);

    let row = getRow();
    if (!row || row.state === 'synced') return { ok: true, localOnly: !row };

    // Uma rejeição anterior pode ter sido transitória. Reabre somente o cash_open
    // para uma tentativa idempotente; uma rejeição persistente bloqueia a venda.
    if (row.state === 'rejected') {
      this.store.db.prepare(
        "update queue set state='pending',last_error=null,updated_at=? where id=? and type='cash_open'"
      ).run(new Date().toISOString(), eventId);
      row = getRow();
    }

    const startedAt = Date.now();
    while (this.sync.running && Date.now() - startedAt < 20000) await sleep(100);

    const sync = await this.sync.run(true);
    row = getRow();

    if (!sync?.ok) {
      // Sem comunicação: mantém a operação offline-first. Como cash_open foi
      // criado antes da venda, a ordem da fila local será preservada no retry.
      return { ok: true, offline: true, error: sync?.error || 'sync_unavailable' };
    }

    if (row?.state === 'rejected') {
      const error = new Error(row.last_error || 'cash_open_sync_rejected');
      error.code = 'cash_open_sync_rejected';
      throw error;
    }

    return { ok: true, synced: row?.state === 'synced' };
  };

  ThorAgent.prototype.finalizeSale = async function (payload = {}) {
    let implicit = null;
    if (!this.store.get('cash_open_event_id')) implicit = this._implicitCashOpen('sale');
    try {
      await this._ensureCashOpenReadyForSale();
      return await originalFinalizeSale.call(this, payload);
    } catch (error) {
      if (implicit?.created && error?.code === 'cash_open_sync_rejected') {
        this._rollbackImplicitCashOpen(implicit.eventId);
      }
      throw error;
    }
  };

  ThorAgent.prototype.cashMovement = async function (payload = {}) {
    let implicit = null;
    if (!this.store.get('cash_open_event_id')) implicit = this._implicitCashOpen(payload.movementType || 'cash_movement');
    try {
      return await originalCashMovement.call(this, payload);
    } catch (error) {
      if (implicit?.created) this._rollbackImplicitCashOpen(implicit.eventId);
      throw error;
    }
  };

  ThorAgent.prototype.returnSale = async function (payload = {}) {
    let implicit = null;
    const refundMethod = String(payload.refundMethod || payload.refund_method || '');
    if (refundMethod === 'cash' && !this.store.get('cash_open_event_id')) implicit = this._implicitCashOpen('cash_refund');
    try {
      return await originalReturnSale.call(this, payload);
    } catch (error) {
      if (implicit?.created) this._rollbackImplicitCashOpen(implicit.eventId);
      throw error;
    }
  };

  ThorAgent.prototype.manualSync = async function () {
    const operator = this.currentOperator?.();
    if (operator && typeof this._profileAllows === 'function' && !this._profileAllows('sync.manual', true)) {
      throw new Error('manual_sync_not_allowed');
    }
    const startedAt = Date.now();
    while (this.sync.running && Date.now() - startedAt < 20000) await sleep(100);
    return this.sync.run(true);
  };

  ThorAgent.prototype.syncPolicy = function () {
    return {
      intervalMs: Number(this.sync?.intervalMs || 300000),
      intervalMinutes: Math.round(Number(this.sync?.intervalMs || 300000) / 60000),
      syncAfterOperatorLogin: true,
      manualSyncForced: true,
      lazyCashOpening: true,
      firstSaleWaitsForCashAck: true,
      askCashOpening: this.v3Settings().askCashOpening,
    };
  };
}

module.exports = { installSyncPolicy };
