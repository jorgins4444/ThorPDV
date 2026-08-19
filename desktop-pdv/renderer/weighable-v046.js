(function () {
  function w46State() { return v3State(); }
  function w46Number(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function w46Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }
  function w46Qty(value) { return w46Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1'); }
  function w46ScaleWeight(value) {
    const raw = w46Number(value);
    if (raw <= 0) throw new Error('scale_invalid_weight');
    const grams = Number.isInteger(raw) && raw >= 50;
    const weight = grams ? raw / 1000 : raw;
    const normalized = Math.round(weight * 1000) / 1000;
    if (normalized <= 0) throw new Error('scale_invalid_weight');
    return { raw, weight: normalized, grams };
  }
  function w46ProductFlags(product) {
    return {
      isWeighable: Boolean(product?.is_weighable),
      fractioned: Boolean(product?.is_weighable) || Boolean(product?.fractioned),
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'UN'),
    };
  }

  async function w46Commit(product, quantity, replace = false, itemIndex = -1) {
    const qty = w46Number(quantity);
    if (qty <= 0) return infoModal('Quantidade', 'Informe uma quantidade maior que zero.');
    const flags = w46ProductFlags(product);
    if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) {
      return infoModal('Quantidade', 'Este produto não permite quantidade fracionada.');
    }

    const v = w46State();
    if (replace && itemIndex >= 0 && state.cart[itemIndex]) {
      state.cart[itemIndex].quantity = qty;
      Object.assign(state.cart[itemIndex], flags);
    } else {
      const found = state.cart.find((item) => String(item.productId) === String(product.id));
      if (found) {
        found.quantity = w46Number(found.quantity) + qty;
        found.image_url = product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || '';
        Object.assign(found, flags);
      } else {
        state.cart.push({
          productId: product.id,
          name: product.name || product.description || 'Produto',
          image_url: product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '',
          sku: product.sku || '',
          quantity: qty,
          unitPrice: w46Number(product.base_price ?? product.sale_price ?? product.price),
          discount: 0,
          ...flags,
        });
      }
    }
    v.lastProductId = product.id;
    v.supervisorAuthorization = null;
    await v3Reprice();
  }

  function w46QuantityModal(product, options = {}) {
    const flags = w46ProductFlags(product);
    const initial = options.initialQuantity ?? (flags.isWeighable ? '' : 1);
    const title = flags.isWeighable ? 'Informar peso do produto' : 'Informar quantidade';
    const label = flags.isWeighable ? `Peso (${flags.unit})` : `Quantidade (${flags.unit})`;
    const m = modal(`<div class="w46-head"><div><small>${flags.isWeighable ? 'PRODUTO PESÁVEL' : 'QUANTIDADE FRACIONADA'}</small><h3>${title}</h3><p>${esc(product.name || 'Produto')}</p></div><span>${flags.isWeighable ? '⚖' : '123'}</span></div><div class="field"><label>${label}</label><input id="w46Quantity" type="number" min="0.001" step="${flags.fractioned ? '0.001' : '1'}" value="${initial === '' ? '' : w46Qty(initial)}" placeholder="${flags.isWeighable ? 'Ex.: 0,750' : 'Ex.: 1'}"></div><div id="w46ScaleStatus" class="w46-scale-status">${flags.isWeighable ? 'Digite o peso manualmente ou leia a balança conectada.' : 'Informe a quantidade desejada.'}</div><div class="actions"><button class="secondary" id="w46Cancel">Cancelar</button>${flags.isWeighable ? '<button class="secondary" id="w46Scale">⚖ Ler balança</button>' : ''}<button class="primary" id="w46Apply">${options.replace ? 'Atualizar' : 'Adicionar'}</button></div>`, 'wide');
    const input = m.querySelector('#w46Quantity');
    const status = m.querySelector('#w46ScaleStatus');
    const scale = m.querySelector('#w46Scale');
    const apply = m.querySelector('#w46Apply');

    m.querySelector('#w46Cancel').onclick = () => m.remove();
    if (scale) {
      const allowed = w46Allowed('hardware.scale', true);
      scale.disabled = !allowed;
      scale.title = allowed ? 'Ler peso da balança configurada' : 'Perfil sem permissão para usar a balança';
      scale.onclick = async () => {
        if (!allowed) return;
        try {
          scale.disabled = true;
          status.textContent = 'Lendo balança...';
          const result = await window.thor.readScale();
          const reading = w46ScaleWeight(result?.weight);
          input.value = w46Qty(reading.weight);
          status.textContent = reading.grams
            ? `Leitura recebida: ${reading.raw} g = ${w46Qty(reading.weight)} ${flags.unit}. Confirme em ${options.replace ? 'Atualizar' : 'Adicionar'}.`
            : `Peso recebido: ${w46Qty(reading.weight)} ${flags.unit}. Confirme em ${options.replace ? 'Atualizar' : 'Adicionar'}.`;
          input.focus();
        } catch (error) {
          status.textContent = friendlyError(error?.message);
        } finally {
          scale.disabled = !allowed;
        }
      };
    }

    const submit = async () => {
      const qty = w46Number(String(input.value || '').replace(',', '.'));
      if (qty <= 0) {
        status.textContent = 'Informe ou leia um peso/quantidade maior que zero.';
        input.focus();
        return;
      }
      if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) {
        status.textContent = 'Este produto aceita somente quantidade inteira.';
        input.focus();
        return;
      }
      m.remove();
      await w46Commit(product, qty, Boolean(options.replace), Number(options.itemIndex ?? -1));
    };
    apply.onclick = submit;
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } };
    input.focus();
    input.select();
  }

  async function w46Add(product) {
    if (!product?.id) return infoModal('Produto', 'Não foi possível identificar o produto selecionado.');
    const flags = w46ProductFlags(product);
    if (flags.isWeighable || flags.promptQuantity) {
      w46QuantityModal(product);
      return;
    }
    return w46Commit(product, 1);
  }

  function w46CartProduct(item) {
    return {
      id: item.productId,
      name: item.name,
      sku: item.sku,
      unit: item.unit || 'UN',
      base_price: item.unitPrice,
      sale_price: item.unitPrice,
      is_weighable: Boolean(item.isWeighable),
      fractioned: Boolean(item.fractioned),
      prompt_quantity: Boolean(item.promptQuantity),
      allow_discount: item.allowDiscount !== false,
    };
  }

  function w46PatchCartControls() {
    document.querySelectorAll('.cart-v43-item[data-cart-index]').forEach((row) => {
      const index = Number(row.dataset.cartIndex);
      const item = state.cart[index];
      if (!item) return;
      const fractioned = Boolean(item.isWeighable) || Boolean(item.fractioned);
      if (!fractioned) return;
      const qty = row.querySelector('.cart-v43-qty');
      if (!qty) return;
      qty.innerHTML = `<button class="w46-quantity-button" data-w46-quantity="${index}" title="${item.isWeighable ? 'Alterar peso' : 'Alterar quantidade'}"><b>${w46Qty(item.quantity)}</b><small>${esc(item.unit || 'UN')}</small></button>`;
      qty.querySelector('[data-w46-quantity]').onclick = () => w46QuantityModal(w46CartProduct(item), { replace: true, itemIndex: index, initialQuantity: item.quantity });
      if (item.isWeighable) row.classList.add('w46-weighable-row');
    });
  }

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(w46PatchCartControls);
    return result;
  };
  repriceCart = v3Reprice;

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(w46PatchCartControls);
    return result;
  };
  renderCart = v3RenderCart;

  v3Add = w46Add;
  add = w46Add;

  v3ReadScale = async function () {
    const v = w46State();
    const index = state.cart.findIndex((item) => String(item.productId) === String(v.lastProductId));
    const item = index >= 0 ? state.cart[index] : state.cart[state.cart.length - 1];
    if (!item) return infoModal('Balança', 'Adicione primeiro um produto pesável.');
    if (!item.isWeighable) return infoModal('Balança', 'O último produto lançado não está configurado como pesável no Gestão.');
    if (!w46Allowed('hardware.scale', true)) return infoModal('Balança', 'O perfil deste operador não possui permissão para usar a balança.');
    try {
      const result = await window.thor.readScale();
      const reading = w46ScaleWeight(result?.weight);
      item.quantity = reading.weight;
      v.supervisorAuthorization = null;
      await v3Reprice();
      showToast(reading.grams
        ? `Balança: ${reading.raw} g convertidos para ${w46Qty(reading.weight)} ${item.unit || 'KG'}.`
        : `Peso atualizado: ${w46Qty(reading.weight)} ${item.unit || 'KG'}.`);
    } catch (error) {
      infoModal('Balança', friendlyError(error?.message));
    }
  };

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(w46PatchCartControls);
    return result;
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      fractional_quantity_not_allowed: 'Este produto não permite quantidade fracionada.',
      product_discount_not_allowed: 'Este produto está configurado para não aceitar desconto.',
      scale_port_not_configured: 'Nenhuma porta de balança foi configurada neste terminal.',
      scale_weight_not_detected: 'A balança não retornou um peso válido.',
      scale_invalid_weight: 'O peso retornado pela balança é inválido.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();
