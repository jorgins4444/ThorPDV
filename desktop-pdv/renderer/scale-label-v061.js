(function () {
  let sl61Settings = { scaleLabelEnabled: true, scaleLabelPrefix: '2' };

  function sl61Digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function sl61CheckDigit(base12) {
    const digits = sl61Digits(base12);
    if (digits.length !== 12) return '';
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
  }

  function sl61CompleteEan13(base12) {
    const digits = sl61Digits(base12);
    if (digits.length !== 12) return digits;
    return digits + sl61CheckDigit(digits);
  }

  async function sl61RefreshSettings() {
    const settings = await window.thor.v3Settings().catch(() => ({}));
    sl61Settings = { ...sl61Settings, ...settings };
    return sl61Settings;
  }

  function sl61BindScanner() {
    const search = document.getElementById('search');
    if (!search || search.dataset.scaleLabelV061 === '1') return;
    search.dataset.scaleLabelV061 = '1';

    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const base12 = sl61Digits(search.value);
      if (base12.length !== 12) return;
      if (sl61Settings.scaleLabelEnabled === false) return;

      const prefix = String(sl61Settings.scaleLabelPrefix || '2').replace(/\D/g, '').slice(0, 1) || '2';
      if (base12[0] !== prefix) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const completed = sl61CompleteEan13(base12);
      search.value = completed;

      queueMicrotask(() => {
        search.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      });
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(() => {
      sl61BindScanner();
      void sl61RefreshSettings();
    });
    return result;
  };

  void sl61RefreshSettings();
})();
