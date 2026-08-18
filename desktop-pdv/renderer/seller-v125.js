(function () {
  function sellerState() {
    const value = v3State();
    if (!Object.prototype.hasOwnProperty.call(value, 'sellerInitialized')) value.sellerInitialized = false;
    if (!value.sellerInitialized && value.operator) {
      value.seller = value.operator;
      value.sellerInitialized = true;
    }
    return value;
  }
  function candidates() {
    const value = sellerState();
    return (value.operators || []).filter((user) => user && user.id && user.active !== false);
  }
  function refreshSellerLabel() {
    const value = sellerState();
    const button = document.getElementById('v089Seller');
    if (!button) return;
    const label = button.querySelector('small');
    if (label) label.textContent = value.seller?.name || 'Informar';
    button.title = value.seller?.name
      ? `Vendedor da venda: ${value.seller.name}. Operador do caixa: ${value.operator?.name || 'não identificado'}`
      : 'Informar vendedor desta venda';
  }
  function openSellerSelector() {
    const value = sellerState();
    const rows = candidates();
    const content = rows.length
      ? `<label class="field"><span>Vendedor desta venda</span><select id="v125SellerSelect"><option value="">Sem vendedor informado</option>${rows.map((user) => `<option value="${esc(user.id)}" ${String(value.seller?.id || '') === String(user.id) ? 'selected' : ''}>${esc(user.name || user.email || 'Usuário')}</option>`).join('')}</select></label>
         <div class="v105-beneficiary"><span>OPERADOR DO CAIXA</span><b>${esc(value.operator?.name || 'Não identificado')}</b><small>O operador permanece autenticado; somente o vendedor da venda será alterado.</small></div>`
      : '<p class="muted">Nenhum usuário foi sincronizado para seleção como vendedor.</p>';
    const box = modal(`<div class="v090-movement-head"><div><small>IDENTIFICAÇÃO COMERCIAL</small><h3>Informar vendedor</h3><p>O vendedor pode ser diferente do operador responsável pelo caixa.</p></div><span>#</span></div>
      ${content}<div class="actions"><button class="secondary" id="v125SellerCancel">Cancelar</button>${rows.length ? '<button class="primary" id="v125SellerConfirm">Confirmar vendedor</button>' : ''}</div>`, 'v125-seller-modal');
    box.querySelector('#v125SellerCancel').onclick = () => box.remove();
    box.querySelector('#v125SellerConfirm')?.addEventListener('click', () => {
      const id = box.querySelector('#v125SellerSelect').value;
      value.seller = rows.find((user) => String(user.id) === String(id)) || null;
      value.sellerInitialized = true;
      box.remove();
      refreshSellerLabel();
      showToast(value.seller ? `Vendedor ${value.seller.name} selecionado.` : 'Venda sem vendedor informado.');
    });
  }
  function decorate() {
    const button = document.getElementById('v089Seller');
    if (!button || button.dataset.v125Seller === '1') { refreshSellerLabel(); return; }
    button.dataset.v125Seller = '1';
    button.onclick = openSellerSelector;
    refreshSellerLabel();
  }
  window.openSellerSelectorV125 = openSellerSelector;
  new MutationObserver(decorate).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#operatorBtn')) setTimeout(() => { sellerState(); refreshSellerLabel(); }, 100);
  });
  decorate();
})();
