(()=>{
  'use strict';
  let suspending=false;

  function cartTotal(){
    try{return state.cart.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unitPrice??item.unit_price??0),0);}catch{return 0;}
  }
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function productSearch(){
    return document.getElementById('search')||[...document.querySelectorAll('input')].find(input=>{
      const p=String(input.getAttribute('placeholder')||'').toLocaleLowerCase('pt-BR');
      return p.includes('buscar produto')||(p.includes('produto')&&(p.includes('ean')||p.includes('código')||p.includes('codigo')));
    })||null;
  }
  function focusProductSearch(select=false){
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const search=productSearch();
      if(!search||search.disabled||search.readOnly)return;
      try{search.focus({preventScroll:true});}catch{try{search.focus();}catch{}}
      if(select)try{search.select();}catch{}
    }));
  }

  async function saveSuspended(){
    if(suspending)return;
    suspending=true;
    try{
      const v=typeof v3State==='function'?v3State():{};
      const items=Array.isArray(state?.cart)?state.cart.map(item=>({...item})):[];
      if(!items.length)return;
      const result=await window.thor.saveDraftSale({
        items,
        customerId:v.customerId||null,
        customerName:v.customerName||'',
        consumerDocument:v.consumerDocument||'',
        discount:Number(v.discount||0),
        surcharge:Number(v.surcharge||0),
        notes:v.notes||''
      });
      state.cart=[];
      try{if(typeof v3ResetSale==='function')v3ResetSale();}catch{}
      try{if(typeof renderSaleWorkspace==='function')renderSaleWorkspace();else if(typeof renderWorkspace==='function')renderWorkspace();}catch{}
      try{queueMicrotask(()=>{if(typeof v3RenderCart==='function')v3RenderCart();});}catch{}
      focusProductSearch(false);
      try{if(typeof showToast==='function')showToast(`Operação ${result.number} suspensa. Recupere em Central operacional → Operações.`);}catch{}
    }catch(err){
      try{if(typeof infoModal==='function')infoModal('Operação',typeof friendlyError==='function'?friendlyError(err?.message||String(err)):(err?.message||String(err)));else alert(err?.message||String(err));}catch{}
      focusProductSearch(false);
    }finally{suspending=false;}
  }

  function renameOperationsOnce(){
    document.querySelectorAll('[data-oc120-center]').forEach(btn=>{
      const b=btn.querySelector('b'),sm=btn.querySelector('small');
      if(b&&b.textContent!=='Central operacional')b.textContent='Central operacional';
      if(sm&&sm.textContent!=='2ª via, pendências e operações')sm.textContent='2ª via, pendências e operações';
    });
    document.querySelectorAll('.oc120-modal').forEach(modal=>{
      const head=modal.querySelector('.oc120-head h3');
      if(head&&head.textContent!=='Histórico, contingência e operações')head.textContent='Histórico, contingência e operações';
      const tab=modal.querySelector('[data-tab="drafts"]');
      if(tab&&tab.textContent!=='Operações')tab.textContent='Operações';
      modal.querySelectorAll('.oc120-list.drafts article small').forEach(el=>{
        const next=(el.textContent||'').replace(/PRÉ-VENDA/gi,'OPERAÇÃO SUSPENSA');
        if(el.textContent!==next)el.textContent=next;
      });
      modal.querySelectorAll('.oc120-empty').forEach(el=>{
        if(/pré-venda/i.test(el.textContent||''))el.textContent='Nenhuma operação suspensa em aberto.';
      });
    });
  }

  function scheduleRename(){
    setTimeout(renameOperationsOnce,0);
    setTimeout(renameOperationsOnce,80);
    setTimeout(renameOperationsOnce,250);
  }

  document.addEventListener('click',e=>{
    if(e.target?.closest?.('[data-oc120-center], [data-tab="drafts"]'))scheduleRename();
  },false);

  document.addEventListener('keydown',async e=>{
    if(e.key!=='Escape'||suspending)return;
    if(document.querySelector('.modal,.thorcg-modal,.oc120-modal'))return;
    try{
      if(state?.view!=='sale'||state?.busy||!Array.isArray(state?.cart)||!state.cart.length)return;
    }catch{return;}
    e.preventDefault();
    e.stopImmediatePropagation();
    const ok=window.confirm(`Suspender operação de venda?\n\n${state.cart.length} item(ns) • ${money(cartTotal())}\n\nOs produtos serão salvos em Central operacional → Operações.`);
    if(!ok){focusProductSearch(false);return;}
    await saveSuspended();
  },true);

  window.openSuspendedOperationsV097=()=>{
    window.openOperationsCenterV120?.('drafts');
    scheduleRename();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renameOperationsOnce,{once:true});
  else renameOperationsOnce();
})();
