const recoveryOriginalRender = render;
const recoveryOriginalUpdateTop = updateTop;

render = function () {
  recoveryOriginalRender();
  if (state.status?.enrolled) setTimeout(renderSyncRecoveryIndicator, 0);
};

updateTop = function () {
  recoveryOriginalUpdateTop();
  if (state.status?.enrolled) renderSyncRecoveryIndicator();
};

function syncCount(diag, key) {
  return Number(diag?.stats?.[key] || 0);
}

async function renderSyncRecoveryIndicator() {
  const top = document.querySelector('.top-right');
  if (!top || document.getElementById('syncRecoveryBtn')) return;
  let diag = state.status?.syncDiagnostics;
  try { diag = await window.thor.syncDiagnostics(); } catch {}
  const pending = syncCount(diag, 'pending');
  const rejected = syncCount(diag, 'rejected');
  const button = document.createElement('button');
  button.id = 'syncRecoveryBtn';
  button.className = `secondary compact ${rejected ? 'sync-attention' : ''}`;
  button.innerHTML = `Fila ↑ <b>${pending}</b>${rejected ? ` / <b>${rejected} erro</b>` : ''}`;
  button.title = 'Diagnóstico e recuperação da sincronização PDV → Gestão';
  button.onclick = syncRecoveryModal;
  const syncButton = document.getElementById('sync');
  top.insertBefore(button, syncButton || null);
}

async function syncRecoveryModal() {
  let diag;
  try { diag = await window.thor.syncDiagnostics(); }
  catch (e) { return infoModal('Sincronização', friendlyError(e.message)); }
  const pending = syncCount(diag, 'pending');
  const rejected = syncCount(diag, 'rejected');
  const synced = syncCount(diag, 'synced');
  const events = Array.isArray(diag.events) ? diag.events : [];
  const rows = events.slice(0, 20).map((event) => `<tr><td>${esc(event.type)}</td><td>${esc(event.state)}</td><td>${Number(event.attempts || 0)}</td><td>${esc(event.last_error || '—')}</td></tr>`).join('');
  const m = modal(`<div class="settings-head"><div><small>SINCRONIZAÇÃO BIDIRECIONAL</small><h3>Fila PDV → Gestão</h3></div><span>ThorPDV ${esc(state.status?.appVersion || '')}</span></div>
    <div class="sync-health-grid">
      <article><small>Pendentes</small><strong>${pending}</strong></article>
      <article><small>Com erro</small><strong>${rejected}</strong></article>
      <article><small>Sincronizados</small><strong>${synced}</strong></article>
      <article><small>Último sync</small><strong>${diag.lastSyncAt ? dt(diag.lastSyncAt) : 'Nunca'}</strong></article>
    </div>
    ${diag.lastError ? `<div class="error"><b>Último erro:</b> ${esc(diag.lastError)}</div>` : ''}
    <p class="muted">Produtos, preços e estoque descem do Gestão. Vendas, pagamentos, caixa, devoluções e cancelamentos sobem pela fila local.</p>
    <div class="sync-events-table"><table class="fiscal-table"><thead><tr><th>Evento</th><th>Estado</th><th>Tentativas</th><th>Erro</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Nenhum evento pendente ou rejeitado.</td></tr>'}</tbody></table></div>
    <div id="recoverMessage" class="settings-error"></div>
    <div class="actions"><button class="danger" id="disconnectTerminal">Desconectar terminal</button><button class="secondary" id="closeRecovery">Fechar</button><button class="primary" id="recoverQueue">Reprocessar fila</button></div>`, 'wide');

  m.querySelector('#closeRecovery').onclick = () => m.remove();
  m.querySelector('#recoverQueue').onclick = async () => {
    const button = m.querySelector('#recoverQueue');
    const message = m.querySelector('#recoverMessage');
    try {
      button.disabled = true;
      button.textContent = 'Reprocessando...';
      const result = await window.thor.recoverSync();
      const d = result.diagnostics || await window.thor.syncDiagnostics();
      message.textContent = result.ok
        ? `Recuperação concluída. Pendentes: ${syncCount(d,'pending')}; erros: ${syncCount(d,'rejected')}.`
        : `A tentativa terminou com erro: ${d.lastError || result.sync?.error || 'erro desconhecido'}`;
      state.status = await window.thor.status();
      await refreshProducts();
      await refreshFiscalSales();
      setTimeout(() => { m.remove(); render(); }, 900);
    } catch (e) {
      message.textContent = friendlyError(e.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Reprocessar fila';
    }
  };
  m.querySelector('#disconnectTerminal').onclick = async () => {
    if (!confirm('Desconectar este computador do Gestão? As vendas e a fila local serão preservadas para subir após um novo pareamento.')) return;
    try {
      await window.thor.disconnectDevice();
      state.status = await window.thor.status();
      m.remove();
      render();
    } catch (e) { m.querySelector('#recoverMessage').textContent = friendlyError(e.message); }
  };
}
