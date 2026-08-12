(function(){
  const V='v089';
  let scheduled=false;
  let paymentPatched=false;

  const num=(v)=>{const n=Number(v||0);return Number.isFinite(n)?n:0;};
  const digits=(v)=>String(v||'').replace(/\D/g,'');
  const br=(v)=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const qty=(v)=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:3});
  const vstate=()=>{try{return v3State();}catch{return {};}};
  const gross=()=>state.cart.reduce((s,i)=>s+num(i.quantity)*num(i.unitPrice),0);
  const itemDiscount=()=>state.cart.reduce((s,i)=>s+Math.max(num(i.discount),0),0);
  const saleDiscount=()=>Math.max(num(vstate().discount),0);
  const surcharge=()=>Math.max(num(vstate().surcharge),0);
  const total=()=>num(vstate().quote?.total ?? Math.max(gross()-itemDiscount()-saleDiscount()+surcharge(),0));
  const cashback=()=>Array.isArray(vstate().payments)?vstate().payments.filter(p=>String(p.method)==='cashback').reduce((s,p)=>s+num(p.amount),0):0;

  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;try{apply();}catch(e){console.warn('v089_apply_failed',e);}});}

  function context(){
    const c=state.status?.context||{};
    return {
      branch:c.branch_name||'Filial',
      pos:c.pos_name||c.pos_code||'PDV',
      address:c.branch_address||c.address||c.branch_name||'Filial',
      operator:vstate().operator?.name||state.status?.operator?.name||'Vendedor'
    };
  }

  function imageOf(product){return product?.image_url||product?.imageUrl||product?.thumbnail_url||product?.thumbnailUrl||product?.photo_url||product?.photoUrl||product?.image||product?.photo||'';}
  function oldPriceOf(product){
    const current=num(product?.base_price??product?.sale_price);
    const candidates=[product?.original_price,product?.list_price,product?.compare_at_price,product?.regular_price,product?.price_before,product?.old_price].map(num).filter(v=>v>current+.009);
    return candidates.length?Math.max(...candidates):0;
  }

  function ensureHeader(){
    const shell=document.querySelector('.shell');
    const top=document.querySelector('.topbar');
    if(!shell||!top)return;
    document.body.classList.add('thor-v089');shell.classList.add('v089-shell');top.classList.add('v089-topbar');
    if(!top.querySelector('.v089-head')){
      const legacy=document.createElement('div');legacy.className='v089-legacy-top';
      while(top.firstChild)legacy.appendChild(top.firstChild);
      top.appendChild(legacy);
      const head=document.createElement('div');head.className='v089-head';
      head.innerHTML=`<button class="v089-hamb" id="v089Actions" type="button" title="Ações (F2)"><span></span><span></span><span></span></button><div class="v089-head-search"><span>⌕</span><div id="v089SearchSlot"></div></div><div class="v089-head-tools"><button id="v089ScanFocus" type="button" title="Focar leitura/pesquisa">▣</button><button id="v089BrandChip" type="button" title="ThorPDV">T</button><button id="v089Profile" type="button" title="Operador">●</button></div>`;
      top.appendChild(head);
      head.querySelector('#v089Actions').onclick=openActions;
      head.querySelector('#v089ScanFocus').onclick=()=>document.getElementById('search')?.focus();
      head.querySelector('#v089BrandChip').onclick=()=>settingsModal();
      head.querySelector('#v089Profile').onclick=()=>document.getElementById('operatorBtn')?.click();
    }
    const search=document.getElementById('search'),slot=document.getElementById('v089SearchSlot');
    if(search&&slot&&search.parentElement!==slot){search.classList.add('v089-main-search');search.placeholder='Consultar Produto...';slot.appendChild(search);}
  }

  function ensureActionBar(){
    if(state.view!=='sale')return;
    const workspace=document.getElementById('workspace');if(!workspace)return;
    let bar=workspace.querySelector('.v089-actionbar');
    if(!bar){
      bar=document.createElement('div');bar.className='v089-actionbar';
      bar.innerHTML=`<div class="v089-action-left"><button class="v089-actions-pill" id="v089ActionsBar">AÇÕES <small>(F2)</small></button><i></i><span class="v089-sale-label">VENDA</span></div><div class="v089-party"><button id="v089Customer"><span class="v089-party-icon green">◎</span><span><b>Cliente</b><small>Informar</small></span><kbd>F8</kbd></button><button id="v089Seller"><span class="v089-party-icon cyan">#</span><span><b>Vendedor</b><small>Informar</small></span><kbd>F9</kbd></button></div><div class="v089-items-title"><b id="v089ItemsTitle">Itens(0,000)</b><em id="v089Address">⌖ Filial</em></div><div class="v089-quick"><button class="purple" id="v089Settings"><span>⚙</span><b>Config Rápida <small>(F4)</small></b></button><button class="cyan" id="v089Discount"><span>−</span><b>Desconto <small>(F6)</small></b></button><button class="orange" id="v089Surcharge"><span>＋</span><b>Acréscimo <small>(F7)</small></b></button></div>`;
      workspace.insertBefore(bar,workspace.firstChild);
      bar.querySelector('#v089ActionsBar').onclick=openActions;
      bar.querySelector('#v089Customer').onclick=()=>document.getElementById('v47ConsumerAction')?.click();
      bar.querySelector('#v089Seller').onclick=()=>document.getElementById('operatorBtn')?.click();
      bar.querySelector('#v089Settings').onclick=()=>settingsModal();
      bar.querySelector('#v089Discount').onclick=openDiscount;
      bar.querySelector('#v089Surcharge').onclick=openSurcharge;
    }
    updateActionBar();
  }

  function updateActionBar(){
    const c=context();
    const customer=document.getElementById('v089Customer');
    if(customer){
      const v=vstate();const label=customer.querySelector('small');const title=customer.querySelector('b');
      if(v.customerName){title.textContent='Cliente';label.textContent=v.customerName;}
      else if(digits(v.consumerDocument)){title.textContent='Cliente';label.textContent=`CPF/CNPJ •••• ${digits(v.consumerDocument).slice(-4)}`;}
      else{title.textContent='Cliente';label.textContent='Informar';}
    }
    const seller=document.getElementById('v089Seller');if(seller){seller.querySelector('small').textContent=c.operator||'Informar';}
    const count=state.cart.reduce((s,i)=>s+num(i.quantity),0);const itemTitle=document.getElementById('v089ItemsTitle');if(itemTitle)itemTitle.textContent=`Itens(${qty(count)})`;
    const addr=document.getElementById('v089Address');if(addr)addr.textContent=`⌖ ${c.address}`;
  }

  function ensureLayout(){
    if(state.view!=='sale')return;
    const work=document.querySelector('.v47-work');const catalog=work?.querySelector('.v47-main');const items=work?.querySelector('.v47-items-card');const summary=work?.querySelector('.v47-summary');
    if(!work||!catalog||!items||!summary)return;
    work.classList.add('v089-work');catalog.classList.add('v089-catalog');items.classList.add('v089-items-card');summary.classList.add('v089-summary');
    let right=work.querySelector(':scope > .v089-right');
    if(!right){right=document.createElement('section');right.className='v089-right';work.appendChild(right);}
    if(items.parentElement!==right)right.appendChild(items);
    if(summary.parentElement!==right)right.appendChild(summary);

    const searchZone=catalog.querySelector('.v47-search-zone');
    if(searchZone){searchZone.classList.add('v089-product-zone');const searchRow=searchZone.querySelector('.search-row');if(searchRow)searchRow.classList.add('v089-hidden-search-row');
      let crumb=searchZone.querySelector('.v089-breadcrumb');
      if(!crumb){crumb=document.createElement('div');crumb.className='v089-breadcrumb';crumb.innerHTML='<span>Início</span><i>›</i><b>PRODUTOS</b><i>›</i><b>CATÁLOGO</b><em>☁</em>';searchZone.insertBefore(crumb,searchZone.querySelector('#products'));}
    }
    catalog.querySelector('.v088-catalog-head')?.classList.add('v089-hide');
    catalog.querySelector('.v088-sale-tabs')?.classList.add('v089-hide');
    document.querySelector('.v088-sale-tabs')?.classList.add('v089-hide');
    decorateProducts();
    decorateCart();
    ensureSummaryBoard();
  }

  function decorateProducts(){
    const box=document.getElementById('products');if(!box)return;
    box.classList.add('v089-products');
    const rows=Array.isArray(state.products)?state.products:[];
    box.querySelectorAll('.v088-product-card').forEach((card,index)=>{
      card.classList.add('v089-product-card');const p=rows[index];if(!p)return;
      const media=card.querySelector('.v088-product-media');const copy=card.querySelector('.v088-product-copy');if(!media||!copy)return;
      let badges=media.querySelector('.v089-badges');
      const stock=num(p.quantity);const current=num(p.base_price??p.sale_price);const old=oldPriceOf(p);const discountPct=old>current?Math.max(0,Math.round((1-current/old)*100)):0;
      if(!badges){badges=document.createElement('div');badges.className='v089-badges';media.appendChild(badges);}
      badges.innerHTML=`<span class="${stock>0?'stock':'out'}">${stock>0?`${qty(stock)} UN`:'OUT'}</span>${discountPct?`<span class="off">OFF<br>${discountPct}%</span>`:''}`;
      let pricing=copy.querySelector('.v089-pricing');if(!pricing){pricing=document.createElement('div');pricing.className='v089-pricing';copy.appendChild(pricing);}pricing.innerHTML=`${old?`<del>R$ ${br(old)}</del>`:''}<strong>R$ ${br(current)}</strong>`;
      const originalPrice=copy.querySelector(':scope > b');if(originalPrice)originalPrice.classList.add('v089-hide-original-price');
      const originalStock=copy.querySelector(':scope > span');if(originalStock)originalStock.classList.add('v089-hide-original-stock');
    });
  }

  function decorateCart(){
    const card=document.querySelector('.v089-items-card');if(!card)return;
    const head=card.querySelector('.cart-head');if(head){head.classList.add('v089-cart-head');const title=head.querySelector('h2');if(title)title.innerHTML='<span id="v089CartTitle">Itens</span>';const small=head.querySelector('small');if(small)small.textContent='';}
    const cart=document.getElementById('cart');if(!cart)return;cart.classList.add('v089-cart');
    cart.querySelector('.cart-v43-list-head')?.classList.add('v089-hide');
    cart.querySelectorAll('.cart-v43-item').forEach((row,index)=>{
      row.classList.add('v089-cart-item');
      const item=state.cart[index];if(!item)return;
      if(!row.querySelector('.v089-cart-thumb')){
        const product=(state.products||[]).find(p=>String(p.id)===String(item.productId));const img=imageOf(product);
        const thumb=document.createElement('div');thumb.className='v089-cart-thumb';thumb.innerHTML=img?`<img src="${esc(img)}" alt="">`:'<span>◆</span>';
        row.insertBefore(thumb,row.firstChild);
      }
      const productBox=row.querySelector('.cart-v43-product');if(productBox){const small=productBox.querySelector('small');if(small)small.textContent=`Qtd. ${qty(item.quantity)}   Unit. ${br(item.unitPrice)}   Desc. ${br(item.discount||0)}`;}
    });
  }

  function ensureSummaryBoard(){
    const summary=document.querySelector('.v089-summary');if(!summary)return;
    summary.querySelector('.v47-summary-head')?.classList.add('v089-hide');summary.querySelector('.v47-sale-actions')?.classList.add('v089-hide');summary.querySelector('.v47-financial-card')?.classList.add('v089-hide');summary.querySelector('.v47-payment-card')?.classList.add('v089-hide');summary.querySelector('.v088-quick-actions')?.classList.add('v089-hide');
    let board=summary.querySelector('.v089-summary-board');
    if(!board){board=document.createElement('div');board.className='v089-summary-board';board.innerHTML=`<div class="v089-total-box purple"><span>Total</span><b id="v089Gross">0,00</b></div><div class="v089-total-box green"><span>Líquido</span><b id="v089Net">0,00</b></div><div class="v089-mini green"><span>Cashback</span><b id="v089Cashback">+ 0,00 (% 0,00)</b></div><div class="v089-mini cyan"><span>Desconto</span><b id="v089DiscountValue">- 0,00 (% 0,00)</b></div>`;summary.insertBefore(board,summary.firstChild);}
    const finalize=document.getElementById('finalize');if(finalize){finalize.classList.add('v089-finalize');if(finalize.parentElement!==summary)summary.appendChild(finalize);}
    updateSummary();
  }

  function updateSummary(){
    const g=gross(),disc=itemDiscount()+saleDiscount(),net=total(),cb=cashback();
    const gp=document.getElementById('v089Gross'),np=document.getElementById('v089Net'),cp=document.getElementById('v089Cashback'),dp=document.getElementById('v089DiscountValue');
    if(gp)gp.textContent=br(g);if(np)np.textContent=br(net);if(cp)cp.textContent=`+ ${br(cb)} (% ${g?br(cb/g*100):'0,00'})`;if(dp)dp.textContent=`- ${br(disc)} (% ${g?br(disc/g*100):'0,00'})`;
    const finalize=document.getElementById('finalize');if(finalize)finalize.innerHTML=`▣ &nbsp; Concluir Venda (${br(net)}) <small>(F3)</small>`;
    updateActionBar();
  }

  function openActions(){
    if(document.querySelector('.modal'))return;
    const m=modal(`<div class="v089-menu-head"><div><small>THORPDV</small><h3>Ações da venda</h3></div><button id="v089MenuClose">×</button></div><div class="v089-menu-grid"><button data-act="cash"><i>▤</i><b>Caixa</b><small>Abrir, movimentar ou fechar</small></button><button data-act="fiscal"><i>▥</i><b>Fiscal</b><small>Vendas e NFC-e</small></button><button data-act="sync"><i>↻</i><b>Sincronizar</b><small>Atualizar dados do Gestão</small></button><button data-act="settings"><i>⚙</i><b>Configurações</b><small>Terminal e impressão</small></button><button data-act="drawer"><i>▱</i><b>Gaveta</b><small>Abrir gaveta do caixa</small></button><button data-act="operator"><i>●</i><b>Operador</b><small>Trocar usuário do caixa</small></button></div>`,'wide');
    m.classList.add('v089-actions-modal');m.querySelector('#v089MenuClose').onclick=()=>m.remove();
    const closeRun=(fn)=>()=>{m.remove();setTimeout(fn,20);};
    m.querySelector('[data-act="cash"]').onclick=closeRun(()=>openCashModal());
    m.querySelector('[data-act="fiscal"]').onclick=closeRun(()=>setView('fiscal'));
    m.querySelector('[data-act="settings"]').onclick=closeRun(()=>settingsModal());
    m.querySelector('[data-act="operator"]').onclick=closeRun(()=>document.getElementById('operatorBtn')?.click());
    m.querySelector('[data-act="drawer"]').onclick=closeRun(async()=>{try{await window.thor.openDrawer();showToast('Comando enviado para a gaveta.');}catch(e){infoModal('Gaveta',friendlyError(e?.message));}});
    m.querySelector('[data-act="sync"]').onclick=closeRun(async()=>{try{await window.thor.sync();await refreshStatus();await refreshProducts();await refreshFiscalSales();showToast('Sincronização concluída.');}catch(e){infoModal('Sincronização',friendlyError(e?.message));}});
  }

  function discountAllowed(){try{return typeof p41Allowed==='function'?p41Allowed('discount.apply',true):Boolean(v3Perm('discount.apply',true));}catch{return true;}}
  function overrideAllowed(){try{return typeof p41Allowed==='function'?p41Allowed('discount.override_limit',false):Boolean(v3Perm('discount.override_limit',false));}catch{return false;}}

  function openDiscount(){
    if(!state.cart.length)return infoModal('Desconto','Inclua pelo menos um item antes de aplicar desconto.');
    if(!discountAllowed())return infoModal('Desconto','O perfil deste operador não possui permissão para aplicar desconto.');
    const v=vstate(),base=Math.max(gross()-itemDiscount(),0),current=Math.max(num(v.discount),0),surch=surcharge();
    const m=modal(`<div class="v089-discount-head"><h3>Desconto no subtotal da operação</h3><button id="v089DiscountClose">×</button></div><div class="v089-discount-body"><label>Cupom<div class="v089-coupon"><input id="v089Coupon" placeholder="Cupom de Desconto..."><button id="v089CouponApply">Aplicar</button></div></label><label>SubTotal<input value="${br(base)}" readonly></label><label>Percentual de Desconto<input id="v089DiscountPct" inputmode="decimal" value="${br(base?current/base*100:0)}"></label><label>Valor de Desconto<input id="v089DiscountAmount" inputmode="decimal" value="${br(current)}"></label><label>Total<input id="v089DiscountTotal" value="${br(Math.max(base-current+surch,0))}" readonly></label></div><div class="v089-discount-foot"><button id="v089ApplyDiscount">Aplicar Desconto</button></div>`);
    m.classList.add('v089-discount-modal');const pct=m.querySelector('#v089DiscountPct'),amount=m.querySelector('#v089DiscountAmount'),preview=m.querySelector('#v089DiscountTotal');
    const parse=(x)=>num(String(x||'').replace(/\./g,'').replace(',','.'));
    const syncFromPct=()=>{const p=Math.min(Math.max(parse(pct.value),0),100),a=Math.min(base*p/100,base);amount.value=br(a);preview.value=br(Math.max(base-a+surch,0));};
    const syncFromAmount=()=>{const a=Math.min(Math.max(parse(amount.value),0),base);pct.value=br(base?a/base*100:0);preview.value=br(Math.max(base-a+surch,0));};
    pct.oninput=syncFromPct;amount.oninput=syncFromAmount;m.querySelector('#v089DiscountClose').onclick=()=>m.remove();
    m.querySelector('#v089CouponApply').onclick=()=>infoModal('Cupom','A aplicação automática de cupons ainda não está configurada neste terminal. O desconto manual continua disponível.');
    m.querySelector('#v089ApplyDiscount').onclick=async()=>{const proposed=Math.min(Math.max(parse(amount.value),0),base),percentage=base?proposed/base*100:0,limit=Math.max(num(v.operator?.permissions?.discount?.max_percent),0);try{let auth=null;if(proposed>0&&percentage>limit+.0001&&!overrideAllowed())auth=await v3NeedSupervisor('discount',percentage,`Desconto de ${percentage.toFixed(2)}% acima da alçada de ${limit.toFixed(2)}%`);v.discount=proposed;v.supervisorAuthorization=auth;m.remove();await v3Reprice();updateSummary();showToast(proposed?'Desconto aplicado.':'Desconto removido.');}catch(e){if(e?.message!=='authorization_cancelled')infoModal('Desconto',friendlyError(e?.message));}};
    setTimeout(()=>{pct.focus();pct.select();},30);
  }

  function openSurcharge(){
    if(!state.cart.length)return infoModal('Acréscimo','Inclua pelo menos um item antes de aplicar acréscimo.');
    const v=vstate(),base=Math.max(gross()-itemDiscount()-saleDiscount(),0),current=Math.max(num(v.surcharge),0);
    const m=modal(`<div class="v089-discount-head"><h3>Acréscimo no subtotal da operação</h3><button id="v089SurchargeClose">×</button></div><div class="v089-discount-body"><label>SubTotal<input value="${br(base)}" readonly></label><label>Percentual de Acréscimo<input id="v089SurchargePct" inputmode="decimal" value="${br(base?current/base*100:0)}"></label><label>Valor de Acréscimo<input id="v089SurchargeAmount" inputmode="decimal" value="${br(current)}"></label><label>Total<input id="v089SurchargeTotal" value="${br(base+current)}" readonly></label></div><div class="v089-discount-foot"><button id="v089ApplySurcharge">Aplicar Acréscimo</button></div>`);m.classList.add('v089-discount-modal');
    const pct=m.querySelector('#v089SurchargePct'),amount=m.querySelector('#v089SurchargeAmount'),preview=m.querySelector('#v089SurchargeTotal');const parse=(x)=>num(String(x||'').replace(/\./g,'').replace(',','.'));
    pct.oninput=()=>{const p=Math.max(parse(pct.value),0),a=base*p/100;amount.value=br(a);preview.value=br(base+a);};amount.oninput=()=>{const a=Math.max(parse(amount.value),0);pct.value=br(base?a/base*100:0);preview.value=br(base+a);};m.querySelector('#v089SurchargeClose').onclick=()=>m.remove();m.querySelector('#v089ApplySurcharge').onclick=async()=>{v.surcharge=Math.max(parse(amount.value),0);v.supervisorAuthorization=null;m.remove();await v3Reprice();updateSummary();showToast(v.surcharge?'Acréscimo aplicado.':'Acréscimo removido.');};setTimeout(()=>{pct.focus();pct.select();},30);
  }

  function methodIcon(code){return ({cash:'$',credit_card:'▰',debit_card:'▰',pix:'◆',boleto:'▧',store_credit:'▣',voucher:'▣',cashback:'⌁',installment:'▤',parcelamento:'▤',other:'•••'})[code]||'▰';}

  function patchPayment(){
    if(paymentPatched||typeof v3PaymentModal!=='function')return;paymentPatched=true;
    const old=v3PaymentModal;window.v089OriginalPaymentModal=old;
    v3PaymentModal=function(method){const result=old(method);queueMicrotask(decoratePayment);return result;};
  }

  function decoratePayment(){
    const modals=[...document.querySelectorAll('.modal')];const overlay=modals.reverse().find(m=>m.querySelector('.payment-head'));if(!overlay||overlay.dataset.v089Ready==='1')return;overlay.dataset.v089Ready='1';overlay.classList.add('v089-payment-modal');const card=overlay.querySelector('.modal-card');if(!card)return;card.classList.add('v089-payment-card');
    const head=card.querySelector('.payment-head');if(head){head.innerHTML='<h3>Finalização</h3><button id="v089PayClose">×</button>';head.querySelector('#v089PayClose').onclick=()=>overlay.remove();}
    const top=document.createElement('div');top.className='v089-payment-top';top.innerHTML='<div class="v089-pay-search">Pesquise... <span>⌄</span></div><button>Modelo PDV</button><button>Operação presencial</button>';head?.after(top);
    const entry=card.querySelector('.payment-entry'),list=card.querySelector('#payList'),footer=card.querySelector('.payment-footer');if(!entry||!footer)return;
    const layout=document.createElement('div');layout.className='v089-payment-layout';const left=document.createElement('section');left.className='v089-payment-left';const right=document.createElement('aside');right.className='v089-payment-right';entry.parentElement.insertBefore(layout,entry);layout.append(left,right);left.append(entry);if(list)left.insertBefore(list,entry);
    const grid=entry.querySelector('.payment-method-grid');if(grid){grid.classList.add('v089-pay-methods');grid.querySelectorAll('[data-method]').forEach(b=>{const code=b.dataset.method,label=b.textContent.trim();b.innerHTML=`<i>${methodIcon(code)}</i><span>${esc(label)}</span>`;});}
    const amount=entry.querySelector('#payAmount');const amountField=amount?.closest('.field');if(amountField){amountField.classList.add('v089-pay-amount');amountField.querySelector('label').textContent='';}
    const customer=document.createElement('div');customer.className='v089-payment-customer';const v=vstate();customer.innerHTML=`<label>Cliente</label><div><button id="v089PayCustomer"><span>${esc(v.customerName||'Consultar pessoa...')}</span></button><button id="v089PayAddCustomer">＋</button><button id="v089PaySearchCustomer">⌕</button></div>`;left.append(customer);
    const openCustomer=()=>{overlay.remove();setTimeout(()=>document.getElementById('v47ConsumerAction')?.click(),20);};customer.querySelector('#v089PayCustomer').onclick=openCustomer;customer.querySelector('#v089PayAddCustomer').onclick=openCustomer;customer.querySelector('#v089PaySearchCustomer').onclick=openCustomer;
    const add=entry.querySelector('#addPayment');if(add){add.textContent='Adicionar';add.classList.add('v089-add-payment');}
    const integrated=entry.querySelector('#integratedPay');if(integrated)integrated.classList.add('v089-integrated');
    right.innerHTML=`<div class="v089-pay-kpis"><article class="purple"><small>Total</small><b id="v089PayTotal">${br(total())}</b><i>$</i></article><article class="green"><small>Saldo</small><b id="v089PayBalance">${br(typeof v3Remaining==='function'?v3Remaining():total())}</b><i>＋</i></article></div><div class="v089-pay-lines"><span>Desconto <b class="cyan">${br(itemDiscount()+saleDiscount())}</b></span><span>Cashback <b class="green">${br(cashback())}</b></span><span>Acréscimo <b class="orange">${br(surcharge())}</b></span></div>`;
    right.append(footer);footer.classList.add('v089-payment-footer');
    const originalRefresh=new MutationObserver(()=>{const t=right.querySelector('#v089PayTotal'),bal=right.querySelector('#v089PayBalance');if(t)t.textContent=br(total());if(bal)bal.textContent=br(typeof v3Remaining==='function'?v3Remaining():total());});originalRefresh.observe(entry,{childList:true,subtree:true,characterData:true,attributes:true});
  }

  function rebuildGate(){
    const gate=document.getElementById('thorOperatorGate');const card=gate?.querySelector('.v088-gate-card');const login=card?.querySelector('.v088-gate-login');let config=card?.querySelector('.v088-gate-config');if(!gate||!card||!login||!config||card.dataset.v089Ready==='1')return;card.dataset.v089Ready='1';gate.classList.add('v089-gate');card.classList.add('v089-gate-card');login.classList.add('v089-gate-login');
    const c=context(),settings=state.settings||state.status?.settings||{};let methods=[];try{methods=(vstate().salesOptions?.payment_methods||[]).filter(x=>x?.active!==false);}catch{}
    config.className='v089-gate-config';config.innerHTML=`<div class="v089-gate-config-head"><div><i>⚙</i><span><h2>Configuração do Terminal</h2><p>Configure e teste os parâmetros do seu terminal</p></span></div><div><button id="v089GateSettings">☷ &nbsp; Abrir Configurações</button><button class="cyan" id="v089GateTest">◉ &nbsp; Testar Conexão</button></div></div><div class="v089-gate-grid"><article><i>⌂</i><span><b>Loja / Filial</b><small>${esc(c.branch)}</small></span><em>›</em></article><article class="cyan"><i>▣</i><span><b>PDV</b><small>${esc(c.pos)}</small></span><em>›</em></article><article><i>▧</i><span><b>Impressora</b><small>${esc(settings.printerName||state.status?.printer||'Não configurada')}</small></span><em>›</em></article><article class="cyan"><i>☁</i><span><b>Conexão / Sincronização</b><small>Modo: <strong class="${state.status?.online?'ok':'warn'}">${state.status?.online?'Online':'Offline'}</strong></small></span><em>›</em></article><article><i>▤</i><span><b>Servidor / URL</b><small>Status: <strong class="${state.status?.online?'ok':'warn'}">${state.status?.online?'Conectado':'Offline'}</strong></small></span><em>›</em></article><article class="cyan"><i>▥</i><span><b>Fiscal</b><small>Configuração sincronizada</small></span><em>›</em></article><article><i>▰</i><span><b>Meios de Pagamento</b><small>${methods.length?`${methods.length} forma(s) ativa(s)`:'Sincronizar configuração'}</small></span><em>›</em></article><article class="cyan"><i>•••</i><span><b>Outros</b><small>ThorPDV v${esc(state.status?.appVersion||'—')}</small></span><em>›</em></article></div><div class="v089-gate-ready ${state.status?.online?'online':'offline'}"><span>${state.status?.online?'✓ Terminal configurado e pronto para uso':'○ Operação offline disponível'}</span><small>Versão ${esc(state.status?.appVersion||'—')} &nbsp; | &nbsp; ${state.status?.lastSyncAt?`Atualizado ${new Date(state.status.lastSyncAt).toLocaleString('pt-BR')}`:'Ainda não sincronizado'}</small></div>`;
    config.querySelector('#v089GateSettings').onclick=()=>settingsModal();config.querySelector('#v089GateTest').onclick=async(e)=>{const b=e.currentTarget,original=b.innerHTML;try{b.disabled=true;b.textContent='Testando...';await window.thor.sync();state.status=await window.thor.status();b.textContent=state.status?.online?'✓ Conexão OK':'Sem conexão';}catch{b.textContent='Falha na conexão';}finally{setTimeout(()=>{if(b.isConnected){b.disabled=false;b.innerHTML=original;}},1300);}};
  }

  function apply(){
    patchPayment();
    if(state.status?.enrolled){ensureHeader();if(state.view==='sale'){ensureActionBar();ensureLayout();updateSummary();}else document.body.classList.add('thor-v089');}
    rebuildGate();
    document.querySelectorAll('.modal').forEach(m=>{if(m.querySelector('.payment-head'))decoratePayment();});
  }

  document.addEventListener('keydown',(e)=>{
    if(state.capturingShortcut||document.getElementById('thorOperatorGate')||document.querySelector('.modal'))return;
    const key=String(e.key||'').toUpperCase();if(state.view!=='sale')return;
    if(key==='F2'){e.preventDefault();e.stopImmediatePropagation();openActions();}
    else if(key==='F3'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('finalize')?.click();}
    else if(key==='F4'){e.preventDefault();e.stopImmediatePropagation();settingsModal();}
    else if(key==='F5'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('paymentsButton')?.click();}
    else if(key==='F6'){e.preventDefault();e.stopImmediatePropagation();openDiscount();}
    else if(key==='F7'){e.preventDefault();e.stopImmediatePropagation();openSurcharge();}
  },true);

  const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});schedule();
})();
