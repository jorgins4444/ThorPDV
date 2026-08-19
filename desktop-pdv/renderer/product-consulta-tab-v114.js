(() => {
  if (window.ThorProductConsultaTabV114) {
    window.ThorProductConsultaTabV114.attach();
    return;
  }

  const PAGE_SIZE = 10;
  let products = [];
  let filtered = [];
  let page = 1;
  let source = 'offline';
  let productViewOpen = false;

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyValue = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const stockValue = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function button() {
    return document.getElementById('navProductConsulta');
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

    tbody.innerHTML = current.length ? current.map(product => `
      <tr>
        <td><b>${escHtml(product.name || '—')}</b></td>
        <td>${escHtml(product.product_code || product.sku || '—')}</td>
        <td><b>${moneyValue(product.price)}</b></td>
        <td>${stockValue(product.stock)}</td>
        <td>${escHtml(product.ncm || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhum produto encontrado.</td></tr>';

    summary.textContent = total
      ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total} produtos`
      : '0 produtos';
    pageInfo.textContent = `Página ${page} de ${pageCount}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pageCount;
  }

  function applyFilter() {
    if (!productViewOpen) return;
    const query = String(document.getElementById('productConsultQuery')?.value || '').trim().toLowerCase();
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
    if (!productViewOpen) return;
    const status = document.getElementById('productConsultStatus');
    const body = document.getElementById('productConsultBody');
    if (status) status.textContent = 'Carregando produtos...';
    if (body) body.innerHTML = '<tr><td colspan="5" class="empty">Carregando catálogo...</td></tr>';

    try {
      const result = await window.thor.productCatalogReadV114();
      if (!productViewOpen) return;
      products = Array.isArray(result?.products) ? result.products : [];
      filtered = [...products];
      source = result?.source === 'online' ? 'online' : 'offline';
      page = 1;
      if (status) status.textContent = source === 'online'
        ? `${products.length} produto(s) • dados atuais do Thor Gestão`
        : `${products.length} produto(s) • dados locais do caixa`;
      renderRows();
    } catch (error) {
      if (!productViewOpen) return;
      if (status) status.textContent = 'Falha ao consultar produtos';
      if (body) body.innerHTML = `<tr><td colspan="5" class="empty">${escHtml(error?.message || 'Não foi possível carregar a consulta.')}</td></tr>`;
    }
  }

  function open() {
    if (!state?.status?.operator || !window.thor?.productCatalogReadV114) return;
    const workspace = document.getElementById('workspace');
    if (!workspace) return;

    // Mantém o estado em uma view nativa para não interferir no ciclo original do PDV.
    state.view = 'sale';
    productViewOpen = true;
    attach();
    markProductTab(true);

    workspace.innerHTML = `
      <main class="fiscal-workspace">
        <div class="fiscal-head">
          <div>
            <small>CONSULTA DE PRODUTOS</small>
            <h1>Consulta geral de produtos</h1>
            <p>Visualização somente para consulta. Nenhum estoque, preço ou venda é alterado nesta aba.</p>
          </div>
          <span class="fiscal-count" id="productConsultStatus">Carregando produtos...</span>
        </div>

        <div class="fiscal-toolbar">
          <input id="productConsultQuery" autocomplete="off" placeholder="Pesquisar por nome, código, EAN ou NCM...">
          <span class="fiscal-count">10 produtos por página</span>
        </div>

        <div class="fiscal-table-card">
          <table class="fiscal-table">
            <thead>
              <tr><th>Nome do produto</th><th>Código</th><th>Preço</th><th>Estoque</th><th>NCM</th></tr>
            </thead>
            <tbody id="productConsultBody">
              <tr><td colspan="5" class="empty">Carregando catálogo...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="fiscal-toolbar" style="margin-top:12px;margin-bottom:0">
          <span class="fiscal-count" id="productConsultSummary">Carregando...</span>
          <span style="margin-left:auto" class="fiscal-count" id="productConsultPageInfo">Página 1 de 1</span>
          <button type="button" class="secondary" id="productConsultPrev">Anterior</button>
          <button type="button" class="secondary" id="productConsultNext">Próxima</button>
        </div>
      </main>`;

    document.getElementById('productConsultQuery')?.addEventListener('input', applyFilter);
    document.getElementById('productConsultPrev')?.addEventListener('click', () => { page -= 1; renderRows(); });
    document.getElementById('productConsultNext')?.addEventListener('click', () => { page += 1; renderRows(); });
    document.getElementById('productConsultQuery')?.focus();
    void loadCatalog();
  }

  // Venda e Fiscal continuam usando exatamente o setView/render original.
  // Após o render nativo, apenas recolocamos o botão da consulta na mesma barra.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('#navSale,#navFiscal') : null;
    if (!target) return;
    productViewOpen = false;
    setTimeout(attach, 0);
  }, true);

  window.ThorProductConsultaTabV114 = { attach, open };
  attach();
})();
