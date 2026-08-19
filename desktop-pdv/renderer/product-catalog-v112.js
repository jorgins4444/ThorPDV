(() => {
  const PAGE_SIZE = 10;
  let overlay = null;
  let allProducts = [];
  let filteredProducts = [];
  let page = 1;
  let source = 'offline';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const stock = (value) => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.getElementById('search')?.focus();
  }

  function filter() {
    if (!overlay) return;
    const query = String(overlay.querySelector('#thorCatalogQuery')?.value || '').trim().toLowerCase();
    filteredProducts = !query ? [...allProducts] : allProducts.filter((product) => [
      product.name,
      product.product_code,
      product.sku,
      product.ncm,
      ...(Array.isArray(product.barcodes) ? product.barcodes : []),
    ].some((value) => String(value || '').toLowerCase().includes(query)));
    page = 1;
    renderTable();
  }

  function useProduct(product) {
    const search = document.getElementById('search');
    if (!search) return close();
    const identifier = String(product.product_code || product.sku || product.barcodes?.[0] || product.name || '');
    close();
    search.value = identifier;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
    search.select();
  }

  function renderTable() {
    if (!overlay) return;
    const tbody = overlay.querySelector('#thorCatalogBody');
    const footer = overlay.querySelector('#thorCatalogFooter');
    if (!tbody || !footer) return;

    const total = filteredProducts.length;
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    page = Math.min(Math.max(page, 1), pages);
    const start = (page - 1) * PAGE_SIZE;
    const rows = filteredProducts.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = rows.length ? rows.map((product, index) => `
      <tr data-index="${start + index}">
        <td><b>${escapeHtml(product.name || '—')}</b><small>Ref. ${escapeHtml(product.sku || '—')} • EAN ${escapeHtml(product.barcodes?.[0] || '—')}</small></td>
        <td>${escapeHtml(product.product_code || product.sku || '—')}</td>
        <td>${escapeHtml(product.ncm || '—')}</td>
        <td class="catalog-money">${money(product.price)}</td>
        <td>${stock(product.stock)}</td>
        <td>${escapeHtml(product.price_table || '—')}</td>
        <td><button class="secondary catalog-use" data-use="${start + index}">Usar</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="catalog-empty">Nenhum produto encontrado.</td></tr>';

    footer.innerHTML = `
      <span>${total ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total}` : '0 produtos'} • ${source === 'online' ? 'Consulta online' : 'Catálogo local/offline'}</span>
      <div><button class="secondary" id="thorCatalogPrev" ${page <= 1 ? 'disabled' : ''}>Anterior</button><b>Página ${page} de ${pages}</b><button class="secondary" id="thorCatalogNext" ${page >= pages ? 'disabled' : ''}>Próxima</button></div>`;

    tbody.querySelectorAll('[data-use]').forEach((button) => {
      button.onclick = () => useProduct(filteredProducts[Number(button.dataset.use)]);
    });
    tbody.querySelectorAll('tr[data-index]').forEach((row) => {
      row.ondblclick = () => useProduct(filteredProducts[Number(row.dataset.index)]);
    });
    footer.querySelector('#thorCatalogPrev')?.addEventListener('click', () => { page -= 1; renderTable(); });
    footer.querySelector('#thorCatalogNext')?.addEventListener('click', () => { page += 1; renderTable(); });
  }

  async function open() {
    if (overlay || !window.thor?.productCatalog) return;
    overlay = document.createElement('div');
    overlay.className = 'product-catalog-overlay';
    overlay.innerHTML = `
      <section class="product-catalog-card" role="dialog" aria-modal="true" aria-label="Consulta geral de produtos">
        <header><div><small>CONSULTA GERAL</small><h2>Produtos</h2><p>Consulte sem alterar a venda, o estoque ou a sincronização do caixa.</p></div><button class="catalog-close" id="thorCatalogClose" aria-label="Fechar">×</button></header>
        <div class="product-catalog-search"><input id="thorCatalogQuery" autocomplete="off" placeholder="Pesquisar por nome, código, referência, EAN ou NCM..."><span id="thorCatalogStatus">Carregando catálogo...</span></div>
        <div class="product-catalog-table-wrap"><table class="product-catalog-table"><thead><tr><th>Nome</th><th>Código</th><th>NCM</th><th>Preço</th><th>Estoque</th><th>Tabela de preço</th><th></th></tr></thead><tbody id="thorCatalogBody"><tr><td colspan="7" class="catalog-empty">Carregando...</td></tr></tbody></table></div>
        <footer id="thorCatalogFooter"><span>Carregando...</span></footer>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#thorCatalogClose').onclick = close;
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('#thorCatalogQuery').addEventListener('input', filter);
    overlay.querySelector('#thorCatalogQuery').focus();

    try {
      const result = await window.thor.productCatalog();
      allProducts = Array.isArray(result?.products) ? result.products : [];
      filteredProducts = [...allProducts];
      source = result?.source === 'online' ? 'online' : 'offline';
      const status = overlay?.querySelector('#thorCatalogStatus');
      if (status) status.textContent = `${allProducts.length} produto(s) • ${source === 'online' ? 'dados atuais do servidor' : 'dados disponíveis neste caixa'}`;
      renderTable();
    } catch (error) {
      const status = overlay?.querySelector('#thorCatalogStatus');
      if (status) status.textContent = `Não foi possível carregar: ${String(error?.message || error)}`;
      const body = overlay?.querySelector('#thorCatalogBody');
      if (body) body.innerHTML = '<tr><td colspan="7" class="catalog-empty">Falha ao carregar a consulta.</td></tr>';
    }
  }

  function injectButton() {
    const search = document.getElementById('search');
    if (!search) return;
    const row = search.closest('.search-row');
    if (!row || row.querySelector('#consultProducts')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'consultProducts';
    button.className = 'secondary product-catalog-open';
    button.textContent = 'Consultar produtos';
    button.onclick = open;
    const cash = row.querySelector('#cash');
    row.insertBefore(button, cash || null);
  }

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay) close(); });
  const observer = new MutationObserver(injectButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton); else injectButton();
})();
