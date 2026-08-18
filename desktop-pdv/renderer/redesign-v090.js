(function(){
  const KEY='thor.pdv.productView.v090';
  let scheduled=false;
  let viewMode='grid';
  try{viewMode=localStorage.getItem(KEY)==='list'?'list':'grid';}catch{}

  const n=(v)=>{const x=Number(v||0);return Number.isFinite(x)?x:0;};
  const br=(v)=>n(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const imageOf=(p)=>p?.image_url||p?.imageUrl||p?.menu_image_url||p?.menuImageUrl||p?.thumbnail_url||p?.thumbnailUrl||'';
  const bucket=(sale)=>{
    const saleStatus=String(sale?.status||'');
    const fiscalStatus=String(sale?.fiscal?.status||'');
    if(saleStatus==='cancelled'||saleStatus==='cancel_pending'||fiscalStatus==='cancelled')return 'cancelled';
    if(fiscalStatus==='authorized'||(!fiscalStatus&&saleStatus==='completed'))return 'authorized';
    if(fiscalStatus==='rejected'||fiscalStatus==='transmission_error')return 'rejected';
    return 'pending';
  };

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;try{apply();}catch(error){console.warn('v090_apply_failed',error);}});
  }

  function apply(){
    const fiscal=Boolean(document.querySelector('.fiscal-workspace'));
    document.body.classList.toggle('thor-v090-fiscal',fiscal);
    document.body.classList.toggle('thor-v090-sale',!fiscal&&state?.view==='sale');
    if(fiscal)enhanceFiscal();
    else if(state?.view==='sale'){
      ensureViewSelector();
      decorateProducts();
      fixCheckoutGeometry();
    }
    enhanceActionsMenu();
    enhancePaymentDrawer();
  }

  function ensureViewSelector(){
    const crumb=document.querySelector('.v089-breadcrumb');
    const products=document.getElementById('products');
    if(!crumb||!products)return;
    let controls=crumb.querySelector('.v090-view-switch');
    if(!controls){
      controls=document.createElement('div');
      controls.className='v090-view-switch';
      controls.innerHTML='<span>Exibição</span><button type="button" data-view="grid" title="Exibir produtos em grade">▦ <b>Grade</b></button><button type="button" data-view="list" title="Exibir produtos em lista">☷ <b>Lista</b></button>';
      const cloud=crumb.querySelector('em');
      crumb.insertBefore(controls,cloud||null);
      controls.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{
        viewMode=button.dataset.view==='list'?'list':'grid';
        try{localStorage.setItem(KEY,viewMode);}catch{}
        updateViewMode();
      });
    }
    updateViewMode();
  }

  function updateViewMode(){
    const products=document.getElementById('products');
    if(!products)return;
    products.classList.toggle('v090-product-list',viewMode==='list');
    products.classList.toggle('v090-product-grid',viewMode!=='list');
    document.querySelectorAll('.v090-view-switch [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===viewMode));
  }

  function decorateProducts(){
    const box=document.getElementById('products');
    if(!box)return;
    const rows=Array.isArray(state?.products)?state.products:[];
    box.querySelectorAll('.v088-product-card').forEach((card,index)=>{
      const product=rows[index];
      if(!product)return;
      const media=card.querySelector('.v088-product-media');
      const copy=card.querySelector('.v088-product-copy');
      if(!media||!copy)return;
      const src=imageOf(product);
      card.classList.toggle('v090-no-photo',!src);
      card.dataset.image=src||'';

      if(src){
        media.classList.remove('no-image');
        media.querySelector('.v090-product-fallback')?.remove();
        media.querySelector(':scope > span')?.remove();
        let img=media.querySelector(':scope > img');
        if(!img){img=document.createElement('img');img.alt='';img.loading='lazy';media.insertBefore(img,media.firstChild);}
        if(img.getAttribute('src')!==src)img.setAttribute('src',src);
        img.onerror=()=>{card.classList.add('v090-no-photo');media.classList.add('no-image');img?.remove();ensureFallback(card,media,product);};
      }else{
        media.classList.add('no-image');
        media.querySelector(':scope > img')?.remove();
        ensureFallback(card,media,product);
      }

      let code=copy.querySelector('.v090-product-code');
      if(!code){code=document.createElement('span');code.className='v090-product-code';copy.insertBefore(code,copy.querySelector('.v089-pricing')||null);}
      code.textContent=`Cód. ${product.product_code||product.sku||'—'} • Estoque ${n(product.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}`;
    });
    updateViewMode();
  }

  function ensureFallback(card,media,product){
    let fallback=media.querySelector('.v090-product-fallback');
    if(!fallback){fallback=document.createElement('div');fallback.className='v090-product-fallback';media.insertBefore(fallback,media.querySelector('.v089-badges')||null);}
    fallback.innerHTML=`<strong>${esc(product.name||'Produto')}</strong><b>R$ ${br(product.base_price??product.sale_price)}</b><small>Sem foto cadastrada</small>`;
  }

  function fixCheckoutGeometry(){
    const right=document.querySelector('.v089-right');
    const summary=document.querySelector('.v089-summary');
    const finalize=document.getElementById('finalize');
    if(right)right.classList.add('v090-right');
    if(summary)summary.classList.add('v090-summary');
    if(finalize)finalize.classList.add('v090-finalize');
  }

  function enhanceActionsMenu(){
    document.querySelectorAll('.v089-actions-modal').forEach(wrap=>{
      if(wrap.dataset.v090Ready==='1')return;
      const grid=wrap.querySelector('.v089-menu-grid');
      if(!grid)return;
      wrap.dataset.v090Ready='1';
      const supply=document.createElement('button');
      supply.dataset.v090Movement='supply';
      supply.innerHTML='<i>＋</i><b>Suprimento</b><small>Entrada de dinheiro no caixa</small>';
      const withdrawal=document.createElement('button');
      withdrawal.dataset.v090Movement='withdrawal';
      withdrawal.innerHTML='<i>−</i><b>Sangria</b><small>Retirada de dinheiro do caixa</small>';
      grid.insertBefore(supply,grid.children[1]||null);
      grid.insertBefore(withdrawal,grid.children[2]||null);
      supply.onclick=()=>{wrap.remove();setTimeout(()=>openMovement('supply'),20);};
      withdrawal.onclick=()=>{wrap.remove();setTimeout(()=>openMovement('withdrawal'),20);};
    });
  }

  function openMovement(type){
    const supply=type==='supply';
    if(!state.status?.cashOpenEventId){
      infoModal(supply?'Suprimento':'Sangria','O caixa precisa estar aberto antes desta movimentação. Abra o caixa e tente novamente.');
      return;
    }
    const title=supply?'Suprimento':'Sangria';
    const m=modal(`<div class="v090-movement-head"><span>${supply?'＋':'−'}</span><div><small>CAIXA</small><h3>${title}</h3><p>${supply?'Registre uma entrada de dinheiro que não seja venda.':'Registre uma retirada de dinheiro do caixa.'}</p></div></div><div class="field"><label>Valor</label><input id="v090MovementValue" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00"></div><div class="field"><label>Observação</label><input id="v090MovementNote" maxlength="160" placeholder="Motivo / referência (opcional)"></div><div id="v090MovementError" class="settings-error"></div><div class="actions"><button class="secondary" id="v090MovementCancel">Cancelar</button><button class="primary ${supply?'':'danger'}" id="v090MovementSave">Registrar ${title}</button></div>`);
    m.classList.add('v090-movement-modal');
    const input=m.querySelector('#v090MovementValue');
    m.querySelector('#v090MovementCancel').onclick=()=>m.remove();
    m.querySelector('#v090MovementSave').onclick=async()=>{
      const amount=n(input.value);
      const button=m.querySelector('#v090MovementSave');
      const error=m.querySelector('#v090MovementError');
      if(amount<=0){error.textContent='Informe um valor maior que zero.';input.focus();return;}
      try{
        button.disabled=true;button.textContent='Registrando...';
        let supervisorAuthorization=null;
        if(type==='withdrawal'&&amount>=500)supervisorAuthorization=await window.requestSupervisorAuthorizationV120('high_withdrawal','Autorizar sangria elevada',amount);
        const result=await window.thor.cashMovement({movementType:type,amount,notes:m.querySelector('#v090MovementNote').value.trim(),supervisorAuthorization});
        let printError='';
        try{await window.thor.printCashMovement(result?.receipt||{});}catch(error){printError=friendlyError(error?.message||'print_failed');}
        await refreshStatus();
        m.remove();
        showToast(printError?`${title} registrado. Impressão pendente: ${printError}`:`${title} de ${money(amount)} registrado e comprovante impresso.`);
      }catch(err){error.textContent=friendlyError(err?.message||String(err));button.disabled=false;button.textContent=`Registrar ${title}`;}
    };
    setTimeout(()=>input?.focus(),30);
  }

  function fiscalStats(){
    const rows=Array.isArray(state?.fiscalSales)?state.fiscalSales:[];
    const result={total:rows.length,authorized:0,pending:0,rejected:0,cancelled:0,amount:0};
    for(const sale of rows){
      const kind=bucket(sale);result[kind]=(result[kind]||0)+1;
      if(kind==='pending')result.pending+=0;
      if(kind==='rejected')result.pending+=1;
      if(kind==='authorized')result.amount+=n(sale.total);
    }
    return result;
  }

  function enhanceFiscal(){
    const fiscal=document.querySelector('.fiscal-workspace');
    const head=fiscal?.querySelector('.fiscal-head');
    if(!fiscal||!head)return;
    fiscal.classList.add('v090-fiscal');
    head.classList.add('v090-fiscal-head');

    let navigation=fiscal.querySelector('.v090-fiscal-nav');
    if(!navigation){
      navigation=document.createElement('div');navigation.className='v090-fiscal-nav';
      navigation.innerHTML='<button id="v090FiscalBack">← Venda</button><button id="v090FiscalSync">↻ Sincronizar</button><button id="v090FiscalToday">Hoje</button><button id="v090FiscalPending">Pendências</button><button id="v090FiscalLast">Última NFC-e</button><button id="v090FiscalDiagnostic">Diagnóstico</button>';
      head.insertAdjacentElement('afterend',navigation);
      navigation.querySelector('#v090FiscalBack').onclick=()=>setView('sale');
      navigation.querySelector('#v090FiscalSync').onclick=()=>document.getElementById('fiscalRefresh')?.click();
      navigation.querySelector('#v090FiscalToday').onclick=()=>document.getElementById('fiscalToday')?.click();
      navigation.querySelector('#v090FiscalPending').onclick=()=>{
        state.fiscalFilter.status='pending';const select=document.getElementById('fiscalStatusFilter');if(select)select.value='pending';renderFiscalTable();schedule();
      };
      navigation.querySelector('#v090FiscalLast').onclick=()=>{
        const sale=(state.fiscalSales||[]).find(row=>String(row?.fiscal?.status||'')==='authorized');
        if(!sale)return infoModal('Fiscal','Ainda não existe NFC-e autorizada no histórico local deste terminal.');
        Promise.resolve(openSaleDetail(sale)).catch(error=>infoModal('Fiscal',friendlyError(error?.message||String(error))));
      };
      navigation.querySelector('#v090FiscalDiagnostic').onclick=openFiscalDiagnostic;
    }

    let kpis=fiscal.querySelector('.v090-fiscal-kpis');
    if(!kpis){kpis=document.createElement('section');kpis.className='v090-fiscal-kpis';navigation.insertAdjacentElement('afterend',kpis);}
    const s=fiscalStats();
    kpis.innerHTML=`<article><span>Operações</span><b>${s.total}</b><small>histórico local</small></article><article class="ok"><span>Autorizadas</span><b>${s.authorized}</b><small>${money(s.amount)} faturado</small></article><article class="warn"><span>Pendências</span><b>${s.pending}</b><small>processar / conferir</small></article><article class="bad"><span>Rejeitadas</span><b>${s.rejected}</b><small>SEFAZ / transmissão</small></article><article><span>Canceladas</span><b>${s.cancelled}</b><small>venda / NFC-e</small></article>`;

    let notice=fiscal.querySelector('.v090-fiscal-notice');
    if(s.rejected>0){
      if(!notice){notice=document.createElement('div');notice.className='v090-fiscal-notice';kpis.insertAdjacentElement('afterend',notice);}
      notice.innerHTML=`<b>⚠ ${s.rejected} rejeição(ões) precisam de atenção.</b><span>Abra a operação em “Visualizar” para consultar cStat, xMotivo, tentativas e eventos da transmissão.</span>`;
    }else notice?.remove();

    fiscal.querySelector('.fiscal-toolbar')?.classList.add('v090-fiscal-toolbar');
    fiscal.querySelector('.fiscal-filter-chips')?.classList.add('v090-fiscal-chips');
    fiscal.querySelector('.fiscal-table-card')?.classList.add('v090-fiscal-table-card');
  }

  function openFiscalDiagnostic(){
    const readiness=state.status?.context?.fiscal_readiness||{};
    const queue=state.status?.queue||{};
    const values=[
      ['Terminal',state.status?.online?'Online':'Offline',state.status?.online?'ok':'warn'],
      ['Fila de sincronização',`${queue.pending||0} pendente(s)`,queue.rejected?'warn':'ok'],
      ['Eventos rejeitados',String(queue.rejected||0),queue.rejected?'bad':'ok'],
      ['Ambiente fiscal',String(readiness.environment||readiness.ambiente||state.status?.context?.fiscal_environment||'Configurado'),''],
      ['Certificado',readiness.certificate_ready===false?'Pendente':'Configurado',readiness.certificate_ready===false?'bad':'ok'],
      ['Última sincronização',state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado','']
    ];
    const m=modal(`<div class="v090-diagnostic-head"><small>THORFISCAL</small><h3>Diagnóstico fiscal do terminal</h3><p>Resumo operacional para identificar rapidamente problemas de comunicação ou configuração.</p></div><div class="v090-diagnostic-grid">${values.map(([label,value,status])=>`<article class="${status}"><span>${esc(label)}</span><b>${esc(value)}</b></article>`).join('')}</div><div class="actions"><button class="secondary" id="v090DiagSync">Sincronizar agora</button><button class="primary" id="v090DiagClose">Fechar</button></div>`,'wide');
    m.querySelector('#v090DiagClose').onclick=()=>m.remove();
    m.querySelector('#v090DiagSync').onclick=async()=>{m.remove();try{await window.thor.sync();await refreshStatus();await refreshFiscalSales();showToast('Diagnóstico atualizado após sincronização.');}catch(error){infoModal('Sincronização',friendlyError(error?.message||String(error)));}};
  }

  function enhancePaymentDrawer(){
    document.querySelectorAll('.v089-payment-card').forEach(card=>card.classList.add('v090-payment-card'));
    document.querySelectorAll('.v089-payment-footer').forEach(footer=>footer.classList.add('v090-payment-footer'));
  }

  document.addEventListener('keydown',event=>{
    if(document.querySelector('.modal'))return;
    if(state?.view==='fiscal'&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setView('sale');}
  },true);

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();
