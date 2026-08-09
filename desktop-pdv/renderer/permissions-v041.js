function p41Operator() {
  try { return state.status?.operator || v3State?.().operator || null; } catch { return state.status?.operator || null; }
}

function p41Value(path, fallback = undefined) {
  const operator = p41Operator();
  if (!operator) return fallback;
  return path.split('.').reduce((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }, operator.permissions || {}) ?? fallback;
}

function p41Allowed(path, fallback = false) {
  return Boolean(p41Value(path, fallback));
}

function p41Block(element, message = 'Sem permissão neste perfil') {
  if (!element) return;
  element.disabled = true;
  element.setAttribute('aria-disabled', 'true');
  element.title = message;
  element.classList.add('permission-disabled');
}

function p41ApplyTopPermissions() {
  const operator = p41Operator();
  if (!operator) return;

  const fiscal = document.getElementById('navFiscal');
  if (fiscal && !p41Allowed('fiscal.view')) fiscal.hidden = true;

  const settings = document.getElementById('settings');
  if (settings && !p41Allowed('settings.edit')) settings.hidden = true;

  const sync = document.getElementById('sync');
  if (sync && !p41Allowed('sync.manual')) sync.hidden = true;

  const drawer = document.getElementById('drawerBtn');
  if (drawer && !p41Allowed('hardware.manual_drawer')) drawer.hidden = true;
}

function p41ApplySalePermissions() {
  const operator = p41Operator();
  if (!operator || state.view !== 'sale') return;

  if (!p41Allowed('sale.create')) p41Block(document.getElementById('finalize'), 'Este perfil não pode realizar vendas');

  const documentInput = document.getElementById('consumerDocument');
  if (documentInput && !p41Allowed('customer.identify')) {
    documentInput.value = '';
    documentInput.disabled = true;
    documentInput.title = 'Este perfil não pode identificar o consumidor';
  }

  if (!p41Allowed('hardware.scale')) p41Block(document.getElementById('scaleRead'), 'Este perfil não pode usar a balança');

  document.querySelectorAll('[data-v3-pay]').forEach((button) => {
    const method = String(button.dataset.v3Pay || '');
    if (method && !p41Allowed(`payment.${method}`)) p41Block(button, 'Forma de pagamento não permitida para este perfil');
  });

  const cash = document.getElementById('cash');
  if (cash && !state.status?.cashOpenEventId && !p41Allowed('cash.open')) p41Block(cash, 'Este perfil não pode abrir caixa');
}

const p41OriginalRender = render;
render = function () {
  const result = p41OriginalRender();
  queueMicrotask(() => {
    p41ApplyTopPermissions();
    p41ApplySalePermissions();
  });
  return result;
};

const p41OriginalUpdateTop = updateTop;
updateTop = function () {
  const result = p41OriginalUpdateTop();
  p41ApplyTopPermissions();
  return result;
};

const p41OriginalSetView = setView;
setView = function (view) {
  if (view === 'fiscal' && p41Operator() && !p41Allowed('fiscal.view')) {
    infoModal('Acesso restrito', 'O perfil deste operador não possui acesso ao Menu Fiscal.');
    return;
  }
  return p41OriginalSetView(view);
};

const p41OriginalRenderSaleWorkspace = renderSaleWorkspace;
renderSaleWorkspace = function () {
  const result = p41OriginalRenderSaleWorkspace();
  queueMicrotask(p41ApplySalePermissions);
  return result;
};

const p41OriginalPaymentModal = v3PaymentModal;
v3PaymentModal = function (initialMethod = 'cash') {
  const operator = p41Operator();
  if (operator) {
    const allowedMethods = Object.keys(v3PaymentLabels || {}).filter((method) => p41Allowed(`payment.${method}`));
    if (!allowedMethods.length) {
      infoModal('Pagamento', 'Este perfil não possui nenhuma forma de pagamento liberada.');
      return;
    }
    if (!p41Allowed(`payment.${initialMethod}`)) initialMethod = allowedMethods[0];
  }

  const result = p41OriginalPaymentModal(initialMethod);
  queueMicrotask(() => {
    const modals = [...document.querySelectorAll('.modal')];
    const modalElement = modals[modals.length - 1];
    if (!modalElement || !p41Operator()) return;
    modalElement.querySelectorAll('[data-method]').forEach((button) => {
      const method = String(button.dataset.method || '');
      if (method && !p41Allowed(`payment.${method}`)) p41Block(button, 'Forma de pagamento não permitida para este perfil');
    });
    if (!p41Allowed('payment.integrated')) p41Block(modalElement.querySelector('#integratedPay'), 'Pagamento integrado não permitido para este perfil');
  });
  return result;
};

