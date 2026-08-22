(()=>{
  'use strict';
  if(window.__thorPaymentIconsV0912)return;
  window.__thorPaymentIconsV0912=true;

  const ICONS={
    cash:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M17 6.5c0-1.7-2-3-5-3s-5 1.3-5 3 1.4 2.6 5 3.5 5 1.1 5 2.2 5 3.8 0 1.8-2 3.2-5 3.2s-5-1.4-5-3.2"/></svg>`,
    credit_card:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.8"/><path d="M2.5 9h19M6 15h4"/></svg>`,
    debit_card:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.8"/><path d="M2.5 9h19M6 15h3M12 15h2"/></svg>`,
    pix:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5 12 7l3.5-3.5a3 3 0 0 1 4.2 4.2L16.2 11l3.5 3.3a3 3 0 1 1-4.2 4.2L12 15l-3.5 3.5a3 3 0 0 1-4.2-4.2L7.8 11 4.3 7.7a3 3 0 1 1 4.2-4.2Z"/></svg>`,
    boleto:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h9l3 3V21.5H6Z"/><path d="M15 2.5v4h4M8.5 10v7M11 10v7M14 10v7M16.5 10v7"/></svg>`,
    store_credit:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h16v11H4zM12 9.5v11M4 13h16"/><path d="M8 9.5C6.2 8.7 5.3 7.5 5.8 6.4 6.3 5.2 8 5.4 9.3 6.6L12 9.5M16 9.5c1.8-.8 2.7-2 2.2-3.1-.5-1.2-2.2-1-3.5.2L12 9.5"/></svg>`,
    voucher:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h16v11H4zM12 9.5v11M4 13h16"/><path d="M8 9.5C6.2 8.7 5.3 7.5 5.8 6.4 6.3 5.2 8 5.4 9.3 6.6L12 9.5M16 9.5c1.8-.8 2.7-2 2.2-3.1-.5-1.2-2.2-1-3.5.2L12 9.5"/></svg>`,
    cashback:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15.5c3.5-2.6 6.2-3 8.2-1.2l1 1c1 1 2.2.6 2.5-.2.2-.7-.2-1.4-1-1.9l-2.5-1.5"/><path d="m3 15.5 4.5 4h5.7c1.7 0 3.2-.6 4.3-1.8L21 14.2c.9-.9.8-2.1 0-2.8-.7-.7-1.8-.7-2.6 0l-2.1 2.1"/><path d="M12 3v7M15 5.2c0-1.2-1.3-2-3-2s-3 .8-3 2 1 1.7 3 2.2 3 1 3 2.1-1.3 2-3 2-3-.8-3-2"/></svg>`,
    installment:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 3V2h6v1M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>`,
    parcelamento:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 3V2h6v1M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>`,
    other:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>`
  };

  const aliases=[
    ['dinheiro','cash'],['espécie','cash'],['especie','cash'],['crédito','credit_card'],['credito','credit_card'],
    ['débito','debit_card'],['debito','debit_card'],['pix','pix'],['boleto','boleto'],['vale','store_credit'],
    ['voucher','voucher'],['cashback','cashback'],['parcel','installment']
  ];

  function detect(btn){
    const own=(btn.dataset.method||btn.dataset.code||btn.dataset.paymentMethod||'').toLowerCase();
    if(ICONS[own])return own;
    const text=(btn.textContent||'').trim().toLowerCase();
    for(const [needle,key] of aliases)if(text.includes(needle))return key;
    return 'other';
  }

  function decorate(btn){
    if(btn.dataset.thorPaymentIcon==='1')return;
    const key=detect(btn);
    btn.dataset.thorPaymentIcon='1';
    btn.dataset.thorPaymentKind=key;
    const legacy=[...btn.children].find(el=>el.matches?.('i,.v089-pay-icon,.pay-icon,.payment-icon'));
    let icon=btn.querySelector('.thor-pay-icon');
    if(!icon){
      icon=document.createElement('span');
      icon.className='thor-pay-icon';
      if(legacy) legacy.replaceWith(icon); else btn.prepend(icon);
    }
    icon.innerHTML=ICONS[key]||ICONS.other;
  }

  function patch(){
    const roots=document.querySelectorAll('.v089-pay-methods,.payment-methods,[data-payment-methods],.v089-payment-methods');
    roots.forEach(root=>root.querySelectorAll('button').forEach(decorate));
  }

  setInterval(patch,500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',patch,{once:true});else patch();
})();
