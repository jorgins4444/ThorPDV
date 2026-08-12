(()=>{
  const n=(value)=>{const x=Number(value||0);return Number.isFinite(x)?x:0;};
  const commercial=()=>{const v=v3State();if(!v.commercialV070)v.commercialV070={salesOrderId:null,salesOrderNumber:null,orderPriceLock:false,term:null,preferredPaymentMethod:null};return v.commercialV070;};

  function findCheckout(){
    const overlay=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('.payment-head'));
    if(!overlay)return null;
    const card=overlay.querySelector('.modal-card');
    const finish=card?.querySelector('#finishCheckout');
    if(!card||!finish)return null;
    return {overlay,card,finish};
  }

  function showError(ctx,text){
    let err=ctx.card.querySelector('#payError');
    if(!err){
      err=document.createElement('div');
      err.id='payError';
      err.className='settings-error v102-visible-error';
      ctx.card.querySelector('.payment-entry')?.appendChild(err);
    }
    err.classList.add('v102-visible-error');
    err.hidden=false;
    err.style.setProperty('display','block','important');
    err.style.setProperty('visibility','visible','important');
    err.textContent=text||'';
  }

  function commitPanelIfNeeded(ctx){
    const panel=ctx.card.querySelector('.v101-term-panel:not([hidden])');
    if(!panel)return commercial().term;
    const count=panel.querySelector('#v101TermCount');
    const confirm=panel.querySelector('#v101TermConfirm');
    const selected=Math.trunc(n(count?.value));
    const current=Math.trunc(n(commercial().term?.installments));
    if(selected>0&&confirm&&(!commercial().term||selected!==current||!confirm.disabled)){
      confirm.click();
    }
    return commercial().term;
  }

  function bind(){
    const ctx=findCheckout();
    if(!ctx||ctx.finish.dataset.v102Bound==='1')return false;
    ctx.finish.dataset.v102Bound='1';
    ctx.overlay.classList.add('v102-checkout');

    ctx.finish.addEventListener('click',async(event)=>{
      const remaining=Math.max(n(v3Remaining()),0);
      const panel=ctx.card.querySelector('.v101-term-panel:not([hidden])');
      let term=commercial().term;

      // Checkout à vista continua usando o fluxo legado sem interferência.
      if(!panel&&!term)return;
      if(remaining<=0.01&&!term)return;

      term=commitPanelIfNeeded(ctx);
      if(!term){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'Selecione a quantidade de parcelas e confirme a Venda a Prazo antes de concluir.');
        return;
      }

      const v=v3State();
      if(!v.customerId){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'Venda a Prazo exige um cliente cadastrado no ThorGestão.');
        return;
      }
      if(remaining<=0.01){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'A venda já está integralmente paga. Remova um pagamento à vista para financiar o saldo.');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showError(ctx,'');

      const originalText=ctx.finish.textContent;
      ctx.finish.disabled=true;
      ctx.finish.textContent='Concluindo Venda a Prazo...';
      try{
        // A partir daqui o wrapper commercial-v070 leva a condição para o agente.
        ctx.overlay.remove();
        await v3CompleteCheckout();
      }catch(error){
        // v3CompleteCheckout normalmente já trata e exibe o erro, mas este fallback
        // impede novamente a sensação de clique sem resposta.
        try{infoModal('Finalização',friendlyError(error?.message));}catch{}
      }finally{
        if(ctx.finish.isConnected){
          ctx.finish.disabled=false;
          ctx.finish.textContent=originalText||'Concluir Venda';
        }
      }
    },true);
    return true;
  }

  function schedule(){
    let tries=0;
    const tick=()=>{
      tries++;
      if(bind())return;
      if(tries<20)setTimeout(tick,50);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      const result=previous.apply(this,args);
      schedule();
      // sales-settlement-v073 tornou o modal assíncrono; também ligamos depois
      // da Promise para eliminar a corrida entre renderização e handlers.
      Promise.resolve(result).then(()=>schedule(),()=>schedule());
      return result;
    };
  }

  const observer=new MutationObserver(()=>{
    const ctx=findCheckout();
    if(ctx&&ctx.finish.dataset.v102Bound!=='1')requestAnimationFrame(bind);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();
