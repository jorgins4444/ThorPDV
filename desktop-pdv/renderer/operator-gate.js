let thorOperatorGateVisible = false;
let thorOperatorGateLoading = false;

function thorOperatorGateContext() {
  const context = state.status?.context || {};
  return {
    branch: context.branch_name || 'Filial',
    pos: context.pos_name || context.pos_code || 'PDV',
    company: context.company_name || 'ThorPDV',
  };
}

function thorOperatorGateRemove() {
  document.getElementById('thorOperatorGate')?.remove();
  thorOperatorGateVisible = false;
  try { v3State().operatorPromptOpen = false; } catch {}
}

function thorGateProgress(gate, percent, label, detail = '') {
  const wrap = gate?.querySelector('#gateProgress');
  const bar = gate?.querySelector('#gateProgressBar');
  const pct = gate?.querySelector('#gateProgressPct');
  const text = gate?.querySelector('#gateProgressText');
  const sub = gate?.querySelector('#gateProgressDetail');
  if (!wrap) return;
  wrap.hidden = false;
  wrap.classList.remove('error', 'offline', 'success', 'background');
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  if (bar) bar.style.width = `${value}%`;
  if (pct) pct.textContent = `${Math.round(value)}%`;
  if (text) text.textContent = label || 'Sincronizando...';
  if (sub) sub.textContent = detail || '';
}

function thorGateSyncDate(value) {
  if (!value) return 'Aguardando primeira sincronização';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Dados locais disponíveis';
  return `Dados atualizados em ${date.toLocaleString('pt-BR')}`;
}

function thorResolveOperator(operators, value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  return operators.find((operator) => String(operator.email || '').trim().toLowerCase() === key)
    || operators.find((operator) => String(operator.name || '').trim().toLowerCase() === key)
    || operators.find((operator) => String(operator.id || '').trim().toLowerCase() === key)
    || null;
}

