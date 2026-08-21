(()=>{
  'use strict';
  let suspending=false;

  function cartTotal(){
    try{return state.cart.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unitPrice??item.unit_price??0),0);}catch{return 0;}
  }
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}

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
      try{if(typeof showToast==='function')showToast(`Operação ${result.number} suspensa. Recupere em Central operacional → Operações.`);}catch{}
    }catch(err){
      try{if(typeof infoModal==='function')infoModal('Operação',typeof friendlyError==='function'?friendlyError(err?.message||String(err)):(err?.message||String(err)));else alert(err?.message||String(err));}catch{}
    }finally{suspending=false;}
  }

  function renameOperations(){
    document.querySelectorAll('[data-oc120-center]').forEach(btn=>{
      const b=btn.querySelector('b'),sm=btn.querySelector('small');
      if(b)b.textContent='Central operacional';
      if(sm)sm.textContent='2ª via, pendências e operações';
    });
    document.querySelectorAll('.oc120-modal').forEach(modal=>{
      const head=modal.querySelector('.oc120-head h3');if(head)head.textContent='Histórico, contingência e operações';
      const tab=modal.querySelector('[data-tab="drafts"]');if(tab)tab.textContent='Operações';
      modal.querySelectorAll('.oc120-list.drafts article small').forEach(el=>{el.textContent=el.textContent.replace(/PRÉ-VENDA/gi,'OPERAÇÃO SUSPENSA');});
      modal.querySelectorAll('.oc120-empty').forEach(el=>{if(/pré-venda/i.test(el.textContent||''))el.textContent='Nenhuma operação suspensa em aberto.';});
    });
  }

  document.addEventListener('keydown',async e=>{
    if(e.key!=='Escape'||suspending)return;
    if(document.querySelector('.modal,.thorcg-modal,.oc120-modal'))return;
    try{
      if(state?.view!=='sale'||state?.busy||!Array.isArray(state?.cart)||!state.cart.length)return;
    }catch{return;}
    e.preventDefault();
    e.stopImmediatePropagation();
    const total=cartTotal();
    const ok=window.confirm(`Suspender operação de venda?\n\n${state.cart.length} item(ns) • ${money(total)}\n\nOs produtos serão salvos em Central operacional → Operações.`);
    if(!ok)return;
    await saveSuspended();
  },true);

  window.openSuspendedOperationsV097=()=>window.openOperationsCenterV120?.('drafts');
  const observer=new MutationObserver(renameOperations);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renameOperations,{once:true});else renameOperations();
})();
