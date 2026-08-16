(function(){
  function text(v){return String(v??'').trim();}
  function digits(v){return String(v??'').replace(/\D/g,'');}
  function rules(){
    const fromStatus=state.status?.salesSessionRules;
    const fromContext=state.status?.context?.pdv_parameters?.sales_session;
    const r=(fromStatus&&typeof fromStatus==='object'?fromStatus:fromContext)||{};
    return {
      requireSeller:Boolean(r.require_seller),
      requireCustomer:Boolean(r.require_customer),
      customerMode:['default','fixed'].includes(text(r.customer_mode))?text(r.customer_mode):'free',
      defaultCustomer:r.default_customer&&typeof r.default_customer==='object'?r.default_customer:null,
    };
  }
  function saleState(){
    const v=v3State();
    if(typeof v.sellerUserId==='undefined')v.sellerUserId=null;
    if(typeof v.sellerName==='undefined')v.sellerName='';
    return v;
  }
  function setCustomer(customer){
    const v=saleState();
    v.customerId=customer?.id||null;
    v.customerName=customer?.name||'';
    v.customerEmail=customer?.email||'';
    v.customerPhone=customer?.phone||'';
    const doc=digits(customer?.document||'');
    v.consumerDocument=doc;
    const legacy=document.getElementById('consumerDocument');
    if(legacy)legacy.value=doc;
  }
  function applyConfiguredCustomer(){
    const r=rules(),v=saleState(),customer=r.defaultCustomer;
    if(!customer?.id)return;
    if(r.customerMode==='fixed')setCustomer(customer);
    else if(r.customerMode==='default'&&!v.customerId&&!digits(v.consumerDocument))setCustomer(customer);
  }
  function currentSeller(){const v=saleState();return {id:text(v.sellerUserId),name:text(v.sellerName)};}
  function setSeller(row){const v=saleState();v.sellerUserId=row?.id||null;v.sellerName=row?.name||'';patchSaleHeader();}

  async function openSeller(){
    let sellers=[];
    try{sellers=(await window.thor.operators()).filter(row=>row&&row.active!==false);}catch{}
    const selected=currentSeller();
    const m=modal(`<div class="v107-seller-head"><div><small>RESPONSÁVEL COMERCIAL</small><h3>Informar vendedor da venda</h3><p>O vendedor é independente do operador que está usando o caixa.</p></div><span>VENDA</span></div><div class="v107-seller-search"><span>⌕</span><input id="v107SellerSearch" placeholder="Buscar vendedor pelo nome"></div><div id="v107SellerList" class="v107-seller-list"></div><div class="actions"><button class="secondary" id="v107SellerClear">Remover vendedor</button><button class="secondary" id="v107SellerClose">Fechar</button></div>`,'wide');
    const input=m.querySelector('#v107SellerSearch'),list=m.querySelector('#v107SellerList');
    const paint=()=>{
      const q=text(input.value).toLowerCase();
      const rows=sellers.filter(row=>!q||text(row.name).toLowerCase().includes(q));
      list.innerHTML=rows.length?rows.map((row,i)=>`<button type="button" data-v107-seller="${i}" class="${text(row.id)===selected.id?'selected':''}"><span class="v107-seller-avatar">${esc(text(row.name).charAt(0).toUpperCase()||'V')}</span><span><b>${esc(row.name||'Vendedor')}</b><small>${esc(row.profile_name||'Usuário PDV')}${row.commission_percent!=null?` · Comissão ${Number(row.commission_percent||0).toLocaleString('pt-BR')}%`:''}</small></span><em>${text(row.id)===selected.id?'Selecionado':'Selecionar'}</em></button>`).join(''):'<div class="v107-seller-empty">Nenhum vendedor encontrado.</div>';
      list.querySelectorAll('[data-v107-seller]').forEach(button=>button.onclick=()=>{const row=rows[Number(button.dataset.v107Seller)];if(!row)return;setSeller(row);m.remove();showToast(`Vendedor ${row.name} informado na venda.`);});
    };
    input.oninput=paint;
    m.querySelector('#v107SellerClear').onclick=()=>{setSeller(null);m.remove();showToast('Vendedor removido da venda.');};
    m.querySelector('#v107SellerClose').onclick=()=>m.remove();
    paint();input.focus();
  }

  function patchSaleHeader(){
    if(state.view!=='sale')return;
    applyConfiguredCustomer();
    const v=saleState(),r=rules();
    const seller=document.getElementById('v089Seller');
    if(seller){
      seller.onclick=openSeller;
      seller.classList.toggle('v107-required',r.requireSeller&&!v.sellerUserId);
      seller.classList.toggle('v107-selected',Boolean(v.sellerUserId));
      const label=seller.querySelector('small');if(label)label.textContent=v.sellerName||'Informar';
      seller.title='Informar vendedor da venda (não altera o operador do caixa)';
    }
    const customer=document.getElementById('v089Customer');
    const legacy=document.getElementById('v47ConsumerAction');
    if(r.customerMode==='fixed'&&r.defaultCustomer?.id){
      const fixedName=text(r.defaultCustomer.name)||'Cliente fixo';
      if(customer){customer.classList.add('v107-fixed');customer.onclick=()=>infoModal('Cliente fixo',`Esta filial está configurada para usar o cliente fixo ${fixedName}. Para alterar, acesse Thor Gestão → Opções de Vendas → Sessão.`);const label=customer.querySelector('small');if(label)label.textContent=fixedName;}
      if(legacy){legacy.onclick=()=>infoModal('Cliente fixo',`O cliente ${fixedName} está fixado pelas regras da sessão no Thor Gestão.`);legacy.classList.add('v107-fixed');}
    }else{
      customer?.classList.remove('v107-fixed');legacy?.classList.remove('v107-fixed');
    }
    if(r.requireCustomer&&!v.customerId)customer?.classList.add('v107-required');else customer?.classList.remove('v107-required');
  }

  function validateRules(){
    applyConfiguredCustomer();
    const r=rules(),v=saleState();
    if(r.requireSeller&&!v.sellerUserId){infoModal('Vendedor obrigatório','Informe o vendedor responsável pela venda antes de continuar.');setTimeout(()=>openSeller(),80);return false;}
    if(r.requireCustomer&&!v.customerId){infoModal('Cliente obrigatório','Esta filial exige um cliente cadastrado no Gestão antes de concluir a venda.');return false;}
    if(r.customerMode==='fixed'&&!r.defaultCustomer?.id){infoModal('Cliente fixo','A regra de cliente fixo está ativa, mas nenhum cliente válido foi configurado no Thor Gestão.');return false;}
    return true;
  }

  const previousRenderSale=renderSaleWorkspace;
  renderSaleWorkspace=function(){const result=previousRenderSale();applyConfiguredCustomer();queueMicrotask(patchSaleHeader);return result;};

  const previousRenderCart=v3RenderCart;
  v3RenderCart=function(){const result=previousRenderCart();queueMicrotask(patchSaleHeader);return result;};
  renderCart=v3RenderCart;

  const previousReset=v3ResetSale;
  v3ResetSale=function(){const result=previousReset();const v=saleState();v.sellerUserId=null;v.sellerName='';applyConfiguredCustomer();return result;};

  const previousFinalize=finalize;
  finalize=function(){if(!validateRules())return;return previousFinalize.apply(this,arguments);};

  const previousComplete=v3CompleteCheckout;
  v3CompleteCheckout=async function(){
    if(!validateRules())return;
    const v=saleState();
    try{
      await window.thor.setCommercialContext({salesSessionContext:true,sellerUserId:v.sellerUserId||null,sellerName:v.sellerName||null,customerId:v.customerId||null,customerName:v.customerName||null});
    }catch(error){return infoModal('Sessão da venda',friendlyError(error?.message));}
    return previousComplete.apply(this,arguments);
  };

  window.addEventListener('keydown',event=>{
    if(event.key!=='F9'||state.view!=='sale'||document.querySelector('.modal'))return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openSeller();
  },true);

  const observer=new MutationObserver(()=>{if(document.getElementById('v089Seller'))queueMicrotask(patchSaleHeader);});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  queueMicrotask(patchSaleHeader);
})();
