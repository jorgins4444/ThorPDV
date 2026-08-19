let cash40PromptedOperatorId = '';
let cash40ClosedTransition = false;

function cash40ProductForItem(item) {
  const sources = [state.products || [], state.allProducts || []];
  for (const source of sources) {
    const found = source.find((product) => String(product.id) === String(item.productId));
    if (found) return found;
  }
  return null;
}

function cash40LineTotal(item) {
  const quoteItem = v3State()?.quote?.items?.find?.((row) => String(row.productId) === String(item.productId));
  if (quoteItem && Number.isFinite(Number(quoteItem.total))) return Number(quoteItem.total);
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

const cash40OriginalV3Add = v3Add;
v3Add = async function (product) {
  await cash40OriginalV3Add(product);
  const item = state.cart.find((row) => String(row.productId) === String(product.id));
  if (item) {
    item.unit = product.unit || item.unit || 'UN';
    item.barcode = Array.isArray(product.barcodes) ? (product.barcodes[0] || '') : (product.barcode || item.barcode || '');
  }
  v3RenderCart();
};
add = v3Add;

v3RenderCart = function () {
  const v = v3State();
  const box = document.getElementById('cart');
  if (!box) return;

  box.innerHTML = state.cart.length ? state.cart.map((item, index) => {
    const product = cash40ProductForItem(item);
    const unit = item.unit || product?.unit || 'UN';
    const sku = item.sku || product?.sku || '—';
    const lineTotal = cash40LineTotal(item);
    return `<div class="cart-item launched-item">
      <div class="launched-index">${index + 1}</div>
      <div class="launched-info">
        <strong>${esc(item.name)}</strong>
        <small>Cód. ${esc(sku)} • ${esc(unit)} • Unit. ${money(item.unitPrice)}</small>
      </div>
      <div class="launched-line-total">
        <small>${Number(item.quantity || 0).toLocaleString('pt-BR',{maximumFractionDigits:3})} × ${money(item.unitPrice)}</small>
        <strong>${money(lineTotal)}</strong>
      </div>
      <div class="qty launched-qty">
        <button data-minus="${index}" title="Diminuir quantidade">−</button>
        <b>${Number(item.quantity || 0).toFixed(3).replace(/\.000$/,'')}</b>
        <button data-plus="${index}" title="Aumentar quantidade">+</button>
      </div>
      <button class="launched-remove" data-remove-item="${index}" title="Remover item">×</button>
    </div>`;
  }).join('') : `<div class="empty launched-empty"><strong>Nenhum produto lançado</strong><span>Pesquise pelo nome, SKU ou código de barras para iniciar a venda.</span></div>`;

  box.querySelectorAll('[data-minus]').forEach((button) => button.onclick = async () => {
    const index = Number(button.dataset.minus);
    const item = state.cart[index];
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) state.cart.splice(index, 1);
    await v3Reprice();
  });
  box.querySelectorAll('[data-plus]').forEach((button) => button.onclick = async () => {
    const item = state.cart[Number(button.dataset.plus)];
    if (!item) return;
    item.quantity += 1;
    await v3Reprice();
  });
  box.querySelectorAll('[data-remove-item]').forEach((button) => button.onclick = async () => {
    state.cart.splice(Number(button.dataset.removeItem), 1);
    await v3Reprice();
  });

  const sub = document.getElementById('subtotalValue');
  const grand = document.getElementById('grand');
  const paid = document.getElementById('paidValue');
  const remain = document.getElementById('remainingValue');
  const pay = document.getElementById('paymentSummary');
  const itemCount = document.getElementById('itemsCount');
  if (sub) sub.textContent = money(v.quote?.subtotal || 0);
  if (grand) grand.textContent = money(v3Total());
  if (paid) paid.textContent = money(v3Paid());
  if (remain) remain.textContent = money(v3Remaining());
  if (itemCount) itemCount.textContent = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  if (pay) pay.innerHTML = v.payments.length ? v.payments.map((payment, index) => `<div><span>${esc(v3PaymentLabels[payment.method] || payment.method)}${payment.integrated ? ' • integrado' : ''}</span><b>${money(payment.amount)}</b><button data-remove-pay="${index}">×</button></div>`).join('') : '<small>Nenhum pagamento lançado.</small>';
  document.querySelectorAll('[data-remove-pay]').forEach((button) => button.onclick = () => {
    v.payments.splice(Number(button.dataset.removePay), 1);
    v3RenderCart();
  });
};
renderCart = v3RenderCart;

