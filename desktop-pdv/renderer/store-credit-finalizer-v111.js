(function () {
  if (window.__storeCreditFinalizerV111) return;
  window.__storeCreditFinalizerV111 = true;

  const METHOD = 'store_credit_voucher';
  let scheduled = false;

  if (typeof v3PaymentLabels === 'object' && v3PaymentLabels) {
    v3PaymentLabels[METHOD] = 'Vale Crédito';
  }

  function findFinalizationModal() {
    return [...document.querySelectorAll('.modal')].reverse().find((node) =>
      node.querySelector('.payment-head') &&
      node.querySelector('.payment-entry') &&
      node.querySelector('#finishCheckout')
    ) || null;
  }

  function decorateButton(button, grid) {
    const mode = grid.classList.contains('v089-pay-methods') ? 'v089' : 'plain';
    button.style.display = '';
    button.hidden = false;
    button.type = 'button';
    button.dataset.method = METHOD;
    button.dataset.v111StoreCreditFinalizer = '1';

    if (button.dataset.v111Visual !== mode) {
      button.dataset.v111Visual = mode;
      if (mode === 'v089') button.innerHTML = '<i>▣</i><span>Vale Crédito</span>';
      else button.textContent = 'Vale Crédito';
    }
  }

  function patchFinalizationModal() {
    const paymentModal = findFinalizationModal();
    if (!paymentModal) return false;

    const grid = paymentModal.querySelector('.v089-pay-methods, .payment-method-grid');
    if (!grid) return false;

    let button = grid.querySelector(`[data-method="${METHOD}"]`);
    if (!button) {
      button = document.createElement('button');
      grid.appendChild(button);
    }

    decorateButton(button, grid);

    if (button.dataset.v111Bound !== '1') {
      button.dataset.v111Bound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        paymentModal.remove();
        setTimeout(() => {
          try {
            v3PaymentModal(METHOD);
          } catch (error) {
            try {
              infoModal('Vale Crédito', friendlyError(error?.message || 'store_credit_voucher_not_available'));
            } catch {}
          }
        }, 0);
      }, true);
    }

    return true;
  }

  function schedulePatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { patchFinalizationModal(); } catch (error) { console.warn('store_credit_finalizer_patch_failed', error); }
    });
  }

  // A tela de Finalização é montada por camadas assíncronas e depois decorada
  // pelo redesign. Observamos somente inclusão/remoção de nós e o patch é
  // idempotente, evitando depender da ordem dos wrappers de v3PaymentModal.
  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  queueMicrotask(schedulePatch);
  setTimeout(schedulePatch, 80);
})();
