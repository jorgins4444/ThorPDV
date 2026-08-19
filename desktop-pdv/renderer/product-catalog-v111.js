(() => {
  const PAGE_SIZE = 10;
  let overlay = null;
  let rows = [];
  let filtered = [];
  let page = 1;
  let tableName = 'Preço padrão';

  const money = (value) => Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const quantity = (value) => Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

  const searchable = (product) => [
    product?.name,
    product?.product_code,
    product?.sku,
    product?.ncm,
    ...(Array.isArray(product?.barcodes) ? product.barcodes : []),
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  function closeCatalog() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onEscape, true);
    setTimeout(() => document.querySelector('#search')?.focus(), 0);
  }

  function onEscape(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCatalog();
    }
  }

  function selectProduct(product) {
    try {
      if (typeof window.add === 'function') {
        window.add(product);
        closeCatalog();
        return;
      }
    } catch {}

    const search = document.querySelector('#search');
    if (!search) {
      closeCatalog();
      return;
    }

    const barcode = Array.isArray(product?.barcodes) ? product.barcodes[0] : '';
    search.value = String(product?.product_code || product?.sku || barcode || product?.name || '');
    closeCatalog();
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
    }));
  }

  function renderRows() {
    if (!overlay) return;
    const tbody = overlay.querySelector('[data-catalog-body]');
    const info = overlay.querySelector('[data-catalog-info]');
    const prev = overlay.querySelector('[data-catalog-prev]');
    const next = overlay.querySelector('[data-catalog-next]');
    if (!tbody || !info || !prev || !next) return;

    tbody.textContent = '';
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);

    for (const product of visible) {
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.title = 'Duplo clique para selecionar o produto';

      const values = [
        String(product?.name || ''),
        String(product?.product_code || product?.sku || ''),
        String(product?.ncm || ''),
        money(product?.base_price ?? product?.sale_price),
        quantity(product?.quantity),
        tableName,
      ];

      values.forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = value || (index === 2 ? '—' : '');
        tr.appendChild(td);
      });

      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'catalog-v111-select';
      button.textContent = 'Selecionar';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectProduct(product);
      });
      action.appendChild(button);
      tr.appendChild(action);

      tr.addEventListener('dblclick', () => selectProduct(product));
      tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          selectProduct(product);
        }
      });
      tbody.appendChild(tr);
    }

    if (!visible.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'catalog-v111-empty';
      td.textContent = 'Nenhum produto encontrado.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    const first = filtered.length ? start + 1 : 0;
    const last = Math.min(start + PAGE_SIZE, filtered.length);
    info.textContent = `${first}–${last} de ${filtered.length} produtos`;
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
  }

  function applyFilter() {
    if (!overlay) return;
    const term = String(overlay.querySelector('[data-catalog-search]')?.value || '').trim().toLowerCase();
    filtered = term ? rows.filter((product) => searchable(product).includes(term)) : [...rows];
    page = 1;
    renderRows();
  }

  async function openCatalog() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'catalog-v111-overlay';
    overlay.innerHTML = `
      <section class="catalog-v111-modal" role="dialog" aria-modal="true" aria-label="Consulta geral de produtos">
        <header class="catalog-v111-header">
          <div>
            <span class="catalog-v111-eyebrow">CONSULTA GERAL</span>
            <h2>Produtos</h2>
            <p>Consulte nome, código, NCM, preço, estoque e tabela de preço sem sair da venda.</p>
          </div>
          <button type="button" class="catalog-v111-close" data-catalog-close aria-label="Fechar">×</button>
        </header>
        <div class="catalog-v111-toolbar">
          <input type="search" data-catalog-search placeholder="Pesquisar por nome, código, referência, EAN ou NCM" autocomplete="off">
          <span class="catalog-v111-source" data-catalog-source>Carregando catálogo…</span>
        </div>
        <div class="catalog-v111-table-wrap">
          <table class="catalog-v111-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>NCM</th>
                <th>Preço</th>
                <th>Estoque</th>
                <th>Tabela de preço</th>
                <th></th>
              </tr>
            </thead>
            <tbody data-catalog-body>
              <tr><td colspan="7" class="catalog-v111-empty">Carregando produtos…</td></tr>
            </tbody>
          </table>
        </div>
        <footer class="catalog-v111-footer">
          <span data-catalog-info>0 produtos</span>
          <div>
            <button type="button" data-catalog-prev>Anterior</button>
            <button type="button" data-catalog-next>Próxima</button>
          </div>
        </footer>
      </section>
    `;

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEscape, true);

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeCatalog();
    });
    overlay.querySelector('[data-catalog-close]')?.addEventListener('click', closeCatalog);
    overlay.querySelector('[data-catalog-search]')?.addEventListener('input', applyFilter);
    overlay.querySelector('[data-catalog-prev]')?.addEventListener('click', () => {
      page -= 1;
      renderRows();
    });
    overlay.querySelector('[data-catalog-next]')?.addEventListener('click', () => {
      page += 1;
      renderRows();
    });

    setTimeout(() => overlay?.querySelector('[data-catalog-search]')?.focus(), 0);

    try {
      const result = await window.thor.productCatalog();
      rows = Array.isArray(result?.products) ? result.products : [];
      filtered = [...rows];
      const context = result?.context || {};
      tableName = String(
        context.price_table_name ||
        (context.price_table_id ? 'Tabela ativa' : 'Preço padrão')
      );
      const source = overlay?.querySelector('[data-catalog-source]');
      if (source) {
        source.textContent = result?.source === 'server'
          ? 'Catálogo atualizado do servidor'
          : 'Catálogo local disponível offline';
      }
      renderRows();
    } catch (error) {
      const tbody = overlay?.querySelector('[data-catalog-body]');
      if (tbody) {
        tbody.textContent = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'catalog-v111-empty';
        td.textContent = `Não foi possível abrir a consulta: ${String(error?.message || error || 'erro')}`;
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
    }
  }

  function ensureTrigger() {
    if (document.getElementById('catalog-v111-trigger')) return;
    const search = document.querySelector('#search');
    if (!search) return;

    const row = search.closest('.search-row') || search.parentElement;
    if (!row) return;

    const button = document.createElement('button');
    button.id = 'catalog-v111-trigger';
    button.type = 'button';
    button.className = 'catalog-v111-trigger';
    button.textContent = 'Consultar produtos';
    button.title = 'Abrir consulta geral de produtos';
    button.addEventListener('click', openCatalog);

    if (search.nextSibling) row.insertBefore(button, search.nextSibling);
    else row.appendChild(button);
  }

  const observer = new MutationObserver(ensureTrigger);
  const start = () => {
    ensureTrigger();
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();