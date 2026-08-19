(() => {
  if (window.ThorProductConsultaTabV114) {
    window.ThorProductConsultaTabV114.attach();
    return;
  }

  const PAGE_SIZE = 10;
  const LOW_STOCK_LIMIT = 3;
  let products = [];
  let filtered = [];
  let page = 1;
  let source = 'offline';
  let productViewOpen = false;
  let sortMode = 'name_asc';

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyValue = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const stockValue = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function button() { return document.getElementById('navProductConsulta'); }

  function ensureStyle() {
    if (document.getElementById('productConsultV115Style')) return;
    const style = document.createElement('style');
    style.id = 'productConsultV115Style';
    style.textContent = `
      .product-consult-tools{display:grid;grid-template-columns:minmax(280px,1fr) 210px auto;gap:10px;align-items:center}
      .product-consult-tools select{height:44px;border:1px solid #d7e1dc;border-radius:10px;background:#fff;padding:0 10px;color:#31453c}
      .product-consult-table tbody tr{cursor:pointer}.product-consult-table tbody tr:hover{background:#f5faf7}
      .product-stock-pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-weight:800;font-size:11px;background:#edf7f1;color:#17663d;white-space:nowrap}
      .product-stock-pill.low{background:#fff6dc;color:#8a6500}.product-stock-pill.zero{background:#fdeaea;color:#a32828}
      .product-variation{font-size:11px;color:#66766e;white-space:nowrap}.product-ean{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
      .product-detail-overlay{position:fixed;inset:0;z-index:4800;background:rgba(9,21,16,.58);display:flex;align-items:center;justify-content:center;padding:24px}
      .product-detail-card{width:min(720px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.28)}
      .product-detail-head{display:flex;justify-content:space-between;gap:20px;padding:20px 22px 14px;border-bottom:1px solid #e6ece8}.product-detail-head h2{margin:4px 0 0}.product-detail-close{border:0;background:#eef4f1;width:38px;height:38px;border-radius:10px;font-size:24px;cursor:pointer}
      .product-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:18px 22px}.product-detail-field{border:1px solid #e4ebe7;border-radius:12px;padding:12px;min-height:66px}.product-detail-field small{display:block;color:#7b8982;margin-bottom:6px}.product-detail-field b{color:#21372d;word-break:break-word}.product-detail-field.wide{grid-column:span 3}
      .product-detail-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 22px 20px}
      @media(max-width:900px){.product-consult-tools{grid-template-columns:1fr}.product-detail-grid{grid-template-columns:1fr 1fr}.product-detail-field.wide{grid-column:span 2}}
    `;
    document.head.appendChild(style);
  }

  function markProductTab(active) {
    const consult = button();
    if (consult) consult.classList.toggle('active', Boolean(active));
    if (active) {
      document.getElementById('navSale')?.classList.remove('active');
      document.getElementById('navFiscal')?.classList.remove('active');
    }
  }

  function attach() {
    if (!state?.status?.operator) return;
    const top = document.querySelector('.top-right');
    if (!top) return;
    let consult = button();
    if (!consult) {
      consult = document.createElement('button');
      consult.type = 'button';
      consult.id = 'navProductConsulta';
      consult.className = 'nav-button';
      consult.textContent = 'Consulta de produtos';
      const fiscal = document.getElementById('navFiscal');
      if (fiscal) fiscal.insertAdjacentElement('afterend', consult);
      else top.insertBefore(consult, top.firstChild || null);
    }
    consult.onclick = open;
    if (productViewOpen) markProductTab(true);
  }

  function stockBadge(product) {
    const qty = Number(product.stock || 0);
    if (qty <= 0) return `<span class="product-stock-pill zero">Sem estoque</span>`;
    if (qty <= LOW_STOCK_LIMIT) return `<span class="product-stock-pill low">${stockValue(qty)} • baixo</span>`;
    return `<span class="product-stock-pill">${stockValue(qty)}</span>`;
  }

  function sortFiltered() {
    const list = [...filtered];
    const text = value => String(value || '').toLocaleLowerCase('pt-BR');
    list.sort((a, b) => {
      if (sortMode === 'code_asc') return text(a.product_code || a.sku).localeCompare(text(b.product_code || b.sku), 'pt-BR', { numeric: true });
      if (sortMode === 'price_asc') return Number(a.price || 0) - Number(b.price || 0);
      if (sortMode === 'price_desc') return Number(b.price || 0) - Number(a.price || 0);
      if (sortMode === 'stock_asc') return Number(a.stock || 0) - Number(b.stock || 0);
      if (sortMode === 'stock_desc') return Number(b.stock || 0) - Number(a.stock || 0);
      return text(a.name).localeCompare(text(b.name), 'pt-BR', { numeric: true });
    });
    filtered = list;
  }

  function renderRows() {
    if (!productViewOpen) return;
    const tbody = document.getElementById('productConsultBody');
    const summary = document.getElementById('productConsultSummary');
    const pageInfo = document.getElementById('productConsultPageInfo');
    const prev = document.getElementById('productConsultPrev');
    const next = document.getElementById('productConsultNext');
    if (!tbody || !summary || !pageInfo || !prev || !next) return;

    const total = filtered.length;
    const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    page = Math.min(Math.max(page, 1), pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const current = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = current.length ? current.map((product, index) => {
      const ean = Array.isArray(product.barcodes) ? product.barcodes[0] : '';
      const variation = product.variation || [product.color, product.size].filter(Boolean).join(' / ');
      return `
        <tr data-product-index="${start + index}" title="Clique para ver os detalhes">
          <td><b>${escHtml(product.name || '—')}</b>${variation ? `<div class="product-variation">${escHtml(variation)}</div>` : ''}</td>
          <td>${escHtml(product.product_code || product.sku || '—')}</td>
          <td><b>${moneyValue(product.price)}</b></td>
          <td>${escHtml(product.ncm || '—')}</td>
          <td>${stockBadge(product)}</td>
          <td>${escHtml(product.brand || '—')}</td>
          <td class="product-ean">${escHtml(ean || '—')}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Nenhum produto encontrado.</td></tr>';

    tbody.querySelectorAll('[data-product-index]').forEach(row => {
      row.addEventListener('click', () => showDetails(filtered[Number(row.dataset.productIndex)]));
    });
    summary.textContent = total ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total} produtos` : '0 produtos';
    pageInfo.textContent = `Página ${page} de ${pageCount}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pageCount;
  }

  function applyFilter() {
    if (!productViewOpen) return;
    const query = String(document.getElementById('productConsultQuery')?.value || '').trim().toLowerCase();
    filtered = !query ? [...products] : products.filter(product => [
      product.name, product.product_code, product.sku, product.ncm, product.brand,
      product.color, product.size, product.variation, product.unit,
      ...(Array.isArray(product.barcodes) ? product.barcodes : []),
    ].some(value => String(value || '').toLowerCase().includes(query)));
    sortFiltered();
    page = 1;
    renderRows();
  }

  function closeDetails() {
    document.getElementById('productDetailOverlay')?.remove();
  }

  function sendToSale(product) {
    closeDetails();
    const identifier = String(product.product_code || product.sku || product.barcodes?.[0] || product.name || '').trim();
    const saleButton = document.getElementById('navSale');
    productViewOpen = false;
    if (saleButton) saleButton.click();
    setTimeout(() => {
      const search = document.getElementById('search');
      if (!search) return;
      search.value = identifier;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.focus();
      search.select();
    }, 80);
  }

  function showDetails(product) {
    if (!product) return;
    closeDetails();
    const eans = Array.isArray(product.barcodes) && product.barcodes.length ? product.barcodes.join(', ') : '—';
    const variation = product.variation || [product.color && `Cor: ${product.color}`, product.size && `Tamanho: ${product.size}`].filter(Boolean).join(' • ') || '—';
    const overlay = document.createElement('div');
    overlay.id = 'productDetailOverlay';
    overlay.className = 'product-detail-overlay';
    overlay.innerHTML = `
      <section class="product-detail-card" role="dialog" aria-modal="true" aria-label="Detalhes do produto">
        <header class="product-detail-head"><div><small>DETALHES DO PRODUTO</small><h2>${escHtml(product.name || 'Produto')}</h2></div><button type="button" class="product-detail-close" aria-label="Fechar">×</button></header>
        <div class="product-detail-grid">
          <div class="product-detail-field"><small>Código</small><b>${escHtml(product.product_code || product.sku || '—')}</b></div>
          <div class="product-detail-field"><small>Preço</small><b>${moneyValue(product.price)}</b></div>
          <div class="product-detail-field"><small>Estoque</small><b>${stockValue(product.stock)} ${escHtml(product.unit || '')}</b></div>
          <div class="product-detail-field"><small>NCM</small><b>${escHtml(product.ncm || '—')}</b></div>
          <div class="product-detail-field"><small>Marca</small><b>${escHtml(product.brand || '—')}</b></div>
          <div class="product-detail-field"><small>Unidade</small><b>${escHtml(product.unit || 'UN')}</b></div>
          <div class="product-detail-field"><small>Cor</small><b>${escHtml(product.color || '—')}</b></div>
          <div class="product-detail-field"><small>Tamanho</small><b>${escHtml(product.size || '—')}</b></div>
          <div class="product-detail-field"><small>Origem da consulta</small><b>${source === 'online' ? 'Servidor / atual' : 'Caixa / offline'}</b></div>
          <div class="product-detail-field wide"><small>Variação</small><b>${escHtml(variation)}</b></div>
          <div class="product-detail-field wide"><small>EAN / Código de barras</small><b class="product-ean">${escHtml(eans)}</b></div>
        </div>
        <div class="product-detail-actions"><button type="button" class="secondary" id="productDetailClose">Fechar</button><button type="button" id="productDetailUse">Levar para venda</button></div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.product-detail-close').onclick = closeDetails;
    overlay.querySelector('#productDetailClose').onclick = closeDetails;
    overlay.querySelector('#productDetailUse').onclick = () => sendToSale(product);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) closeDetails(); });
  }

  async function loadCatalog() {
    if (!productViewOpen) return;
    const status = document.getElementById('productConsultStatus');
    const body = document.getElementById('productConsultBody');
    if (status) status.textContent = 'Carregando produtos...';
    if (body) body.innerHTML = '<tr><td colspan="7" class="empty">Carregando catálogo...</td></tr>';
    try {
      const result = await window.thor.productCatalogReadV114();
      if (!productViewOpen) return;
      products = Array.isArray(result?.products) ? result.products : [];
      filtered = [...products];
      source = result?.source === 'online' ? 'online' : 'offline';
      sortFiltered();
      page = 1;
      if (status) status.textContent = source === 'online'
        ? `${products.length} produto(s) • dados atuais do Thor Gestão`
        : `${products.length} produto(s) • dados locais do caixa`;
      renderRows();
    } catch (error) {
      if (!productViewOpen) return;
      if (status) status.textContent = 'Falha ao consultar produtos';
      if (body) body.innerHTML = `<tr><td colspan="7" class="empty">${escHtml(error?.message || 'Não foi possível carregar a consulta.')}</td></tr>`;
    }
  }

  function open() {
    if (!state?.status?.operator || !window.thor?.productCatalogReadV114) return;
    const workspace = document.getElementById('workspace');
    if (!workspace) return;
    ensureStyle();
    state.view = 'sale';
    productViewOpen = true;
    attach();
    markProductTab(true);

    workspace.innerHTML = `
      <main class="fiscal-workspace">
        <div class="fiscal-head">
          <div><small>CONSULTA DE PRODUTOS</small><h1>Consulta geral de produtos</h1><p>Consulta completa do catálogo sem alterar estoque, preço ou venda.</p></div>
          <span class="fiscal-count" id="productConsultStatus">Carregando produtos...</span>
        </div>
        <div class="fiscal-toolbar product-consult-tools">
          <input id="productConsultQuery" autocomplete="off" placeholder="Pesquisar por nome, código, EAN, NCM, marca, cor ou tamanho...">
          <select id="productConsultSort" aria-label="Ordenar produtos">
            <option value="name_asc">Nome (A–Z)</option><option value="code_asc">Código</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="stock_asc">Menor estoque</option><option value="stock_desc">Maior estoque</option>
          </select>
          <span class="fiscal-count">10 produtos por página</span>
        </div>
        <div class="fiscal-table-card">
          <table class="fiscal-table product-consult-table">
            <thead><tr><th>Nome</th><th>Código</th><th>Preço</th><th>NCM</th><th>Estoque</th><th>Marca</th><th>EAN</th></tr></thead>
            <tbody id="productConsultBody"><tr><td colspan="7" class="empty">Carregando catálogo...</td></tr></tbody>
          </table>
        </div>
        <div class="fiscal-toolbar" style="margin-top:12px;margin-bottom:0">
          <span class="fiscal-count" id="productConsultSummary">Carregando...</span>
          <span style="margin-left:auto" class="fiscal-count" id="productConsultPageInfo">Página 1 de 1</span>
          <button type="button" class="secondary" id="productConsultPrev">Anterior</button><button type="button" class="secondary" id="productConsultNext">Próxima</button>
        </div>
      </main>`;

    document.getElementById('productConsultQuery')?.addEventListener('input', applyFilter);
    document.getElementById('productConsultSort')?.addEventListener('change', event => { sortMode = event.target.value; sortFiltered(); page = 1; renderRows(); });
    document.getElementById('productConsultPrev')?.addEventListener('click', () => { page -= 1; renderRows(); });
    document.getElementById('productConsultNext')?.addEventListener('click', () => { page += 1; renderRows(); });
    document.getElementById('productConsultQuery')?.focus();
    void loadCatalog();
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('#navSale,#navFiscal') : null;
    if (!target) return;
    closeDetails();
    productViewOpen = false;
    setTimeout(attach, 0);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('productDetailOverlay')) closeDetails();
  }, true);

  window.ThorProductConsultaTabV114 = { attach, open };
  attach();
})();
