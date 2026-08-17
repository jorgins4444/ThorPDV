(function(){
  if(window.__receivableCashSummaryV115)return;
  window.__receivableCashSummaryV115=true;
  if(typeof cashDailyCloseModal!=='function')return;

  const previous=cashDailyCloseModal;
  cashDailyCloseModal=function(preview,options={}){
    const wrap=previous(preview,options);
    try{
      if(!wrap?.querySelector)return wrap;
      const total=Number(preview?.receivable_received_total||0);
      const cash=Number(preview?.receivable_received_cash||0);
      const count=Number(preview?.receivable_receipt_count||0);
      if(total<=0.009)return wrap;
      const grid=wrap.querySelector('.cash-summary-grid');
      if(!grid)return wrap;

      let card=[...grid.querySelectorAll('article')].find(article=>String(article.querySelector('span')?.textContent||'').trim()==='Recebimentos');
      if(!card){
        card=document.createElement('article');
        const sales=[...grid.querySelectorAll('article')].find(article=>String(article.querySelector('span')?.textContent||'').trim()==='Vendas');
        if(sales?.nextSibling)grid.insertBefore(card,sales.nextSibling);else grid.appendChild(card);
      }
      card.dataset.receivableSummaryV115='1';
      card.innerHTML=`<span>Recebimentos</span><strong>${cashDailyMoney(total)}</strong><small>${Math.trunc(count)} recebimento(s) de crediário${cash>0.009?` • ${cashDailyMoney(cash)} em dinheiro`:''}</small>`;

      const nonCash=Math.max(total-cash,0);
      if(nonCash>0.009&&!wrap.querySelector('[data-receivable-cash-note-v115]')){
        const note=document.createElement('div');
        note.dataset.receivableCashNoteV115='1';
        note.className='cash-return-credit-note';
        note.innerHTML=`<b>Recebimentos não monetários na gaveta: ${cashDailyMoney(nonCash)}</b><span>PIX, cartões e outras formas ficam registrados no fechamento, mas somente ${cashDailyMoney(cash)} recebido em dinheiro compõe o numerário físico.</span>`;
        grid.insertAdjacentElement('afterend',note);
      }
    }catch(error){console.warn('[receivable-cash-summary-v115]',error);}
    return wrap;
  };
})();
