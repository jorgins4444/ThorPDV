(function installProductCatalogScreenV110(){
  const PAGE_SIZE=10;
  let allRows=[];
  let filteredRows=[];
  let currentPage=0;
  let tableName='Tabela padrão vigente';
  let modal=null;

  const safe=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const currency=(value)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
  const quantity=(value)=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:3});

  function searchText(row){
    return [row.name,row.product_code,row.sku,row.ncm,...(Array.isArray(row.barcodes)?row.barcodes:[])].map((v)=>String(v||'').toLocaleLowerCase('pt-BR')).join(' ');
  }

  function applyFilter(value=''){
    const query=String(value||'').trim().toLocaleLowerCase('pt-BR');
    filteredRows=query?allRows.filter((row)=>searchText(row).includes(query)):allRows.slice();
    currentPage=0;
    renderTable();
  }

  function pageCount(){ return Math.max(1,Math.ceil(filteredRows.length/PAGE_SIZE)); }
  function pageRows(){
    const pages=pageCount();
    currentPage=Math.max(0,Math.min(currentPage,pages-1));
    return filteredRows.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  }

  function renderTable(){
    if(!modal)return;
    const body=modal.querySelector('#thor-product-catalog-body');
    const info=modal.querySelector('#thor-product-catalog-info');
    const pageLabel=modal.querySelector('#thor-product-catalog-page');
    const prev=modal.querySelector('#thor-product-catalog-prev');
    const next=modal.querySelector('#thor-product-catalog-next');
    if(!body)return;

    const rows=pageRows();
    body.innerHTML=rows.length?rows.map((row,index)=>{
      const globalIndex=currentPage*PAGE_SIZE+index;
      const code=row.product_code||row.sku||'—';
      return `<tr data-product-index="${globalIndex}" tabindex="0">
        <td class="thor-pc-name"><strong>${safe(row.name||'Produto')}</strong><small>${row.sku&&row.sku!==row.product_code?`Ref. ${safe(row.sku)}`:''}</small></td>
        <td>${safe(code)}</td>
        <td>${safe(row.ncm||'—')}</td>
        <td class="thor-pc-price">${currency(row.base_price)}</td>
        <td>${quantity(row.quantity)} ${safe(row.unit||'UN')}</td>
        <td><span class="thor-pc-table-name">${safe(tableName)}</span></td>
        <td><button type="button" class="thor-pc-select" data-select-index="${globalIndex}">Selecionar</button></td>
      </tr>`;
    }).join(''):`<tr><td colspan="7" class="thor-pc-empty">Nenhum produto encontrado.</td></tr>`;

    const from=filteredRows.length?currentPage*PAGE_SIZE+1:0;
    const to=Math.min((currentPage+1)*PAGE_SIZE,filteredRows.length);
    info.textContent=`${filteredRows.length} produto(s) • exibindo ${from}–${to}`;
    pageLabel.textContent=`Página ${currentPage+1} de ${pageCount()}`;
    prev.disabled=currentPage===0;
    next.disabled=currentPage+1>=pageCount();

    body.querySelectorAll('[data-select-index]').forEach((button)=>{
      button.onclick=(event)=>{
        event.stopPropagation();
        chooseProduct(Number(button.dataset.selectIndex));
      };
    });
    body.querySelectorAll('tr[data-product-index]').forEach((row)=>{
      row.ondblclick=()=>chooseProduct(Number(row.dataset.productIndex));
      row.onkeydown=(event)=>{if(event.key==='Enter'){event.preventDefault();chooseProduct(Number(row.dataset.productIndex));}};
    });
  }

  function closeCatalog(){
    if(!modal)return;
    modal.remove();
    modal=null;
    document.removeEventListener('keydown',onCatalogKeydown,true);
    setTimeout(()=>document.getElementById('search')?.focus(),0);
  }

  function chooseProduct(index){
    const row=filteredRows[index];
    if(!row)return;
    closeCatalog();
    try{
      if(typeof add==='function') add(row);
      else{
        const search=document.getElementById('search');
        if(search){search.value=String(row.product_code||row.sku||row.name||'');search.dispatchEvent(new Event('input',{bubbles:true}));search.focus();}
      }
    }catch(error){console.error('[ThorPDV catálogo] Falha ao selecionar produto',error);}
  }

  function onCatalogKeydown(event){
    if(event.key==='Escape'){event.preventDefault();closeCatalog();}
  }

  async function openCatalog(){
    if(modal)return;
    try{
      const [products,status]=await Promise.all([
        window.thor.allProducts(),
        window.thor.status().catch(()=>null),
      ]);
      allRows=Array.isArray(products)?products:[];
      filteredRows=allRows.slice();
      currentPage=0;
      tableName=String(status?.context?.price_table_name||status?.context?.priceTableName||'Tabela padrão vigente');
    }catch(error){
      console.error('[ThorPDV catálogo] Falha ao carregar produtos',error);
      allRows=[];filteredRows=[];currentPage=0;tableName='Tabela padrão vigente';
    }

    modal=document.createElement('div');
    modal.className='thor-product-catalog-backdrop';
    modal.innerHTML=`<section class="thor-product-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="thor-product-catalog-title">
      <header class="thor-product-catalog-header">
        <div><span class="thor-product-catalog-kicker">CONSULTA GERAL</span><h2 id="thor-product-catalog-title">Produtos</h2><p>Consulta local de produtos do caixa. Pesquise por nome, código, referência, EAN ou NCM.</p></div>
        <button type="button" class="thor-product-catalog-close" aria-label="Fechar">×</button>
      </header>
      <div class="thor-product-catalog-searchbar"><input id="thor-product-catalog-search" autocomplete="off" placeholder="Pesquisar produto..."><span>10 produtos por página</span></div>
      <div class="thor-product-catalog-scroll"><table class="thor-product-catalog-table"><thead><tr><th>Nome</th><th>Código</th><th>NCM</th><th>Preço</th><th>Estoque</th><th>Tabela de preço</th><th></th></tr></thead><tbody id="thor-product-catalog-body"></tbody></table></div>
      <footer class="thor-product-catalog-footer"><span id="thor-product-catalog-info"></span><div class="thor-product-catalog-pages"><button type="button" id="thor-product-catalog-prev">← Anterior</button><strong id="thor-product-catalog-page"></strong><button type="button" id="thor-product-catalog-next">Próxima →</button></div><span class="thor-product-catalog-offline">Disponível offline</span></footer>
    </section>`;
    document.body.appendChild(modal);
    modal.onclick=(event)=>{if(event.target===modal)closeCatalog();};
    modal.querySelector('.thor-product-catalog-close').onclick=closeCatalog;
    modal.querySelector('#thor-product-catalog-search').oninput=(event)=>applyFilter(event.target.value);
    modal.querySelector('#thor-product-catalog-prev').onclick=()=>{currentPage=Math.max(0,currentPage-1);renderTable();};
    modal.querySelector('#thor-product-catalog-next').onclick=()=>{currentPage=Math.min(pageCount()-1,currentPage+1);renderTable();};
    document.addEventListener('keydown',onCatalogKeydown,true);
    renderTable();
    setTimeout(()=>modal?.querySelector('#thor-product-catalog-search')?.focus(),0);
  }

  function attachCatalogButton(){
    const row=document.querySelector('.search-row');
    const search=document.getElementById('search');
    if(!row||!search||document.getElementById('thor-product-catalog-open'))return;
    const button=document.createElement('button');
    button.type='button';
    button.id='thor-product-catalog-open';
    button.className='secondary thor-product-catalog-open';
    button.innerHTML='<span>Consultar produtos</span>';
    button.title='Abrir consulta geral de produtos';
    button.onclick=openCatalog;
    const cash=document.getElementById('cash');
    row.insertBefore(button,cash||null);
  }

  if(typeof renderSaleWorkspace==='function'){
    const originalRenderSaleWorkspace=renderSaleWorkspace;
    renderSaleWorkspace=function renderSaleWorkspaceProductCatalogV110(...args){
      const result=originalRenderSaleWorkspace.apply(this,args);
      queueMicrotask(attachCatalogButton);
      return result;
    };
  }

  window.openThorProductCatalog=openCatalog;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(attachCatalogButton),{once:true});
  else queueMicrotask(attachCatalogButton);
})();
