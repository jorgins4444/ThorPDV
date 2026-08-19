let thorOperatorGateVisible = false;
let thorOperatorGateLoading = false;

function thorOperatorGateContext() {
  const context = state.status?.context || {};
  return {
    branch: context.branch_name || 'Filial',
    pos: context.pos_name || context.pos_code || 'PDV',
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
  wrap.classList.remove('error', 'offline', 'success');
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  if (bar) bar.style.width = `${value}%`;
  if (pct) pct.textContent = `${Math.round(value)}%`;
  if (text) text.textContent = label || 'Sincronizando...';
  if (sub) sub.textContent = detail || '';
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
    let gate = document.getElementById('thorOperatorGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'thorOperatorGate';
      gate.className = 'operator-gate';
      document.body.appendChild(gate);
    }
    thorOperatorGateVisible = true;
    gate.innerHTML = `
      <section class="operator-gate-card">
        <div class="operator-gate-brand">ϟ THOR<span>PDV</span></div>
        <div class="operator-gate-terminal">
          <span>${esc(context.branch)}</span>
          <b>${esc(context.pos)}</b>
        </div>
        <div class="operator-gate-copy">
          <small>ACESSO AO FRENTE DE CAIXA</small>
          <h1>Identifique o operador</h1>
          <p>Após validar o PIN, o ThorPDV sincroniza vendas pendentes, produtos, estoque e permissões antes de liberar o caixa.</p>
        </div>
        ${operators.length ? `
          <div id="gateLoginFields">
            <label class="operator-gate-field"><span>Usuário PDV</span><select id="gateOperator">${operators.map(o => `<option value="${esc(o.id)}">${esc(o.name)} — ${esc(o.profile_name || 'PDV')}</option>`).join('')}</select></label>
            <label class="operator-gate-field"><span>PIN</span><input id="gatePin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Digite seu PIN"></label>
            <div id="gateError" class="operator-gate-error">${esc(message)}</div>
            <button id="gateLogin" class="operator-gate-primary">Entrar no caixa <kbd>Enter</kbd></button>
          </div>
          <div id="gateProgress" class="operator-sync-progress" hidden>
            <div class="operator-sync-title"><strong id="gateProgressText">Sincronizando...</strong><b id="gateProgressPct">0%</b></div>
            <div class="operator-sync-track"><i id="gateProgressBar"></i></div>
            <p id="gateProgressDetail">Preparando comunicação com o Gestão...</p>
            <div id="gateOfflineActions" class="operator-sync-actions"></div>
          </div>
        ` : `
          <div class="operator-gate-warning">Nenhum operador PDV está disponível neste terminal. Sincronize para baixar os usuários e perfis do Gestão.</div>
          <div id="gateError" class="operator-gate-error">${esc(message)}</div>
          <button id="gateSync" class="operator-gate-primary">Sincronizar operadores</button>
        `}
        <div class="operator-gate-foot"><span>Terminal pareado</span><span>Permissões por perfil</span><span>Sync automático a cada 5 min</span></div>
      </section>`;

    const pin = gate.querySelector('#gatePin');
    const login = gate.querySelector('#gateLogin');
    const error = gate.querySelector('#gateError');
    const fields = gate.querySelector('#gateLoginFields');
    const progress = gate.querySelector('#gateProgress');
    let progressTimer = null;

    const finishEntry = async (result, offline = false) => {
      state.status = await window.thor.status().catch(() => state.status);
      state.status.operator = result.operator;
      try {
        const v = v3State();
        v.operator = result.operator;
        v.operatorPromptOpen = false;
      } catch {}
      if (!offline) {
        thorGateProgress(gate, 100, 'Sincronização concluída', 'Produtos, estoque, permissões e fila estão atualizados.');
        progress?.classList.add('success');
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      thorOperatorGateRemove();
      render();
      showToast(offline ? `Operador ${result.operator.name} entrou em modo offline.` : `Operador ${result.operator.name} identificado e sincronizado.`);
    };

    const doLogin = async () => {
      if (!login || !pin) return;
      const userId = gate.querySelector('#gateOperator')?.value || '';
      const originalPin = pin.value;
      try {
        login.disabled = true;
        gate.querySelector('#gateOperator').disabled = true;
        pin.disabled = true;
        if (error) error.textContent = '';
        if (fields) fields.classList.add('syncing');
        thorGateProgress(gate, 8, 'Validando operador...', 'Conferindo usuário, PIN e perfil local.');
        let simulated = 8;
        progressTimer = setInterval(() => {
          simulated = Math.min(simulated + 5, 88);
          const label = simulated < 30 ? 'Enviando operações pendentes...' : simulated < 58 ? 'Atualizando produtos e estoque...' : simulated < 78 ? 'Atualizando usuários e permissões...' : 'Confirmando comunicação com o Gestão...';
          const detail = simulated < 30 ? 'Vendas, pagamentos e movimentos de caixa são enviados primeiro.' : simulated < 58 ? 'Recebendo catálogo, preços e posição de estoque.' : simulated < 78 ? 'Aplicando o perfil atualizado do operador.' : 'Finalizando heartbeat e estado do terminal.';
          thorGateProgress(gate, simulated, label, detail);
        }, 300);

        const result = await window.thor.operatorLogin({ userId, pin: originalPin });
        clearInterval(progressTimer);
        progressTimer = null;

        if (result?.sync?.ok === false) {
          thorGateProgress(gate, 100, 'Não foi possível sincronizar', `Gestão indisponível: ${friendlyError(result.sync.error || 'sync_unavailable')}`);
          progress?.classList.add('offline');
          const actions = gate.querySelector('#gateOfflineActions');
          if (actions) {
            actions.innerHTML = '<button id="gateRetry" class="operator-gate-primary">Tentar sincronizar novamente</button><button id="gateEnterOffline" class="operator-gate-secondary">Entrar offline</button>';
            actions.querySelector('#gateRetry').onclick = () => {
              actions.innerHTML = '';
              gate.querySelector('#gateOperator').disabled = false;
              pin.disabled = false;
              pin.value = originalPin;
              doLogin();
            };
            actions.querySelector('#gateEnterOffline').onclick = () => finishEntry(result, true);
          }
          return;
        }

        await finishEntry(result, false);
      } catch (e) {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
        if (progress) progress.hidden = true;
        if (fields) fields.classList.remove('syncing');
        if (error) error.textContent = friendlyError(e.message);
        pin.disabled = false;
        gate.querySelector('#gateOperator').disabled = false;
        pin.value = '';
        pin.focus();
      } finally {
        if (login && document.body.contains(login)) {
          login.disabled = false;
          login.innerHTML = 'Entrar no caixa <kbd>Enter</kbd>';
        }
      }
    };

    if (login) login.onclick = doLogin;
    if (pin) {
      pin.focus();
      pin.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doLogin();
        }
      };
    }
    const sync = gate.querySelector('#gateSync');
    if (sync) sync.onclick = async () => {
      try {
        sync.disabled = true;
        sync.textContent = 'Sincronizando...';
        await window.thor.sync();
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
  if (e.key === 'F2' || e.key === 'F3' || e.key === 'F4' || e.key === 'F5' || e.key === 'F6' || e.key === 'F12') {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);
