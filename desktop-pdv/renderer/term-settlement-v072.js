(function(){
  const previousPaymentModal=v3PaymentModal;
  v3PaymentModal=function(initialMethod='cash'){
    const result=previousPaymentModal(initialMethod);
    queueMicrotask(()=>{
      const finish=document.getElementById('finishCheckout');
      if(!finish||finish.dataset.termSettlementV072==='1')return;
      finish.dataset.termSettlementV072='1';
      finish.onclick=async()=>{
        const remaining=v3Remaining();
        const commercial=v3State().commercialV070||{};
        const err=finish.closest('.modal')?.querySelector('#payError');
        if(remaining>0.01&&!commercial.term){
          if(err)err.textContent=`Ainda faltam ${money(remaining)}. Para deixar saldo, selecione Venda a Prazo.`;
          return;
        }
        finish.closest('.modal')?.remove();
        await v3CompleteCheckout();
      };
    });
    return result;
  };

  const previousComplete=v3CompleteCheckout;
  v3CompleteCheckout=async function(){
    const commercial=v3State().commercialV070||{};
    const remaining=v3Remaining();
    if(commercial.term&&remaining<=0.01){
      const originalTerm=commercial.term;
      commercial.term=null;
      try{
        const result=await previousComplete();
        showToast('Pedido quitado integralmente. Nenhum saldo foi financiado.');
        return result;
      }catch(error){
        commercial.term=originalTerm;
        throw error;
      }
    }
    return previousComplete();
  };
})();
