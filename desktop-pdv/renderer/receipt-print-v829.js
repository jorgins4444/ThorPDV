(function installReceiptColumnsSetting(){
  const enhance = async () => {
    const printerSelect = document.getElementById('printerSelect');
    const saveButton = document.getElementById('saveSettings');
    if (!printerSelect || !saveButton || saveButton.dataset.receiptColumnsPatched === '1') return;
    saveButton.dataset.receiptColumnsPatched = '1';

    let current = 44;
    try {
      const settings = await window.thor.settings();
      current = Number(settings?.receiptColumns) === 65 ? 65 : 44;
    } catch {}

    const field = document.createElement('div');
    field.className = 'field';
    field.dataset.receiptColumnsField = '1';
    field.innerHTML = `<label>Largura do cupom térmico</label><select id="receiptColumns"><option value="44" ${current===44?'selected':''}>44 colunas — padrão térmico</option><option value="65" ${current===65?'selected':''}>65 colunas — cupom compacto</option></select><small class="muted">Aplicado à pré-venda/comprovante e ao DANFE NFC-e. Na NFC-e o Thor acrescenta chave de acesso, protocolo e QR Code.</small>`;
    const printerField = printerSelect.closest('.field');
    if (printerField?.parentNode) printerField.parentNode.insertBefore(field, printerField.nextSibling);

    const original = saveButton.onclick;
    saveButton.onclick = async function (event) {
      const columns = Number(document.getElementById('receiptColumns')?.value) === 65 ? 65 : 44;
      try { await window.thor.saveSettings({ receiptColumns: columns }); } catch {}
      if (typeof original === 'function') return original.call(this, event);
    };
  };

  const observer = new MutationObserver(() => { void enhance(); });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  void enhance();
})();
