(function () {
  function v49Digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function v49State() {
    const v = v3State();
    if (typeof v.customerId === 'undefined') v.customerId = null;
    if (typeof v.customerName === 'undefined') v.customerName = '';
    if (typeof v.customerEmail === 'undefined') v.customerEmail = '';
    if (typeof v.customerPhone === 'undefined') v.customerPhone = '';
    return v;
  }

  function v49Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v49FormatDocument(value) {
    const digits = v49Digits(value);
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return String(value || '');
  }

  function v49FormatPhone(value) {
    const digits = v49Digits(value);
    if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return String(value || '');
  }

  function v49SyncAction() {
    if (state.view !== 'sale') return;
    const v = v49State();
    const button = document.getElementById('v47ConsumerAction');
    if (!button) return;
    const title = button.querySelector('b');
    const subtitle = button.querySelector('small');
    const identified = Boolean(v.customerId || v49Digits(v.consumerDocument));
    button.classList.toggle('active', identified);
    if (v.customerId && v.customerName) {
      if (title) title.textContent = v.customerName;
      const doc = v49Digits(v.consumerDocument);
      if (subtitle) subtitle.textContent = doc ? `${v49FormatDocument(doc)} • Cliente do Gestão` : 'Cliente do Gestão';
      return;
    }
    const doc = v49Digits(v.consumerDocument);
    if (title) title.textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
    if (subtitle) subtitle.textContent = doc ? `${v49FormatDocument(doc)} • Sem cadastro vinculado` : 'Buscar cliente ou informar CPF/CNPJ';
  }

  function v49SetCustomer(customer) {
    const v = v49State();
    v.customerId = customer?.id || null;
    v.customerName = customer?.name || '';
    v.customerEmail = customer?.email || '';
    v.customerPhone = customer?.phone || '';
    const doc = v49Digits(customer?.document || '');
    v.consumerDocument = doc && v3ValidDocument(doc) ? doc : '';
    const legacy = document.getElementById('consumerDocument');
    if (legacy) legacy.value = v.consumerDocument;
    v49SyncAction();
  }

  function v49SetManualDocument(document) {
    const v = v49State();
    v.customerId = null;
    v.customerName = '';
    v.customerEmail = '';
    v.customerPhone = '';
    v.consumerDocument = v49Digits(document);
    const legacy = document.getElementById('consumerDocument');
    if (legacy) legacy.value = v.consumerDocument;
    v49SyncAction();
  }

  function v49ClearCustomer() {
    v49SetManualDocument('');
  }

  function v49CustomerRow(customer, index) {
    const document = customer.document ? v49FormatDocument(customer.document) : 'Sem CPF/CNPJ';
    const contact = [customer.phone ? v49FormatPhone(customer.phone) : '', customer.email || ''].filter(Boolean).join(' • ');
    return `<button type="button" class="v49-customer-row" data-v49-customer="${index}">
      <span class="v49-customer-avatar">${esc(String(customer.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
      <span class="v49-customer-main"><b>${esc(customer.name || 'Cliente')}</b><small>${esc(document)}${contact ? ` • ${esc(contact)}` : ''}</small></span>
      <span class="v49-customer-select">Selecionar ›</span>
    </button>`;
  }

  async function v49OpenConsumer() {
    if (!v49Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }

    const v = v49State();
    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Busque um cliente sincronizado do Gestão ou informe somente CPF/CNPJ.</p></div><span>👤</span></div>
      <div class="v49-current" id="v49Current"></div>
      <section class="v49-section">
        <div class="v49-section-head"><div><b>Buscar cliente do Gestão</b><small>Pesquise pelo nome ou CPF/CNPJ do cadastro sincronizado.</small></div><span>CADASTRO</span></div>
        <div class="v49-search"><span>⌕</span><input id="v49CustomerSearch" autocomplete="off" placeholder="Nome ou CPF/CNPJ..."><button type="button" class="secondary" id="v49SyncCustomers">Sincronizar</button></div>
        <div class="v49-results" id="v49CustomerResults"><div class="v49-empty">Digite para pesquisar um cliente.</div></div>
      </section>
      <div class="v49-divider"><span>ou</span></div>
      <section class="v49-section v49-manual">
        <div class="v49-section-head"><div><b>Usar somente CPF/CNPJ</b><small>Não é necessário que o consumidor esteja cadastrado no Gestão.</small></div><span>RÁPIDO</span></div>
        <div class="v49-manual-row"><input id="v49ManualDocument" inputmode="numeric" autocomplete="off" value="${esc(v.customerId ? '' : (v.consumerDocument || ''))}" placeholder="CPF ou CNPJ"><button type="button" class="primary" id="v49UseDocument">Usar documento</button></div>
        <div id="v49ManualError" class="settings-error"></div>
      </section>
      <div class="actions"><button class="secondary" id="v49ClearCustomer">Remover identificação</button><button class="secondary" id="v49CloseCustomer">Fechar</button></div>`, 'wide');

    const current = wrap.querySelector('#v49Current');
    const search = wrap.querySelector('#v49CustomerSearch');
    const results = wrap.querySelector('#v49CustomerResults');
    const manual = wrap.querySelector('#v49ManualDocument');
    const manualError = wrap.querySelector('#v49ManualError');
    let rows = [];
    let timer = null;
    let closed = false;

    const renderCurrent = () => {
      if (v.customerId && v.customerName) {
        const pieces = [v.consumerDocument ? v49FormatDocument(v.consumerDocument) : '', v.customerPhone ? v49FormatPhone(v.customerPhone) : '', v.customerEmail || ''].filter(Boolean);
        current.innerHTML = `<div><span class="v49-current-icon">✓</span><span><small>IDENTIFICADO</small><b>${esc(v.customerName)}</b><em>${esc(pieces.join(' • ') || 'Cliente do Gestão')}</em></span></div>`;
        current.classList.add('active');
      } else if (v49Digits(v.consumerDocument)) {
        current.innerHTML = `<div><span class="v49-current-icon">✓</span><span><small>DOCUMENTO INFORMADO</small><b>${esc(v49FormatDocument(v.consumerDocument))}</b><em>Consumidor sem cadastro vinculado</em></span></div>`;
        current.classList.add('active');
      } else {
        current.innerHTML = '<div><span class="v49-current-icon">○</span><span><small>CONSUMIDOR</small><b>Não identificado</b><em>A identificação é opcional.</em></span></div>';
        current.classList.remove('active');
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (wrap.isConnected) wrap.remove();
      v49SyncAction();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    wrap.onclick = (event) => { if (event.target === wrap) close(); };

    const renderRows = () => {
      if (!rows.length) {
        results.innerHTML = `<div class="v49-empty">${search.value.trim() ? 'Nenhum cliente encontrado no cadastro local.' : 'Digite para pesquisar um cliente.'}</div>`;
        return;
      }
      results.innerHTML = rows.map(v49CustomerRow).join('');
      results.querySelectorAll('[data-v49-customer]').forEach((button) => {
        button.onclick = () => {
          const customer = rows[Number(button.dataset.v49Customer)];
          if (!customer) return;
          v49SetCustomer(customer);
          renderCurrent();
          showToast(`Cliente ${customer.name} identificado na venda.`);
          close();
        };
      });
    };

    const load = async (query) => {
      const q = String(query || '').trim();
      if (!q) {
        rows = [];
        renderRows();
        return;
      }
      results.innerHTML = '<div class="v49-empty">Pesquisando clientes...</div>';
      try {
        rows = await window.thor.customers(q);
        renderRows();
      } catch (error) {
        rows = [];
        results.innerHTML = `<div class="v49-empty">Não foi possível consultar os clientes: ${esc(friendlyError(error?.message))}</div>`;
      }
    };

    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(search.value), 120);
    };
    search.onkeydown = (event) => {
      if (event.key === 'Enter' && rows[0]) {
        event.preventDefault();
        v49SetCustomer(rows[0]);
        renderCurrent();
        showToast(`Cliente ${rows[0].name} identificado na venda.`);
        close();
      }
    };

    wrap.querySelector('#v49SyncCustomers').onclick = async (event) => {
      const button = event.currentTarget;
      try {
        button.disabled = true;
        button.textContent = 'Sincronizando...';
        await window.thor.sync();
        await load(search.value);
        showToast('Clientes atualizados com o Gestão.');
      } catch (error) {
        infoModal('Clientes', friendlyError(error?.message));
      } finally {
        button.disabled = false;
        button.textContent = 'Sincronizar';
      }
    };

    const useManual = async () => {
      const document = v49Digits(manual.value);
      if (!document || !v3ValidDocument(document)) {
        manualError.textContent = 'Informe um CPF ou CNPJ válido.';
        manual.classList.add('invalid');
        manual.focus();
        return;
      }
      manualError.textContent = '';
      manual.classList.remove('invalid');
      try {
        const matches = await window.thor.customers(document);
        const exact = (matches || []).find((customer) => v49Digits(customer.document) === document);
        if (exact) {
          v49SetCustomer(exact);
          showToast(`CPF/CNPJ localizado: ${exact.name}.`);
        } else {
          v49SetManualDocument(document);
          showToast('CPF/CNPJ informado para esta venda.');
        }
      } catch {
        v49SetManualDocument(document);
        showToast('CPF/CNPJ informado para esta venda.');
      }
      renderCurrent();
      close();
    };

    manual.oninput = () => { manual.classList.remove('invalid'); manualError.textContent = ''; };
    manual.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); useManual(); } };
    wrap.querySelector('#v49UseDocument').onclick = useManual;
    wrap.querySelector('#v49ClearCustomer').onclick = () => {
      v49ClearCustomer();
      renderCurrent();
      showToast('Identificação do consumidor removida.');
      close();
    };
    wrap.querySelector('#v49CloseCustomer').onclick = close;

    renderCurrent();
    search.focus();
  }

  const previousResetSale = v3ResetSale;
  v3ResetSale = function () {
    const result = previousResetSale();
    const v = v49State();
    v.customerId = null;
    v.customerName = '';
    v.customerEmail = '';
    v.customerPhone = '';
    return result;
  };

  // Keep the sale linked to the actual Gestão customer when one was selected.
  v3CompleteCheckout = async function () {
    const v = v49State();
    if (v.discountPending) return infoModal('Desconto', 'Conclua ou cancele a autorização de desconto antes de finalizar a venda.');
    if (state.busy) return;
    if (!state.status.cashOpenEventId) return openCashModal();
    if (!v3ValidDocument(v.consumerDocument)) return infoModal('CPF/CNPJ', 'CPF/CNPJ inválido. Corrija ou deixe em branco.');
    const progress = typeof saleProgress === 'function' ? saleProgress() : null;
    const started = performance.now();
    const hasCash = v.payments.some((payment) => payment.method === 'cash');
    const soldItems = state.cart.map((item) => ({ productId:item.productId, quantity:item.quantity, discount:Math.max(Number(item.discount || 0), 0) }));
    try {
      state.busy = true;
      progress?.update('Recebendo venda...','Confirmando itens e forma de pagamento.',28);
      const result = await window.thor.finalizeSale({
        items: soldItems,
        customerId: v.customerId || null,
        consumerDocument: v.consumerDocument,
        payments: v.payments,
        discount: Math.max(Number(v.discount || 0), 0),
        surcharge: Math.max(Number(v.surcharge || 0), 0),
        supervisorAuthorization: v.supervisorAuthorization,
      });
      progress?.update('Autorizando venda...','Venda recebida; preparando a impressão.',58);
      for (const sold of soldItems) {
        const product = state.products.find((row) => row.id === sold.productId);
        if (product) product.quantity = Math.max(0, Number(product.quantity || 0) - Number(sold.quantity || 0));
      }
      state.cart = [];
      v3ResetSale();
      renderSaleWorkspace();
      state.busy = false;
      showToast(`Venda concluída: ${money(result.total)}${result.change > 0 ? ` • Troco ${money(result.change)}` : ''}.`);
      void window.thor.recordPerformance?.('ui.checkout_released', performance.now() - started, { items:soldItems.length, cash:hasCash });
      setTimeout(() => {
        void refreshStatus().catch(() => {});
        void postSalePrint(result.eventId, progress).catch((error) => {
          progress?.finish('Venda salva; impressão pendente', friendlyError(error?.message), false);
          showToast(`Venda salva. Impressão pendente: ${friendlyError(error?.message)}`);
        });
      }, 0);
      return result;
    } catch (error) {
      progress?.finish('Falha ao concluir a venda', friendlyError(error?.message), false);
      infoModal('Finalização', friendlyError(error?.message));
      return null;
    } finally {
      state.busy = false;
    }
  };

  function v49PatchSale() {
    if (state.view !== 'sale') return;
    const button = document.getElementById('v47ConsumerAction');
    if (button) button.onclick = v49OpenConsumer;
    v49SyncAction();
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v49PatchSale);
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v49SyncAction);
    return result;
  };
  renderCart = v3RenderCart;
})();
