(()=>{
  const CANCELLED_SALE_STATUSES=new Set(['cancelled','cancel_pending']);
  const rawRequestNfce=typeof requestNfceAndMaybePrint==='function'?requestNfceAndMaybePrint:null;
  const rawOpenSaleDetail=typeof openSaleDetail==='function'?openSaleDetail:null;
  const rawPaintCancelProgress=typeof paintCancelProgress==='function'?paintCancelProgress:null;

  function saleIsCancelled(sale){
    const saleStatus=String(sale?.status||'').toLowerCase();
    const fiscalStatus=String(sale?.fiscal?.status||'').toLowerCase();
    return CANCELLED_SALE_STATUSES.has(saleStatus)||fiscalStatus==='cancelled';
  }

  function fiscalIsCancelled(sale){return String(sale?.fiscal?.status||'').toLowerCase()==='cancelled';}

  function cancelledSaleMessage(sale){
    const number=sale?.number?` #${sale.number}`:'';
    return `A venda${number} está cancelada. Não é permitido solicitar uma nova NFC-e para uma operação cancelada.`;
  }

  function showNfceBlocked(sale){
    const message=cancelledSaleMessage(sale);
    if(typeof infoModal==='function')infoModal('NFC-e bloqueada',message);
    else if(typeof showToast==='function')showToast(message);
    return {ok:false,blocked:true,error:'sale_cancelled'};
  }

  async function resolveSale(keyOrSale){
    if(keyOrSale&&typeof keyOrSale==='object')return keyOrSale;
    const key=String(keyOrSale||'');
    if(!key||!window.thor?.fiscalSale)return null;
    try{return await window.thor.fiscalSale(key);}catch{return null;}
  }

  // Segunda barreira de segurança na UI. O agente local também recusa a emissão
  // quando a venda está cancelled/cancel_pending, mas esta validação evita até
  // mesmo abrir confirmação/progresso de emissão para uma operação já cancelada.
  if(rawRequestNfce){
    const guardedRequest=async function(key,options={}){
      const detail=await resolveSale(key);
      if(detail&&saleIsCancelled(detail))return showNfceBlocked(detail);
      return rawRequestNfce(key,options);
    };
    requestNfceAndMaybePrint=guardedRequest;
    window.requestNfceAndMaybePrint=guardedRequest;
  }

  function latestSaleModal(){
    return [...document.querySelectorAll('.modal')].reverse().find(node=>node.querySelector('.sale-actions'))||null;
  }

  function decorateCancelledSaleModal(detail){
    if(!detail||!saleIsCancelled(detail))return;
    const overlay=latestSaleModal();
    if(!overlay)return;
    const card=overlay.querySelector('.modal-card')||overlay;
    const fiscalCancelled=fiscalIsCancelled(detail);
    const nfceButton=overlay.querySelector('#nfceSale');

    // Se a NFC-e foi efetivamente cancelada, o botão existente continua sendo
    // usado somente para consultar/reimprimir o DANFE cancelado. Em venda
    // cancelada sem documento fiscal, nenhuma nova solicitação é permitida.
    if(nfceButton&&!fiscalCancelled){
      nfceButton.disabled=true;
      nfceButton.textContent='NFC-e bloqueada';
      nfceButton.title='Venda cancelada — não é possível solicitar NFC-e';
      nfceButton.classList.add('nfce-cancelled-lock');
      nfceButton.onclick=null;
    }

    if(!overlay.querySelector('.sale-cancelled-ux-banner')&&!fiscalCancelled){
      const head=overlay.querySelector('.sale-detail-head');
      const banner=document.createElement('div');
      banner.className='sale-locked-banner sale-cancelled-ux-banner';
      banner.innerHTML='<b>Venda cancelada</b><span>Esta operação está encerrada. A solicitação de uma nova NFC-e permanece bloqueada.</span>';
      if(head?.parentNode)head.insertAdjacentElement('afterend',banner);else card.prepend(banner);
    }
  }

  if(rawOpenSaleDetail){
    const enhancedOpenSaleDetail=async function(sale){
      const result=await rawOpenSaleDetail(sale);
      let detail=sale;
      try{
        const key=typeof saleKey==='function'?saleKey(sale):String(sale?.id||sale?.client_event_id||sale?.local_key||'');
        if(key)detail=await window.thor.fiscalSale(key);
      }catch{}
      decorateCancelledSaleModal(detail);
      return result;
    };
    openSaleDetail=enhancedOpenSaleDetail;
    window.openSaleDetail=enhancedOpenSaleDetail;
  }

  function cancellationCopy(phase,fiscalCancellation){
    if(phase==='done')return {
      title:'Cancelamento realizado com sucesso',
      subtitle:fiscalCancellation?'A NFC-e foi cancelada e a venda foi encerrada com sucesso.':'A venda foi cancelada e a operação foi encerrada com sucesso.'
    };
    if(phase==='error')return {title:'Não foi possível concluir o cancelamento',subtitle:'Confira a mensagem abaixo antes de tentar novamente.'};
    const detail={
      validating:'Validando a operação e as regras de cancelamento.',
      building:'Preparando o evento de cancelamento fiscal.',
      signing:'Assinando o evento com o certificado digital.',
      sending:'Enviando o cancelamento para a SEFAZ.',
      accepted:'Cancelamento aceito pela SEFAZ. Finalizando a venda.',
      reversing:'Estornando estoque e financeiro da venda.',
      syncing:'Sincronizando o cancelamento com o ThorGestão.'
    }[phase]||'Finalizando a operação.';
    return {title:'Processando cancelamento, aguarde',subtitle:detail};
  }

  if(rawPaintCancelProgress){
    const enhancedPaintCancelProgress=function(m,sale,options={}){
      const result=rawPaintCancelProgress(m,sale,options);
      if(!m?.isConnected)return result;
      const phase=String(options?.phase||'validating');
      const fiscalCancellation=Boolean(options?.fiscalCancellation);
      const copy=cancellationCopy(phase,fiscalCancellation);
      const head=m.querySelector('.cancel-progress-head');
      const title=head?.querySelector('h3');
      const subtitle=head?.querySelector('p');
      const body=m.querySelector('#cancelProgressBody');
      if(title)title.textContent=copy.title;
      if(subtitle)subtitle.textContent=copy.subtitle;
      if(body){
        body.setAttribute('role','status');
        body.setAttribute('aria-live','polite');
        body.classList.toggle('cancel-ux-processing',!['done','error'].includes(phase));
        body.classList.toggle('cancel-ux-success',phase==='done');
        body.classList.toggle('cancel-ux-error',phase==='error');
      }
      if(phase==='done'&&m.dataset.cancelUxSuccess!=='1'){
        m.dataset.cancelUxSuccess='1';
        if(typeof showToast==='function')showToast('Cancelamento realizado com sucesso.');
      }
      return result;
    };
    paintCancelProgress=enhancedPaintCancelProgress;
    window.paintCancelProgress=enhancedPaintCancelProgress;
  }
})();
