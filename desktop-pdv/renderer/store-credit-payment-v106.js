(function () {
  if (window.__storeCreditPaymentV106) return;
  window.__storeCreditPaymentV106 = true;

  const number = (value) => Number(value || 0);

  // Vale Crédito é uma forma de pagamento oficial do ThorPDV. O lançamento
  // nunca é manual: ao escolher esta forma abrimos a consulta do vale e
  // validamos o saldo antes de adicionar o pagamento à venda.
  if (typeof v3PaymentLabels === 'object' && v3PaymentLabels) {
    v3PaymentLabels.store_credit_voucher = 'Vale Crédito';
  }

  const voucherAppliedInSale = (voucherNumber) => v3State().payments
    .filter((payment) => payment?.method === 'store_credit_voucher' && String(payment?.metadata?.voucher_number || '').toUpperCase() === String(voucherNumber || '').toUpperCase())
    .reduce((sum, payment) => sum + number(payment.amount), 0);

  const remainingForSale = (voucher) => Math.max(number(voucher?.remaining) - voucherAppliedInSale(voucher?.voucher_number), 0);
  const formatDate = (value) => {
    try { return new Date(value).toLocaleString('pt-BR'); }
    catch { return ''; }
  };

  function voucherPaymentModalV106() {
    if (!state.cart.length) return;

    const m = modal(`<div class="v105-voucher-pay-head"><div><small>PAGAMENTO</small><h3>Vale Crédito</h3><p>Informe o número do vale ou localize um vale ativo com saldo.</p></div><strong>${money(v3Remaining())}</strong></div>
      <div class="field"><label>Número, cliente, documento ou venda</label><div class="v105-search-line"><input id="v106VoucherQuery" placeholder="Ex.: VC260816... / CPF / nome" autocomplete="off"><button type="button" id="v106VoucherLookup">Consultar número</button></div></div>
      <div class="v106-voucher-search-actions"><button type="button" class="secondary" id="v106VoucherSearch">Buscar vales disponíveis</button><small>Serão exibidos somente vales ativos e com saldo.</small></div>
      <div id="v106VoucherResults" class="v106-voucher-results"><small>Digite o número do vale para consulta direta ou clique em “Buscar vales disponíveis”.</small></div>
      <div id="v106VoucherSelected" class="v105-voucher-info"><small>Nenhum vale selecionado.</small></div>
      <div class="field"><label>Valor a utilizar</label><input id="v106VoucherAmount" type="number" min="0.01" step="0.01" value="0.00" disabled></div>
      <div id="v106VoucherError" class="settings-error"></div>
      <div class="actions"><button class="secondary" id="v106VoucherBack">Voltar</button><button class="primary" id="v106VoucherAdd" disabled>Usar Vale Crédito</button></div>`, 'wide v105-voucher-pay v106-voucher-pay');

    let voucher = null;
    const query = m.querySelector('#v106VoucherQuery');
    const results = m.querySelector('#v106VoucherResults');
    const selectedBox = m.querySelector('#v106VoucherSelected');
    const amount = m.querySelector('#v106VoucherAmount');
    const error = m.querySelector('#v106VoucherError');
    const add = m.querySelector('#v106VoucherAdd');

    const clearSelection = () => {
      voucher = null;
      amount.value = '0.00';
      amount.disabled = true;
      add.disabled = true;
      selectedBox.innerHTML = '<small>Nenhum vale selecionado.</small>';
    };

    const chooseVoucher = (row) => {
      const available = remainingForSale(row);
      if (String(row?.status || '') !== 'active' || available <= 0.0001) {
        clearSelection();
        error.textContent = 'Este Vale Crédito não possui saldo disponível para esta venda.';
        return;
      }
      voucher = row;
      const applied = Math.min(v3Remaining(), available);
      amount.value = applied.toFixed(2);
      amount.max = available.toFixed(2);
      amount.disabled = false;
      add.disabled = applied <= 0;
      error.textContent = '';
      const already = voucherAppliedInSale(row.voucher_number);
      selectedBox.innerHTML = `<span><small>VALE SELECIONADO</small><b>${esc(row.voucher_number)}</b><em>Saldo disponível: ${money(available)}${already > 0 ? ` • Já usado nesta venda: ${money(already)}` : ''}</em><em>${esc(row.guest_name || row.guest_document || 'Pessoa sem cadastro')}${row.sale_number ? ` • Origem: venda ${esc(row.sale_number)}` : ''}</em><em>${row.issued_at ? `Emitido em ${esc(formatDate(row.issued_at))}` : ''}</em></span>`;
    };

    const renderResults = (rows) => {
      const active = (Array.isArray(rows) ? rows : []).filter((row) => String(row.status || '') === 'active' && remainingForSale(row) > 0.0001);
      if (!active.length) {
        results.innerHTML = '<div class="v106-voucher-empty"><b>Nenhum Vale Crédito disponível.</b><small>Não há vales ativos com saldo para os critérios informados.</small></div>';
        return;
      }
      results.innerHTML = `<div class="v106-voucher-list">${active.map((row, index) => {
        const available = remainingForSale(row);
        const beneficiary = row.guest_name || row.guest_document || 'Pessoa sem cadastro';
        return `<button type="button" data-v106-voucher="${index}"><span><b>${esc(row.voucher_number)}</b><small>${esc(beneficiary)}${row.sale_number ? ` • Venda ${esc(row.sale_number)}` : ''}</small><small>${row.issued_at ? `Emitido em ${esc(formatDate(row.issued_at))}` : ''}</small></span><strong>${money(available)}</strong></button>`;
      }).join('')}</div>`;
      results.querySelectorAll('[data-v106-voucher]').forEach((button) => {
        button.onclick = () => chooseVoucher(active[Number(button.dataset.v106Voucher)]);
      });
    };

    const bestEffortSync = async () => {
      try { await window.thor.sync(); } catch {}
    };

    const lookupExact = async () => {
      error.textContent = '';
      const value = String(query.value || '').trim();
      if (!value) { error.textContent = 'Informe o número do Vale Crédito.'; query.focus(); return; }
      clearSelection();
      results.innerHTML = '<small>Consultando vale...</small>';
      try {
        await bestEffortSync();
        const row = await window.thor.storeCreditVoucher(value);
        renderResults([row]);
        chooseVoucher(row);
      } catch (e) {
        results.innerHTML = '<small>Vale não localizado ou sem saldo.</small>';
        error.textContent = friendlyError(e.message);
      }
    };

    const searchAvailable = async () => {
      error.textContent = '';
      clearSelection();
      results.innerHTML = '<small>Buscando vales disponíveis...</small>';
      try {
        await bestEffortSync();
        const rows = await window.thor.storeCreditVouchers(String(query.value || '').trim(), 50);
        renderResults(rows);
      } catch (e) {
        results.innerHTML = '<small>Não foi possível consultar os vales.</small>';
        error.textContent = friendlyError(e.message);
      }
    };

    m.querySelector('#v106VoucherBack').onclick = () => m.remove();
    m.querySelector('#v106VoucherLookup').onclick = lookupExact;
    m.querySelector('#v106VoucherSearch').onclick = searchAvailable;
    query.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); lookupExact(); } };

    add.onclick = () => {
      if (!voucher) return;
      const value = number(amount.value);
      const available = remainingForSale(voucher);
      const remainingSale = v3Remaining();
      if (value <= 0) return error.textContent = 'Informe um valor.';
      if (value > available + 0.001) return error.textContent = `Saldo disponível do vale: ${money(available)}.`;
      if (value > remainingSale + 0.001) return error.textContent = `Valor restante da venda: ${money(remainingSale)}.`;
      v3State().payments.push({
        method: 'store_credit_voucher',
        amount: value,
        metadata: { voucher_number: String(voucher.voucher_number || '').toUpperCase() },
      });
      m.remove();
      v3RenderCart();
      showToast(`Vale ${voucher.voucher_number}: ${money(value)} aplicado.`);
    };

    setTimeout(() => query.focus(), 50);
    return m;
  }

  const previousPaymentModalV106 = v3PaymentModal;
  v3PaymentModal = function (initialMethod = 'cash') {
    if (initialMethod === 'store_credit_voucher') return voucherPaymentModalV106();

    const paymentModal = previousPaymentModalV106(initialMethod);
    queueMicrotask(() => {
      if (!paymentModal?.isConnected) return;
      const grid = paymentModal.querySelector('.payment-method-grid');
      if (!grid) return;

      // Como a forma já faz parte do catálogo visual, reaproveitamos o botão
      // criado pelo checkout e substituímos somente sua ação. Assim não existe
      // pagamento manual sem identificação do vale nem botão duplicado.
      let button = grid.querySelector('[data-method="store_credit_voucher"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.method = 'store_credit_voucher';
        grid.appendChild(button);
      }
      button.dataset.v106StoreCredit = '1';
      button.textContent = 'Vale Crédito';
      button.onclick = () => {
        paymentModal.remove();
        voucherPaymentModalV106();
      };
    });
    return paymentModal;
  };

  // Caso a tela de venda já tenha sido renderizada antes deste complemento
  // terminar de carregar, insere a forma de pagamento sem exigir reinício.
  const ensureQuickPaymentButton = () => {
    const grid = document.querySelector('.payment-methods');
    if (!grid || grid.querySelector('[data-v3-pay="store_credit_voucher"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pay';
    button.dataset.v3Pay = 'store_credit_voucher';
    button.innerHTML = '<span>Vale Crédito</span><kbd></kbd>';
    button.onclick = () => v3PaymentModal('store_credit_voucher');
    grid.appendChild(button);
  };

  queueMicrotask(ensureQuickPaymentButton);
  setTimeout(ensureQuickPaymentButton, 120);
})();