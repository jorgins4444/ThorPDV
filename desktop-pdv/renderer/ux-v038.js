function uxFooterKey(key,label,payment=false){
  if(!key) return '';
  return `<span class="footer-key${payment?' payment':''}"><kbd>${esc(key)}</kbd><span>${esc(label)}</span></span>`;
}

function uxEnhanceFooter(){
  const help=document.getElementById('hotkeyHelp');
  const foot=document.getElementById('footerSync');
  if(help){
    if(state.view==='sale'){
      const fixed=[['F2','Finalizar'],['F3','Fiscal'],['F4','Caixa'],['F6','Sincronizar'],['F12','Configurações']];
      const payments=Object.entries(state.settings?.shortcuts||{}).filter(([,key])=>key).map(([method,key])=>[String(key),paymentLabels[method]||method]);
      help.innerHTML=[...fixed.map(([key,label])=>uxFooterKey(key,label)),...payments.map(([key,label])=>uxFooterKey(key,label,true))].join('');
    }else{
      help.innerHTML=[uxFooterKey('F3','Voltar para venda'),uxFooterKey('F6','Atualizar'),uxFooterKey('F12','Configurações')].join('');
    }
  }
  if(foot){
    const last=state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'ainda não sincronizado';
    foot.innerHTML=`<strong>Sync automático: a cada 5 min</strong><span>Último sync: ${esc(last)}</span>`;
  }
}

const uxOriginalUpdateTop=updateTop;
updateTop=function(){
  uxOriginalUpdateTop();
  uxEnhanceFooter();
};

const uxOriginalPaymentModal=v3PaymentModal;
v3PaymentModal=function(initialMethod='cash'){
  const result=uxOriginalPaymentModal(initialMethod);
  queueMicrotask(()=>{
    const add=document.querySelector('.modal #addPayment');
    if(add){
      add.innerHTML='Adicionar pagamento <kbd>Enter</kbd>';
      add.title='Pressione Enter para adicionar a forma de pagamento';
    }
  });
  return result;
};

document.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey) return;
  const modal=document.querySelector('.modal');
  if(!modal) return;
  const add=modal.querySelector('#addPayment');
  if(!add) return;
  if(event.target?.closest?.('#finishCheckout,#payBack,#integratedPay,[data-method],[data-pay-remove]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(typeof v3Remaining==='function'&&v3Remaining()<=0.01){
    modal.querySelector('#finishCheckout')?.click();
    return;
  }
  add.click();
},true);

queueMicrotask(uxEnhanceFooter);
