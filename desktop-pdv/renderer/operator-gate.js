let thorOperatorGateVisible = false;
let thorOperatorGateLoading = false;
let thorOperatorGateTicket = 0;
let thorOperatorGateUnlockedUntil = 0;

function thorOperatorGateContext() {
  const context = state.status?.context || {};
  return {
    branch: context.branch_name || 'Filial',
    pos: context.pos_name || context.pos_code || 'PDV',
    company: context.company_name || 'ThorPDV',
  };
}

function thorCurrentOperator() {
  if (state.status?.operator) return state.status.operator;
  try { return v3State().operator || null; } catch { return null; }
}

function thorOperatorGateUnlocked() {
  return Boolean(thorCurrentOperator()) || Date.now() < thorOperatorGateUnlockedUntil;
}

function thorOperatorGateRemove() {
  thorOperatorGateTicket += 1;
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
  if (text) text.textContent = label || 'Validando acesso...';
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
  if (!state.status?.enrolled) {
    thorOperatorGateRemove();
    return;
  }
  if (thorOperatorGateUnlocked()) {
    thorOperatorGateRemove();
    return;
  }
  if (thorOperatorGateLoading) return;

  const ticket = ++thorOperatorGateTicket;
  thorOperatorGateLoading = true;
  try {
    try { v3State().operatorPromptOpen = true; } catch {}

    let operators = [];
    try { operators = await window.thor.operators(); } catch {}

    // A consulta de operadores é assíncrona. Revalida a sessão antes de montar
    // o overlay para impedir que uma chamada antiga recrie o login depois que o
    // operador já foi autenticado e o caixa liberado.
    if (ticket !== thorOperatorGateTicket || thorOperatorGateUnlocked() || !state.status?.enrolled) {
      if (thorOperatorGateUnlocked()) thorOperatorGateRemove();
      return;
    }

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

    // Empresa/filial/terminal não ficam no DOM da tela normal de login. Essas
    // informações só são criadas quando o usuário abre Configurações / F10.
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
            <div class="operator-sync-title"><strong id="gateProgressText">Validando acesso...</strong><b id="gateProgressPct">35%</b></div>
            <div class="operator-sync-track"><i id="gateProgressBar"></i></div>
            <p id="gateProgressDetail">Conferindo usuário e PIN localmente.</p>
          </div>
        ` : `
          <div class="operator-gate-warning">Nenhum operador PDV está disponível neste terminal. Sincronize para baixar os usuários e perfis do Thor Gestão.</div>
          <div id="gateError" class="operator-gate-error">${esc(message)}</div>
          <button id="gateSync" class="operator-gate-primary">Sincronizar operadores</button>
        `}
        <div class="operator-login-sync-state ${state.status?.online ? 'online' : ''}">
          <span class="operator-sync-check">${state.status?.lastSyncAt ? '✓' : '↻'}</span>
          <span><b>${state.status?.syncing ? 'Sincronização em segundo plano' : state.status?.lastSyncAt ? 'Dados locais disponíveis' : 'Pronto para sincronizar'}</b><small>${esc(lastSync)}</small></span>
          <i>${state.status?.online ? '●' : '◌'}</i>
        </div>
      </section>
      <footer class="operator-gate-shortcuts">
        <span data-terminal-config><i>⚙</i> Configurações <kbd>F10</kbd></span>
        <span><i>◉</i> Personalizar <kbd>F12</kbd></span>
        <span><i>↻</i> Sincronização <kbd>F3</kbd></span>
      </footer>`;

    const pin = gate.querySelector('#gatePin');
    const operatorInput = gate.querySelector('#gateOperatorSearch');
    const login = gate.querySelector('#gateLogin');
    const error = gate.querySelector('#gateError');
    const fields = gate.querySelector('#gateLoginFields');
    const progress = gate.querySelector('#gateProgress');
    const cardAccess = gate.querySelector('#gateCardAccess');

    if (operatorInput && operators.length === 1) operatorInput.value = operators[0].email || operators[0].name || '';

    const finishEntry = (result) => {
      if (!result?.operator) throw new Error('operator_login_failed');

      state.status = { ...(state.status || {}), operator: result.operator };
      state.view = 'sale';
      try {
        const v = v3State();
        v.operator = result.operator;
        v.operatorPromptOpen = false;
      } catch {}

      // Libera a UI antes de qualquer status, sincronização ou nova renderização.
      // O período de desbloqueio também neutraliza chamadas assíncronas antigas que
      // tenham começado a abrir o login antes da autenticação terminar.
      thorOperatorGateUnlockedUntil = Date.now() + 30000;
      thorOperatorGateRemove();

      try { render(); } catch (renderError) { console.error('[ThorPDV operator entry render]', renderError); }
      queueMicrotask(() => thorOperatorGateRemove());
      requestAnimationFrame(() => thorOperatorGateRemove());

      try { showToast(`Bem-vindo, ${result.operator.name}. Sincronização continua em segundo plano.`); } catch {}

      // Atualização de status é sempre posterior à abertura do caixa e preserva o
      // operador já autenticado caso uma leitura intermediária chegue incompleta.
      setTimeout(async () => {
        try {
          const fresh = await window.thor.status();
          const operator = fresh.operator || state.status?.operator || result.operator;
          state.status = { ...fresh, operator };
          if (fresh.licenseBlocked || fresh.pairingInvalidated || !operator) {
            thorOperatorGateUnlockedUntil = 0;
            render();
            return;
          }
          try { updateTop(); } catch {}
        } catch {}
      }, 900);
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
        thorGateProgress(gate, 35, 'Validando acesso...', 'Conferindo usuário, PIN e permissões locais.');

        const result = await window.thor.operatorLogin({ userId: selectedOperator.id, pin: originalPin });

        // Login válido sempre entra imediatamente. O retorno de sincronização não
        // decide navegação; rede e sync são processos de background.
        finishEntry(result);
      } catch (e) {
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
          new Promise(resolve => setTimeout(() => resolve({ ok: false, pending: true }), 15000)),
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
  if (!state.status?.enrolled) {
    thorOperatorGateRemove();
    return;
  }
  if (thorOperatorGateUnlocked()) {
    thorOperatorGateRemove();
    return;
  }
  queueMicrotask(() => thorOperatorGateShow());
};

document.addEventListener('keydown', e => {
  if (!thorOperatorGateVisible) return;
  if (e.key === 'F5') {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.getElementById('gateCardAccess')?.click();
    return;
  }
  if (['F2','F3','F4','F6','F12'].includes(e.key)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);