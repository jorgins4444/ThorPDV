(() => {
  if (window.ThorProductConsultaV113) {
    window.ThorProductConsultaV113.attach();
    return;
  }

  const PAGE_SIZE = 10;
  let overlay = null;
  let products = [];
  let filtered = [];
  let page = 1;
  let source = 'offline';

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const stock = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function ensureStyle() {
    if (document.getElementById('thorProductConsultaV113Style')) return;
    const style = document.createElement('style');
    style.id = 'thorProductConsultaV113Style';
    style.textContent = `
      .v113-consult-button{height:50px;white-space:nowrap;padding:0 16px}
      .v113-catalog-overlay{position:fixed;inset:0;z-index:4000;background:rgba(12,24,19,.62);display:flex;align-items:center;justify-content:center;padding:24px}
      .v113-catalog-card{width:min(1200px,97vw);max-height:92vh;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}
      .v113-catalog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:20px 22px 15px;border-bottom:1px solid #e5ece8}
      .v113-catalog-head small{display:block;color:#19834b;font-size:9px;font-weight:900;letter-spacing:.12em}.v113-catalog-head h2{margin:4px 0;color:#17372f;font-size:24px}.v113-catalog-head p{margin:0;color:#718078;font-size:12px}
      .v113-catalog-close{border:0;background:#eef4f1;color:#34473e;width:38px;height:38px;border-radius:10px;font-size:24px;cursor:pointer}
      .v113-catalog-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px 22px}.v113-catalog-tools input{height:44px;border:1px solid #cedbd4;border-radius:10px;padding:0 13px;font-size:14px}.v113-catalog-tools input:focus{outline:3px solid rgba(25,131,75,.1);border-color:#19834b}.v113-catalog-status{font-size:11px;color:#6f7d76;white-space:nowrap}
      .v113-catalog-wrap{overflow:auto;min-height:390px;border-top:1px solid #edf1ef;border-bottom:1px solid #edf1ef}.v113-catalog-table{width:100%;border-collapse:collapse;font-size:12px;min-width:930px}.v113-catalog-table th{position:sticky;top:0;background:#f5f8f6;color:#526159;text-align:left;padding:11px 12px;border-bottom:1px solid #dce5e0;white-space:nowrap}.v113-catalog-table td{padding:11px 12px;border-bottom:1px solid #edf1ef;vertical-align:middle}.v113-catalog-table tbody tr:hover{background:#f7fbf9}.v113-catalog-table td:first-child{min-width:260px}.v113-catalog-table td:first-child b{display:block;color:#1e3329;font-size:13px}.v113-catalog-table td:first-child small{display:block;margin-top:3px;color:#7b8881}.v113-catalog-price{font-weight:900;color:#17372f;white-space:nowrap}.v113-catalog-stock{font-weight:800}.v113-catalog-use{padding:7px 10px;white-space:nowrap}.v113-catalog-empty{text-align:center!important;padding:42px!important;color:#78857e}
      .v113-catalog-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 22px;color:#6f7d76;font-size:11px}.v113-catalog-pages{display:flex;align-items:center;gap:9px}.v113-catalog-pages b{color:#32443a}.v113-catalog-pages button{padding:7px 10px}.v113-catalog-pages button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:900px){.v113-catalog-overlay{padding:10px}.v113-catalog-card{width:100%;max-height:96vh}.v113-catalog-tools{grid-template-columns:1fr}.v113-catalog-status{white-space:normal}.v113-catalog-foot{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.getElementById('search')?.focus();
  }

  function selectProduct(product) {
    const search = document.getElementById('search');
    if (!search) return close();
    const identifier = String(product.product_code || product.sku || product.barcodes?.[0] || product.name || '');
    close();
    search.value = identifier;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
    search.select();
  }

  function renderRows() {
    if (!overlay) return;
    const tbody = overlay.querySelector('#v113CatalogBody');
    const footer = overlay.querySelector('#v113CatalogFooter');
    if (!tbody || !footer) return;

    const total = filtered.length;
    const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    page = Math.min(Math.max(page, 1), pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const current = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = current.length ? current.map((product, index) => `
      <tr data-row="${start + index}">
        <td><b>${escHtml(product.name || '—')}</b><small>Ref. ${escHtml(product.sku || '—')} • EAN ${escHtml(product.barcodes?.[0] || '—')}</small></td>
        <td>${escHtml(product.product_code || '—')}</td>
        <td>${escHtml(product.ncm || '—')}</td>
        <td class="v113-catalog-price">${money(product.price)}</td>
        <td class="v113-catalog-stock">${stock(product.stock)}</td>
        <td>${escHtml(product.price_table || '—')}</td>
        <td><button type="button" class="secondary v113-catalog-use" data-use="${start + index}">Selecionar</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="v113-catalog-empty">Nenhum produto encontrado.</td></tr>';

    footer.innerHTML = `
      <span>${total ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total}` : '0 produtos'} • ${source === 'online' ? 'consulta atual do servidor' : 'consulta local/offline'}</span>
      <div class="v113-catalog-pages"><button type="button" class="secondary" id="v113Prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button><b>Página ${page} de ${pageCount}</b><button type="button" class="secondary" id="v113Next" ${page >= pageCount ? 'disabled' : ''}>Próxima</button></div>`;

    tbody.querySelectorAll('[data-use]').forEach(button => {
      button.onclick = () => selectProduct(filtered[Number(button.dataset.use)]);
    });
    tbody.querySelectorAll('tr[data-row]').forEach(row => {
      row.ondblclick = () => selectProduct(filtered[Number(row.dataset.row)]);
    });
    footer.querySelector('#v113Prev')?.addEventListener('click', () => { page -= 1; renderRows(); });
    footer.querySelector('#v113Next')?.addEventListener('click', () => { page += 1; renderRows(); });
  }

  function applyFilter() {
    if (!overlay) return;
    const query = String(overlay.querySelector('#v113CatalogQuery')?.value || '').trim().toLowerCase();
    filtered = !query ? [...products] : products.filter(product => [
      product.name,
      product.product_code,
      product.sku,
      product.ncm,
      ...(Array.isArray(product.barcodes) ? product.barcodes : []),
    ].some(value => String(value || '').toLowerCase().includes(query)));
    page = 1;
    renderRows();
  }

  async function loadCatalog() {
    if (!overlay) return;
    const status = overlay.querySelector('#v113CatalogStatus');
    const body = overlay.querySelector('#v113CatalogBody');
    if (status) status.textContent = 'Carregando produtos...';
    if (body) body.innerHTML = '<tr><td colspan="7" class="v113-catalog-empty">Carregando catálogo...</td></tr>';
    try {
      const result = await window.thor.productCatalogRead();
      products = Array.isArray(result?.products) ? result.products : [];
      filtered = [...products];
      source = result?.source === 'online' ? 'online' : 'offline';
      page = 1;
      if (status) status.textContent = `${products.length} produto(s) • ${source === 'online' ? 'dados atuais' : 'dados disponíveis neste caixa'}`;
      renderRows();
    } catch (error) {
      if (status) status.textContent = 'Falha ao consultar produtos';
      if (body) body.innerHTML = `<tr><td colspan="7" class="v113-catalog-empty">${escHtml(error?.message || 'Não foi possível carregar a consulta.')}</td></tr>`;
    }
  }

  function open() {
    if (overlay || !window.thor?.productCatalogRead) return;
    ensureStyle();
    overlay = document.createElement('div');
    overlay.className = 'v113-catalog-overlay';
    overlay.innerHTML = `
      <section class="v113-catalog-card" role="dialog" aria-modal="true" aria-label="Consulta de produtos">
        <header class="v113-catalog-head"><div><small>CONSULTA DE PRODUTOS</small><h2>Catálogo geral</h2><p>Pesquisa independente. Nenhum estoque, preço, venda ou sincronização é alterado nesta tela.</p></div><button type="button" class="v113-catalog-close" id="v113CatalogClose" aria-label="Fechar">×</button></header>
        <div class="v113-catalog-tools"><input id="v113CatalogQuery" autocomplete="off" placeholder="Nome, código principal, referência, EAN ou NCM..."><span class="v113-catalog-status" id="v113CatalogStatus">Carregando produtos...</span></div>
        <div class="v113-catalog-wrap"><table class="v113-catalog-table"><thead><tr><th>Nome</th><th>Código</th><th>NCM</th><th>Preço</th><th>Estoque</th><th>Tabela de preço</th><th></th></tr></thead><tbody id="v113CatalogBody"><tr><td colspan="7" class="v113-catalog-empty">Carregando catálogo...</td></tr></tbody></table></div>
        <footer class="v113-catalog-foot" id="v113CatalogFooter"><span>Carregando...</span></footer>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#v113CatalogClose').onclick = close;
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
    overlay.querySelector('#v113CatalogQuery').addEventListener('input', applyFilter);
    overlay.querySelector('#v113CatalogQuery').focus();
    void loadCatalog();
  }

  function attach() {
    if (state?.view !== 'sale' || !state?.status?.operator) return;
    const search = document.getElementById('search');
    const row = search?.closest('.search-row');
    if (!row || row.querySelector('#v113ConsultProducts')) return;
    ensureStyle();
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'v113ConsultProducts';
    button.className = 'secondary v113-consult-button';
    button.textContent = 'Consultar produtos';
    button.onclick = open;
    const cash = row.querySelector('#cash');
    row.insertBefore(button, cash || null);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, true);

  window.ThorProductConsultaV113 = { attach, open };
  attach();
})();
