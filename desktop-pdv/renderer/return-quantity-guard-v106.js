(function () {
  const previousReturnSaleModal = returnSaleModal;
  const number = (value) => Number(value || 0);
  const allowsFraction = (item) => Boolean(item?.is_weighable || item?.fractioned || item?.label_scale);

  returnSaleModal = function (sale) {
    const modalElement = previousReturnSaleModal(sale);
    const items = Array.isArray(sale?.items) ? sale.items : [];
    const errorElement = modalElement?.querySelector('#v105ReturnError');
    const confirmButton = modalElement?.querySelector('#confirmReturn');
    const inputs = [...(modalElement?.querySelectorAll('[data-return-qty]') || [])];

    const validateInput = (input) => {
      const index = Number(input.dataset.returnQty);
      const item = items[index] || {};
      const quantity = number(input.value);
      const remaining = Math.max(number(item.quantity) - number(item.returned_quantity), 0);
      const selected = modalElement?.querySelector(`[data-return-select="${index}"]`)?.checked;

      if (!selected) {
        input.setCustomValidity('');
        return true;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        input.setCustomValidity('Informe uma quantidade maior que zero.');
        return false;
      }
      if (quantity > remaining + 0.0001) {
        input.setCustomValidity(`Quantidade máxima disponível: ${remaining}.`);
        return false;
      }
      if (!allowsFraction(item) && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
        input.setCustomValidity('Produto unitário aceita somente quantidade inteira.');
        return false;
      }
      input.setCustomValidity('');
      return true;
    };

    inputs.forEach((input) => {
      const index = Number(input.dataset.returnQty);
      const item = items[index] || {};
      const fractional = allowsFraction(item);
      const remaining = Math.max(number(item.quantity) - number(item.returned_quantity), 0);

      input.step = fractional ? '0.001' : '1';
      input.min = fractional ? '0.001' : '1';
      input.max = String(fractional ? remaining : Math.max(Math.floor(remaining + 0.000001), 0));
      input.inputMode = fractional ? 'decimal' : 'numeric';
      input.title = fractional ? 'Produto fracionado: permite casas decimais.' : 'Produto unitário: informe somente quantidades inteiras.';
      input.addEventListener('input', () => validateInput(input));
    });

    if (confirmButton) {
      confirmButton.addEventListener('click', (event) => {
        const invalid = inputs.find((input) => !validateInput(input));
        if (!invalid) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (errorElement) errorElement.textContent = invalid.validationMessage || 'Revise a quantidade informada para devolução.';
        invalid.focus();
        invalid.reportValidity?.();
      }, true);
    }

    return modalElement;
  };
})();
