const ux39OriginalRefreshProducts = refreshProducts;
const ux39OriginalRenderProducts = renderProducts;
const ux39OriginalRenderSaleWorkspace = renderSaleWorkspace;
const ux39OriginalRenderWorkspace = renderWorkspace;

function ux39HasSaleQuery() {
  return Boolean(String(state.query || '').trim());
}

refreshProducts = async function (query = state.query) {
  const q = String(query ?? '');
  state.query = q;
  if (!q.trim()) {
    state.products = [];
    if (state.view === 'sale') renderProducts();
    return [];
  }
  return ux39OriginalRefreshProducts(q);
};

renderProducts = function () {
  const box = document.getElementById('products');
  if (!box) return;
  if (!ux39HasSaleQuery()) {
    box.classList.add('search-idle');
    box.innerHTML = `<div class="product-search-idle"><div class="icon">⌕</div><strong>Pesquise para localizar um produto</strong><small>Digite o nome, SKU ou leia o código de barras. O catálogo completo não fica mais exposto na tela de venda.<br>Para navegar por todos os itens, use <kbd>Todos os Produtos</kbd>.</small></div>`;
    return;
  }
  box.classList.remove('search-idle');
  ux39OriginalRenderProducts();
};

renderSaleWorkspace = function () {
  ux39OriginalRenderSaleWorkspace();
  const row = document.querySelector('.search-row');
  if (row && !document.getElementById('allProductsButton')) {
    const button = document.createElement('button');
    button.id = 'allProductsButton';
    button.className = 'all-products-button';
    button.type = 'button';
    button.textContent = 'Todos os Produtos';
    button.title = 'Abrir a listagem geral de produtos';
    const cash = row.querySelector('#cash');
    row.insertBefore(button, cash || null);
    button.onclick = ux39OpenProductList;
  }
  renderProducts();
};

renderWorkspace = function () {
  if (state.view === 'product_list') return ux39RenderProductListScreen();
  return ux39OriginalRenderWorkspace();
};

async function ux39OpenProductList() {
  state.view = 'product_list';
  render();
  await ux39LoadAllProducts();
}

async function ux39LoadAllProducts() {
  const count = document.getElementById('catalogListCount');
  const body = document.getElementById('catalogListBody');
  if (body) body.innerHTML = '<tr><td colspan="7" class="catalog-empty">Carregando catálogo local...</td></tr>';
  try {
    state.allProducts = await window.thor.allProducts();
    if (count) count.textContent = `${state.allProducts.length} produto(s)`;
    ux39RenderAllProducts('');
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="7" class="catalog-empty">Não foi possível carregar o catálogo: ${esc(friendlyError(error.message))}</td></tr>`;
  }
}

function ux39RenderProductListScreen() {
  const box = document.getElementById('workspace');
  if (!box) return;
  box.innerHTML = `<main class="catalog-screen">
    <header class="catalog-screen-head">
      <div><small>CATÁLOGO LOCAL DO CAIXA</small><h1>Todos os Produtos</h1><p>Consulte o catálogo completo sincronizado do Gestão e adicione itens à venda quando desejar.</p></div>
      <div class="actions"><button class="secondary" id="catalogSync">Sincronizar agora</button><button class="primary" id="catalogBack">Voltar à venda</button></div>
    </header>
    <div class="catalog-screen-toolbar"><input id="catalogFilter" placeholder="Filtrar por nome, SKU ou código de barras..." autocomplete="off"><span id="catalogListCount">Carregando...</span></div>
    <section class="catalog-list-card"><table class="catalog-list-table"><thead><tr><th>Código</th><th>Produto</th><th>Un.</th><th>EAN</th><th class="stock">Estoque</th><th class="price">Preço</th><th></th></tr></thead><tbody id="catalogListBody"><tr><td colspan="7" class="catalog-empty">Carregando catálogo local...</td></tr></tbody></table></section>
  </main>`;
  document.getElementById('catalogBack').onclick = () => setView('sale');
  document.getElementById('catalogSync').onclick = async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = 'Sincronizando...';
      await window.thor.sync();
      await refreshStatus();
      await ux39LoadAllProducts();
      showToast('Catálogo sincronizado com o Gestão.');
    } catch (error) {
      infoModal('Sincronização', friendlyError(error.message));
    } finally {
      button.disabled = false;
      button.textContent = 'Sincronizar agora';
    }
  };
  let timer;
  document.getElementById('catalogFilter').oninput = event => {
    clearTimeout(timer);
    timer = setTimeout(() => ux39RenderAllProducts(event.target.value), 80);
  };
  queueMicrotask(ux39LoadAllProducts);
}

function ux39RenderAllProducts(filter = '') {
  const body = document.getElementById('catalogListBody');
  const count = document.getElementById('catalogListCount');
  if (!body) return;
  const q = String(filter || '').trim().toLowerCase();
  const all = Array.isArray(state.allProducts) ? state.allProducts : [];
  const filtered = q ? all.filter(product => {
    const barcodes = Array.isArray(product.barcodes) ? product.barcodes.join(' ') : String(product.barcodes || '');
    return [product.name, product.sku, barcodes].some(value => String(value || '').toLowerCase().includes(q));
  }) : all;
  if (count) count.textContent = q ? `${filtered.length} de ${all.length} produto(s)` : `${all.length} produto(s)`;
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="7" class="catalog-empty">Nenhum produto encontrado.</td></tr>';
    return;
  }
  body.innerHTML = filtered.map((product, index) => {
    const barcode = Array.isArray(product.barcodes) ? product.barcodes[0] : '';
    return `<tr><td>${esc(product.sku || '—')}</td><td><strong>${esc(product.name)}</strong><small>${esc(product.production_mode === 'on_demand' ? 'Produção sob demanda' : 'Produto de estoque')}</small></td><td>${esc(product.unit || 'UN')}</td><td>${esc(barcode || '—')}</td><td class="stock">${Number(product.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td class="price">${money(product.base_price || product.sale_price || 0)}</td><td><button class="catalog-add" data-catalog-index="${index}">Adicionar</button></td></tr>`;
  }).join('');
  body.querySelectorAll('[data-catalog-index]').forEach(button => {
    button.onclick = async () => {
      const product = filtered[Number(button.dataset.catalogIndex)];
      if (!product) return;
      await add(product);
      showToast(`${product.name} adicionado à venda.`);
    };
  });
}

const ux39OriginalEnhanceFooter = typeof uxEnhanceFooter === 'function' ? uxEnhanceFooter : null;
if (ux39OriginalEnhanceFooter) {
  uxEnhanceFooter = function () {
    ux39OriginalEnhanceFooter();
    if (state.view !== 'product_list') return;
    const help = document.getElementById('hotkeyHelp');
    if (help) help.innerHTML = `${uxFooterKey('F3', 'Voltar à venda')}${uxFooterKey('F6', 'Sincronizar')}`;
  };
}

document.addEventListener('keydown', event => {
  if (state.view !== 'product_list') return;
  if (event.key === 'F3') {
    event.preventDefault();
    event.stopImmediatePropagation();
    setView('sale');
  }
}, true);
