(function () {
  if (window.__cashMovementReceiptV106) return;
  window.__cashMovementReceiptV106 = true;

  openCashModal = function () {
    const v = v3State();
    if (!v.operator) return v3OperatorModal(true);
    const opened = state.status.cashOpenEventId;
    const m = modal(opened ? `<h3>Caixa aberto</h3>
      <p class="muted">Operador: <b>${esc(v.operator.name)}</b>. Faça suprimento, sangria ou fechamento.</p>
      <div class="field"><label>Valor</label><input id="cashValue" type="number" min="0.01" step="0.01" value="0.00" inputmode="decimal"></div>
      <div class="field"><label>Motivo da movimentação</label><textarea id="cashReason" rows="3" placeholder="Informe o motivo do suprimento ou da sangria"></textarea></div>
      <div id="cashMovementError" class="settings-error"></div>
      <div class="actions"><button class="secondary" id="supply">Suprimento</button><button class="secondary" id="withdraw">Sangria</button><button class="danger primary" id="closeCash">Fechar caixa</button></div>` : `<h3>Abrir caixa</h3><p class="muted">Operador: <b>${esc(v.operator.name)}</b></p><div class="field"><label>Fundo de troco</label><input id="opening" type="number" step="0.01" value="0"></div><div class="actions"><button class="secondary" id="back">Cancelar</button><button class="primary" id="openCash">Abrir caixa</button></div>`);

    if (opened) {
      const movement = async (type) => {
        const amount = Number(m.querySelector('#cashValue').value || 0);
        const reason = String(m.querySelector('#cashReason').value || '').trim();
        const error = m.querySelector('#cashMovementError');
        error.textContent = '';
        if (!Number.isFinite(amount) || amount <= 0) return error.textContent = 'Informe um valor maior que zero.';
        if (!reason) return error.textContent = 'Informe o motivo da movimentação.';

        const button = m.querySelector(type === 'supply' ? '#supply' : '#withdraw');
        try {
          button.disabled = true;
          let auth = null;
          if (!vPerm('cash.movement', false)) auth = await v3NeedSupervisor('cash_movement', amount, reason);
          const result = await window.thor.cashMovement({ movementType: type, amount, notes: reason, supervisorAuthorization: auth });
          m.remove();
          await refreshStatus();
          const label = type === 'supply' ? 'Suprimento' : 'Sangria';
          try {
            await window.thor.printCashMovement44(result.receipt || {});
            showToast(`${label} registrado e comprovante impresso.`);
          } catch (printError) {
            showToast(`${label} registrado.`);
            infoModal(`${label} registrado`, `A movimentação foi salva, mas o comprovante não pôde ser impresso.\n\n${friendlyError(printError.message)}`);
          }
        } catch (e) {
          button.disabled = false;
          if (e.message !== 'authorization_cancelled') error.textContent = friendlyError(e.message);
        }
      };

      m.querySelector('#supply').onclick = () => movement('supply');
      m.querySelector('#withdraw').onclick = () => movement('withdrawal');
      m.querySelector('#closeCash').onclick = async () => {
        const value = prompt('Informe o valor contado no caixa:', '0');
        if (value === null) return;
        try {
          await window.thor.closeCash({ closingAmount: Number(value || 0) });
          m.remove();
          await refreshStatus();
          showToast('Fechamento enviado.');
        } catch (e) { infoModal('Caixa', friendlyError(e.message)); }
      };
      const value = m.querySelector('#cashValue');
      value?.focus();
      value?.select();
    } else {
      m.querySelector('#back').onclick = () => m.remove();
      m.querySelector('#openCash').onclick = async () => {
        try {
          await window.thor.openCash({ openingAmount: Number(m.querySelector('#opening').value || 0) });
          m.remove();
          await refreshStatus();
          showToast('Caixa aberto.');
        } catch (e) { infoModal('Caixa', friendlyError(e.message)); }
      };
    }
  };
})();
