(()=>{
  'use strict';
  let confirmOpen=false;
  const resumedKey='thor.v097.resumedDraftId';

  function installStyle(){
    if(document.getElementById('thorSuspendV097Style'))return;
    const s=document.createElement('style');s.id='thorSuspendV097Style';s.textContent=`
      .thor-suspend-overlay{position:fixed;z-index:2147483600;inset:0;background:rgba(12,9,27,.62);display:grid;place-items:center;padding:24px;backdrop-filter:blur(2px)}
      .thor-suspend-card{width:min(470px,94vw);background:#fff;border-radius:18px;box-shadow:0 28px 90px rgba(0,0,0,.38);overflow:hidden;color:#232936}
      .thor-suspend-head{padding:22px 24px 16px;background:linear-gradient(135deg,#6336d8,#8157e6);color:#fff}.thor-suspend-head small{font-size:11px;font-weight:900;letter-spacing:.08em}.thor-suspend-head h3{margin:5px 0 0;font-size:23px}
      .thor-suspend-body{padding:20px 24px}.thor-suspend-body p{margin:0 0 10px;line-height:1.5}.thor-suspend-summary{padding:12px 14px;border-radius:11px;background:#f5f2fd;color:#5c42a3;font-weight:800}
      .thor-suspend-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 24px 22px}.thor-suspend-actions button{height:42px;border-radius:10px;padding:0 18px;font-weight:800;cursor:pointer}.thor-suspend-no{background:#fff;border:1px solid #d9dfdc;color:#4c5560}.thor-suspend-yes{border:0;background:#6336d8;color:#fff}.thor-suspend-yes:disabled{opacity:.6;cursor:wait}
    `;document.head.appendChild(s);
  }

  function cartTotal(){
    try{return state.cart.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unitPrice??item.unit_price??0),0);}catch{return 0;}
  }
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function currentDraftId(){try{return sessionStorage.getItem(resumedKey)||'';}catch{return '';}}
  function clearDraftId(){try{sessionStorage.removeItem(resumedKey);}catch{}}

  async function saveSuspended(){
    const v=typeof v3State==='function'?v3State():{};
    const payload={
      id:currentDraftId()||undefined,
      items:Array.isArray(state?.cart)?state.cart:[],
      customerId:v.customerId||null,
      customerName:v.customerName||'',
      consumerDocument:v.consumerDocument||'',
      discount:Number(v.discount||0),
      surcharge:Number(v.surcharge||0),
      notes:v.notes||''
    };
    const result=await window.thor.saveDraftSale(payload);
    state.cart=[];
    clearDraftId();
    try{if(typeof v3ResetSale==='function')v3ResetSale();}catch{}
    try{if(typeof renderSaleWorkspace==='function')renderSaleWorkspace();else if(typeof renderWorkspace==='function')renderWorkspace();}catch{}
    try{queueMicrotask(()=>{if(typeof v3RenderCart==='function')v3RenderCart();});}catch{}
    try{if(typeof showToast==='function')showToast(`Operação suspensa como ${result.number}. Recupere em Central operacional → Operações.`);}catch{}
    return result;
  }

  function closeConfirm(){document.getElementById('thorSuspendV097')?.remove();confirmOpen=false;}
  function askSuspend(){
    if(confirmOpen||!Array.isArray(state?.cart)||!state.cart.length)return;
    installStyle();confirmOpen=true;
    const wrap=document.createElement('div');wrap.id='thorSuspendV097';wrap.className='thor-suspend-overlay';
    wrap.innerHTML=`<section class="thor-suspend-card"><header class="thor-suspend-head"><small>THORPDV • ESC</small><h3>Suspender operação de venda?</h3></header><div class="thor-suspend-body"><p>Os produtos lançados serão salvos e o caixa ficará livre para iniciar outro atendimento.</p><div class="thor-suspend-summary">${state.cart.length} item(ns) • ${money(cartTotal())}</div></div><div class="thor-suspend-actions"><button type="button" class="thor-suspend-no">Não, continuar</button><button type="button" class="thor-suspend-yes">Sim, suspender</button></div></section>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.thor-suspend-no').onclick=closeConfirm;
    wrap.addEventListener('mousedown',e=>{if(e.target===wrap)closeConfirm();});
    wrap.querySelector('.thor-suspend-yes').onclick=async e=>{const b=e.currentTarget;try{b.disabled=true;b.textContent='Salvando...';await saveSuspended();closeConfirm();}catch(err){b.disabled=false;b.textContent='Sim, suspender';try{if(typeof infoModal==='function')infoModal('Operação',typeof friendlyError==='function'?friendlyError(err?.message||String(err)):(err?.message||String(err)));else alert(err?.message||String(err));}catch{}}};
  }

  function renameOperations(){
    document.querySelectorAll('[data-oc120-center]').forEach(btn=>{const b=btn.querySelector('b'),sm=btn.querySelector('small');if(b)b.textContent='Central operacional';if(sm)sm.textContent='2ª via, pendências e operações';});
    document.querySelectorAll('.oc120-modal').forEach(modal=>{
      const head=modal.querySelector('.oc120-head h3');if(head)head.textContent='Histórico, contingência e operações';
      const tab=modal.querySelector('[data-tab="drafts"]');if(tab)tab.textContent='Operações';
      modal.querySelectorAll('.oc120-list.drafts article small').forEach(el=>{el.textContent=el.textContent.replace(/PRÉ-VENDA/gi,'OPERAÇÃO SUSPENSA');});
      modal.querySelectorAll('.oc120-empty').forEach(el=>{if(/pré-venda/i.test(el.textContent||''))el.textContent='Nenhuma operação suspensa em aberto.';});
    });
  }

  document.addEventListener('click',e=>{
    const load=e.target.closest?.('[data-load-draft]');if(load){try{sessionStorage.setItem(resumedKey,String(load.dataset.loadDraft||''));}catch{}}
    const del=e.target.closest?.('[data-delete-draft]');if(del&&String(del.dataset.deleteDraft||'')===currentDraftId())clearDraftId();
  },true);

  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(document.getElementById('thorSuspendV097')){e.preventDefault();e.stopImmediatePropagation();closeConfirm();return;}
    if(document.querySelector('.modal,.thorcg-modal,.oc120-modal'))return;
    try{
      if(state?.view!=='sale'||state?.busy||!Array.isArray(state?.cart)||!state.cart.length)return;
    }catch{return;}
    e.preventDefault();e.stopImmediatePropagation();askSuspend();
  },true);

  window.openSuspendedOperationsV097=()=>window.openOperationsCenterV120?.('drafts');
  const observer=new MutationObserver(renameOperations);observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renameOperations,{once:true});else renameOperations();
})();
