(function () {
  function v47Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v47CartStats() {
    const lines = state.cart.length;
    const quantity = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { lines, quantity };
  }

  function v47UpdateChrome() {
    if (state.view !== 'sale') return;
    const v = v3State();
    const stats = v47CartStats();
    const count = document.getElementById('v47ItemCount');
    if (count) count.textContent = stats.lines === 1 ? '1 item' : `${stats.lines} itens`;

    const consumer = document.getElementById('v47ConsumerAction');
    if (consumer) {
      const doc = String(v.consumerDocument || '').replace(/\D/g, '');
      consumer.classList.toggle('active', Boolean(doc));
      consumer.querySelector('b').textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
      consumer.querySelector('small').textContent = doc ? `Documento •••• ${doc.slice(-4)}` : 'CPF/CNPJ opcional';
    }

    const adjustments = document.getElementById('v47AdjustmentAction');
    if (adjustments) {
      const itemDiscount = state.cart.reduce((sum, item) => sum + Math.max(Number(item.discount || 0), 0), 0);
      const saleDiscount = Math.max(Number(v.discount || 0), 0);
      const surcharge = Math.max(Number(v.surcharge || 0), 0);
      const hasAdjustment = itemDiscount > 0 || saleDiscount > 0 || surcharge > 0;
      adjustments.classList.toggle('active', hasAdjustment);
      adjustments.querySelector('b').textContent = hasAdjustment ? 'Desconto / acréscimo ativo' : 'Desconto / acréscimo';
      const parts = [];
      if (itemDiscount + saleDiscount > 0) parts.push(`-${money(itemDiscount + saleDiscount)}`);
      if (surcharge > 0) parts.push(`+${money(surcharge)}`);
      adjustments.querySelector('small').textContent = parts.length ? parts.join(' • ') : 'Aplicar somente quando necessário';
    }
  }

  function v47OpenConsumer() {
    if (!v47Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }
    const host = document.getElementById('v47LegacyMetaHost');
    const meta = host?.querySelector('.checkout-meta');
    const field = meta?.querySelector(':scope > label');
    if (!host || !meta || !field) return infoModal('Consumidor', 'O campo de identificação do consumidor não está disponível.');

    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Informe CPF ou CNPJ somente quando necessário.</p></div><span>👤</span></div><div id="v47ConsumerSlot" class="v47-consumer-slot"></div><div class="v47-consumer-help">A identificação fica vinculada somente à venda atual e será enviada junto com o documento fiscal quando aplicável.</div><div class="actions"><button class="secondary" id="v47ConsumerClear">Limpar</button><button class="primary" id="v47ConsumerDone">Concluir</button></div>`);
    const slot = wrap.querySelector('#v47ConsumerSlot');
    slot.appendChild(field);
    const input = field.querySelector('#consumerDocument');
    if (input) { input.focus(); input.select(); }

    const close = () => {
      meta.insertBefore(field, meta.firstChild || null);
      wrap.remove();
      v47UpdateChrome();
    };
    wrap.onclick = event => { if (event.target === wrap) close(); };
    wrap.querySelector('#v47ConsumerDone').onclick = () => {
      if (input && !v3ValidDocument(input.value)) {
        input.classList.add('invalid');
        input.focus();
        return;
      }
      close();
    };
    wrap.querySelector('#v47ConsumerClear').onclick = () => {
      const v = v3State();
      v.consumerDocument = '';
      if (input) {
        input.value = '';
        input.classList.remove('invalid');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      close();
    };
  }

  function v47OpenAdjustments() {
    const host = document.getElementById('v47LegacyMetaHost');
    const meta = host?.querySelector('.checkout-meta');
    const grid = meta?.querySelector('.adjustment-grid');
    if (!host || !meta || !grid) return infoModal('Desconto / acréscimo', 'Os controles de ajuste da venda não estão disponíveis.');

    const wrap = modal(`<div class="v47-modal-head"><div><small>AJUSTES DA VENDA</small><h3>Desconto e acréscimo</h3><p>Use somente quando a operação exigir. Descontos acima da alçada continuam exigindo autorização do supervisor.</p></div><span>%</span></div><div id="v47AdjustmentSlot" class="v47-adjustment-slot"></div><div class="v47-adjustment-help"><b>Desconto por item</b><span>Para conceder desconto apenas em um produto, use “Aplicar desconto” diretamente na linha do item.</span></div><div class="actions"><button class="primary" id="v47AdjustmentDone">Concluir</button></div>`, 'wide');
    const slot = wrap.querySelector('#v47AdjustmentSlot');
    grid.classList.add('v47-adjustment-grid');
    slot.appendChild(grid);

    const close = () => {
      grid.classList.remove('v47-adjustment-grid');
      meta.appendChild(grid);
      wrap.remove();
      v47UpdateChrome();
    };
    wrap.onclick = event => { if (event.target === wrap) close(); };
    wrap.querySelector('#v47AdjustmentDone').onclick = close;
  }

  function v47ReorganizeWorkspace() {
    if (state.view !== 'sale') return;
    const work = document.querySelector('.v3-work');
    if (!work || work.dataset.v47Ready === '1') return;

    const catalog = work.querySelector('.catalog');
    const panel = work.querySelector('.v3-cart-panel');
    const searchRow = catalog?.querySelector('.search-row');
    const products = catalog?.querySelector('#products');
    const cartHead = panel?.querySelector('.cart-head');
    const meta = panel?.querySelector('.checkout-meta');
    const cart = panel?.querySelector('#cart');
    const totals = panel?.querySelector('.v3-totals');
    const paymentSummary = panel?.querySelector('#paymentSummary');
    const paymentsButton = panel?.querySelector('#paymentsButton');
    const paymentMethods = panel?.querySelector('.payment-methods');
    const finalize = panel?.querySelector('#finalize');

    if (!catalog || !panel || !searchRow || !products || !cartHead || !meta || !cart || !totals || !paymentSummary || !paymentsButton || !paymentMethods || !finalize) return;

    work.dataset.v47Ready = '1';
    work.classList.add('v47-work');
    catalog.classList.add('v47-main');
    panel.classList.add('v47-summary');

    const search = searchRow.querySelector('#search');
    if (search) search.placeholder = 'Buscar produto por nome, SKU ou código de barras...';

    const searchZone = document.createElement('section');
    searchZone.className = 'v47-search-zone';
    searchZone.append(searchRow, products);

    const itemsCard = document.createElement('section');
    itemsCard.className = 'v47-items-card';
    const headTitle = cartHead.querySelector('div');
    if (headTitle) headTitle.innerHTML = '<small>VENDA ATUAL</small><h2>Itens lançados <span id="v47ItemCount" class="v47-item-count">0 itens</span></h2>';
    itemsCard.append(cartHead, cart);
    catalog.replaceChildren(searchZone, itemsCard);

    const summaryHead = document.createElement('div');
    summaryHead.className = 'v47-summary-head';
    summaryHead.innerHTML = '<small>RESUMO DA VENDA</small><h2>Fechamento</h2><p>Confira valores e finalize quando estiver tudo certo.</p>';

    const actions = document.createElement('div');
    actions.className = 'v47-sale-actions';
    actions.innerHTML = `<button type="button" id="v47ConsumerAction" class="v47-sale-action"><span>👤</span><span><b>Identificar consumidor</b><small>CPF/CNPJ opcional</small></span><i>›</i></button><button type="button" id="v47AdjustmentAction" class="v47-sale-action"><span>%</span><span><b>Desconto / acréscimo</b><small>Aplicar somente quando necessário</small></span><i>›</i></button>`;

    const financialCard = document.createElement('section');
    financialCard.className = 'v47-financial-card';
    financialCard.appendChild(totals);

    const paymentCard = document.createElement('section');
    paymentCard.className = 'v47-payment-card';
    const paymentTitle = document.createElement('div');
    paymentTitle.className = 'v47-section-title';
    paymentTitle.innerHTML = '<div><small>PAGAMENTO</small><b>Recebimentos</b></div>';
    paymentCard.append(paymentTitle, paymentSummary, paymentsButton, paymentMethods);

    const legacyHost = document.createElement('div');
    legacyHost.id = 'v47LegacyMetaHost';
    legacyHost.hidden = true;
    legacyHost.appendChild(meta);

    panel.replaceChildren(summaryHead, actions, financialCard, paymentCard, finalize, legacyHost);
    panel.querySelector('#v47ConsumerAction').onclick = v47OpenConsumer;
    panel.querySelector('#v47AdjustmentAction').onclick = v47OpenAdjustments;

    v47UpdateChrome();
    v47RenderProductsState();
  }

  function v47RenderProductsState() {
    const box = document.getElementById('products');
    if (!box || state.view !== 'sale') return;
    const hasQuery = Boolean(String(state.query || '').trim());
    box.classList.toggle('v47-results-hidden', !hasQuery);
    if (!hasQuery) box.innerHTML = '';
  }

  const previousRenderProducts = renderProducts;
  renderProducts = function () {
    const result = previousRenderProducts();
    v47RenderProductsState();
    return result;
  };

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v47ReorganizeWorkspace);
    return result;
  };

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(v47UpdateChrome);
    return result;
  };
  repriceCart = v3Reprice;

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v47UpdateChrome);
    return result;
  };
  renderCart = v3RenderCart;
})();
