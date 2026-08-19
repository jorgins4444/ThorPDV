(function () {
  function v48Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v48Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v48DiscountBase() {
    return Math.max(state.cart.reduce((sum, item) => {
      const gross = v48Number(item.quantity) * v48Number(item.unitPrice);
      return sum + Math.max(gross - Math.max(v48Number(item.discount), 0), 0);
    }, 0), 0);
  }

  function v48DiscountDisplay(amount, mode) {
    const base = v48DiscountBase();
    if (mode === 'percent') return base > 0 ? ((v48Number(amount) / base) * 100).toFixed(2) : '0.00';
    return v48Number(amount).toFixed(2);
  }

  function v48SyncActionLabels() {
    const v = v3State();
    const consumer = document.getElementById('v47ConsumerAction');
    if (consumer) {
      const doc = String(v.consumerDocument || '').replace(/\D/g, '');
      consumer.classList.toggle('active', Boolean(doc));
      const title = consumer.querySelector('b');
      const subtitle = consumer.querySelector('small');
      if (title) title.textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
      if (subtitle) subtitle.textContent = doc ? `Documento •••• ${doc.slice(-4)}` : 'CPF/CNPJ opcional';
    }

    const adjustments = document.getElementById('v47AdjustmentAction');
    if (adjustments) {
      const itemDiscount = state.cart.reduce((sum, item) => sum + Math.max(v48Number(item.discount), 0), 0);
      const saleDiscount = Math.max(v48Number(v.discount), 0);
      const surcharge = Math.max(v48Number(v.surcharge), 0);
      const hasAdjustment = itemDiscount > 0 || saleDiscount > 0 || surcharge > 0;
      adjustments.classList.toggle('active', hasAdjustment);
      const title = adjustments.querySelector('b');
      const subtitle = adjustments.querySelector('small');
      if (title) title.textContent = hasAdjustment ? 'Desconto / acréscimo ativo' : 'Desconto / acréscimo';
      const parts = [];
      if (itemDiscount + saleDiscount > 0) parts.push(`-${money(itemDiscount + saleDiscount)}`);
      if (surcharge > 0) parts.push(`+${money(surcharge)}`);
      if (subtitle) subtitle.textContent = parts.length ? parts.join(' • ') : 'Aplicar somente quando necessário';
    }
  }

  function v48ModalLifecycle(wrap, onClose) {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (wrap.isConnected) wrap.remove();
      onClose?.();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    wrap.onclick = (event) => { if (event.target === wrap) close(); };
    return close;
  }

  function v48OpenConsumer() {
    if (!v48Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }
    const v = v3State();
    const current = String(v.consumerDocument || '');
    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Informe CPF ou CNPJ somente quando necessário.</p></div><span>👤</span></div><div class="field"><label>CPF / CNPJ</label><input id="v48ConsumerDocument" inputmode="numeric" autocomplete="off" value="${esc(current)}" placeholder="Opcional"></div><div id="v48ConsumerError" class="settings-error"></div><div class="v47-consumer-help">A identificação fica vinculada somente à venda atual e será enviada junto com o documento fiscal quando aplicável.</div><div class="actions"><button class="secondary" id="v48ConsumerClear">Limpar</button><button class="secondary" id="v48ConsumerCancel">Cancelar</button><button class="primary" id="v48ConsumerDone">Concluir</button></div>`);
    const input = wrap.querySelector('#v48ConsumerDocument');
    const error = wrap.querySelector('#v48ConsumerError');
    const close = v48ModalLifecycle(wrap, v48SyncActionLabels);

    const commit = () => {
      const value = String(input.value || '').trim();
      if (!v3ValidDocument(value)) {
        input.classList.add('invalid');
        error.textContent = 'CPF/CNPJ inválido. Corrija ou deixe em branco.';
        input.focus();
        return;
      }
      v.consumerDocument = value;
      const legacy = document.getElementById('consumerDocument');
      if (legacy) legacy.value = value;
      close();
    };

    input.oninput = () => { input.classList.remove('invalid'); error.textContent = ''; };
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } };
    wrap.querySelector('#v48ConsumerDone').onclick = commit;
    wrap.querySelector('#v48ConsumerCancel').onclick = close;
    wrap.querySelector('#v48ConsumerClear').onclick = () => {
      v.consumerDocument = '';
      const legacy = document.getElementById('consumerDocument');
      if (legacy) legacy.value = '';
      close();
    };
    input.focus();
    input.select();
  }

  function v48LegacyAdjustmentControls() {
    return {
      mode: document.getElementById('saleDiscountMode'),
      discount: document.getElementById('saleDiscount'),
      discountApply: document.getElementById('saleDiscountApply'),
      surcharge: document.getElementById('saleSurcharge'),
    };
  }

  function v48OpenAdjustments() {
    const controls = v48LegacyAdjustmentControls();
    if (!controls.mode || !controls.discount || !controls.discountApply || !controls.surcharge) {
      return infoModal('Desconto / acréscimo', 'Não foi possível iniciar os controles de ajuste. Feche e abra novamente a venda.');
    }

    const v = v3State();
    const modeValue = v.discountMode === 'percent' ? 'percent' : 'amount';
    const wrap = modal(`<div class="v47-modal-head"><div><small>AJUSTES DA VENDA</small><h3>Desconto e acréscimo</h3><p>Os valores só são gravados depois da aplicação. Desconto acima da alçada exige autorização do supervisor.</p></div><span>%</span></div><div class="discount-v45-modal-grid"><label><span>Tipo do desconto</span><select id="v48DiscountMode"><option value="amount" ${modeValue === 'amount' ? 'selected' : ''}>Valor (R$)</option><option value="percent" ${modeValue === 'percent' ? 'selected' : ''}>Porcentagem (%)</option></select></label><label><span>Desconto</span><input id="v48DiscountValue" type="number" min="0" step="0.01" value="${v48DiscountDisplay(v.discount, modeValue)}"></label><label><span>Acréscimo (R$)</span><input id="v48SurchargeValue" type="number" min="0" step="0.01" value="${Math.max(v48Number(v.surcharge), 0).toFixed(2)}"></label></div><div id="v48AdjustmentStatus" class="discount-v45-preview"></div><div class="v47-adjustment-help"><b>Desconto por item</b><span>Para conceder desconto somente em um produto, use “Aplicar desconto” diretamente na linha do item.</span></div><div class="actions"><button class="secondary" id="v48AdjustmentCancel">Fechar</button><button class="secondary" id="v48ApplySurcharge">Aplicar acréscimo</button><button class="primary" id="v48ApplyDiscount">Aplicar desconto</button></div>`, 'wide');

    const mode = wrap.querySelector('#v48DiscountMode');
    const discount = wrap.querySelector('#v48DiscountValue');
    const surcharge = wrap.querySelector('#v48SurchargeValue');
    const status = wrap.querySelector('#v48AdjustmentStatus');
    const applyDiscount = wrap.querySelector('#v48ApplyDiscount');
    const applySurcharge = wrap.querySelector('#v48ApplySurcharge');
    const close = v48ModalLifecycle(wrap, v48SyncActionLabels);

    const refreshStatus = () => {
      const base = v48DiscountBase();
      const raw = Math.max(v48Number(discount.value), 0);
      const proposed = mode.value === 'percent' ? Math.min(raw, 100) / 100 * base : Math.min(raw, base);
      status.textContent = `Desconto atual: ${money(v.discount)} • Proposto: ${money(proposed)} • Acréscimo atual: ${money(v.surcharge)}`;
    };
    refreshStatus();

    mode.onchange = () => {
      v.discountMode = mode.value;
      discount.value = v48DiscountDisplay(v.discount, mode.value);
      refreshStatus();
    };
    discount.oninput = refreshStatus;
    surcharge.oninput = refreshStatus;

    applyDiscount.onclick = async () => {
      if (v.discountPending) return;
      controls.mode.value = mode.value;
      controls.mode.dispatchEvent(new Event('change', { bubbles: true }));
      controls.discount.value = String(discount.value || '0');
      applyDiscount.disabled = true;
      try {
        const result = controls.discountApply.onclick?.call(controls.discountApply, new Event('click'));
        await Promise.resolve(result);
        discount.value = v48DiscountDisplay(v.discount, mode.value);
        refreshStatus();
        v48SyncActionLabels();
      } finally {
        applyDiscount.disabled = false;
      }
    };

    applySurcharge.onclick = async () => {
      const amount = Math.max(v48Number(surcharge.value), 0);
      v.surcharge = amount;
      v.supervisorAuthorization = null;
      controls.surcharge.value = amount.toFixed(2);
      await v3Reprice();
      refreshStatus();
      v48SyncActionLabels();
      showToast(amount > 0 ? 'Acréscimo aplicado.' : 'Acréscimo removido.');
    };

    wrap.querySelector('#v48AdjustmentCancel').onclick = close;
  }

  // Supervisor modal must always settle its Promise, including backdrop/Esc/removal.
  v3NeedSupervisor = async function (action, requestedValue, reason = '') {
    const v = v3State();
    if (v.supervisorAuthorization?.action === action) return v.supervisorAuthorization;
    const supervisors = (v.operators || []).filter((operator) => operator.permissions?.supervisor?.authorize);
    if (!supervisors.length) throw new Error('supervisor_not_available');

    return await new Promise((resolve, reject) => {
      let settled = false;
      const wrap = modal(`<h3>Autorização de supervisor</h3><p class="muted">A operação ultrapassa a alçada do operador atual.</p><div class="field"><label>Supervisor</label><select id="supUser">${supervisors.map((operator) => `<option value="${esc(operator.id)}">${esc(operator.name)}</option>`).join('')}</select></div><div class="field"><label>PIN do supervisor</label><input id="supPin" type="password" inputmode="numeric" maxlength="8"></div><div class="field"><label>Motivo</label><input id="supReason" value="${esc(reason)}" placeholder="Motivo da autorização"></div><div id="supError" class="settings-error"></div><div class="actions"><button class="secondary" id="supCancel">Cancelar</button><button class="primary" id="supOk">Autorizar</button></div>`);
      const pin = wrap.querySelector('#supPin');
      const ok = wrap.querySelector('#supOk');
      const error = wrap.querySelector('#supError');
      let observer;

      const cleanup = () => {
        document.removeEventListener('keydown', onKey, true);
        observer?.disconnect();
      };
      const rejectCancelled = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (wrap.isConnected) wrap.remove();
        reject(new Error('authorization_cancelled'));
      };
      const resolveAuthorization = (authorization) => {
        if (settled) return;
        settled = true;
        cleanup();
        v.supervisorAuthorization = authorization;
        if (wrap.isConnected) wrap.remove();
        resolve(authorization);
      };
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        rejectCancelled();
      };

      document.addEventListener('keydown', onKey, true);
      wrap.onclick = (event) => { if (event.target === wrap) rejectCancelled(); };
      wrap.querySelector('#supCancel').onclick = rejectCancelled;
      ok.onclick = async () => {
        if (settled) return;
        try {
          ok.disabled = true;
          error.textContent = '';
          const result = await window.thor.supervisorAuthorize({
            userId: wrap.querySelector('#supUser').value,
            pin: pin.value,
            action,
            requestedValue,
            reason: wrap.querySelector('#supReason').value,
          });
          resolveAuthorization(result.authorization);
        } catch (err) {
          error.textContent = friendlyError(err?.message);
          ok.disabled = false;
          pin.focus();
          pin.select();
        }
      };
      pin.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); ok.click(); } };

      observer = new MutationObserver(() => {
        if (!settled && !wrap.isConnected) rejectCancelled();
      });
      observer.observe(document.body, { childList: true });
      pin.focus();
    });
  };

  function v48PatchSaleButtons() {
    if (state.view !== 'sale') return;
    const consumer = document.getElementById('v47ConsumerAction');
    const adjustment = document.getElementById('v47AdjustmentAction');
    if (consumer) consumer.onclick = v48OpenConsumer;
    if (adjustment) adjustment.onclick = v48OpenAdjustments;
    v48SyncActionLabels();
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v48PatchSaleButtons);
    return result;
  };

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(v48SyncActionLabels);
    return result;
  };
  repriceCart = v3Reprice;
})();