const p41OriginalSettingsModal = settingsModal;
settingsModal = async function () {
  if (p41Operator() && !p41Allowed('settings.edit')) {
    infoModal('Configurações', 'O perfil deste operador não pode alterar as configurações do terminal.');
    return;
  }
  return p41OriginalSettingsModal();
};

const p41OriginalSafePrint = safePrint;
safePrint = async function (key, type, reprint = false) {
  if (!reprint) return p41OriginalSafePrint(key, type);
  try {
    const result = await window.thor.printSale(key, type, true);
    if (result?.cancelled) return;
    showToast(type === 'nfce' ? 'NFC-e reenviada para impressão.' : 'Documento reenviado para impressão.');
  } catch (error) {
    if (error.message === 'printer_not_configured') infoModal('Impressora não configurada', 'Abra Configurações, escolha uma impressora instalada no Windows ou “Salvar como PDF”.');
    else infoModal('Reimpressão', friendlyError(error.message));
  }
};

const p41OriginalOpenSaleDetail = openSaleDetail;
openSaleDetail = async function (sale) {
  if (p41Operator() && !p41Allowed('fiscal.view')) {
    infoModal('Acesso restrito', 'O perfil deste operador não possui acesso aos detalhes fiscais da venda.');
    return;
  }

  await p41OriginalOpenSaleDetail(sale);
  const modals = [...document.querySelectorAll('.modal')];
  const modalElement = modals[modals.length - 1];
  if (!modalElement || !p41Operator()) return;

  const key = saleKey(sale);
  const reprint = modalElement.querySelector('#reprintSale');
  if (reprint) {
    if (p41Allowed('print.receipt') && p41Allowed('print.reprint')) reprint.onclick = () => safePrint(key, 'pre_sale', true);
    else p41Block(reprint, 'Este perfil não pode reimprimir documentos');
  }

  const nfce = modalElement.querySelector('#nfceSale');
  const authorized = sale.fiscal?.status === 'authorized';
  if (nfce && authorized) {
    if (p41Allowed('print.nfce') && p41Allowed('print.reprint') && p41Allowed('fiscal.reprint')) nfce.onclick = () => safePrint(key, 'nfce', true);
    else p41Block(nfce, 'Este perfil não pode reimprimir NFC-e');
  } else if (nfce && !p41Allowed('fiscal.request_nfce')) {
    p41Block(nfce, 'Este perfil não pode solicitar NFC-e');
  }
};

const p41OriginalFriendlyError = friendlyError;
friendlyError = function (code) {
  const text = String(code || '');
  if (text.startsWith('payment_method_not_allowed:')) return 'Esta forma de pagamento não está liberada para o perfil do operador.';
  const permissionErrors = {
    operator_not_allowed_to_sell: 'Este perfil não pode realizar vendas.',
    operator_not_allowed_to_identify_customer: 'Este perfil não pode identificar o consumidor na venda.',
    integrated_payment_not_allowed: 'Este perfil não pode usar TEF/PIX integrado.',
    manual_drawer_not_allowed: 'Este perfil não pode abrir a gaveta manualmente.',
    scale_not_allowed: 'Este perfil não pode usar a balança.',
    nfce_request_not_allowed: 'Este perfil não pode solicitar NFC-e.',
    fiscal_menu_not_allowed: 'Este perfil não possui acesso ao Menu Fiscal.',
    manual_sync_not_allowed: 'Este perfil não pode iniciar sincronização manual.',
    settings_edit_not_allowed: 'Este perfil não pode alterar as configurações do terminal.',
    receipt_print_not_allowed: 'Este perfil não pode imprimir comprovantes.',
    nfce_print_not_allowed: 'Este perfil não pode imprimir NFC-e.',
    document_reprint_not_allowed: 'Este perfil não pode reimprimir documentos.',
    nfce_reprint_not_allowed: 'Este perfil não pode reimprimir NFC-e.',
    operator_not_allowed_to_open_cash: 'Este perfil não pode abrir caixa.',
    operator_not_allowed_to_close_cash: 'Este perfil não pode fechar caixa.',
    cash_open_not_authorized: 'A abertura de caixa não está autorizada para este perfil.',
    cash_movement_not_authorized: 'A movimentação de caixa não está autorizada para este perfil.',
    sale_cancel_not_authorized: 'O cancelamento da venda não está autorizado para este perfil.',
    invalid_operator: 'O operador ou o perfil não está ativo para este terminal.',
  };
  return permissionErrors[text] || p41OriginalFriendlyError(code);
};
