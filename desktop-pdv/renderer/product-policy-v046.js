(function () {
  function productPolicyPatch() {
    const hasBlockedDiscountProduct = state.cart.some((item) => item.allowDiscount === false);
    const saleApply = document.getElementById('saleDiscountApply');
    if (saleApply && !saleApply.dataset.productPolicyPatched) {
      const originalClick = saleApply.onclick;
      saleApply.dataset.productPolicyPatched = '1';
      saleApply.onclick = (event) => {
        if (state.cart.some((item) => item.allowDiscount === false)) {
          return infoModal('Desconto da venda', 'Há produto nesta venda configurado para não aceitar desconto. Aplique desconto por item somente nos produtos permitidos.');
        }
        return originalClick?.call(saleApply, event);
      };
    }

    document.querySelectorAll('[data-item-discount]').forEach((button) => {
      const index = Number(button.dataset.itemDiscount);
      const item = state.cart[index];
      if (!item || item.allowDiscount !== false) return;
      button.disabled = true;
      button.textContent = 'Desconto bloqueado';
      button.title = 'Produto configurado para não aceitar desconto';
    });

    const applied = document.getElementById('saleDiscountApplied');
    if (applied && hasBlockedDiscountProduct && Number(v3State().discount || 0) <= 0) {
      applied.textContent = 'Há item sem permissão de desconto: use desconto por item nos demais.';
    }
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(productPolicyPatch);
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(productPolicyPatch);
    return result;
  };
  renderCart = v3RenderCart;

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(productPolicyPatch);
    return result;
  };
  repriceCart = v3Reprice;
})();
