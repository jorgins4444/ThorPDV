(()=>{
  let patched=false;

  function decorateCheckout(){
    const overlays=[...document.querySelectorAll('.modal')].filter(m=>m.querySelector('.payment-head'));
    const overlay=overlays.at(-1);
    if(!overlay)return false;
    const card=overlay.querySelector('.modal-card');
    if(!card)return false;

    overlay.classList.add('v099-checkout');
    card.classList.add('v099-checkout-card');

    const top=card.querySelector('.v089-payment-top');
    const customer=card.querySelector('.v089-payment-customer');
    if(top&&customer&&top.dataset.v099Ready!=='1'){
      top.dataset.v099Ready='1';
      top.replaceChildren(customer);
      customer.classList.add('v099-customer-top');
      const label=customer.querySelector(':scope > label');
      if(label)label.textContent='Cliente';
    }

    const right=card.querySelector('.v089-payment-right');
    const kpis=right?.querySelector('.v089-pay-kpis');
    const lines=right?.querySelector('.v089-pay-lines');
    if(right&&kpis&&lines){
      right.classList.add('v099-payment-summary');
      kpis.classList.add('v099-main-kpis');
      lines.classList.add('v099-adjustment-kpis');
      [...lines.querySelectorAll(':scope > span')].forEach(row=>{
        const txt=(row.textContent||'').trim().toLowerCase();
        row.classList.toggle('discount',txt.startsWith('desconto'));
        row.classList.toggle('cashback',txt.startsWith('cashback'));
        row.classList.toggle('surcharge',txt.startsWith('acréscimo')||txt.startsWith('acrescimo'));
      });
    }

    const footer=card.querySelector('.v089-payment-footer,.v090-payment-footer,.payment-footer');
    if(footer){
      footer.classList.add('v099-payment-footer');
      const back=footer.querySelector('#payBack');
      if(back)back.remove();
      const actions=footer.querySelector('.actions');
      if(actions)actions.classList.add('v099-finish-actions');
      const finish=footer.querySelector('#finishCheckout');
      if(finish){
        finish.classList.add('v099-finish-checkout');
        finish.textContent='Concluir Venda';
      }
    }
    return true;
  }

  function schedule(){
    if(patched)return;
    let tries=0;
    const tick=()=>{
      tries++;
      if(decorateCheckout()){patched=true;return;}
      if(tries<8)setTimeout(tick,45);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      patched=false;
      const result=previous.apply(this,args);
      schedule();
      return result;
    };
  }
})();
