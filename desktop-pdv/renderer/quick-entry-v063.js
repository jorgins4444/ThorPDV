(function () {
  let q63ScanTimer = null;
  let q63LastInputAt = 0;
  let q63ScanStartedAt = 0;
  let q63ScanCount = 0;
  let q63Busy = false;

  function q63Text(value) {
    return String(value ?? '').trim();
  }

  function q63Number(value) {
    const number = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }

  function q63Qty(value) {
    return q63Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  function q63Barcodes(product) {
    const values = [];
    if (product?.barcode) values.push(product.barcode);
    const source = Array.isArray(product?.barcodes) ? product.barcodes : [];
    for (const item of source) {
      if (typeof item === 'string' || typeof item === 'number') values.push(item);
      else if (item && typeof item === 'object') values.push(item.barcode ?? item.code ?? item.value ?? '');
    }
    return values.map((value) => q63Text(value).toLowerCase()).filter(Boolean);
  }

  function q63ExplicitToken(rawToken) {
    const token = q63Text(rawToken);
    const match = token.match(/^(cod|codigo|c|ref|r|ean|e)\s*:\s*(.+)$/i);
    if (!match) return { kind: 'auto', value: token };
    const prefix = match[1].toLowerCase();
    const kind = ['cod', 'codigo', 'c'].includes(prefix) ? 'code' : ['ref', 'r'].includes(prefix) ? 'reference' : 'ean';
    return { kind, value: q63Text(match[2]) };
  }

  function q63MatchScore(product, rawToken) {
    const explicit = q63ExplicitToken(rawToken);
    const token = explicit.value.toLowerCase();
    if (!token) return -1;
    const digits = token.replace(/\D/g, '');
    const codeMatches = digits && /^\d+$/.test(token) && Number(product?.product_code || 0) === Number(digits);
    const referenceMatches = q63Text(product?.sku).toLowerCase() === token;
    const eanMatches = q63Barcodes(product).includes(token);

    if (explicit.kind === 'code') return codeMatches ? 400 : -1;
    if (explicit.kind === 'reference') return referenceMatches ? 400 : -1;
    if (explicit.kind === 'ean') return eanMatches ? 400 : -1;

    if (eanMatches) return 300;
    if (codeMatches) return 200;
    if (referenceMatches) return 100;
    return -1;
  }

  async function q63ResolveExact(rawToken) {
    const explicit = q63ExplicitToken(rawToken);
    const token = explicit.value;
    if (!token) return null;
    const results = await window.thor.searchProducts(token).catch(() => []);
    let best = null;
    let bestScore = -1;
    for (const product of Array.isArray(results) ? results : []) {
      const score = q63MatchScore(product, rawToken);
      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function q63ParseQuantity(raw) {
    const match = q63Text(raw).match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:\*|x)\s*(.+)$/i);
    if (!match) return null;
    const quantity = q63Number(match[1]);
    const token = q63Text(match[2]);
    if (!quantity || !token) return null;
    return { quantity, token };
  }

  function q63Flags(product) {
    return {
      isWeighable: Boolean(product?.is_weighable) || Boolean(product?.label_scale),
      fractioned: Boolean(product?.is_weighable) || Boolean(product?.fractioned) || Boolean(product?.label_scale),
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'UN'),
    };
  }

  async function q63CommitQuantity(product, quantity) {
    const qty = q63Number(quantity);
    if (!product?.id || qty <= 0) throw new Error('quick_entry_invalid_quantity');
    const flags = q63Flags(product);
    if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) throw new Error('fractional_quantity_not_allowed');

    const productId = String(product.id);
    const found = state.cart.find((item) => String(item.productId) === productId);
    if (found) {
      found.quantity = q63Number(found.quantity) + qty;
      found.productCode = product.product_code || found.productCode || '';
      found.reference = product.sku || found.reference || '';
      found.sku = product.sku || found.sku || '';
      found.image_url = product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || '';
      Object.assign(found, flags);
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name || product.description || 'Produto',
        image_url: product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '',
        productCode: product.product_code || '',
        reference: product.sku || '',
        sku: product.sku || '',
        quantity: qty,
        unitPrice: q63Number(product.base_price ?? product.sale_price ?? product.price),
        discount: 0,
        ...flags,
      });
    }

    const v = typeof v3State === 'function' ? v3State() : null;
    if (v) {
      v.lastProductId = product.id;
      v.supervisorAuthorization = null;
    }
    await v3Reprice();
  }

  function q63ResetSearch(search) {
    if (!search) return;
    search.value = '';
    search.focus();
    state.query = '';
    state.products = [];
    try { renderProducts(); } catch {}
  }

  async function q63LaunchProduct(product, search, quantity = null) {
    if (!product) return false;
    if (quantity != null) {
      await q63CommitQuantity(product, quantity);
      showToast(`${q63Qty(quantity)} × ${product.name || 'Produto'} lançado.`);
    } else {
      await add(product);
    }
    q63ResetSearch(search);
    return true;
  }

  async function q63Handle(raw, search) {
    if (q63Busy) return;
    q63Busy = true;
    try {
      const quantityEntry = q63ParseQuantity(raw);
      if (quantityEntry) {
        const product = await q63ResolveExact(quantityEntry.token);
        if (!product) {
          showToast(`Produto "${quantityEntry.token}" não encontrado.`);
          search.select();
          return;
        }
        await q63LaunchProduct(product, search, quantityEntry.quantity);
        return;
      }

      const exact = await q63ResolveExact(raw);
      if (exact) {
        await q63LaunchProduct(exact, search);
        return;
      }

      const normalized = q63Text(raw);
      const barcodeLike = /^\d{6,14}$/.test(normalized) || /^(ean|e)\s*:/i.test(normalized);
      const explicit = /^(cod|codigo|c|ref|r|ean|e)\s*:/i.test(normalized);
      if (barcodeLike || explicit) {
        showToast('Produto não encontrado para o código informado.');
        search.select();
        return;
      }

      await refreshProducts(normalized);
      const first = state.products?.[0];
      if (!first) {
        showToast('Produto não encontrado.');
        search.select();
        return;
      }
      await q63LaunchProduct(first, search);
    } catch (error) {
      const code = String(error?.message || error || '');
      if (code === 'quick_entry_invalid_quantity') infoModal('Quantidade', 'Informe uma quantidade maior que zero.');
      else infoModal('Lançamento rápido', friendlyError(code));
      search.select();
    } finally {
      q63Busy = false;
    }
  }

  function q63DispatchEnter(search) {
    search.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
  }

  function q63AutoScannerInput(search) {
    const now = performance.now();
    const gap = q63LastInputAt ? now - q63LastInputAt : 999;
    if (gap > 70) {
      q63ScanStartedAt = now;
      q63ScanCount = 1;
    } else {
      q63ScanCount += 1;
    }
    q63LastInputAt = now;

    if (q63ScanTimer) clearTimeout(q63ScanTimer);
    const raw = q63Text(search.value);
    const numericBarcode = /^\d{8}$|^\d{12,14}$/.test(raw);
    if (!numericBarcode || q63ScanCount < 6) return;

    const duration = Math.max(now - q63ScanStartedAt, 1);
    const averageGap = duration / Math.max(q63ScanCount - 1, 1);
    if (averageGap > 35) return;

    q63ScanTimer = setTimeout(() => {
      if (q63Text(search.value) !== raw || q63Busy) return;
      q63DispatchEnter(search);
    }, 45);
  }

  function q63AddHint(search) {
    const zone = search.closest('.v47-search-zone') || search.parentElement?.parentElement;
    if (!zone || zone.querySelector('.q63-hint')) return;
    const hint = document.createElement('small');
    hint.className = 'q63-hint';
    hint.innerHTML = '<b>Lançamento rápido:</b> bip EAN = adiciona direto • <code>2*3</code> = 2 un. do código 3 • <code>1,250*5</code> = quantidade fracionada • aceita código principal, referência ou EAN.';
    const products = zone.querySelector('#products');
    if (products) zone.insertBefore(hint, products);
    else zone.appendChild(hint);
  }

  function q63Bind() {
    const search = document.getElementById('search');
    if (!search || search.dataset.quickEntryV063 === '1') return;
    search.dataset.quickEntryV063 = '1';
    q63AddHint(search);

    search.addEventListener('input', () => q63AutoScannerInput(search));
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && q63Text(search.value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (q63ScanTimer) clearTimeout(q63ScanTimer);
        queueMicrotask(() => q63DispatchEnter(search));
        return;
      }
      if (event.key !== 'Enter') return;
      const raw = q63Text(search.value);
      if (!raw) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (q63ScanTimer) clearTimeout(q63ScanTimer);
      void q63Handle(raw, search);
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(q63Bind);
    return result;
  };
})();
