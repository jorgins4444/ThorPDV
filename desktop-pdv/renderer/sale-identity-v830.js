(()=>{
  const value=(v)=>String(v??'').trim();
  const currentOperator=()=>v3State()?.operator||state.status?.operator||null;
  const sellerRows=()=>Array.isArray(v3State()?.operators)?v3State().operators:[];

  function validSeller(id){return sellerRows().some(row=>value(row.id)===value(id));}
  async function normalizeSeller(forceOperator=false){
    const v=v3State();
    const operator=currentOperator();
    let configured=value(v.saleSellerUserId)||value(state.settings?.saleSellerUserId)||value(state.status?.settings?.saleSellerUserId);
    if(forceOperator||!validSeller(configured))configured=value(operator?.id);
    v.saleSellerUserId=configured;
    if(configured&&value(state.settings?.saleSellerUserId)!==configured){
      state.settings={...(state.settings||{}),saleSellerUserId:configured};
      if(state.status?.settings)state.status.settings={...state.status.settings,saleSellerUserId:configured};
      try{await window.thor.saveSettings({saleSellerUserId:configured});}catch{}
    }
    return configured;
  }

  function ensureStyles(){
    if(document.getElementById('saleIdentityV830Style'))return;
    const style=document.createElement('style');
    style.id='saleIdentityV830Style';
    style.textContent=`
      .sale-identity-v830{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:10px;align-items:end;margin:4px 0 8px}
      .sale-identity-v830 .operator-readonly{min-height:42px;border:1px solid var(--line,#dfe5e2);border-radius:10px;padding:7px 10px;background:rgba(15,23,42,.035);display:flex;flex-direction:column;justify-content:center}
      .sale-identity-v830 small,.sale-identity-v830 label>span{font-size:10px;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
      .sale-identity-v830 strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sale-identity-v830 label{display:flex;flex-direction:column;gap:4px;min-width:0}
      .sale-identity-v830 select{width:100%;min-height:42px}
      @media(max-width:1180px){.sale-identity-v830{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function patchWorkspace(){
    ensureStyles();
    const meta=document.querySelector('.checkout-meta');
    if(!meta||meta.querySelector('.sale-identity-v830'))return;
    const v=v3State();
    const operator=currentOperator();
    const selected=value(v.saleSellerUserId)||value(operator?.id);
    const rows=sellerRows();
    const holder=document.createElement('div');
    holder.className='sale-identity-v830';
    holder.innerHTML=`<div class="operator-readonly"><small>Operador da venda</small><strong>${esc(operator?.name||'Não identificado')}</strong></div><label><span>Vendedor da venda</span><select id="saleSellerV830">${rows.map(row=>`<option value="${esc(row.id)}" ${value(row.id)===selected?'selected':''}>${esc(row.name)}${row.profile_name?` — ${esc(row.profile_name)}`:''}</option>`).join('')}</select></label>`;
    const firstAdjustment=meta.querySelector('.adjustment-grid');
    meta.insertBefore(holder,firstAdjustment||null);
    const select=holder.querySelector('#saleSellerV830');
    if(select){
      if(!select.value&&operator?.id)select.value=value(operator.id);
      select.onchange=async()=>{
        v.saleSellerUserId=value(select.value)||value(operator?.id);
        state.settings={...(state.settings||{}),saleSellerUserId:v.saleSellerUserId};
        if(state.status?.settings)state.status.settings={...state.status.settings,saleSellerUserId:v.saleSellerUserId};
        try{await window.thor.saveSettings({saleSellerUserId:v.saleSellerUserId});showToast(`Vendedor: ${rows.find(row=>value(row.id)===v.saleSellerUserId)?.name||'selecionado'}.`);}catch(e){infoModal('Vendedor',friendlyError(e?.message));}
      };
    }
  }

  if(typeof v3Hydrate==='function'){
    const previousHydrate=v3Hydrate;
    v3Hydrate=async function(){
      const previousOperator=value(v3State()?.operator?.id);
      const result=await previousHydrate();
      const operatorChanged=Boolean(previousOperator&&previousOperator!==value(currentOperator()?.id));
      await normalizeSeller(operatorChanged);
      return result;
    };
  }

  if(typeof renderSaleWorkspace==='function'){
    const previousRender=renderSaleWorkspace;
    renderSaleWorkspace=function(){
      const result=previousRender.apply(this,arguments);
      queueMicrotask(()=>{void normalizeSeller(false).then(patchWorkspace);});
      setTimeout(patchWorkspace,20);
      return result;
    };
  }

  const oldFriendly=typeof friendlyError==='function'?friendlyError:null;
  if(oldFriendly){
    friendlyError=function(code){
      const map={
        sale_number_pending_sync:'A venda foi concluída, mas o número sequencial ainda não chegou do servidor. Sincronize o caixa e reimprima; o Thor não imprimirá UUID no lugar do número da venda.',
        sale_sync_rejected:'A venda não foi aceita na sincronização. Verifique a pendência antes de imprimir o comprovante.',
        invalid_seller:'O vendedor selecionado não está ativo ou não pertence a este PDV/filial.'
      };
      return map[code]||oldFriendly(code);
    };
  }

  const observer=new MutationObserver(()=>{if(state?.view==='sale')patchWorkspace();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(()=>{void normalizeSeller(false).then(patchWorkspace);},100);
})();
