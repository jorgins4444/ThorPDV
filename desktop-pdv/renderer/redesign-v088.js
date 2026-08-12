(function(){
  const VERSION='v088';
  let scheduled=false;

  function later(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      try{enhanceAll();}catch(error){console.warn('v088_enhance_failed',error);}
    });
  }

  function text(value,fallback='—'){
    const raw=String(value??'').trim();
    return raw||fallback;
  }

  function productImage(product){
    return product?.image_url||product?.imageUrl||product?.thumbnail_url||product?.thumbnailUrl||product?.photo_url||product?.photoUrl||product?.image||product?.photo||'';
  }

  function compactQuantity(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return '0';
    return n.toLocaleString('pt-BR',{maximumFractionDigits:3});
  }

  function currentOperator(){
    try{return v3State().operator||state.status?.operator||null;}catch{return state.status?.operator||null;}
  }

  function ensureSidebar(){
    const shell=document.querySelector('.shell');
    const workspace=document.getElementById('workspace');
    if(!shell||!workspace)return;
    shell.classList.add('v088-shell');
    document.body.classList.add('thor-v088');

    let sidebar=shell.querySelector('.v088-sidebar');
    if(!sidebar){
      sidebar=document.createElement('aside');
      sidebar.className='v088-sidebar';
      sidebar.innerHTML=`
        <div class="v088-brand">Thor<span>PDV</span></div>
        <nav class="v088-nav">
          <button data-v088-action="sale"><i>▣</i><span>Venda</span></button>
          <button data-v088-action="products"><i>◆</i><span>Produtos</span></button>
          <button data-v088-action="customer"><i>◉</i><span>Cliente</span></button>
          <button data-v088-action="cash"><i>▤</i><span>Caixa</span></button>
          <button data-v088-action="fiscal"><i>▥</i><span>Fiscal</span></button>
          <button data-v088-action="settings"><i>⚙</i><span>Configurações</span></button>
        </nav>
        <div class="v088-nav-bottom">
          <button data-v088-action="sync"><i>↻</i><span>Sincronizar</span></button>
          <button data-v088-action="operator"><i>●</i><span>Operador</span></button>
        </div>`;
      shell.insertBefore(sidebar,workspace);

      sidebar.querySelector('[data-v088-action="sale"]').onclick=()=>setView('sale');
      sidebar.querySelector('[data-v088-action="products"]').onclick=()=>{
        if(state.view!=='sale')setView('sale');
        setTimeout(()=>{document.getElementById('search')?.focus();document.querySelector('.v088-catalog-head')?.scrollIntoView({block:'nearest'});},30);
      };
      sidebar.querySelector('[data-v088-action="customer"]').onclick=()=>{
        if(state.view!=='sale')setView('sale');
        setTimeout(()=>document.getElementById('v47ConsumerAction')?.click(),40);
      };
      sidebar.querySelector('[data-v088-action="cash"]').onclick=()=>openCashModal();
      sidebar.querySelector('[data-v088-action="fiscal"]').onclick=()=>setView('fiscal');
      sidebar.querySelector('[data-v088-action="settings"]').onclick=()=>settingsModal();
      sidebar.querySelector('[data-v088-action="sync"]').onclick=async()=>{
        try{
          await window.thor.sync();
          await refreshStatus();
          await refreshProducts();
          await refreshFiscalSales();
          showToast('Sincronização concluída.');
        }catch(error){infoModal('Sincronização',friendlyError(error?.message||String(error)));}
      };
      sidebar.querySelector('[data-v088-action="operator"]').onclick=()=>document.getElementById('operatorBtn')?.click();
    }

    sidebar.querySelectorAll('[data-v088-action]').forEach(button=>button.classList.remove('active'));
    sidebar.querySelector(`[data-v088-action="${state.view==='fiscal'?'fiscal':'sale'}"]`)?.classList.add('active');
    const operator=currentOperator();
    const opLabel=sidebar.querySelector('[data-v088-action="operator"] span');
    if(opLabel)opLabel.textContent=operator?.name||'Operador';

    const topbar=shell.querySelector('.topbar');
    if(topbar){
      topbar.classList.add('v088-topbar');
      const topLeft=topbar.querySelector('.top-left');
      if(topLeft&&!topLeft.querySelector('.v088-terminal-copy')){
        const copy=document.createElement('div');
        copy.className='v088-terminal-copy';
        copy.innerHTML='<small>TERMINAL</small><b id="v088TerminalTitle"></b>';
        topLeft.appendChild(copy);
      }
      const terminal=document.getElementById('v088TerminalTitle');
      if(terminal)terminal.textContent=text(state.status?.context?.pos_name||state.status?.context?.pos_code,'PDV');
      const originalLogo=topbar.querySelector('.logo');if(originalLogo)originalLogo.classList.add('v088-original-logo');
      const navSale=document.getElementById('navSale');if(navSale)navSale.classList.add('v088-original-nav');
      const navFiscal=document.getElementById('navFiscal');if(navFiscal)navFiscal.classList.add('v088-original-nav');
      const settings=document.getElementById('settings');if(settings)settings.classList.add('v088-original-settings');
      const sync=document.getElementById('sync');if(sync)sync.classList.add('v088-top-sync');
      const operatorBtn=document.getElementById('operatorBtn');if(operatorBtn)operatorBtn.classList.add('v088-operator-chip');
      const drawerBtn=document.getElementById('drawerBtn');if(drawerBtn)drawerBtn.classList.add('v088-drawer-btn');
    }
  }

  function ensureSaleTabs(){
    if(state.view!=='sale')return;
    const main=document.querySelector('.v47-main');
    if(!main)return;
    main.classList.add('v088-sale-main');
    let tabs=main.querySelector('.v088-sale-tabs');
    if(!tabs){
      tabs=document.createElement('nav');
      tabs.className='v088-sale-tabs';
      tabs.innerHTML=`<button class="active" data-v088-tab="sale">Venda</button><button data-v088-tab="products">Produtos</button><button data-v088-tab="customer">Cliente</button><button data-v088-tab="payment">Pagamento</button>`;
      main.insertBefore(tabs,main.firstChild);
      tabs.querySelector('[data-v088-tab="sale"]').onclick=()=>document.getElementById('search')?.focus();
      tabs.querySelector('[data-v088-tab="products"]').onclick=()=>document.getElementById('search')?.focus();
      tabs.querySelector('[data-v088-tab="customer"]').onclick=()=>document.getElementById('v47ConsumerAction')?.click();
      tabs.querySelector('[data-v088-tab="payment"]').onclick=()=>document.getElementById('paymentsButton')?.click();
    }

    const searchZone=main.querySelector('.v47-search-zone');
    const products=document.getElementById('products');
    if(searchZone&&products&&!searchZone.querySelector('.v088-catalog-head')){
      const head=document.createElement('div');
      head.className='v088-catalog-head';
      head.innerHTML='<div><small>CATÁLOGO</small><h2>Produtos</h2></div><span id="v088CatalogCount"></span>';
      searchZone.insertBefore(head,products);
    }

    const search=document.getElementById('search');
    if(search){
      search.placeholder='Buscar produto por código, nome, referência ou EAN...';
      search.classList.add('v088-search');
    }
    document.getElementById('scaleRead')?.classList.add('v088-utility-button');
    document.getElementById('cash')?.classList.add('v088-utility-button');
    document.querySelector('.v47-items-card')?.classList.add('v088-items-card');
    document.querySelector('.v47-summary')?.classList.add('v088-summary');
    ensureQuickActions();
    paintCatalog();
  }

  function ensureQuickActions(){
    const summary=document.querySelector('.v47-summary');
    if(!summary)return;
    if(!summary.querySelector('.v088-quick-actions')){
      const bar=document.createElement('div');
      bar.className='v088-quick-actions';
      bar.innerHTML=`
        <button data-v088-quick="settings"><i>⚙</i><span>Config. rápida</span></button>
        <button data-v088-quick="discount"><i>%</i><span>Desconto</span></button>
        <button data-v088-quick="surcharge"><i>＋</i><span>Acréscimo</span></button>
        <button data-v088-quick="cashback"><i>↻</i><span>Cashback</span></button>`;
      const financial=summary.querySelector('.v47-financial-card');
      summary.insertBefore(bar,financial||summary.firstChild);
      bar.querySelector('[data-v088-quick="settings"]').onclick=()=>settingsModal();
      bar.querySelector('[data-v088-quick="discount"]').onclick=()=>document.getElementById('v47AdjustmentAction')?.click();
      bar.querySelector('[data-v088-quick="surcharge"]').onclick=()=>document.getElementById('v47AdjustmentAction')?.click();
      bar.querySelector('[data-v088-quick="cashback"]').onclick=()=>{
        let available=false;
        try{available=(v3State().salesOptions?.payment_methods||[]).some(row=>row?.active!==false&&row?.code==='cashback');}catch{}
        if(available&&typeof v3PaymentModal==='function')return v3PaymentModal('cashback');
        infoModal('Cashback','A forma Cashback não está habilitada nas Opções de Vendas deste caixa.');
      };
    }
    const legacy=summary.querySelector('.v47-sale-actions');if(legacy)legacy.classList.add('v088-legacy-actions');
    const paymentMethods=summary.querySelector('.payment-methods');if(paymentMethods)paymentMethods.classList.add('v088-payment-methods');
    const paymentButton=document.getElementById('paymentsButton');if(paymentButton){paymentButton.classList.add('v088-payment-open');paymentButton.innerHTML='Escolher formas de pagamento <kbd>F5</kbd>';}
    const finalize=document.getElementById('finalize');if(finalize){finalize.classList.add('v088-finalize');finalize.innerHTML=`Concluir venda <span>${typeof v3Total==='function'?money(v3Total()):''}</span><kbd>F2</kbd>`;}
  }

  function paintCatalog(){
    if(state.view!=='sale')return;
    const box=document.getElementById('products');
    if(!box)return;
    const rows=Array.isArray(state.products)?state.products:[];
    const signature=`${state.query||''}|${rows.slice(0,80).map(p=>`${p.id}:${p.base_price??p.sale_price??0}:${p.quantity??0}`).join(',')}`;
    if(box.dataset.v088Signature===signature&&box.querySelector('.v088-product-card,.v088-product-empty'))return;
    box.dataset.v088Signature=signature;
    box.classList.remove('v47-results-hidden');
    box.classList.add('v088-product-grid');
    const count=document.getElementById('v088CatalogCount');
    if(count)count.textContent=rows.length?`${rows.length} produto(s)`:'Pesquisa rápida';
    if(!rows.length){
      box.innerHTML='<div class="v088-product-empty"><i>⌕</i><b>Encontre o produto rapidamente</b><span>Leia o código de barras ou pesquise por nome, referência ou EAN.</span></div>';
      return;
    }
    box.innerHTML=rows.slice(0,80).map((product,index)=>{
      const image=productImage(product);
      const price=Number(product.base_price??product.sale_price??0);
      const stock=Number(product.quantity??0);
      const code=text(product.product_code||product.sku,'—');
      return `<button class="v088-product-card" data-v088-product="${index}" type="button">
        <div class="v088-product-media ${image?'':'no-image'}">${image?`<img src="${esc(image)}" alt="" loading="lazy">`:'<span>◆</span>'}<em>${stock>0?`${compactQuantity(stock)} un`:'Sem saldo'}</em></div>
        <div class="v088-product-copy"><strong>${esc(product.name||'Produto')}</strong><small>Cód. ${esc(code)}</small><b>${money(price)}</b><span>Estoque: ${compactQuantity(stock)}</span></div>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-v088-product]').forEach(button=>button.onclick=()=>{
      const product=rows[Number(button.dataset.v088Product)];
      if(product)add(product);
    });
    box.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.parentElement?.classList.add('no-image');img.remove();});
  }

  function gateConfigData(){
    const settings=state.settings||state.status?.settings||{};
    const context=state.status?.context||{};
    let methods=[];
    try{methods=(v3State().salesOptions?.payment_methods||[]).filter(row=>row?.active!==false);}catch{}
    return {
      company:text(context.tenant_name||context.company_name||context.organization_name,'ThorPDV'),
      branch:text(context.branch_name,'Filial'),
      pos:text(context.pos_name||context.pos_code,'PDV'),
      printer:text(settings.printerName||state.status?.printer,'Não configurada'),
      payments:methods.length?`${methods.length} forma(s) ativa(s)`:'Configuração do Gestão',
      online:Boolean(state.status?.online),
      syncing:Boolean(state.status?.syncing),
      version:text(state.status?.appVersion,'—'),
      lastSync:state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado'
    };
  }

  function enhanceOperatorGate(){
    const gate=document.getElementById('thorOperatorGate');
    const card=gate?.querySelector('.operator-gate-card');
    if(!gate||!card)return;
    gate.classList.add('v088-operator-gate');
    if(card.dataset.v088Ready==='1')return;
    card.dataset.v088Ready='1';
    card.classList.add('v088-gate-card');

    const login=document.createElement('section');
    login.className='v088-gate-login';
    [...card.childNodes].forEach(node=>login.appendChild(node));
    const data=gateConfigData();
    const config=document.createElement('section');
    config.className='v088-gate-config';
    config.innerHTML=`
      <div class="v088-gate-config-head"><div><span>⚙</span><div><h2>Configurações do terminal</h2><p>Confira o ambiente antes de realizar o acesso.</p></div></div><button id="v088GateSettings">Abrir configurações</button></div>
      <div class="v088-config-grid">
        <article><i>▦</i><div><small>Empresa / Loja</small><b>${esc(data.company)}</b></div></article>
        <article><i>⌂</i><div><small>Filial</small><b>${esc(data.branch)}</b></div></article>
        <article class="green"><i>▣</i><div><small>Terminal / PDV</small><b>${esc(data.pos)}</b></div></article>
        <article class="green"><i>▤</i><div><small>Modo de operação</small><b>Venda</b></div></article>
        <article><i>▧</i><div><small>Impressora</small><b>${esc(data.printer)}</b></div><em class="${data.printer!=='Não configurada'?'ok':'warn'}">${data.printer!=='Não configurada'?'Configurada':'Pendente'}</em></article>
        <article><i>▱</i><div><small>Pagamentos</small><b>${esc(data.payments)}</b></div></article>
        <article class="green"><i>●</i><div><small>Servidor / Conexão</small><b>${data.online?'Online':'Offline'}</b></div><em class="${data.online?'ok':'warn'}">${data.online?'Conectado':'Sem conexão'}</em></article>
        <article><i>↻</i><div><small>Sincronização</small><b>${data.syncing?'Sincronizando agora':'Automática'}</b></div></article>
        <article><i>⇧</i><div><small>Atualizações</small><b>Versão ${esc(data.version)}</b></div></article>
        <article class="green"><i>◷</i><div><small>Última sincronização</small><b>${esc(data.lastSync)}</b></div></article>
      </div>
      <div class="v088-config-ready ${data.online?'online':'offline'}"><div><i>${data.online?'✓':'!'}</i><span><b>${data.online?'Tudo certo!':'Operação offline disponível'}</b><small>${data.online?'Terminal conectado e pronto para sincronizar.':'O caixa pode operar com os dados locais já sincronizados.'}</small></span></div><button id="v088GateTest">Testar conexão</button></div>`;
    card.append(login,config);

    config.querySelector('#v088GateSettings').onclick=()=>{
      settingsModal();
      setTimeout(()=>document.querySelectorAll('.modal').forEach(modal=>modal.classList.add('v088-login-settings-modal')),0);
    };
    config.querySelector('#v088GateTest').onclick=async event=>{
      const button=event.currentTarget;
      try{
        button.disabled=true;button.textContent='Testando...';
        await window.thor.sync();
        state.status=await window.thor.status();
        button.textContent=state.status?.online?'Conexão OK':'Sem conexão';
        setTimeout(()=>{card.dataset.v088Ready='';enhanceOperatorGate();},250);
      }catch(error){button.textContent='Falha na conexão';}
      finally{setTimeout(()=>{if(button.isConnected){button.disabled=false;button.textContent='Testar conexão';}},1200);}
    };
  }

  function enhancePaymentDrawer(){
    document.querySelectorAll('.modal').forEach(modal=>{
      if(modal.querySelector('.payment-head'))modal.classList.add('v088-payment-drawer-modal');
      if(modal.querySelector('.settings-head'))modal.classList.add('v088-settings-modal');
      if(modal.querySelector('.v47-modal-head'))modal.classList.add('v088-adjustment-modal');
    });
  }

  function enhanceFiscal(){
    if(state.view!=='fiscal')return;
    document.querySelector('.fiscal-workspace')?.classList.add('v088-fiscal-workspace');
  }

  function enhanceAll(){
    ensureSidebar();
    ensureSaleTabs();
    enhanceOperatorGate();
    enhancePaymentDrawer();
    enhanceFiscal();
  }

  if(typeof render==='function'){
    const previousRender=render;
    render=function(){const result=previousRender();later();setTimeout(later,25);return result;};
  }
  if(typeof renderProducts==='function'){
    const previousRenderProducts=renderProducts;
    renderProducts=function(){const result=previousRenderProducts();queueMicrotask(()=>{paintCatalog();later();});return result;};
  }
  if(typeof v3RenderCart==='function'){
    const previousRenderCart=v3RenderCart;
    v3RenderCart=function(){const result=previousRenderCart();queueMicrotask(()=>{ensureQuickActions();later();});return result;};
    renderCart=v3RenderCart;
  }

  const observer=new MutationObserver(later);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  later();
})();
