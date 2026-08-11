(() => {
  let lastInfo = null;
  let currentModal = null;

  const escUpdate = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const updateError = (code) => ({
    update_device_not_enrolled: 'Este terminal ainda não está ativado.',
    update_not_available: 'Não há atualização liberada para este terminal.',
    update_pending_sync: 'Existem operações locais ainda não sincronizadas. Sincronize antes de atualizar.',
    update_https_required: 'O pacote de atualização precisa usar HTTPS.',
    update_sha256_invalid: 'O SHA-256 da versão liberada é inválido.',
    update_sha256_mismatch: 'O arquivo baixado não corresponde ao SHA-256 cadastrado. A instalação foi bloqueada.',
    update_already_installing: 'Uma atualização já está em andamento.',
  }[code] || code || 'Falha ao atualizar o ThorPDV.');

  function settingsButton() { return document.getElementById('settings'); }

  function paintBadge(info) {
    const button = settingsButton();
    if (!button) return;
    const old = button.querySelector('.update-pending-dot');
    if (info?.update_available) {
      if (!old) button.insertAdjacentHTML('beforeend', '<i class="update-pending-dot" title="Atualização disponível"></i>');
    } else old?.remove();
  }

  function steps(stage) {
    const all = [
      ['checking','Buscando atualização'],['syncing','Sincronizando dados'],['downloading','Baixando pacote'],
      ['verified','Validando SHA-256'],['installing','Instalando'],['installed','Sincronizando nova versão']
    ];
    const order = all.map(x => x[0]);
    let idx = order.indexOf(stage);
    if (stage === 'available' || stage === 'current' || stage === 'preparing') idx = 0;
    if (stage === 'error') idx = -1;
    return `<div class="update-progress-steps">${all.map(([key,label],i)=>`<div class="update-progress-step ${idx>i?'done':idx===i?'active':''}"><i>${idx>i?'✓':''}</i><span>${label}</span></div>`).join('')}</div>`;
  }

  function ensurePanel(modal) {
    if (!modal) return null;
    let panel = modal.querySelector('#pdvUpdatePanel');
    if (panel) return panel;
    const card = modal.querySelector('.modal-card');
    const actions = card?.querySelector(':scope > .actions');
    panel = document.createElement('section');
    panel.id = 'pdvUpdatePanel';
    panel.className = 'pdv-update-panel';
    panel.innerHTML = '<div class="pdv-update-loading">Carregando controle de atualizações...</div>';
    if (actions) card.insertBefore(panel, actions); else card?.appendChild(panel);
    return panel;
  }

  function render(info = lastInfo, progress = null) {
    if (!currentModal?.isConnected) return;
    const panel = ensurePanel(currentModal); if (!panel) return;
    const installed = state?.status?.appVersion || info?.current_version || info?.currentVersion || '—';
    const available = Boolean(info?.update_available);
    const target = info?.target_version || info?.release?.version || '';
    const direction = info?.direction === 'rollback' ? 'Rollback' : 'Atualização';
    const mode = info?.mode === 'mandatory' ? 'Prioritária' : 'Disponível';
    const stage = progress?.stage || (available ? 'available' : 'current');
    const downloading = stage === 'downloading';
    const percent = Number(progress?.progress || 0);
    const error = stage === 'error' ? updateError(progress?.error) : '';
    panel.innerHTML = `<div class="pdv-update-head"><div><small>ATUALIZAÇÕES DO THORPDV</small><h4>Central de atualização</h4><p>Versão instalada: <b>${escUpdate(installed)}</b></p></div><span class="pdv-update-state ${available?'available':'current'}">${available?`${direction} ${mode}`:'Atualizado'}</span></div>
      ${available?`<div class="pdv-update-release"><div><strong>v${escUpdate(target)}</strong><span>${escUpdate(info?.release?.channel||'stable')} · ${escUpdate(info?.scope||'global')}</span></div><p>${escUpdate(info?.release?.release_notes||info?.reason||'Nova versão liberada pelo ThorControl.')}</p>${info?.direction==='rollback'?'<div class="pdv-update-rollback">↶ O ThorControl definiu uma versão anterior como alvo deste terminal.</div>':''}</div>`:'<p class="muted">Nenhuma versão diferente foi liberada pelo ThorControl para este terminal.</p>'}
      ${progress && !['available','current'].includes(stage)?`<div class="pdv-update-progress"><div class="update-flight"><div style="width:${downloading?percent:stage==='verified'?72:stage==='installing'?90:stage==='installed'?100:25}%"></div></div>${steps(stage)}${downloading?`<p>Download: <b>${percent}%</b></p>`:''}${error?`<div class="pdv-update-error">${escUpdate(error)}</div>`:''}</div>`:''}
      <div class="pdv-update-actions"><button class="secondary" id="checkThorUpdate" ${['syncing','downloading','verified','installing'].includes(stage)?'disabled':''}>Buscar atualizações</button>${available?`<button class="primary" id="installThorUpdate" ${['syncing','downloading','verified','installing'].includes(stage)?'disabled':''}>${info?.direction==='rollback'?`Aplicar rollback para ${escUpdate(target)}`:`Baixar e instalar ${escUpdate(target)}`}</button>`:''}</div>
      <small class="pdv-update-security">O THOR sincroniza antes da instalação e valida o SHA-256 do instalador. Nenhuma operação fiscal é retransmitida durante a atualização.</small>`;
    panel.querySelector('#checkThorUpdate')?.addEventListener('click', () => void check(false));
    panel.querySelector('#installThorUpdate')?.addEventListener('click', () => void install());
  }

  async function check(silent = false) {
    try {
      if (!silent) render(lastInfo, { stage: 'checking' });
      const info = await window.thor.checkForUpdates();
      lastInfo = info; paintBadge(info); render(info, { stage: info.update_available ? 'available' : 'current' });
      return info;
    } catch (e) {
      if (!silent) render(lastInfo, { stage: 'error', error: String(e?.message || e) });
      return null;
    }
  }

  async function install() {
    if (!lastInfo?.update_available) { await check(false); if (!lastInfo?.update_available) return; }
    try { render(lastInfo, { stage: 'preparing' }); await window.thor.installUpdate(); }
    catch (e) { render(lastInfo, { stage: 'error', error: String(e?.message || e) }); }
  }

  const originalSettingsModal = window.settingsModal;
  if (typeof originalSettingsModal === 'function') {
    window.settingsModal = async function(...args) {
      await originalSettingsModal(...args);
      const modals = [...document.querySelectorAll('.modal')];
      currentModal = modals[modals.length - 1] || null;
      ensurePanel(currentModal);
      render(lastInfo || { update_available: false, current_version: state?.status?.appVersion });
      void check(true).then(() => render(lastInfo));
    };
  }

  window.thor.onUpdateProgress?.((payload) => {
    if (payload?.stage === 'available' && payload.update_available != null) lastInfo = payload;
    render(lastInfo, payload);
  });
  window.thor.onUpdateStatus?.((info) => { if (info?.available) { lastInfo = info.available; paintBadge(lastInfo); } });

  setTimeout(() => {
    if (state?.status?.enrolled) void check(true);
  }, 1400);

  window.thorUpdateUI = { check, install, render };
})();
