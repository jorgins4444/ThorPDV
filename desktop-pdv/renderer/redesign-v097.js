(()=>{
  const icons={
    cash:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M17 14h.01M9.5 12h5"/></svg>',
    pix:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 17 8 12 13 7 8 12 3Z"/><path d="m12 11 5 5-5 5-5-5 5-5Z"/></svg>',
    debit_card:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
    credit_card:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M15 14h3"/></svg>',
    voucher:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    benefit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    beneficio:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    store_credit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v10H5z"/><path d="M8 10h8M8 14h4"/></svg>',
    cashback:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a7 7 0 1 1-1 7"/><path d="M4 4v5h5"/><path d="M12 8v8M9.5 10.5c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.5-2.5 1.5-2.5.5-2.5 1.5S10.5 15 12 15s2.5-.5 2.5-1.5"/></svg>',
    boleto:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M8 4v16M12 4v16M15 4v16M19 4v16"/></svg>',
    installment:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    parcelamento:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    term:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    on_account:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    other:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>',
    others:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>'
  };
  const fallback=icons.other;
  function enforce(){
    document.querySelectorAll('.modal').forEach(overlay=>{
      const head=overlay.querySelector('.payment-head');
      if(!head)return;
      overlay.classList.add('v089-payment-modal');
      const card=overlay.querySelector('.modal-card');
      if(!card)return;
      card.classList.add('v089-payment-card','v090-payment-card');
      overlay.style.setProperty('display','flex','important');
      overlay.style.setProperty('align-items','center','important');
      overlay.style.setProperty('justify-content','center','important');
      overlay.style.setProperty('padding','12px 18px','important');
      overlay.style.setProperty('overflow','hidden','important');
      card.style.setProperty('width','min(920px, calc(100vw - 36px))','important');
      card.style.setProperty('min-width','min(760px, calc(100vw - 36px))','important');
      card.style.setProperty('max-width','920px','important');
      card.style.setProperty('height','min(700px, calc(100vh - 24px))','important');
      card.style.setProperty('max-height','calc(100vh - 24px)','important');
      card.style.setProperty('overflow','hidden','important');
      card.style.setProperty('transform','none','important');
      card.style.setProperty('margin','0','important');
      card.querySelectorAll('.v089-pay-methods [data-method]').forEach(button=>{
        const code=String(button.dataset.method||'').trim();
        const icon=button.querySelector('i');
        if(icon&&icon.dataset.v097Icon!=='1'){
          icon.dataset.v097Icon='1';
          icon.innerHTML=icons[code]||fallback;
        }
      });
    });
  }
  const observer=new MutationObserver(enforce);
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',enforce);
  enforce();
})();