async function cash40MaybePromptOpening() {
  if (state.view === 'cash_closed' || !state.status?.enrolled) return;
  const operator = state.status?.operator || (() => { try { return v3State().operator; } catch { return null; } })();
  if (!operator) return;
  await refreshStatus().catch(() => {});
  if (state.status?.cashOpenEventId) return;

  const settings = await window.thor.v3Settings().catch(() => ({}));
  if (!settings.askCashOpening) return;
  if (cash40PromptedOperatorId === String(operator.id)) return;
  cash40PromptedOperatorId = String(operator.id);

  const m = modal(`<div class="cash-open-question">
    <small>INÍCIO DO TURNO</small>
    <h3>Deseja abrir o caixa agora?</h3>
    <p>Você pode informar um fundo inicial. Se escolher <b>Agora não</b>, o caixa só será criado automaticamente quando ocorrer a primeira venda ou movimentação financeira.</p>
    <label class="field"><span>Fundo de caixa</span><input id="cash40OpeningAmount" type="number" min="0" step="0.01" value="0.00" inputmode="decimal"></label>
    <label class="field"><span>Observação</span><input id="cash40OpeningNote" placeholder="Opcional"></label>
    <div id="cash40OpenError" class="settings-error"></div>
    <div class="actions cash-open-question-actions">
      <button class="secondary" id="cash40Later">Agora não</button>
      <button class="primary" id="cash40Open">Abrir caixa</button>
    </div>
  </div>`);

  m.querySelector('#cash40Later').onclick = () => {
    m.remove();
    showToast('Caixa será aberto automaticamente no primeiro movimento.');
  };
  m.querySelector('#cash40Open').onclick = async () => {
    const button = m.querySelector('#cash40Open');
    const error = m.querySelector('#cash40OpenError');
    const openingAmount = Math.max(Number(m.querySelector('#cash40OpeningAmount').value || 0), 0);
    try {
      button.disabled = true;
      button.textContent = 'Abrindo...';
      await window.thor.openCash({ openingAmount, notes: m.querySelector('#cash40OpeningNote').value || 'Abertura após login do operador' });
      await refreshStatus();
      m.remove();
      showToast(`Caixa aberto com fundo ${money(openingAmount)}.`);
    } catch (err) {
      error.textContent = friendlyError(err.message);
      button.disabled = false;
      button.textContent = 'Abrir caixa';
    }
  };
  const amount = m.querySelector('#cash40OpeningAmount');
  amount?.focus();
  amount?.select();
}

if (typeof thorOperatorGateShow === 'function') {
  const cash40OriginalGateShow = thorOperatorGateShow;
  thorOperatorGateShow = async function (message = '') {
    if (state.view === 'cash_closed' && !state.cashReopening) return;
    return cash40OriginalGateShow(message);
  };
}

if (typeof thorOperatorGateRemove === 'function') {
  const cash40OriginalGateRemove = thorOperatorGateRemove;
  thorOperatorGateRemove = function () {
    const wasVisible = Boolean(thorOperatorGateVisible);
    cash40OriginalGateRemove();
    if (wasVisible && state.status?.operator && state.view !== 'cash_closed') {
      state.cashReopening = false;
      setTimeout(() => cash40MaybePromptOpening().catch(() => {}), 120);
    }
  };
}

const cash40OriginalSettingsModal = settingsModal;
settingsModal = async function () {
  await cash40OriginalSettingsModal();
  const modals = [...document.querySelectorAll('.modal')];
  const m = modals[modals.length - 1];
  const grid = m?.querySelector('.settings-grid');
  if (!m || !grid || m.querySelector('#cash40OpeningPolicy')) return;
  const settings = await window.thor.v3Settings().catch(() => ({}));
  const section = document.createElement('section');
  section.className = 'cash40-settings-section';
  section.innerHTML = `<h4>Fluxo de abertura do caixa</h4>
    <div class="field"><label>Ao identificar o operador</label>
      <select id="cash40OpeningPolicy">
        <option value="ask" ${settings.askCashOpening !== false ? 'selected' : ''}>Perguntar se deseja abrir caixa e informar fundo</option>
        <option value="lazy" ${settings.askCashOpening === false ? 'selected' : ''}>Não perguntar — abrir no primeiro movimento</option>
      </select>
    </div>
    <p class="muted">No modo automático, nenhuma sessão de caixa é criada no login. A primeira venda, suprimento/sangria ou devolução em dinheiro cria o caixa com fundo R$ 0,00.</p>`;
  grid.appendChild(section);

  const save = m.querySelector('#saveSettings');
  if (save) {
    const originalSave = save.onclick;
    save.onclick = async (event) => {
      const askCashOpening = m.querySelector('#cash40OpeningPolicy').value === 'ask';
      const updated = await window.thor.saveV3Settings({ askCashOpening });
      try { v3State().settings = { ...(v3State().settings || {}), ...updated }; } catch {}
      return originalSave?.call(save, event);
    };
  }
};

