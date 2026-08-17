(function () {
  if (window.__cashReturnSummaryV109) return;
  window.__cashReturnSummaryV109 = true;
  if (typeof cashDailyCloseModal !== 'function') return;

  const previousCashDailyCloseModal = cashDailyCloseModal;
  cashDailyCloseModal = function (preview, options = {}) {
    const modalWrap = previousCashDailyCloseModal(preview, options);
    try {
      const count = Number(preview?.returns_count || 0);
      const total = Number(preview?.returns_total || 0);
      if (count <= 0 || !modalWrap?.querySelector) return modalWrap;

      const grid = modalWrap.querySelector('.cash-summary-grid');
      if (!grid || grid.querySelector('[data-cash-return-summary-v109]')) return modalWrap;

      const card = document.createElement('article');
      card.dataset.cashReturnSummaryV109 = '1';
      card.innerHTML = `<span>Devoluções</span><strong>${cashDailyMoney(total)}</strong><small>${count} operação(ões) · crédito/vale · não altera dinheiro físico</small>`;
      const saleCard = grid.children[1] || null;
      if (saleCard?.nextSibling) grid.insertBefore(card, saleCard.nextSibling);
      else grid.appendChild(card);

      const outstanding = Number(preview?.return_voucher_outstanding || 0);
      if (outstanding > 0.009) {
        const note = document.createElement('div');
        note.className = 'cash-return-credit-note';
        note.innerHTML = `<b>Vales Crédito em aberto: ${cashDailyMoney(outstanding)}</b><span>Esse saldo é crédito do cliente/portador e não compõe o numerário esperado da gaveta.</span>`;
        grid.insertAdjacentElement('afterend', note);
      }
    } catch (error) {
      console.warn('[cash-return-summary-v109]', error);
    }
    return modalWrap;
  };
})();
