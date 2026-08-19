(() => {
  if (window.ThorProductConsultaTabV114) {
    window.ThorProductConsultaTabV114.attach();
    return;
  }

  const PAGE_SIZE = 10;
  let workspace = null;
  let products = [];
  let filtered = [];
  let page = 1;
  let source = 'offline';

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const stock = value => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  function ensureStyle() {
    if (document.getElementById('thorProductConsultaTabV114Style')) return;
    const style = document.createElement('style');
    style.id = 'thorProductConsultaTabV114Style';
    style.textContent = `
      .v114-product-tab-button{height:50px;white-space:nowrap;padding:0 16px}
      .v114-product-workspace{position:fixed;inset:0;z-index:3900;background:#f4f6f5;color:#192920;display:flex;flex-direction:column;overflow:hidden}
      .v114-product-topbar{height:62px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 26px;background:#fff;border-bottom:1px solid #dfe7e2;box-shadow:0 2px 12px rgba(28,54,42,.05)}
      .v114-product-brand{display:flex;align-items:center;gap:11px;font-weight:900;color:#192920}.v114-product-brand i{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#5d2bd3;color:#fff;font-style:normal;font-size:19px}.v114-product-brand span{color:#5d2bd3}
      .v114-product-tabs{display:flex;align-items:center;gap:7px}.v114-product-tabs button{height:38px;border:1px solid transparent;border-radius:9px;padding:0 15px;background:transparent;color:#64736b;font:inherit;font-size:12px;font-weight:850;cursor:pointer}.v114-product-tabs button:hover{background:#f0f3f1}.v114-product-tabs button.active{background:#eaf6ef;border-color:#cfe7da;color:#20734f}
      .v114-product-shell{width:min(1320px,calc(100% - 48px));margin:0 auto;flex:1;min-height:0;padding:24px 0 28px;display:flex;flex-direction:column;gap:14px}
      .v114-product-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}.v114-product-head small{display:block;color:#238158;font-size:10px;font-weight:900;letter-spacing:.13em}.v114-product-head h1{margin:5px 0 4px;font-size:28px;color:#18342a}.v114-product-head p{margin:0;color:#718078;font-size:12px}.v114-product-status{font-size:11px;color:#67766e;text-align:right}
      .v114-product-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;background:#fff;border:1px solid #e0e7e3;border-radius:14px;padding:13px 15px}.v114-product-tools input{height:44px;border:1px solid #ccd8d1;border-radius:10px;padding:0 14px;font:inherit;font-size:13px;color:#26382f;outline:none}.v114-product-tools input:focus{border-color:#26855d;box-shadow:0 0 0 3px rgba(38,133,93,.1)}.v114-product-tools span{font-size:11px;color:#718078;white-space:nowrap}
      .v114-product-table-wrap{flex:1;min-height:0;overflow:auto;background:#fff;border:1px solid #dfe7e2;border-radius:14px}.v114-product-table{width:100%;border-collapse:collapse;min-width:860px;font-size:12px}.v114-product-table th{position:sticky;top:0;z-index:1;background:#f5f8f6;color:#56665e;text-align:left;padding:12px 15px;border-bottom:1px solid #dce5e0;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.v114-product-table td{padding:14px 15px;border-bottom:1px solid #edf1ef;vertical-align:middle}.v114-product-table tbody tr:hover{background:#f8fbf9}.v114-product-table td:first-child{min-width:320px}.v114-product-name{font-weight:850;color:#1c3429}.v114-product-code{font-weight:750;color:#44574e}.v114-product-price{font-weight:900;color:#17633f;white-space:nowrap}.v114-product-stock{font-weight:850;color:#33473d}.v114-product-ncm{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#53635b}.v114-product-empty{text-align:center!important;padding:48px!important;color:#7b8881}
      .v114-product-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fff;border:1px solid #e0e7e3;border-radius:14px;padding:12px 15px;color:#6d7b74;font-size:11px}.v114-product-pages{display:flex;align-items:center;gap:9px}.v114-product-pages b{color:#30443a}.v114-product-pages button{height:34px;padding:0 12px;border:1px solid #cfdad4;border-radius:8px;background:#fff;color:#41544a;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.v114-product-pages button:hover:not(:disabled){background:#f1f5f3}.v114-product-pages button:disabled{opacity:.4;cursor:not-allowed}
      @media(max-width:900px){.v114-product-topbar{padding:0 14px}.v114-product-shell{width:calc(100% - 20px);padding-top:14px}.v114-product-head{align-items:flex-start;flex-direction:column;gap:8px}.v114-product-status{text-align:left}.v114-product-tools{grid-template-columns:1fr}.v114-product-tools span{white-space:normal}.v114-product-footer{align-items:flex-start;flex-direction:column}.v114-product-tabs button{padding:0 10px}}
    `;
    document.head.appendChild(style);
  }

  function close() {
    if (!workspace) return;
    workspace.remove();
    workspace = null;
    document.getElementById('search')?.focus();
  }

  function renderRows() {
    if (!workspace) return;
    const tbody = workspace.querySelector('#v114ProductBody');
    const footer = workspace.querySelector('#v114ProductFooter');
    if (!tbody || !footer) return;

    const total = filtered.length;
    const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    page = Math.min(Math.max(page, 1), pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const current = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = current.length ? current.map(product => `
      <tr>
        <td class="v114-product-name">${escHtml(product.name || '—')}</td>
        <td class="v114-product-code">${escHtml(product.product_code || product.sku || '—')}</td>
        <td class="v114-product-price">${money(product.price)}</td>
        <td class="v114-product-stock">${stock(product.stock)}</td>
        <td class="v114-product-ncm">${escHtml(product.ncm || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="v114-product-empty">Nenhum produto encontrado.</td></tr>';

    footer.innerHTML = `
      <span>${total ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total} produtos` : '0 produtos'} • limite de ${PAGE_SIZE} por página</span>
      <div class="v114-product-pages">
        <button type="button" id="v114ProductPrev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
        <b>Página ${page} de ${pageCount}</b>
        <button type="button" id="v114ProductNext" ${page >= pageCount ? 'disabled' : ''}>Próxima</button>
      </div>`;

    footer.querySelector('#v114ProductPrev')?.addEventListener('click', () => { page -= 1; renderRows(); });
    footer.querySelector('#v114ProductNext')?.addEventListener('click', () => { page += 1; renderRows(); });
  }

  function applyFilter() {
    if (!workspace) return;
    const query = String(workspace.querySelector('#v114ProductQuery')?.value || '').trim().toLowerCase();
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
    if (!workspace) return;
    const status = workspace.querySelector('#v114ProductStatus');
    const info = workspace.querySelector('#v114ProductSource');
    const body = workspace.querySelector('#v114ProductBody');
    if (status) status.textContent = 'Carregando produtos...';
    if (body) body.innerHTML = '<tr><td colspan="5" class="v114-product-empty">Carregando catálogo...</td></tr>';

    try {
      const result = await window.thor.productCatalogReadV114();
      products = Array.isArray(result?.products) ? result.products : [];
      filtered = [...products];
      source = result?.source === 'online' ? 'online' : 'offline';
      page = 1;
      if (status) status.textContent = `${products.length} produto(s) disponível(is)`;
      if (info) info.textContent = source === 'online'
        ? 'Dados atuais do Thor Gestão'
        : 'Dados locais do caixa • NCM pode não estar disponível offline';
      renderRows();
    } catch (error) {
      if (status) status.textContent = 'Falha ao consultar produtos';
      if (info) info.textContent = 'Não foi possível carregar o catálogo';
      if (body) body.innerHTML = `<tr><td colspan="5" class="v114-product-empty">${escHtml(error?.message || 'Não foi possível carregar a consulta.')}</td></tr>`;
    }
  }

  function open() {
    if (workspace || !window.thor?.productCatalogReadV114) return;
    if (state?.view !== 'sale' || !state?.status?.operator) return;
    ensureStyle();

    workspace = document.createElement('section');
    workspace.className = 'v114-product-workspace';
    workspace.setAttribute('aria-label', 'Consulta de produtos');
    workspace.innerHTML = `
      <header class="v114-product-topbar">
        <div class="v114-product-brand"><i>ϟ</i><div>Thor<span>PDV</span></div></div>
        <nav class="v114-product-tabs" aria-label="Áreas do PDV">
          <button type="button" id="v114BackToSale">Venda</button>
          <button type="button" class="active" aria-current="page">Consulta de produtos</button>
        </nav>
      </header>
      <main class="v114-product-shell">
        <div class="v114-product-head">
          <div><small>CONSULTA DE PRODUTOS</small><h1>Todos os produtos</h1><p>Tela somente para consulta. Nenhum estoque, preço ou venda é alterado aqui.</p></div>
          <div class="v114-product-status"><b id="v114ProductStatus">Carregando produtos...</b><br><span id="v114ProductSource">Aguardando dados...</span></div>
        </div>
        <div class="v114-product-tools">
          <input id="v114ProductQuery" autocomplete="off" placeholder="Pesquisar por nome, código, EAN ou NCM...">
          <span>Exibindo no máximo ${PAGE_SIZE} produtos por página</span>
        </div>
        <div class="v114-product-table-wrap">
          <table class="v114-product-table">
            <thead><tr><th>Nome do produto</th><th>Código</th><th>Preço</th><th>Estoque</th><th>NCM</th></tr></thead>
            <tbody id="v114ProductBody"><tr><td colspan="5" class="v114-product-empty">Carregando catálogo...</td></tr></tbody>
          </table>
        </div>
        <footer class="v114-product-footer" id="v114ProductFooter"><span>Carregando...</span></footer>
      </main>`;

    document.body.appendChild(workspace);
    workspace.querySelector('#v114BackToSale').onclick = close;
    workspace.querySelector('#v114ProductQuery').addEventListener('input', applyFilter);
    workspace.querySelector('#v114ProductQuery').focus();
    void loadCatalog();
  }

  function attach() {
    if (state?.view !== 'sale' || !state?.status?.operator) return;
    const search = document.getElementById('search');
    const row = search?.closest('.search-row');
    if (!row || row.querySelector('#v114ProductTabButton')) return;

    ensureStyle();
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'v114ProductTabButton';
    button.className = 'secondary v114-product-tab-button';
    button.textContent = 'Consulta de produtos';
    button.onclick = open;
    const cash = row.querySelector('#cash');
    row.insertBefore(button, cash || null);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && workspace) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, true);

  window.ThorProductConsultaTabV114 = { attach, open, close };
  attach();
})();
