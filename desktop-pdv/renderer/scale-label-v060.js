(function () {
  let sl60Settings = { scaleLabelEnabled:true, scaleLabelCodeDigits:5, scaleLabelMode:'weight', scaleLabelPrefix:'2' };
  function sl60Digits(value) { return String(value || '').replace(/\D/g, ''); }
  function sl60Number(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function sl60Qty(value) { return Number(value || 0).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1'); }
  function sl60CurrentSettings() {
    try { return { ...sl60Settings, ...(typeof v3State === 'function' ? (v3State().settings || {}) : {}) }; } catch { return sl60Settings; }
  }
  async function sl60RefreshSettings() { sl60Settings = { ...sl60Settings, ...(await window.thor.v3Settings().catch(() => ({}))) }; return sl60Settings; }

  function sl60ValidEan13(code) {
    const digits = sl60Digits(code);
    if (digits.length !== 13) return false;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(digits[12]);
  }

  function sl60Parse(code, settings) {
    const digits = sl60Digits(code);
    if (!settings?.scaleLabelEnabled || digits.length !== 13 || !sl60ValidEan13(digits)) return null;
    const prefix = String(settings.scaleLabelPrefix || '2').slice(0, 1);
    if (digits[0] !== prefix) return null;
    const codeDigits = [4, 5, 6].includes(Number(settings.scaleLabelCodeDigits)) ? Number(settings.scaleLabelCodeDigits) : 5;
    const body = digits.slice(0, 12);
    const productCodeText = body.slice(1, 1 + codeDigits);
    const valueText = body.slice(1 + codeDigits);
    if (!productCodeText || !valueText) return null;
    return {
      raw: digits,
      productCode: Number(productCodeText),
      productCodeText,
      rawValue: Number(valueText),
      valueText,
      mode: settings.scaleLabelMode === 'total_price' ? 'total_price' : 'weight',
    };
  }

  async function sl60Commit(product, quantity) {
    const qty = sl60Number(quantity);
    if (qty <= 0) throw new Error('scale_label_invalid_quantity');
    const fractioned = Boolean(product?.is_weighable) || Boolean(product?.fractioned) || Boolean(product?.label_scale);
    if (!fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) throw new Error('fractional_quantity_not_allowed');
    const flags = {
      isWeighable: Boolean(product?.is_weighable) || Boolean(product?.label_scale),
      fractioned,
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'KG'),
    };
    const found = state.cart.find((item) => String(item.productId) === String(product.id));
    if (found) {
      found.quantity = sl60Number(found.quantity) + qty;
      Object.assign(found, flags);
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name || product.description || 'Produto',
        productCode: product.product_code || '',
        reference: product.sku || '',
        sku: product.sku || String(product.product_code || ''),
        quantity: qty,
        unitPrice: sl60Number(product.base_price ?? product.sale_price ?? product.price),
        discount: 0,
        ...flags,
      });
    }
    const v = typeof v3State === 'function' ? v3State() : null;
    if (v) { v.lastProductId = product.id; v.supervisorAuthorization = null; }
    await v3Reprice();
  }

  async function sl60Handle(code, search, settings) {
    const parsed = sl60Parse(code, settings);
    if (!parsed) return false;
    const results = await window.thor.searchProducts(String(parsed.productCode));
    const product = (results || []).find((item) => Number(item.product_code || item.sku || 0) === parsed.productCode);
    if (!product) {
      infoModal('Etiqueta de balança', `Produto de código ${parsed.productCodeText} não foi encontrado neste caixa.`);
      return true;
    }
    if (!(product.label_scale || product.is_weighable || product.fractioned)) {
      infoModal('Etiqueta de balança', `O produto ${product.name || parsed.productCodeText} não está configurado como pesável / balança etiquetadora.`);
      return true;
    }

    let quantity = 0;
    let detail = '';
    if (parsed.mode === 'weight') {
      quantity = parsed.rawValue / 1000;
      detail = `Peso ${sl60Qty(quantity)} ${product.unit || 'KG'}`;
    } else {
      const totalPrice = parsed.rawValue / 100;
      const unitPrice = sl60Number(product.base_price ?? product.sale_price ?? product.price);
      if (unitPrice <= 0) {
        infoModal('Etiqueta de balança', 'O produto está sem preço de venda e a etiqueta está configurada por preço total.');
        return true;
      }
      quantity = Math.round((totalPrice / unitPrice) * 1000) / 1000;
      detail = `Preço da etiqueta ${money(totalPrice)} • quantidade calculada ${sl60Qty(quantity)} ${product.unit || 'KG'}`;
    }
    if (quantity <= 0) {
      infoModal('Etiqueta de balança', 'A etiqueta não contém peso/preço válido.');
      return true;
    }
    try {
      await sl60Commit(product, quantity);
      showToast(`${product.name}: ${detail}.`);
      if (search) { search.value = ''; search.focus(); }
      state.query = '';
      return true;
    } catch (error) {
      infoModal('Etiqueta de balança', friendlyError(error?.message));
      return true;
    }
  }

  function sl60BindScanner() {
    const search = document.getElementById('search');
    if (!search || search.dataset.scaleLabelV060 === '1') return;
    search.dataset.scaleLabelV060 = '1';
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const code = String(search.value || '').trim();
      const settings = sl60CurrentSettings();
      if (!sl60Parse(code, settings)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void sl60Handle(code, search, settings);
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(() => { sl60BindScanner(); void sl60RefreshSettings(); });
    return result;
  };

  const previousSettingsModal = settingsModal;
  settingsModal = async function () {
    await previousSettingsModal();
    const modals = document.querySelectorAll('.modal');
    const m = modals[modals.length - 1];
    if (!m || m.querySelector('#scaleLabelCodeDigits')) return;
    const settings = await sl60RefreshSettings();
    const grid = m.querySelector('.v3-settings-grid') || m.querySelector('.settings-grid');
    if (!grid) return;
    const section = document.createElement('section');
    section.className = 'sl60-settings';
    section.innerHTML = `<h4>Etiquetas de balança</h4><p class="muted">Leitura de EAN-13 emitido por balança etiquetadora. O primeiro dígito é o prefixo; em seguida vem o código interno do produto.</p><label class="check-line"><input id="scaleLabelEnabled" type="checkbox" ${settings.scaleLabelEnabled !== false ? 'checked' : ''}> Identificar etiquetas de balança no scanner</label><div class="sl60-grid"><div class="field"><label>Prefixo da etiqueta</label><input id="scaleLabelPrefix" inputmode="numeric" maxlength="1" value="${esc(settings.scaleLabelPrefix || '2')}"></div><div class="field"><label>Dígitos do código do produto</label><select id="scaleLabelCodeDigits">${[4,5,6].map((value) => `<option value="${value}" ${Number(settings.scaleLabelCodeDigits || 5) === value ? 'selected' : ''}>${value} dígitos</option>`).join('')}</select></div></div><div class="field"><label>Conteúdo do valor da etiqueta</label><select id="scaleLabelMode"><option value="weight" ${settings.scaleLabelMode !== 'total_price' ? 'selected' : ''}>Peso (3 casas decimais)</option><option value="total_price" ${settings.scaleLabelMode === 'total_price' ? 'selected' : ''}>Preço total (2 casas decimais)</option></select></div><div class="sl60-example" id="scaleLabelExample"></div>`;
    grid.appendChild(section);

    const example = () => {
      const prefix = sl60Digits(m.querySelector('#scaleLabelPrefix').value).slice(0,1) || '2';
      const codeDigits = Number(m.querySelector('#scaleLabelCodeDigits').value || 5);
      const mode = m.querySelector('#scaleLabelMode').value;
      const valueDigits = 11 - codeDigits;
      m.querySelector('#scaleLabelExample').textContent = `${prefix} + ${codeDigits} dígitos do código + ${valueDigits} dígitos de ${mode === 'weight' ? 'peso' : 'preço'} + dígito verificador`;
    };
    m.querySelector('#scaleLabelPrefix').oninput = example;
    m.querySelector('#scaleLabelCodeDigits').onchange = example;
    m.querySelector('#scaleLabelMode').onchange = example;
    example();

    const save = m.querySelector('#saveSettings');
    if (save) {
      const previousSave = save.onclick;
      save.onclick = async function (event) {
        sl60Settings = await window.thor.saveV3Settings({
          scaleLabelEnabled: m.querySelector('#scaleLabelEnabled').checked,
          scaleLabelPrefix: sl60Digits(m.querySelector('#scaleLabelPrefix').value).slice(0,1) || '2',
          scaleLabelCodeDigits: Number(m.querySelector('#scaleLabelCodeDigits').value || 5),
          scaleLabelMode: m.querySelector('#scaleLabelMode').value,
        });
        if (typeof previousSave === 'function') return previousSave.call(this, event);
      };
    }
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      scale_label_invalid_quantity: 'A quantidade calculada pela etiqueta é inválida.',
      scale_label_product_not_found: 'O produto informado na etiqueta de balança não foi encontrado.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();
