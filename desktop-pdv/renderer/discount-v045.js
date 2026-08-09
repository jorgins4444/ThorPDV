(function () {
  const EPSILON = 0.0001;

  function v45State() {
    const v = v3State();
    if (!v.discountMode) v.discountMode = 'amount';
    if (typeof v.discountPending !== 'boolean') v.discountPending = false;
    return v;
  }

  function v45Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v45Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v45Round(value) {
    return Math.round((v45Number(value) + Number.EPSILON) * 100) / 100;
  }

  function v45GrossSubtotal() {
    return state.cart.reduce((sum, item) => sum + v45Number(item.quantity) * v45Number(item.unitPrice), 0);
  }

  function v45ItemDiscountTotal() {
    return state.cart.reduce((sum, item) => sum + Math.max(v45Number(item.discount), 0), 0);
  }

  function v45SaleDiscountBase() {
    return Math.max(v45GrossSubtotal() - v45ItemDiscountTotal(), 0);
  }

  function v45Percent(amount, base) {
    return base > 0 ? (v45Number(amount) / base) * 100 : 0;
  }

  function v45DiscountLimit() {
    return Math.max(v45Number(v45State().operator?.permissions?.discount?.max_percent), 0);
  }

  function v45CanOverride() {
    return v45Allowed('discount.override_limit', false);
  }

  function v45CanDiscount() {
    return v45Allowed('discount.apply', true);
  }

  function v45FormatInput(amount, mode, base) {
    if (mode === 'percent') return v45Percent(amount, base).toFixed(2);
    return v45Round(amount).toFixed(2);
  }

  function v45AmountFromInput(raw, mode, base) {
    const value = Math.max(v45Number(raw), 0);
    return mode === 'percent' ? v45Round(base * Math.min(value, 100) / 100) : v45Round(value);
  }

  function v45ApprovalReason(scope, percent, limit, itemName = '') {
    if (scope === 'item') return `Desconto de ${percent.toFixed(2)}% no item ${itemName || 'da venda'} acima da alçada de ${limit.toFixed(2)}%`;
    return `Desconto total de ${percent.toFixed(2)}% acima da alçada de ${limit.toFixed(2)}%`;
  }

  async function v45AuthorizeDiscount(percent, reason) {
    const v = v45State();
    const previousAuthorization = v.supervisorAuthorization || null;
    v.supervisorAuthorization = null;
    v.discountPending = true;
    try {
      const authorization = await v3NeedSupervisor('discount', percent, reason);
      v.supervisorAuthorization = authorization;
      return authorization;
    } catch (error) {
      v.supervisorAuthorization = previousAuthorization;
      throw error;
    } finally {
      v.discountPending = false;
    }
  }

  async function v45ApplySaleDiscount(input, mode) {
    const v = v45State();
    const base = v45SaleDiscountBase();
    const previousAmount = Math.max(v45Number(v.discount), 0);
    const previousAuthorization = v.supervisorAuthorization || null;

    if (!v45CanDiscount()) {
      input.value = v45FormatInput(previousAmount, mode, base);
      return infoModal('Desconto', 'O perfil deste operador não possui permissão para aplicar desconto.');
    }
    if (base <= 0) {
      input.value = '0.00';
      return infoModal('Desconto', 'Inclua pelo menos um item com valor antes de aplicar desconto.');
    }

    const proposedAmount = Math.min(v45AmountFromInput(input.value, mode, base), base);
    const proposedPercent = v45Percent(proposedAmount, base);
    const limit = v45DiscountLimit();

    try {
      let authorization = null;
      if (proposedAmount > 0 && proposedPercent > limit + EPSILON && !v45CanOverride()) {
        authorization = await v45AuthorizeDiscount(proposedPercent, v45ApprovalReason('sale', proposedPercent, limit));
      }
      v.discount = proposedAmount;
      v.supervisorAuthorization = authorization;
      await v3Reprice();
      v45RefreshDiscountControls();
      if (authorization) showToast('Desconto aplicado após autorização do supervisor.');
      else showToast(proposedAmount > 0 ? 'Desconto aplicado.' : 'Desconto removido.');
    } catch (error) {
      v.discount = previousAmount;
      v.supervisorAuthorization = previousAuthorization;
      input.value = v45FormatInput(previousAmount, mode, base);
      await v3Reprice();
      if (error?.message !== 'authorization_cancelled') infoModal('Desconto', friendlyError(error?.message));
      else showToast('Autorização cancelada. O desconto não foi alterado.');
    }
  }

  function v45OpenItemDiscount(index) {
    const v = v45State();
    const item = state.cart[index];
    if (!item) return;
    if (!v45CanDiscount()) return infoModal('Desconto no item', 'O perfil deste operador não possui permissão para aplicar desconto.');

    const gross = Math.max(v45Number(item.quantity) * v45Number(item.unitPrice), 0);
    if (gross <= 0) return infoModal('Desconto no item', 'Este item não possui valor válido para desconto.');

    const currentAmount = Math.max(v45Number(item.discount), 0);
    const m = modal(`<h3>Desconto no item</h3><p class="muted"><b>${esc(item.name || 'Produto')}</b><br>Valor bruto do item: ${money(gross)}</p><div class="discount-v45-modal-grid"><label><span>Tipo</span><select id="itemDiscountMode"><option value="amount">Valor (R$)</option><option value="percent">Porcentagem (%)</option></select></label><label><span>Desconto</span><input id="itemDiscountInput" type="number" min="0" step="0.01" value="${currentAmount.toFixed(2)}"></label></div><div class="discount-v45-preview" id="itemDiscountPreview"></div><div id="itemDiscountError" class="settings-error"></div><div class="actions"><button class="secondary" id="itemDiscountCancel">Cancelar</button><button class="secondary" id="itemDiscountClear">Remover desconto</button><button class="primary" id="itemDiscountApply">Aplicar</button></div>`, 'wide');
    const mode = m.querySelector('#itemDiscountMode');
    const input = m.querySelector('#itemDiscountInput');
    const preview = m.querySelector('#itemDiscountPreview');
    const errorBox = m.querySelector('#itemDiscountError');

    const refresh = () => {
      const amount = Math.min(v45AmountFromInput(input.value, mode.value, gross), gross);
      const percent = v45Percent(amount, gross);
      preview.textContent = `Desconto proposto: ${money(amount)} (${percent.toFixed(2)}%) • Líquido do item: ${money(gross - amount)}`;
    };
    mode.onchange = () => {
      input.value = v45FormatInput(currentAmount, mode.value, gross);
      refresh();
    };
    input.oninput = refresh;
    refresh();

    m.querySelector('#itemDiscountCancel').onclick = () => m.remove();
    m.querySelector('#itemDiscountClear').onclick = async () => {
      item.discount = 0;
      v.supervisorAuthorization = null;
      m.remove();
      await v3Reprice();
      showToast('Desconto do item removido.');
    };
    m.querySelector('#itemDiscountApply').onclick = async () => {
      if (v.discountPending) return;
      const previousAmount = Math.max(v45Number(item.discount), 0);
      const previousAuthorization = v.supervisorAuthorization || null;
      const proposedAmount = Math.min(v45AmountFromInput(input.value, mode.value, gross), gross);
      const proposedPercent = v45Percent(proposedAmount, gross);
      const limit = v45DiscountLimit();
      errorBox.textContent = '';
      try {
        let authorization = null;
        if (proposedAmount > 0 && proposedPercent > limit + EPSILON && !v45CanOverride()) {
          authorization = await v45AuthorizeDiscount(proposedPercent, v45ApprovalReason('item', proposedPercent, limit, item.name));
        }
        item.discount = proposedAmount;
        v.supervisorAuthorization = authorization;
        m.remove();
        await v3Reprice();
        if (authorization) showToast('Desconto do item aplicado após autorização do supervisor.');
        else showToast(proposedAmount > 0 ? 'Desconto do item aplicado.' : 'Desconto do item removido.');
      } catch (error) {
        item.discount = previousAmount;
        v.supervisorAuthorization = previousAuthorization;
        if (error?.message === 'authorization_cancelled') {
          m.remove();
          showToast('Autorização cancelada. O desconto do item não foi alterado.');
        } else {
          errorBox.textContent = friendlyError(error?.message);
        }
      }
    };
  }

  function v45RenderCart() {
    const v = v45State();
    const box = document.getElementById('cart');
    if (!box) return;
    const canRemove = v45Allowed('sale.remove_item', true);
    const canDiscount = v45CanDiscount();

    if (!state.cart.length) {
      box.innerHTML = '<div class="cart-v43-empty"><strong>Nenhum item na venda</strong><span>Leia um código de barras, digite o SKU ou clique em um produto.</span></div>';
      v45UpdateSummary();
      return;
    }

    box.innerHTML = `<div class="cart-v43-list-head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span><span></span></div>${state.cart.map((item, index) => {
      const quantity = v45Number(item.quantity);
      const unitPrice = v45Number(item.unitPrice);
      const gross = quantity * unitPrice;
      const discount = Math.min(Math.max(v45Number(item.discount), 0), Math.max(gross, 0));
      const net = Math.max(gross - discount, 0);
      const blockMinus = !canRemove && quantity <= 1;
      const discountPercent = v45Percent(discount, gross);
      return `<div class="cart-v43-item discount-v45-item" data-cart-index="${index}">
        <div class="cart-v43-product"><strong title="${esc(item.name || 'Produto')}">${esc(item.name || 'Produto')}</strong><small>${esc(item.sku || 'Sem SKU')}</small><button class="discount-v45-item-button" data-item-discount="${index}" ${canDiscount ? '' : 'disabled'}>${discount > 0 ? `Desc. ${money(discount)} (${discountPercent.toFixed(2)}%)` : 'Aplicar desconto'}</button></div>
        <div class="cart-v43-qty"><button data-minus="${index}" ${blockMinus ? 'disabled' : ''}>−</button><b>${quantity.toFixed(3).replace(/\.000$/, '')}</b><button data-plus="${index}">+</button></div>
        <div class="cart-v43-unit">${money(unitPrice)}</div>
        <div class="cart-v43-total"><b>${money(net)}</b>${discount > 0 ? `<small>${money(gross)}</small>` : ''}</div>
        <button class="cart-v43-remove" data-remove-item="${index}" ${canRemove ? '' : 'disabled'}>×</button>
      </div>`;
    }).join('')}`;

    box.querySelectorAll('[data-item-discount]').forEach((button) => {
      button.onclick = () => v45OpenItemDiscount(Number(button.dataset.itemDiscount));
    });
    box.querySelectorAll('[data-minus]').forEach((button) => {
      button.onclick = async () => {
        const index = Number(button.dataset.minus);
        const item = state.cart[index];
        if (!item) return;
        if (v45Number(item.quantity) <= 1 && !canRemove) return infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
        item.quantity = v45Number(item.quantity) - 1;
        if (item.quantity <= 0) state.cart.splice(index, 1);
        else if (v45Number(item.discount) > v45Number(item.quantity) * v45Number(item.unitPrice)) item.discount = v45Number(item.quantity) * v45Number(item.unitPrice);
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    box.querySelectorAll('[data-plus]').forEach((button) => {
      button.onclick = async () => {
        const item = state.cart[Number(button.dataset.plus)];
        if (!item) return;
        item.quantity = v45Number(item.quantity) + 1;
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    box.querySelectorAll('[data-remove-item]').forEach((button) => {
      button.onclick = async () => {
        if (!canRemove) return infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
        state.cart.splice(Number(button.dataset.removeItem), 1);
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    v45UpdateSummary();
  }

  function v45UpdateSummary() {
    const v = v45State();
    const gross = v45GrossSubtotal();
    const itemDiscount = v45ItemDiscountTotal();
    const saleDiscount = Math.max(v45Number(v.discount), 0);
    const surcharge = Math.max(v45Number(v.surcharge), 0);
    const total = v45Number(v.quote?.total ?? Math.max(gross - itemDiscount - saleDiscount + surcharge, 0));
    const paidValue = typeof v3Paid === 'function' ? v45Number(v3Paid()) : 0;

    const sub = document.getElementById('subtotalValue');
    const itemDisc = document.getElementById('itemDiscountValue');
    const saleDisc = document.getElementById('discountValue');
    const sur = document.getElementById('surchargeValue');
    const grand = document.getElementById('grand');
    const paid = document.getElementById('paidValue');
    const remain = document.getElementById('remainingValue');
    if (sub) sub.textContent = money(gross);
    if (itemDisc) itemDisc.textContent = `-${money(itemDiscount)}`;
    if (saleDisc) saleDisc.textContent = `-${money(saleDiscount)}`;
    if (sur) sur.textContent = money(surcharge);
    if (grand) grand.textContent = money(total);
    if (paid) paid.textContent = money(paidValue);
    if (remain) remain.textContent = money(Math.max(total - paidValue, 0));
  }

  async function v45Reprice() {
    const v = v45State();
    try {
      v.quote = await window.thor.quoteCheckout({
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: Math.max(v45Number(item.discount), 0) })),
        discount: Math.max(v45Number(v.discount), 0),
        surcharge: Math.max(v45Number(v.surcharge), 0),
      });
      for (const quoted of v.quote.items || []) {
        const item = state.cart.find((candidate) => String(candidate.productId) === String(quoted.productId));
        if (!item) continue;
        item.unitPrice = v45Number(quoted.unitPrice);
        item.discount = Math.max(v45Number(quoted.discount), 0);
      }
    } catch {
      const gross = v45GrossSubtotal();
      const itemDiscount = v45ItemDiscountTotal();
      const subtotal = Math.max(gross - itemDiscount, 0);
      v.quote = { subtotal, discount: v45Number(v.discount), surcharge: v45Number(v.surcharge), total: Math.max(subtotal - v45Number(v.discount) + v45Number(v.surcharge), 0) };
    }
    v45RenderCart();
    v45RefreshDiscountControls();
  }

  function v45RefreshDiscountControls() {
    const v = v45State();
    const input = document.getElementById('saleDiscount');
    const mode = document.getElementById('saleDiscountMode');
    const applied = document.getElementById('saleDiscountApplied');
    const applyButton = document.getElementById('saleDiscountApply');
    if (input && mode && document.activeElement !== input) input.value = v45FormatInput(v.discount, mode.value, v45SaleDiscountBase());
    if (applied) applied.textContent = v.discount > 0 ? `Aplicado: ${money(v.discount)} (${v45Percent(v.discount, v45SaleDiscountBase()).toFixed(2)}%)` : 'Nenhum desconto total aplicado.';
    if (applyButton) applyButton.disabled = !v45CanDiscount() || v.discountPending;
    v45UpdateSummary();
  }

  function v45InstallWorkspace() {
    const v = v45State();
    const grid = document.querySelector('.adjustment-grid');
    if (grid) {
      const first = grid.querySelector('label');
      if (first) {
        const canDiscount = v45CanDiscount();
        first.className = 'discount-v45-sale-field';
        first.innerHTML = `<span>Desconto da venda</span><div class="discount-v45-sale-entry"><select id="saleDiscountMode" ${canDiscount ? '' : 'disabled'}><option value="amount" ${v.discountMode === 'amount' ? 'selected' : ''}>R$</option><option value="percent" ${v.discountMode === 'percent' ? 'selected' : ''}>%</option></select><input id="saleDiscount" type="number" min="0" step="0.01" ${canDiscount ? '' : 'disabled'}><button type="button" id="saleDiscountApply" class="secondary" ${canDiscount ? '' : 'disabled'}>Aplicar</button></div><small id="saleDiscountApplied" class="discount-v45-applied"></small>`;
        const mode = first.querySelector('#saleDiscountMode');
        const input = first.querySelector('#saleDiscount');
        const apply = first.querySelector('#saleDiscountApply');
        input.value = v45FormatInput(v.discount, v.discountMode, v45SaleDiscountBase());
        mode.onchange = () => {
          v.discountMode = mode.value;
          input.value = v45FormatInput(v.discount, mode.value, v45SaleDiscountBase());
        };
        input.onkeydown = (event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply.click(); }
        };
        input.onchange = null;
        apply.onclick = () => v45ApplySaleDiscount(input, mode.value);
      }
    }

    const discountRow = document.getElementById('discountValue')?.closest('.total-row');
    if (discountRow) {
      const label = discountRow.querySelector('span');
      if (label) label.textContent = 'Desconto venda';
      if (!document.getElementById('itemDiscountValue')) {
        const row = document.createElement('div');
        row.className = 'total-row discount-row';
        row.innerHTML = '<span>Desconto itens</span><b id="itemDiscountValue">-R$ 0,00</b>';
        discountRow.parentElement.insertBefore(row, discountRow);
      }
    }

    const clear = document.getElementById('clear');
    if (clear) {
      const canRemove = v45Allowed('sale.remove_item', true);
      clear.disabled = !canRemove;
      clear.onclick = () => {
        if (!canRemove) return infoModal('Limpar venda', 'O perfil deste operador não possui permissão para remover itens da venda.');
        state.cart = [];
        v3ResetSale();
        renderSaleWorkspace();
      };
    }

    v45RefreshDiscountControls();
    v45RenderCart();
  }

  v3Reprice = v45Reprice;
  repriceCart = v45Reprice;
  v3RenderCart = v45RenderCart;
  renderCart = v45RenderCart;

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v45InstallWorkspace);
    return result;
  };

  v3CompleteCheckout = async function () {
    const v = v45State();
    if (v.discountPending) return infoModal('Desconto', 'Conclua ou cancele a autorização de desconto antes de finalizar a venda.');
    if (state.busy) return;
    if (!state.status.cashOpenEventId) return openCashModal();
    if (!v3ValidDocument(v.consumerDocument)) return infoModal('CPF/CNPJ', 'CPF/CNPJ inválido. Corrija ou deixe em branco.');
    try {
      state.busy = true;
      const result = await window.thor.finalizeSale({
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: Math.max(v45Number(item.discount), 0) })),
        consumerDocument: v.consumerDocument,
        payments: v.payments,
        discount: Math.max(v45Number(v.discount), 0),
        surcharge: Math.max(v45Number(v.surcharge), 0),
        supervisorAuthorization: v.supervisorAuthorization,
      });
      state.cart = [];
      v3ResetSale();
      await refreshProducts();
      await refreshStatus();
      await refreshFiscalSales();
      renderSaleWorkspace();
      showToast(`Venda concluída: ${money(result.total)}${result.change > 0 ? ` • Troco ${money(result.change)}` : ''}.`);
      await postSalePrint(result.eventId);
    } catch (error) {
      infoModal('Finalização', friendlyError(error?.message));
    } finally {
      state.busy = false;
    }
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const text = String(code || '');
    const messages = {
      discount_not_allowed: 'Este perfil não pode aplicar descontos.',
      item_discount_not_allowed: 'Este perfil não pode aplicar desconto em itens.',
      discount_exceeds_supervisor_limit: 'O desconto solicitado ultrapassa a alçada do supervisor selecionado.',
      supervisor_authorization_required: 'Este desconto exige autorização de supervisor.',
    };
    return messages[text] || previousFriendlyError(code);
  };
})();
