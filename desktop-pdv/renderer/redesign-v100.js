(()=>{
  let currentOverlay=null;

  const shortcutValue=(method)=>{
    try{return String(state?.settings?.shortcuts?.[method]||'').trim().toUpperCase();}catch{return '';}
  };

  const normalize=(e)=>{
    try{if(typeof normalizeKey==='function')return String(normalizeKey(e)||'').toUpperCase();}catch{}
    return String(e?.key||'').toUpperCase();
  };

  function decorateShortcuts(){
    const overlays=[...document.querySelectorAll('.modal')].filter(m=>m.querySelector('.payment-head'));
    const overlay=overlays.at(-1);
    if(!overlay)return false;
    currentOverlay=overlay;
    overlay.classList.add('v100-checkout');

    overlay.querySelectorAll('.v089-pay-methods [data-method]').forEach(button=>{
      const method=String(button.dataset.method||'').trim();
      const shortcut=shortcutValue(method);
      let kbd=button.querySelector('.v100-method-shortcut');
      if(!kbd){
        kbd=document.createElement('kbd');
        kbd.className='v100-method-shortcut';
        button.appendChild(kbd);
      }
      kbd.textContent=shortcut||'';
      kbd.hidden=!shortcut;
      if(shortcut)button.title=`Atalho: ${shortcut}`;
    });
    return true;
  }

  function schedule(){
    let tries=0;
    const tick=()=>{
      tries++;
      if(decorateShortcuts())return;
      if(tries<10)setTimeout(tick,40);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      const result=previous.apply(this,args);
      schedule();
      return result;
    };
  }

  // Captura no window antes do listener legado do document. Assim, dentro do
  // checkout, o atalho troca a forma de pagamento em vez de abrir outro modal.
  window.addEventListener('keydown',(e)=>{
    const overlay=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('.payment-head'));
    if(!overlay)return;
    const key=normalize(e);
    if(!key)return;

    const target=e.target;
    const typing=target&&/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName||'');
    if(typing&&!/^F\d{1,2}$/.test(key))return;

    const buttons=[...overlay.querySelectorAll('.v089-pay-methods [data-method]')];
    const match=buttons.find(button=>shortcutValue(String(button.dataset.method||''))===key);
    if(!match)return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    match.click();
    match.focus({preventScroll:true});
  },true);

  window.addEventListener('resize',()=>{if(currentOverlay?.isConnected)requestAnimationFrame(decorateShortcuts);},{passive:true});
})();
