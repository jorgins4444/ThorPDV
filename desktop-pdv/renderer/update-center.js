(() => {
  let lastInfo = null;
  let currentModal = null;

  const escUpdate = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeUpdateErrorCode = (value) => {
    const raw = String(value || '');
    const match = raw.match(/(update_[a-z0-9_]+)/i);
    return match ? match[1].toLowerCase() : raw;
  };
  const updateError = (value) => {
    const code = normalizeUpdateErrorCode(value);
    return ({
    update_device_not_enrolled: 'Este terminal ainda não está ativado.',
    update_not_available: 'Não há atualização liberada para este terminal.',
    update_pending_sync: 'Existem operações locais ainda não sincronizadas. Sincronize antes de atualizar.',
    update_https_required: 'O pacote de atualização precisa usar HTTPS.',
    update_sha256_invalid: 'O SHA-256 da versão liberada é inválido.',
    update_sha256_mismatch: 'O arquivo baixado não corresponde ao SHA-256 cadastrado. A instalação foi bloqueada.',
    update_already_installing: 'Uma atualização já está em andamento.',
    update_helper_start_failed: 'O Atualizador Thor não conseguiu abrir. A instalação foi interrompida antes de fechar o PDV.',
    update_sale_in_progress: 'Há uma venda em edição. Finalize ou limpe o carrinho antes de atualizar para não perder essa venda ainda não gravada.',
    update_helper_powershell_failed: 'O helper visual do Windows falhou; o Thor tentará automaticamente o modo alternativo.',
    update_helper_fallback_failed: 'Os dois modos do atualizador foram bloqueados pelo Windows. Use a instalação manual desta versão e consulte o log update-helper.log.',
  }[code] || code || 'Falha ao atualizar o ThorPDV.');
  };

  function settingsButton() { return document.getElementById('settings'); }

  function paintBadge(info) {
    const button = settingsButton();
    if (!button) return;
    const old = button.querySelector('.update-pending-dot');
    if (info?.update_available) {
      if (!old) button.insertAdjacentHTML('beforeend', '<i class="update-pending-dot" title="Atualização disponível"></i>');
    } else old?.remove();
  }

  function parseReleaseNotes(value) {
    const raw = String(value || '').trim();
    const result = { changes: [], improvements: [], fixes: [] };
    if (!raw) return result;

    try {
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(result)) {
          if (Array.isArray(parsed?.[key])) result[key] = parsed[key].map(String).filter(Boolean);
        }
        if (Object.values(result).some(items => items.length)) return result;
      }
    } catch {}

    let current = 'changes';
    let sawHeading = false;
    for (const sourceLine of raw.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line) continue;
      const normalized = line.replace(/[\[\]#:]/g, '').trim().toUpperCase();
      if (/^(ALTERAÇÕES|ALTERACOES|MUDANÇAS|MUDANCAS|NOVIDADES)$/.test(normalized)) {
        current = 'changes'; sawHeading = true; continue;
      }
      if (/^MELHORIAS$/.test(normalized)) {
        current = 'improvements'; sawHeading = true; continue;
      }
      if (/^(CORREÇÕES|CORRECOES|BUGFIXES|BUG FIXES)$/.test(normalized)) {
        current = 'fixes'; sawHeading = true; continue;
      }
      const item = line.replace(/^[-•*]\s*/, '').trim();
      if (item) result[current].push(item);
    }

    if (!sawHeading && result.changes.length > 1) return result;
    if (!Object.values(result).some(items => items.length)) result.changes.push(raw);
    return result;
  }

  function releaseNotesHtml(value) {
    const sections = parseReleaseNotes(value);
    const blocks = [
      ['changes', 'Mudanças e novidades'],
      ['improvements', 'Melhorias'],
      ['fixes', 'Correções'],
    ].filter(([key]) => sections[key].length);

    if (!blocks.length) return '<p class="pdv-release-empty">Esta versão não possui notas cadastradas.</p>';
    return `<div class="pdv-release-notes">${blocks.map(([key,label]) => `<section class="pdv-release-note ${key}"><b>${label}</b><ul>${sections[key].map(item => `<li>${escUpdate(item)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  }

  function steps(stage) {
    const all = [
      ['checking','Buscando atualização'],
      ['syncing','Sincronizando dados'],
      ['downloading','Baixando pacote'],
      ['verified','Validando SHA-256'],
      ['handoff','Preparando instalação'],
      ['installed','Nova versão pronta'],
    ];
    const order = all.map(x => x[0]);
    let normalized = stage;
    if (stage === 'helper_ready') normalized = 'handoff';
    if (stage === 'restart_validating') normalized = 'installed';
    let idx = order.indexOf(normalized);
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
    const busy = ['syncing','downloading','verified','handoff','helper_ready'].includes(stage);
    const pct = downloading ? percent : stage === 'verified' ? 70 : ['handoff','helper_ready'].includes(stage) ? 92 : stage === 'installed' ? 100 : 25;

    panel.innerHTML = `<div class="pdv-update-head"><div><small>ATUALIZAÇÕES DO THORPDV</small><h4>Central de atualização</h4><p>Versão instalada: <b>v${escUpdate(installed)}</b></p></div><span class="pdv-update-state ${available?'available':'current'}">${available?`${direction} ${mode}`:'Atualizado'}</span></div>
      ${available?`<div class="pdv-update-release"><div><strong>v${escUpdate(target)}</strong><span>${escUpdate(info?.release?.channel||'stable')} · ${escUpdate(info?.scope||'global')}</span></div>${releaseNotesHtml(info?.release?.release_notes||info?.reason||'')}${info?.direction==='rollback'?'<div class="pdv-update-rollback">↶ O ThorControl definiu uma versão anterior como alvo deste terminal. Rollback para versões anteriores à 0.8.2 pode pedir o PIN do operador novamente.</div>':''}</div>`:'<p class="muted">Nenhuma versão diferente foi liberada pelo ThorControl para este terminal.</p>'}
      ${progress && !['available','current'].includes(stage)?`<div class="pdv-update-progress"><div class="update-flight"><div style="width:${pct}%"></div></div>${steps(stage)}${downloading?`<p>Download: <b>${percent}%</b></p>`:''}${['handoff','helper_ready'].includes(stage)?'<div class="pdv-update-handoff">O Atualizador Thor vai permanecer visível enquanto o aplicativo principal reinicia e aplica os novos arquivos.</div>':''}${error?`<div class="pdv-update-error">${escUpdate(error)}</div>`:''}</div>`:''}
      <div class="pdv-update-actions"><button class="secondary" id="checkThorUpdate" ${busy?'disabled':''}>Buscar atualizações</button>${available?`<button class="primary" id="installThorUpdate" ${busy?'disabled':''}>${info?.direction==='rollback'?`Aplicar rollback para ${escUpdate(target)}`:`Baixar e instalar ${escUpdate(target)}`}</button>`:''}</div>
      <small class="pdv-update-security">Antes de instalar, o THOR sincroniza as operações persistidas e valida o SHA-256. A base SQLite do terminal não é removida pelo instalador. A venda que ainda estiver somente no carrinho precisa ser finalizada ou limpa.</small>`;
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
    if (Array.isArray(state?.cart) && state.cart.length) {
      render(lastInfo, { stage: 'error', error: 'update_sale_in_progress' });
      return;
    }
    if (!lastInfo?.update_available) { await check(false); if (!lastInfo?.update_available) return; }
    try {
      render(lastInfo, { stage: 'preparing' });
      await window.thor.installUpdate();
    } catch (e) {
      render(lastInfo, { stage: 'error', error: String(e?.message || e) });
    }
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

  window.thorUpdateUI = { check, install, render, parseReleaseNotes };
})();
