(function () {
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const n = (value) => Number(value || 0);
  const allowsFraction = (item) => Boolean(item?.is_weighable || item?.fractioned || item?.label_scale);
  const remainingFor = (item) => Math.max(n(item?.quantity) - n(item?.returned_quantity), 0);
  const qtyLabel = (value) => n(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  v3PaymentLabels.store_credit_voucher = 'Vale Crédito';

  function returnValue(items, selected) {
    return selected.reduce((sum, row) => {
      const original = items[row.index];
      const qty = n(row.quantity);
      const originalQty = n(original?.quantity);
      const total = n(original?.total ?? (originalQty * n(original?.unit_price)));
      const unitNet = originalQty > 0 ? total / originalQty : 0;
      return sum + qty * unitNet;
    }, 0);
  }

  function customerCard(customer, automatic = false) {
    return `<div class="v105-beneficiary selected"><span>${automatic ? 'CLIENTE IDENTIFICADO NA VENDA' : 'CLIENTE SELECIONADO'}</span><b>${esc(customer?.name || 'Cliente')}</b><small>${esc(customer?.document || '')}${customer?.store_credit_balance != null ? ` • Crédito atual ${money(customer.store_credit_balance)}` : ''}</small></div>`;
  }

  function returnItemRow(item, index) {
    const remaining = remainingFor(item);
    const fractional = allowsFraction(item);
    const unavailable = remaining <= 0.000001;
    const editableQuantity = fractional || remaining > 1.000001;
    const initialQuantity = fractional ? Math.min(1, remaining) : 1;
    const name = item.name || item.description || item.sku || 'Item';
    const unit = item.unit || (fractional ? 'kg' : 'un');

    return `<div class="v105-return-line ${unavailable ? 'unavailable' : ''}" data-return-line="${index}">
      <label class="v105-return-choice">
        <input type="checkbox" data-return-select="${index}" ${unavailable ? 'disabled' : ''}>
        <span class="v105-return-check">✓</span>
        <span class="v105-return-product">
          <b>${esc(name)}</b>
          <small>Vendido: ${qtyLabel(item.quantity)} • Já devolvido: ${qtyLabel(item.returned_quantity)} • Disponível: ${qtyLabel(remaining)} ${esc(unit)}</small>
        </span>
        <em>${unavailable ? 'Já devolvido' : 'Selecionar'}</em>
      </label>
      ${unavailable ? '' : editableQuantity ? `
        <div class="v105-return-qty" data-return-qty-panel="${index}" hidden>
          <label><span>Quantidade a devolver</span><input type="number" min="${fractional ? '0.001' : '1'}" max="${remaining}" step="${fractional ? '0.001' : '1'}" value="${initialQuantity}" data-return-qty="${index}"></label>
          <small>Máximo disponível: ${qtyLabel(remaining)} ${esc(unit)}</small>
        </div>` : `
        <div class="v105-return-qty v105-return-fixed" data-return-qty-panel="${index}" hidden>
          <span>Quantidade a devolver</span><b>1</b><small>Única unidade disponível</small>
        </div>`}
    </div>`;
  }

  returnSaleModal = function (sale) {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const automaticCustomer = sale.customer_id ? { id:sale.customer_id, name:sale.customer_name || sale.customer || 'Cliente da venda', document:sale.customer_document || '', store_credit_balance:sale.customer_store_credit_balance } : null;
    let selectedCustomer = automaticCustomer;
    let guest = null;
    let searchTimer = null;

    const m = modal(`<div class="v105-return-head"><div><small>DEVOLUÇÃO</small><h3>Venda ${sale.number ? `#${esc(sale.number)}` : ''}</h3><p>Selecione primeiro o produto que será devolvido. A quantidade só será solicitada quando necessário.</p></div><div class="v105-credit-only"><span>RESTITUIÇÃO</span><b>Crédito em loja</b><small>Não movimenta dinheiro do caixa</small></div></div>
      <div class="return-items v105-return-items">${items.map(returnItemRow).join('')}</div>
      <div class="v105-return-total"><span>Crédito estimado</span><b id="v105ReturnTotal">${money(0)}</b></div>
      <section class="v105-beneficiary-section"><div class="v105-section-title"><b>Quem receberá o crédito?</b><small>${automaticCustomer ? 'O cliente já foi identificado na venda original.' : 'Localize o cliente antes de concluir a devolução.'}</small></div>
        <div id="v105Beneficiary">${automaticCustomer ? customerCard(automaticCustomer,true) : `<div class="v105-customer-search"><div class="v105-search-line"><input id="v105CustomerQuery" placeholder="Digite CPF ou nome do cliente..." autocomplete="off"><button type="button" id="v105SearchCustomer">Buscar</button></div><div id="v105CustomerResults" class="v105-customer-results"><small>Digite o CPF ou o nome para localizar o cadastro.</small></div></div>`}</div>
      </section>
      <div class="v105-credit-info"><b>Crédito em loja</b><span>Cliente cadastrado: o valor entra diretamente no saldo do cadastro. Pessoa sem cadastro: o ThorPDV emite um Vale Crédito numerado e imprime em 44 colunas.</span></div>
      <div class="field"><label>Motivo</label><textarea id="returnReason" rows="3" placeholder="Motivo da devolução..."></textarea></div>
      <div id="v105ReturnError" class="settings-error"></div>
      <div class="actions"><button class="secondary" id="back">Voltar</button><button class="primary" id="confirmReturn">Gerar Crédito em loja</button></div>`, 'wide v105-return-modal');

    const totalEl = m.querySelector('#v105ReturnTotal');
    const errorEl = m.querySelector('#v105ReturnError');

    const selectedRows = () => [...m.querySelectorAll('[data-return-select]:checked')].map((check) => {
      const index = Number(check.dataset.returnSelect);
      const original = items[index] || {};
      const remaining = remainingFor(original);
      const editableQuantity = allowsFraction(original) || remaining > 1.000001;
      const quantityInput = m.querySelector(`[data-return-qty="${index}"]`);
      return { index, quantity: editableQuantity ? n(quantityInput?.value) : Math.min(1, remaining) };
    }).filter((row) => row.quantity > 0);

    const validateRows = (rows) => {
      for (const row of rows) {
        const original = items[row.index] || {};
        const name = original.name || original.description || original.sku || 'produto';
        const remaining = remainingFor(original);
        const quantity = n(row.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return { index:row.index, message:`Informe uma quantidade válida para ${name}.` };
        if (quantity > remaining + 0.0001) return { index:row.index, message:`A quantidade informada para ${name} é maior que a quantidade disponível para devolução (${qtyLabel(remaining)}).` };
        if (!allowsFraction(original) && Math.abs(quantity - Math.round(quantity)) > 0.000001) return { index:row.index, message:`${name} aceita somente quantidade inteira.` };
      }
      return null;
    };

    const refreshTotal = () => {
      const rows = selectedRows();
      const validation = validateRows(rows);
      totalEl.textContent = money(validation ? 0 : returnValue(items, rows));
      if (!validation && errorEl.dataset.returnValidation === 'true') {
        errorEl.textContent = '';
        delete errorEl.dataset.returnValidation;
      }
    };

    m.querySelectorAll('[data-return-select]').forEach((check) => {
      check.addEventListener('change', () => {
        const index = Number(check.dataset.returnSelect);
        const line = m.querySelector(`[data-return-line="${index}"]`);
        const panel = m.querySelector(`[data-return-qty-panel="${index}"]`);
        line?.classList.toggle('selected', check.checked);
        if (panel) panel.hidden = !check.checked;
        if (check.checked) setTimeout(() => m.querySelector(`[data-return-qty="${index}"]`)?.focus(), 20);
        refreshTotal();
      });
    });

    m.querySelectorAll('[data-return-qty]').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.returnQty);
        const original = items[index] || {};
        const remaining = remainingFor(original);
        const quantity = n(input.value);
        if (quantity > remaining + 0.0001) {
          errorEl.textContent = `Quantidade máxima disponível para ${original.name || original.description || 'este produto'}: ${qtyLabel(remaining)}.`;
          errorEl.dataset.returnValidation = 'true';
        } else if (!allowsFraction(original) && quantity > 0 && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
          errorEl.textContent = 'Produto unitário aceita somente quantidade inteira.';
          errorEl.dataset.returnValidation = 'true';
        } else if (errorEl.dataset.returnValidation === 'true') {
          errorEl.textContent = '';
          delete errorEl.dataset.returnValidation;
        }
        refreshTotal();
      });
    });

    m.querySelector('#back').onclick = () => m.remove();

    async function searchCustomers() {
      const input = m.querySelector('#v105CustomerQuery');
      const box = m.querySelector('#v105CustomerResults');
      const query = String(input?.value || '').trim();
      selectedCustomer = null; guest = null;
      if (query.length < 2) { box.innerHTML = '<small>Digite pelo menos 2 caracteres.</small>'; return; }
      box.innerHTML = '<small>Buscando cliente...</small>';
      try {
        const rows = await window.thor.customers(query);
        const queryDigits = digits(query);
        const exact = queryDigits.length >= 11 ? (rows || []).find(row => digits(row.document) === queryDigits) : null;
        if (exact) {
          selectedCustomer = exact;
          box.innerHTML = customerCard(exact,false) + '<button type="button" class="v105-change-customer" id="v105ChangeCustomer">Trocar cliente</button>';
          box.querySelector('#v105ChangeCustomer').onclick = () => { selectedCustomer=null; input.value=''; input.focus(); box.innerHTML='<small>Digite o CPF ou o nome para localizar o cadastro.</small>'; };
          return;
        }
        box.innerHTML = (rows || []).length ? `<div class="v105-result-list">${rows.map((row,index)=>`<button type="button" data-v105-customer="${index}"><b>${esc(row.name||'Cliente')}</b><small>${esc(row.document||'Sem CPF/CNPJ')} • Crédito ${money(row.store_credit_balance||0)}</small></button>`).join('')}</div><button type="button" class="v105-guest-button" id="v105Guest">Nenhum destes — emitir Vale Crédito para pessoa sem cadastro</button>` : `<div class="v105-no-customer"><b>Nenhum cadastro encontrado.</b><small>Você pode emitir um Vale Crédito para esta pessoa.</small></div><button type="button" class="v105-guest-button" id="v105Guest">Pessoa sem cadastro — emitir Vale Crédito</button>`;
        box.querySelectorAll('[data-v105-customer]').forEach(button => button.onclick = () => {
          const customer = rows[Number(button.dataset.v105Customer)]; selectedCustomer=customer; guest=null;
          box.innerHTML = customerCard(customer,false) + '<button type="button" class="v105-change-customer" id="v105ChangeCustomer">Trocar cliente</button>';
          box.querySelector('#v105ChangeCustomer').onclick = () => { selectedCustomer=null; box.innerHTML='<small>Faça uma nova busca acima.</small>'; input.focus(); };
        });
        const guestButton = box.querySelector('#v105Guest');
        if (guestButton) guestButton.onclick = () => {
          const raw = String(input.value || '').trim(); const doc = digits(raw);
          guest = { name:doc.length>=11 ? '' : raw, document:doc.length>=11 ? doc : '' }; selectedCustomer=null;
          box.innerHTML = `<div class="v105-beneficiary voucher"><span>PESSOA SEM CADASTRO</span><b>Será emitido um Vale Crédito</b><small>${esc(guest.name || guest.document)} • numeração gerada automaticamente</small></div><button type="button" class="v105-change-customer" id="v105ChangeCustomer">Voltar à busca</button>`;
          box.querySelector('#v105ChangeCustomer').onclick = () => { guest=null; box.innerHTML='<small>Faça uma nova busca acima.</small>'; input.focus(); };
        };
      } catch (error) { box.innerHTML = `<small class="error">${esc(friendlyError(error.message))}</small>`; }
    }

    const query = m.querySelector('#v105CustomerQuery');
    if (query) {
      query.oninput = () => { clearTimeout(searchTimer); searchTimer=setTimeout(searchCustomers,300); };
      query.onkeydown = event => { if(event.key==='Enter'){event.preventDefault();searchCustomers();} };
      m.querySelector('#v105SearchCustomer').onclick = searchCustomers;
      setTimeout(()=>query.focus(),50);
    }

    m.querySelector('#confirmReturn').onclick = async () => {
      errorEl.textContent='';
      delete errorEl.dataset.returnValidation;
      const rows = selectedRows();
      if (!rows.length) { errorEl.textContent='Selecione ao menos um produto para devolver.'; return; }
      const validation = validateRows(rows);
      if (validation) {
        errorEl.textContent = validation.message;
        errorEl.dataset.returnValidation = 'true';
        m.querySelector(`[data-return-qty="${validation.index}"]`)?.focus();
        return;
      }
      if (!automaticCustomer && !selectedCustomer && !guest) { errorEl.textContent='Localize um cliente ou escolha emitir Vale Crédito para pessoa sem cadastro.'; return; }
      const selected = rows.map(row=>{const original=items[row.index];return {sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,line_index:row.index,quantity:row.quantity};});
      const button = m.querySelector('#confirmReturn'); button.disabled=true; button.textContent='Processando devolução...';
      try {
        const result = await window.thor.returnSale({
          saleKey:saleKey(sale),items:selected,refundMethod:'store_credit',reason:m.querySelector('#returnReason').value.trim(),
          returnCustomerId:selectedCustomer?.id || automaticCustomer?.id || null,
          guestName:guest?.name || '',guestDocument:guest?.document || ''
        });
        m.remove();
        const returnReceipt = result.voucher || result.returnReceipt || null;
        if (returnReceipt) {
          try { await window.thor.printStoreCreditVoucher(returnReceipt); }
          catch (printError) { infoModal('Comprovante de devolução', `A devolução foi concluída, mas não foi possível imprimir o comprovante em 44 colunas: ${friendlyError(printError.message)}.`); }
        }
        try { await window.thor.sync(); } catch {}
        await refreshProducts(); await refreshFiscalSales();
        if (result.voucher) showToast(`Vale Crédito ${result.voucher.voucher_number} emitido: ${money(result.voucher.original_amount)}.`);
        else showToast(`Crédito de ${money(result.estimatedTotal)} lançado para ${result.storeCreditCustomerName || selectedCustomer?.name || automaticCustomer?.name || 'cliente'}.`);
      } catch (error) { button.disabled=false; button.textContent='Gerar Crédito em loja'; infoModal('Devolução',friendlyError(error.message)); }
    };
    return m;
  };

  function voucherPaymentModal() {
    if (!state.cart.length) return;
    const m = modal(`<div class="v105-voucher-pay-head"><div><small>PAGAMENTO</small><h3>Vale Crédito</h3></div><strong>${money(v3Remaining())}</strong></div>
      <div class="field"><label>Número do Vale Crédito</label><div class="v105-search-line"><input id="v105VoucherNumber" placeholder="Ex.: VC260816..." autocomplete="off"><button type="button" id="v105VoucherSearch">Consultar</button></div></div>
      <div id="v105VoucherInfo" class="v105-voucher-info"><small>Informe o número impresso no vale.</small></div>
      <div class="field"><label>Valor a utilizar</label><input id="v105VoucherAmount" type="number" min="0.01" step="0.01" value="0.00" disabled></div>
      <div id="v105VoucherError" class="settings-error"></div><div class="actions"><button class="secondary" id="v105VoucherBack">Voltar</button><button class="primary" id="v105VoucherAdd" disabled>Usar Vale Crédito</button></div>`, 'v105-voucher-pay');
    let voucher = null;
    const number = m.querySelector('#v105VoucherNumber'), amount=m.querySelector('#v105VoucherAmount'), info=m.querySelector('#v105VoucherInfo'), error=m.querySelector('#v105VoucherError'), add=m.querySelector('#v105VoucherAdd');
    m.querySelector('#v105VoucherBack').onclick=()=>m.remove();
    const lookup = async () => {
      error.textContent=''; voucher=null; add.disabled=true; amount.disabled=true; info.innerHTML='<small>Consultando saldo...</small>';
      try { try { await window.thor.sync(); } catch {} voucher=await window.thor.storeCreditVoucher(number.value); const remaining=n(voucher.remaining); if(voucher.status!=='active'||remaining<=0)throw new Error('store_credit_voucher_not_active'); const applied=Math.min(v3Remaining(),remaining); amount.value=applied.toFixed(2);amount.max=remaining.toFixed(2);amount.disabled=false;add.disabled=false;info.innerHTML=`<span><small>VALE ${esc(voucher.voucher_number)}</small><b>Saldo ${money(remaining)}</b><em>${voucher.guest_name?esc(voucher.guest_name):esc(voucher.guest_document||'')}</em></span>`; }
      catch (e) { info.innerHTML='<small>Vale não localizado ou sem saldo.</small>';error.textContent=friendlyError(e.message); }
    };
    m.querySelector('#v105VoucherSearch').onclick=lookup; number.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();lookup();}};
    add.onclick=()=>{if(!voucher)return;const value=n(amount.value);const remaining=n(voucher.remaining);if(value<=0)return error.textContent='Informe um valor.';if(value>remaining+0.001)return error.textContent=`Saldo do vale: ${money(remaining)}.`;if(value>v3Remaining()+0.001)return error.textContent=`Valor restante da venda: ${money(v3Remaining())}.`;v3State().payments.push({method:'store_credit_voucher',amount:value,metadata:{voucher_number:voucher.voucher_number}});m.remove();v3RenderCart();showToast(`Vale ${voucher.voucher_number}: ${money(value)} aplicado.`);};
    setTimeout(()=>number.focus(),50);
  }

  const previousPaymentModal = v3PaymentModal;
  v3PaymentModal = function (initialMethod='cash') {
    if (initialMethod === 'store_credit_voucher') return voucherPaymentModal();
    const result = previousPaymentModal(initialMethod);
    queueMicrotask(()=>document.querySelectorAll('.modal [data-method="store_credit_voucher"]').forEach(button=>button.remove()));
    return result;
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      return_only_store_credit_allowed:'Devoluções do ThorPDV são restituídas somente como Crédito em loja.',
      return_customer_identification_required:'Identifique o cliente por CPF/nome ou escolha emitir Vale Crédito.',
      return_customer_not_found:'O cliente selecionado não está disponível no cadastro deste caixa.',
      return_quantity_exceeds_remaining:'A quantidade informada é maior que a quantidade disponível para devolução.',
      return_item_ambiguous:'Não foi possível identificar com segurança o item da venda. Sincronize a venda e tente novamente.',
      fractional_quantity_not_allowed:'Este produto aceita somente quantidade inteira.',
      store_credit_voucher_number_required:'Informe o número do Vale Crédito.',
      store_credit_voucher_not_found:'Vale Crédito não localizado.',
      store_credit_voucher_not_active:'Este Vale Crédito não possui saldo disponível.',
      insufficient_store_credit_voucher:'O valor informado é maior que o saldo disponível no Vale Crédito.',
      thermal_printer_required:'Configure uma impressora térmica para imprimir o Vale Crédito.',
    };
    return messages[String(code||'')] || previousFriendlyError(code);
  };

  queueMicrotask(()=>{ try { if(state?.view==='sale') renderSaleWorkspace(); } catch {} });
})();