async function cash40EnterClosedScreen() {
  if (cash40ClosedTransition) return;
  cash40ClosedTransition = true;
  try {
    const summary = await window.thor.lastCashClose().catch(() => null);
    await window.thor.operatorLogout().catch(() => {});
    try {
      const v = v3State();
      v.operator = null;
      v.operatorPromptOpen = false;
      v.payments = [];
      v.quote = null;
    } catch {}
    state.cart = [];
    state.query = '';
    state.products = [];
    state.status = await window.thor.status().catch(() => state.status);
    if (state.status) state.status.operator = null;
    state.lastCashCloseSummary = summary;
    state.cashReopening = false;
    cash40PromptedOperatorId = '';
    state.view = 'cash_closed';
    render();
  } finally {
    cash40ClosedTransition = false;
  }
}

const cash40OriginalShowToast = showToast;
showToast = function (message) {
  cash40OriginalShowToast(message);
  if (/^Caixa fechado/i.test(String(message || ''))) {
    setTimeout(() => cash40EnterClosedScreen().catch(() => {}), 180);
  }
};

const cash40OriginalRenderWorkspace = renderWorkspace;
renderWorkspace = function () {
  const shell = document.querySelector('.shell');
  if (state.view === 'cash_closed') {
    shell?.classList.add('cash-closed-mode');
    return cash40RenderClosedScreen();
  }
  shell?.classList.remove('cash-closed-mode');
  return cash40OriginalRenderWorkspace();
};

function cash40RenderClosedScreen() {
  const box = document.getElementById('workspace');
  if (!box) return;
  const summary = state.lastCashCloseSummary || {};
  const context = state.status?.context || {};
  box.innerHTML = `<main class="cash-closed-screen">
    <section class="cash-closed-card">
      <div class="cash-closed-icon">✓</div>
      <small>${esc(context.branch_name || 'FILIAL')} • ${esc(context.pos_name || context.pos_code || 'PDV')}</small>
      <h1>CAIXA FECHADO</h1>
      <p>O fechamento foi concluído e o operador foi desconectado deste caixa.</p>
      <div class="cash-closed-summary">
        <div><span>Fechamento</span><strong>${summary.closed_at ? new Date(summary.closed_at).toLocaleString('pt-BR') : 'Concluído'}</strong></div>
        <div><span>Dinheiro contado</span><strong>${money(summary.closing_amount || 0)}</strong></div>
        <div><span>Diferença</span><strong class="${Math.abs(Number(summary.difference || 0)) > 0.009 ? 'negative' : ''}">${money(summary.difference || 0)}</strong></div>
      </div>
      <div class="cash-closed-actions">
        <button class="secondary" id="cash40Reprint">Reimprimir fechamento</button>
        <button class="cash-reopen-primary" id="cash40Reopen">Reabrir caixa</button>
      </div>
      <small class="cash-closed-help">Ao reabrir, será necessário selecionar o usuário e informar o PIN novamente.</small>
    </section>
  </main>`;

  document.getElementById('cash40Reprint').onclick = async () => {
    try {
      const result = await window.thor.printCashClose(summary);
      if (!result?.cancelled) showToast('Comprovante de fechamento enviado para impressão.');
    } catch (error) {
      infoModal('Reimpressão', friendlyError(error.message));
    }
  };
  document.getElementById('cash40Reopen').onclick = async () => {
    state.cashReopening = true;
    cash40PromptedOperatorId = '';
    state.view = 'sale';
    render();
    setTimeout(() => thorOperatorGateShow?.('Selecione o operador que irá reabrir o caixa.').catch?.(() => {}), 50);
  };
}