async function thorOperatorGateShow(message = '') {
  if (!state.status?.enrolled) return;
  const current = state.status?.operator || (() => { try { return v3State().operator; } catch { return null; } })();
  if (current) {
    thorOperatorGateRemove();
    return;
  }
  if (thorOperatorGateLoading) return;
  thorOperatorGateLoading = true;
  try {
    try { v3State().operatorPromptOpen = true; } catch {}
    let operators = [];
    try { operators = await window.thor.operators(); } catch {}
    const context = thorOperatorGateContext();
    const version = state.status?.appVersion || '—';
    const lastSync = thorGateSyncDate(state.status?.lastSyncAt);
    let gate = document.getElementById('thorOperatorGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'thorOperatorGate';
      gate.className = 'operator-gate';
      document.body.appendChild(gate);
    }
    thorOperatorGateVisible = true;
    gate.innerHTML = `
      <div class="operator-gate-appbar">
        <div class="operator-app-title"><i>ϟ</i><span>ThorPDV Caixa - versão ${esc(version)}</span></div>
        <div class="operator-app-menu">Menu fiscal</div>
      </div>
      <div class="operator-gate-lightning" aria-hidden="true">ϟ</div>
      <section class="operator-gate-card">
        <header class="operator-login-brand-row">
          <div class="operator-login-mark"><span>ϟ</span></div>
          <div class="operator-login-wordmark">Thor<span>PDV</span></div>
          <i></i>
          <b>Caixa</b>
        </header>
        <div class="operator-login-accent"><i></i><b></b></div>
        <div class="operator-gate-terminal">
          <span><small>Empresa</small><b>${esc(context.company)}</b></span>
          <span><small>Filial</small><b>${esc(context.branch)}</b></span>
          <span><small>Terminal</small><b>${esc(context.pos)}</b></span>
        </div>
        ${operators.length ? `
          <div id="gateLoginFields" class="operator-login-fields">
            <label class="operator-gate-field"><span>Usuário ou e-mail</span><div class="operator-input-shell"><i class="operator-field-icon">♙</i><input id="gateOperatorSearch" list="gateOperatorList" autocomplete="username" placeholder="Digite seu usuário ou e-mail"><datalist id="gateOperatorList">${operators.map(o => `<option value="${esc(o.email || o.name || '')}">${esc(o.name)} — ${esc(o.profile_name || 'PDV')}</option>`).join('')}</datalist></div></label>
            <label class="operator-gate-field"><span>Senha ou PIN</span><div class="operator-input-shell"><i class="operator-field-icon">▣</i><input id="gatePin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" placeholder="Digite sua senha ou PIN"><button type="button" id="gateTogglePin" class="operator-pin-toggle" aria-label="Mostrar ou ocultar PIN">◉</button></div></label>
            <div id="gateError" class="operator-gate-error">${esc(message)}</div>
            <div class="operator-login-actions">
              <button id="gateLogin" class="operator-gate-primary"><span>↪</span> Acessar <kbd>Enter</kbd></button>
              <button id="gateCardAccess" type="button" class="operator-gate-card-access"><span>▤</span> Acesso com cartão <kbd>F5</kbd></button>
            </div>
          </div>
          <div id="gateProgress" class="operator-sync-progress" hidden>
            <div class="operator-sync-title"><strong id="gateProgressText">Sincronizando...</strong><b id="gateProgressPct">0%</b></div>
            <div class="operator-sync-track"><i id="gateProgressBar"></i></div>
            <p id="gateProgressDetail">Preparando comunicação com o Thor Gestão...</p>
            <div id="gateOfflineActions" class="operator-sync-actions"></div>
          </div>
        ` : `
          <div class="operator-gate-warning">Nenhum operador PDV está disponível neste terminal. Sincronize para baixar os usuários e perfis do Thor Gestão.</div>
          <div id="gateError" class="operator-gate-error">${esc(message)}</div>
          <button id="gateSync" class="operator-gate-primary">Sincronizar operadores</button>
        `}
        <div class="operator-login-sync-state ${state.status?.online ? 'online' : ''}">
          <span class="operator-sync-check">${state.status?.lastSyncAt ? '✓' : '↻'}</span>
          <span><b>${state.status?.syncing ? 'Sincronização em andamento' : state.status?.lastSyncAt ? 'Sincronização concluída' : 'Pronto para sincronizar'}</b><small>${esc(lastSync)}</small></span>
          <i>${state.status?.online ? '●' : '◌'}</i>
        </div>
      </section>
      <footer class="operator-gate-shortcuts">
        <span><i>⚙</i> Configurações <kbd>F10</kbd></span>
        <span><i>◉</i> Personalizar <kbd>F12</kbd></span>
        <span><i>↻</i> Sincronização pendente <kbd>F3</kbd></span>
      </footer>`;

    const pin = gate.querySelector('#gatePin');
    const operatorInput = gate.querySelector('#gateOperatorSearch');
    const login = gate.querySelector('#gateLogin');
    const error = gate.querySelector('#gateError');
    const fields = gate.querySelector('#gateLoginFields');
    const progress = gate.querySelector('#gateProgress');
    const cardAccess = gate.querySelector('#gateCardAccess');
    let progressTimer = null;

    if (operatorInput && operators.length === 1) operatorInput.value = operators[0].email || operators[0].name || '';

    const finishEntry = async (result, mode = 'online') => {
      // Não aguarda status remoto aqui. O antigo await nesta etapa podia deixar a
      // interface parada visualmente em 100% mesmo com o operador já autenticado.
      state.status = { ...(state.status || {}), operator: result.operator };
      try {
        const v = v3State();
        v.operator = result.operator;
        v.operatorPromptOpen = false;
      } catch {}

      if (mode === 'background') {
        thorGateProgress(gate, 100, 'Acesso liberado', 'A sincronização continuará em segundo plano sem bloquear o caixa.');
        progress?.classList.add('success', 'background');
      } else if (mode === 'offline') {
        thorGateProgress(gate, 100, 'Modo de contingência', 'Operador validado localmente. A sincronização será retomada quando a conexão voltar.');
        progress?.classList.add('offline');
      } else {
        thorGateProgress(gate, 100, 'Sincronização concluída', 'Produtos, estoque, permissões e fila estão atualizados.');
        progress?.classList.add('success');
      }

      await new Promise(resolve => setTimeout(resolve, 180));
      thorOperatorGateRemove();
      try { render(); } catch (renderError) { console.error('[ThorPDV login render]', renderError); }
      window.thor.status().then((fresh) => {
        state.status = { ...fresh, operator: fresh.operator || result.operator };
        try { updateTop(); } catch {}
      }).catch(() => {});
      showToast(mode === 'offline'
        ? `Operador ${result.operator.name} entrou em contingência offline.`
        : mode === 'background'
          ? `Operador ${result.operator.name} identificado. Sincronização continua em segundo plano.`
          : `Operador ${result.operator.name} identificado e sincronizado.`);
    };

    const doLogin = async () => {
      if (!login || !pin || !operatorInput) return;
      const selectedOperator = thorResolveOperator(operators, operatorInput.value);
      if (!selectedOperator) {
        if (error) error.textContent = 'Informe um usuário ou e-mail válido.';
        operatorInput.focus();
        return;
      }
      const originalPin = pin.value;
      if (!originalPin) {
        if (error) error.textContent = 'Informe sua senha ou PIN.';
        pin.focus();
        return;
      }
      try {
        login.disabled = true;
        operatorInput.disabled = true;
        pin.disabled = true;
        if (cardAccess) cardAccess.disabled = true;
        if (error) error.textContent = '';
        if (fields) fields.classList.add('syncing');
        thorGateProgress(gate, 8, 'Validando operador...', 'Conferindo usuário, PIN e perfil local.');
        let simulated = 8;
        progressTimer = setInterval(() => {
          simulated = Math.min(simulated + 4, 88);
          const label = simulated < 30 ? 'Enviando operações pendentes...' : simulated < 58 ? 'Atualizando produtos e estoque...' : simulated < 78 ? 'Atualizando usuários e permissões...' : 'Confirmando comunicação com o Thor Gestão...';
          const detail = simulated < 30 ? 'Vendas, pagamentos e movimentos de caixa são enviados primeiro.' : simulated < 58 ? 'Recebendo catálogo, preços e posição de estoque.' : simulated < 78 ? 'Aplicando o perfil atualizado do operador.' : 'Finalizando heartbeat e estado do terminal.';
          thorGateProgress(gate, simulated, label, detail);
        }, 320);

        const result = await window.thor.operatorLogin({ userId: selectedOperator.id, pin: originalPin });
        clearInterval(progressTimer);
        progressTimer = null;

        if (result?.sync?.pending || result?.sync?.background) {
          await finishEntry(result, 'background');
          return;
        }

        if (result?.sync?.ok === false) {
          thorGateProgress(gate, 96, 'Não foi possível concluir a sincronização', `Thor Gestão indisponível: ${friendlyError(result.sync.error || 'sync_unavailable')}`);
          progress?.classList.add('offline');
          const actions = gate.querySelector('#gateOfflineActions');
          if (actions) {
            actions.innerHTML = '<button id="gateRetry" class="operator-gate-primary">Tentar sincronizar novamente</button><button id="gateEnterOffline" class="operator-gate-secondary">Entrar em contingência</button>';
            actions.querySelector('#gateRetry').onclick = () => {
              actions.innerHTML = '';
              operatorInput.disabled = false;
              pin.disabled = false;
              if (cardAccess) cardAccess.disabled = false;
              pin.value = originalPin;
              doLogin();
            };
            actions.querySelector('#gateEnterOffline').onclick = () => finishEntry(result, 'offline');
          }
          return;
        }

        await finishEntry(result, 'online');
      } catch (e) {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
        if (progress) progress.hidden = true;
        if (fields) fields.classList.remove('syncing');
        if (error) error.textContent = friendlyError(e.message);
        pin.disabled = false;
        operatorInput.disabled = false;
        if (cardAccess) cardAccess.disabled = false;
        pin.value = '';
        pin.focus();
      } finally {
        if (login && document.body.contains(login)) login.disabled = false;
      }
    };

    if (login) login.onclick = doLogin;
    if (pin) {
      pin.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doLogin();
        }
      };
    }
    const togglePin = gate.querySelector('#gateTogglePin');
    if (togglePin && pin) togglePin.onclick = () => {
      pin.type = pin.type === 'password' ? 'text' : 'password';
      togglePin.classList.toggle('active', pin.type === 'text');
      pin.focus();
    };
    if (cardAccess) cardAccess.onclick = () => {
      if (error) error.textContent = 'Acesso por cartão ficará disponível quando um leitor de identificação estiver configurado neste terminal.';
    };

    if (operatorInput) operatorInput.focus();

    const sync = gate.querySelector('#gateSync');
    if (sync) sync.onclick = async () => {
      try {
        sync.disabled = true;
        sync.textContent = 'Sincronizando...';
        await Promise.race([
          window.thor.sync(),
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, pending: true }), 15000)),
        ]);
        state.status = await window.thor.status();
        thorOperatorGateLoading = false;
        await thorOperatorGateShow('');
      } catch (e) {
        if (error) error.textContent = friendlyError(e.message);
      } finally {
        if (sync && document.body.contains(sync)) {
          sync.disabled = false;
          sync.textContent = 'Sincronizar operadores';
        }
      }
    };
  } finally {
    thorOperatorGateLoading = false;
  }
}

const thorOperatorOriginalRender = render;
render = function () {
  thorOperatorOriginalRender();
  if (state.status?.enrolled) queueMicrotask(() => thorOperatorGateShow());
  else thorOperatorGateRemove();
};

document.addEventListener('keydown', e => {
  if (!thorOperatorGateVisible) return;
  if (e.key === 'F5') {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.getElementById('gateCardAccess')?.click();
    return;
  }
  if (['F2','F3','F4','F6','F10','F12'].includes(e.key)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);