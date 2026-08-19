(function () {
  v3PaymentLabels.store_credit = 'Crédito loja';

  function v50Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v50State() {
    const v = v3State();
    if (typeof v.customerCreditBalance !== 'number') v.customerCreditBalance = 0;
    return v;
  }

  async function v50RefreshCustomerCredit() {
    const v = v50State();
    if (!v.customerId) {
      v.customerCreditBalance = 0;
      return null;
    }
    try {
      const query = v.customerName || v.consumerDocument || String(v.customerId);
      const rows = await window.thor.customers(query);
      const customer = (rows || []).find((row) => String(row.id) === String(v.customerId));
      if (!customer) return null;
      v.customerCreditBalance = Math.max(v50Number(customer.store_credit_balance), 0);
      v.customerName = customer.name || v.customerName || '';
      return customer;
    } catch {
      return null;
    }
  }

  function v50PendingCreditPayments() {
    return v50State().payments.reduce((sum, payment) => payment.method === 'store_credit' ? sum + Math.max(v50Number(payment.amount), 0) : sum, 0);
  }

  function v50AvailableCredit() {
    return Math.max(v50State().customerCreditBalance - v50PendingCreditPayments(), 0);
  }

  function v50PaymentModalPatch(modalWrap) {
    if (!modalWrap || modalWrap.dataset.v50CreditPatched === '1') return;
    modalWrap.dataset.v50CreditPatched = '1';
    const entry = modalWrap.querySelector('.payment-entry');
    const error = modalWrap.querySelector('#payError');
    const amount = modalWrap.querySelector('#payAmount');
    const integrated = modalWrap.querySelector('#integratedPay');
    if (!entry || !error || !amount) return;

    const balance = document.createElement('div');
    balance.className = 'v50-credit-balance';
    balance.hidden = true;
    entry.insertBefore(balance, entry.firstChild);

    const selectedMethod = () => modalWrap.querySelector('.payment-method-grid button.active')?.dataset.method || 'cash';
    const refresh = () => {
      const v = v50State();
      const selected = selectedMethod();
      const available = v50AvailableCredit();
      balance.hidden = selected !== 'store_credit';
      if (selected === 'store_credit') {
        if (!v.customerId) {
          balance.classList.add('blocked');
          balance.innerHTML = '<span><small>CRÉDITO EM LOJA</small><b>Cliente obrigatório</b><em>Identifique um cliente do Gestão antes de usar crédito.</em></span>';
          amount.value = '0.00';
        } else {
          balance.classList.toggle('blocked', available <= 0);
          balance.innerHTML = `<span><small>SALDO DISPONÍVEL • ${esc(v.customerName || 'CLIENTE')}</small><b>${money(available)}</b><em>Saldo sincronizado com o Gestão.</em></span>`;
          const remaining = typeof v3Remaining === 'function' ? v3Remaining() : 0;
          if (v50Number(amount.value) <= 0 || v50Number(amount.value) > available) amount.value = Math.min(remaining, available).toFixed(2);
        }
      }
    };

    modalWrap.querySelectorAll('.payment-method-grid button').forEach((button) => {
      button.addEventListener('click', () => queueMicrotask(refresh));
    });

    modalWrap.addEventListener('click', (event) => {
      const target = event.target.closest?.('button');
      if (!target) return;
      const selected = selectedMethod();
      if (selected !== 'store_credit') return;

      if (target.id === 'integratedPay') {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Crédito em loja é saldo interno do cliente e não utiliza TEF/PIX.';
        return;
      }
      if (target.id !== 'addPayment') return;
      const v = v50State();
      if (!v.customerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Identifique um cliente cadastrado no Gestão antes de usar crédito em loja.';
        return;
      }
      const available = v50AvailableCredit();
      const requested = Math.max(v50Number(amount.value), 0);
      if (available <= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Este cliente não possui saldo de crédito em loja.';
        return;
      }
      if (requested > available + 0.001) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = `Saldo insuficiente. Disponível: ${money(available)}.`;
        amount.value = Math.min(available, typeof v3Remaining === 'function' ? v3Remaining() : available).toFixed(2);
        return;
      }
      queueMicrotask(refresh);
    }, true);

    if (integrated) integrated.title = 'Não aplicável a crédito em loja';
    refresh();
  }

  const originalPaymentModal = v3PaymentModal;
  v3PaymentModal = async function (initialMethod = 'cash') {
    const v = v50State();
    if (initialMethod === 'store_credit' && !v.customerId) {
      return infoModal('Crédito em loja', 'Identifique um cliente cadastrado no Gestão antes de usar crédito em loja.');
    }
    await v50RefreshCustomerCredit();
    if (initialMethod === 'store_credit' && v.customerCreditBalance <= 0) {
      return infoModal('Crédito em loja', 'Este cliente não possui saldo de crédito em loja.');
    }
    const result = originalPaymentModal(initialMethod);
    queueMicrotask(() => {
      const modals = [...document.querySelectorAll('.modal')];
      v50PaymentModalPatch(modals[modals.length - 1]);
    });
    return result;
  };

  const originalReturnModal = returnSaleModal;
  returnSaleModal = function (sale) {
    const result = originalReturnModal(sale);
    queueMicrotask(() => {
      const modals = [...document.querySelectorAll('.modal')];
      const wrap = modals[modals.length - 1];
      if (!wrap) return;
      const select = wrap.querySelector('#refundMethod');
      const option = select?.querySelector('option[value="store_credit"]');
      if (!select || !option) return;
      const customerId = sale?.customer_id || null;
      const customerName = sale?.customer_name || sale?.customer || '';
      const note = document.createElement('div');
      note.className = 'v50-return-note';
      if (!customerId) {
        option.disabled = true;
        note.innerHTML = '<strong>Crédito em loja indisponível.</strong> Para gerar crédito, a venda original precisa estar vinculada a um cliente do Gestão.';
      } else {
        option.textContent = `Crédito em loja${customerName ? ` — ${customerName}` : ''}`;
        note.innerHTML = `<strong>Crédito em loja:</strong> ao escolher esta restituição, o valor devolvido será lançado no saldo de ${esc(customerName || 'cliente vinculado')} e poderá ser usado em uma próxima compra.`;
      }
      select.closest('.field')?.insertAdjacentElement('afterend', note);
    });
    return result;
  };

  function v50UpdateConsumerCredit() {
    const v = v50State();
    const button = document.getElementById('v47ConsumerAction');
    if (!button || !v.customerId) return;
    const small = button.querySelector('small');
    if (!small) return;
    const existing = small.textContent || '';
    const credit = money(Math.max(v.customerCreditBalance, 0));
    if (!existing.includes('Crédito')) small.textContent = `${existing} • Crédito ${credit}`;
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(async () => {
      await v50RefreshCustomerCredit();
      v50UpdateConsumerCredit();
    });
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v50UpdateConsumerCredit);
    return result;
  };
  renderCart = v3RenderCart;

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      store_credit_requires_customer: 'Crédito em loja exige uma venda vinculada a um cliente cadastrado no Gestão.',
      insufficient_store_credit: 'O cliente não possui saldo suficiente de crédito em loja.',
      customer_not_found: 'O cliente vinculado não está disponível no cadastro sincronizado deste caixa.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();
