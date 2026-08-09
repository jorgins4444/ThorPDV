(function () {
  function cartV43State() {
    try { return v3State(); } catch { return state.v3 || {}; }
  }

  function cartV43Price(product) {
    const value = Number(product?.base_price ?? product?.sale_price ?? product?.price ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function cartV43Qty(value) {
    const quantity = Number(value || 0);
    if (!Number.isFinite(quantity)) return '0';
    return quantity.toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  function cartV43Subtotal() {
    return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  }

  function cartV43UpdateSummary(v) {
    const fallbackSubtotal = cartV43Subtotal();
    const subtotal = Number(v.quote?.subtotal ?? fallbackSubtotal);
    const discount = Number(v.quote?.discount ?? v.discount ?? 0);
    const surcharge = Number(v.quote?.surcharge ?? v.surcharge ?? 0);
    const total = Number(v.quote?.total ?? Math.max(subtotal - discount + surcharge, 0));
    const paidValue = typeof v3Paid === 'function' ? Number(v3Paid() || 0) : 0;
    const remainingValue = Math.max(total - paidValue, 0);

    const sub = document.getElementById('subtotalValue');
    const disc = document.getElementById('discountValue');
    const sur = document.getElementById('surchargeValue');
    const grand = document.getElementById('grand');
    const paid = document.getElementById('paidValue');
    const remain = document.getElementById('remainingValue');

    if (sub) sub.textContent = money(subtotal);
    if (disc) disc.textContent = `-${money(discount)}`;
    if (sur) sur.textContent = money(surcharge);
    if (grand) grand.textContent = money(total);
    if (paid) paid.textContent = money(paidValue);
    if (remain) remain.textContent = money(remainingValue);

    const title = document.querySelector('.v3-cart-panel .cart-head h2');
    if (title) {
      const itemCount = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      title.innerHTML = `Cupom <span class="cart-v43-count">${cartV43Qty(itemCount)} item(ns)</span>`;
    }
  }

  function cartV43RenderPayments(v) {
    const pay = document.getElementById('paymentSummary');
    if (!pay) return;
    pay.innerHTML = v.payments?.length
      ? v.payments.map((payment, index) => `<div><span>${esc(v3PaymentLabels[payment.method] || payment.method)}${payment.integrated ? ' • integrado' : ''}</span><b>${money(payment.amount)}</b><button data-remove-pay="${index}" title="Remover pagamento">×</button></div>`).join('')
      : '<small>Nenhum pagamento lançado.</small>';
    pay.querySelectorAll('[data-remove-pay]').forEach((button) => {
      button.onclick = () => {
        v.payments.splice(Number(button.dataset.removePay), 1);
        cartV43Render();
      };
    });
  }

  function cartV43Render() {
    const v = cartV43State();
    const box = document.getElementById('cart');
    if (!box) return;

    if (!state.cart.length) {
      box.innerHTML = '<div class="cart-v43-empty"><strong>Nenhum item na venda</strong><span>Leia um código de barras, digite o SKU ou clique em um produto.</span></div>';
    } else {
      box.innerHTML = `<div class="cart-v43-list-head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span><span></span></div>${state.cart.map((item, index) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const lineTotal = quantity * unitPrice;
        return `<div class="cart-v43-item" data-cart-index="${index}">
          <div class="cart-v43-product"><strong title="${esc(item.name || 'Produto')}">${esc(item.name || 'Produto')}</strong><small>${esc(item.sku || 'Sem SKU')}</small></div>
          <div class="cart-v43-qty"><button data-minus="${index}" title="Diminuir quantidade">−</button><b>${cartV43Qty(quantity)}</b><button data-plus="${index}" title="Aumentar quantidade">+</button></div>
          <div class="cart-v43-unit">${money(unitPrice)}</div>
          <div class="cart-v43-total">${money(lineTotal)}</div>
          <button class="cart-v43-remove" data-remove-item="${index}" title="Remover item">×</button>
        </div>`;
      }).join('')}`;

      box.querySelectorAll('[data-minus]').forEach((button) => {
        button.onclick = async () => {
          const index = Number(button.dataset.minus);
          const item = state.cart[index];
          if (!item) return;
          item.quantity = Number(item.quantity || 0) - 1;
          if (item.quantity <= 0) state.cart.splice(index, 1);
          cartV43Render();
          await v3Reprice();
        };
      });

      box.querySelectorAll('[data-plus]').forEach((button) => {
        button.onclick = async () => {
          const item = state.cart[Number(button.dataset.plus)];
          if (!item) return;
          item.quantity = Number(item.quantity || 0) + 1;
          cartV43Render();
          await v3Reprice();
        };
      });

      box.querySelectorAll('[data-remove-item]').forEach((button) => {
        button.onclick = async () => {
          state.cart.splice(Number(button.dataset.removeItem), 1);
          cartV43Render();
          await v3Reprice();
        };
      });
    }

    cartV43UpdateSummary(v);
    cartV43RenderPayments(v);
  }

  async function cartV43Add(product) {
    if (!product || !product.id) {
      infoModal('Produto', 'Não foi possível identificar o produto selecionado. Sincronize o terminal e tente novamente.');
      return;
    }

    const v = cartV43State();
    const productId = String(product.id);
    const found = state.cart.find((item) => String(item.productId) === productId);

    if (found) {
      found.quantity = Number(found.quantity || 0) + 1;
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name || product.description || 'Produto',
        sku: product.sku || '',
        quantity: 1,
        unitPrice: cartV43Price(product),
      });
    }

    v.lastProductId = product.id;

    const subtotal = cartV43Subtotal();
    const discount = Number(v.discount || 0);
    const surcharge = Number(v.surcharge || 0);
    v.quote = {
      ...(v.quote || {}),
      subtotal,
      discount,
      surcharge,
      total: Math.max(subtotal - discount + surcharge, 0),
    };

    cartV43Render();
    await v3Reprice();

    const current = state.cart.find((item) => String(item.productId) === productId);
    if (current && Number(current.unitPrice || 0) <= 0) {
      showToast(`${current.name} adicionado, mas está sem preço de venda.`);
    }
  }

  v3RenderCart = cartV43Render;
  renderCart = cartV43Render;
  v3Add = cartV43Add;
  add = cartV43Add;

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(cartV43Render);
    return result;
  };
})();
