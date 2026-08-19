(()=>{
  const MODEL_KEY='thor.pdv.sale_document_models.v1';
  const rawRequestNfce=typeof requestNfceAndMaybePrint==='function'?requestNfceAndMaybePrint:null;
  const rawCancelSaleModal=typeof cancelSaleModal==='function'?cancelSaleModal:null;
  const rawOpenSaleDetail=typeof openSaleDetail==='function'?openSaleDetail:null;
  const rawRenderFiscalTable=typeof renderFiscalTable==='function'?renderFiscalTable:null;
  const rawPostSalePrint=typeof postSalePrint==='function'?postSalePrint:null;

  function loadModels(){try{const value=JSON.parse(localStorage.getItem(MODEL_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
  function modelKeys(value){
    const keys=[];
    if(typeof value==='string'&&value){keys.push(value);if(value.startsWith('local:'))keys.push(value.slice(6));}
    else if(value&&typeof value==='object'){
      const key=typeof saleKey==='function'?saleKey(value):'';
      if(key)keys.push(key);
      if(value.client_event_id)keys.push(String(value.client_event_id));
      if(value.local_key)keys.push(String(value.local_key));
      if(value.id)keys.push(String(value.id));
    }
    return [...new Set(keys.filter(Boolean))];
  }
  function rememberModel(value,model){
    if(!['pre_sale','nfce','none'].includes(model))return;
    try{const map=loadModels();for(const key of modelKeys(value))map[key]=model;localStorage.setItem(MODEL_KEY,JSON.stringify(map));}catch{}
  }
  function explicitModel(sale){
    const raw=String(sale?.document_model||sale?.document_type||sale?.print_document||sale?.receipt_model||sale?.metadata?.document_model||sale?.metadata?.print_document||'').toLowerCase();
    if(raw.includes('nfce')||raw.includes('nfc-e'))return 'nfce';
    if(raw.includes('pre_sale')||raw.includes('pre-venda')||raw.includes('pre venda'))return 'pre_sale';
    return '';
  }
  function documentModel(sale){
    const map=loadModels();
    for(const key of modelKeys(sale)){if(map[key])return map[key];}
    const explicit=explicitModel(sale);if(explicit)return explicit;
    const fiscal=sale?.fiscal||null;
    const fiscalStatus=String(fiscal?.status||'');
    if(fiscal&&(fiscal.id||fiscal.access_key||fiscal.protocol||fiscal.attempt_count||['requested','draft','processing','authorized','rejected','transmission_error','cancelled','contingency'].includes(fiscalStatus)))return 'nfce';
    const configured=String(state?.settings?.printDocument||'');
    if(String(state?.settings?.printMode||'')==='direct'&&['pre_sale','nfce'].includes(configured))return configured;
    return 'pre_sale';
  }
  function modelLabel(model){return model==='nfce'?'NFC-e':model==='pre_sale'?'Pré-venda':'Sem emissão de documento';}

  function confirmAction({eyebrow='CONFIRMAÇÃO',title,message,yes='Sim',no='Não',danger=false}){
    return new Promise(resolve=>{
      const m=modal(`<div class="settings-head"><div><small>${esc(eyebrow)}</small><h3>${esc(title)}</h3></div><span>ThorPDV</span></div><div class="fiscal-diagnostic ${danger?'error':'processing'}"><b>${esc(message)}</b><span>${danger?'Esta ação só será iniciada após sua confirmação.':'Confirme para continuar com a operação.'}</span></div><div class="actions"><button class="secondary" id="v103No">${esc(no)}</button><button class="${danger?'danger ':''}primary" id="v103Yes">${esc(yes)}</button></div>`,'wide');
      let done=false;
      const finish=value=>{if(done)return;done=true;m.remove();resolve(value);};
      m.querySelector('#v103No').onclick=()=>finish(false);
      m.querySelector('#v103Yes').onclick=()=>finish(true);
    });
  }

  if(rawRequestNfce){
    const confirmedRequest=async function(key,options={}){
      if(!options?.skipConfirmation){
        const ok=await confirmAction({eyebrow:'EMISSÃO FISCAL',title:'Emitir NFC-e',message:'Deseja emitir a NFC-e desta venda?',yes:'Sim, emitir NFC-e',no:'Não'});
        if(!ok)return {cancelled:true};
      }
      rememberModel(key,'nfce');
      return rawRequestNfce(key);
    };
    requestNfceAndMaybePrint=confirmedRequest;
    window.requestNfceAndMaybePrint=confirmedRequest;
  }

  if(rawCancelSaleModal){
    const confirmedCancel=async function(sale){
      const fiscalStatus=String(sale?.fiscal?.status||'');
      const authorized=fiscalStatus==='authorized';
      const message=authorized?'Deseja cancelar esta venda e solicitar o cancelamento da NFC-e na SEFAZ?':'Deseja cancelar esta venda?';
      const ok=await confirmAction({eyebrow:'CANCELAMENTO',title:authorized?'Cancelar venda + NFC-e':'Cancelar venda',message,yes:'Sim, continuar',no:'Não',danger:true});
      if(!ok)return;
      return rawCancelSaleModal(sale);
    };
    cancelSaleModal=confirmedCancel;
    window.cancelSaleModal=confirmedCancel;
  }

  if(typeof postSaleModal==='function'){
    postSaleModal=function(key){
      const m=modal(`<h3>Venda finalizada</h3><p class="muted">O que deseja fazer com o documento desta venda?</p><div class="document-choice"><button class="doc-choice" id="noPrint"><b>Não imprimir</b><span>Finalizar sem documento</span></button><button class="doc-choice" id="printPre"><b>Pré-venda / cupom</b><span>Comprovante não fiscal</span></button><button class="doc-choice fiscal-choice" id="printNfce"><b>NFC-e</b><span>Solicitar documento fiscal e imprimir após autorização</span></button></div>`);
      m.querySelector('#noPrint').onclick=()=>{rememberModel(key,'none');m.remove();};
      m.querySelector('#printPre').onclick=async()=>{rememberModel(key,'pre_sale');m.remove();await safePrint(key,'pre_sale');};
      m.querySelector('#printNfce').onclick=async()=>{rememberModel(key,'nfce');m.remove();await requestNfceAndMaybePrint(key);};
      return m;
    };
    window.postSaleModal=postSaleModal;
  }

  if(rawPostSalePrint){
    postSalePrint=async function(eventId){
      const mode=String(state?.settings?.printMode||'ask');
      const doc=String(state?.settings?.printDocument||'ask');
      if(mode==='direct'&&['pre_sale','nfce'].includes(doc))rememberModel(`local:${eventId}`,doc);
      if(mode==='never')rememberModel(`local:${eventId}`,'none');
      return rawPostSalePrint(eventId);
    };
    window.postSalePrint=postSalePrint;
  }

  function needsReprocess(sale){
    const saleStatus=String(sale?.status||'').toLowerCase();
    const fiscalStatus=String(sale?.fiscal?.status||'').toLowerCase();
    if(['cancelled','cancel_pending'].includes(saleStatus)||fiscalStatus==='cancelled'||fiscalStatus==='authorized')return false;
    if(['pending_sync','rejected','sync_error','error','failed'].includes(saleStatus))return true;
    if(['rejected','transmission_error'].includes(fiscalStatus))return true;
    return sale?.source==='local'&&saleStatus!=='completed';
  }

  async function reprocessSale(sale){
    const key=typeof saleKey==='function'?saleKey(sale):String(sale?.local_key||sale?.client_event_id||sale?.id||'');
    let detail=sale;
    try{detail=await window.thor.fiscalSale(key);}catch{}
    const model=documentModel(detail);
    const ok=await confirmAction({eyebrow:'REPROCESSAMENTO',title:'Reprocessar venda',message:`Deseja reprocessar esta venda mantendo o modelo ${modelLabel(model)}?`,yes:'Sim, reprocessar',no:'Não'});
    if(!ok)return;

    const progress=modal(`<div class="settings-head"><div><small>REPROCESSAMENTO</small><h3>Recuperando a venda</h3></div><span>${esc(modelLabel(model))}</span></div><div class="fiscal-diagnostic processing"><b id="v103ReprocessTitle">Validando fila local</b><span id="v103ReprocessText">O ThorPDV manterá o modelo original da operação.</span></div><div class="actions"><button class="secondary" id="v103ReprocessClose" disabled>Fechar</button></div>`,'wide');
    const title=progress.querySelector('#v103ReprocessTitle'),text=progress.querySelector('#v103ReprocessText'),close=progress.querySelector('#v103ReprocessClose');
    try{
      const saleStatus=String(detail?.status||'').toLowerCase();
      const fiscalStatus=String(detail?.fiscal?.status||'').toLowerCase();
      const syncFailure=['pending_sync','rejected','sync_error','error','failed'].includes(saleStatus)||(detail?.source==='local'&&saleStatus!=='completed');
      if(syncFailure){
        title.textContent='Reenviando a venda para o ThorGestão';
        text.textContent='A fila será recuperada de forma idempotente para evitar duplicidade.';
        const recovery=await window.thor.recoverSync();
        if(recovery&&recovery.ok===false)throw new Error(recovery.sync?.error||recovery.diagnostics?.lastError||'sync_recovery_failed');
        try{await refreshStatus();}catch{}
        try{await refreshFiscalSales();}catch{}
        try{detail=await window.thor.fiscalSale(key);}catch{}
      }

      if(model==='nfce'){
        title.textContent=fiscalStatus==='transmission_error'||fiscalStatus==='rejected'?'Retomando a NFC-e':'Solicitando a NFC-e';
        text.textContent='A mesma venda será usada; nenhuma nova venda será criada.';
        progress.remove();
        rememberModel(detail||key,'nfce');
        return rawRequestNfce?rawRequestNfce(key):requestNfceAndMaybePrint(key,{skipConfirmation:true});
      }
      if(model==='pre_sale'){
        title.textContent='Gerando novamente a Pré-venda';
        text.textContent='A venda sincronizada será mantida e o comprovante não fiscal será reprocessado.';
        rememberModel(detail||key,'pre_sale');
        const printed=await safePrint(key,'pre_sale');
        if(!printed)throw new Error('pre_sale_reprocess_failed');
        title.textContent='Pré-venda reprocessada';text.textContent='A operação foi concluída mantendo o modelo Pré-venda.';
      }else{
        title.textContent='Venda reprocessada';text.textContent='A sincronização foi recuperada sem emitir documento, conforme a escolha original.';
      }
      try{await refreshFiscalSales();}catch{}
      close.disabled=false;close.className='primary';close.onclick=()=>progress.remove();
    }catch(error){
      title.textContent='Não foi possível reprocessar';
      text.textContent=friendlyError(String(error?.message||error||'Erro inesperado'));
      const box=progress.querySelector('.fiscal-diagnostic');box?.classList.remove('processing');box?.classList.add('error');
      close.disabled=false;close.onclick=()=>progress.remove();
    }
  }

  function decorateFiscalTable(){
    if(typeof fiscalFilteredSales!=='function')return;
    const rows=fiscalFilteredSales();
    const box=document.getElementById('fiscalTable');if(!box)return;
    box.querySelectorAll('[data-view-sale]').forEach(view=>{
      const index=Number(view.dataset.viewSale),sale=rows[index];
      if(!sale||!needsReprocess(sale))return;
      const cell=view.parentElement;if(!cell||cell.querySelector('[data-reprocess-sale]'))return;
      const button=document.createElement('button');button.type='button';button.className='table-action';button.dataset.reprocessSale=String(index);button.textContent='Reprocessar';button.title=`Reprocessar mantendo ${modelLabel(documentModel(sale))}`;
      button.onclick=event=>{event.preventDefault();event.stopPropagation();void reprocessSale(sale);};
      cell.appendChild(button);
    });
  }

  if(rawRenderFiscalTable){
    renderFiscalTable=function(){const result=rawRenderFiscalTable();queueMicrotask(decorateFiscalTable);return result;};
    window.renderFiscalTable=renderFiscalTable;
  }

  if(rawOpenSaleDetail){
    openSaleDetail=async function(sale){
      const result=await rawOpenSaleDetail(sale);
      let detail=sale;try{detail=await window.thor.fiscalSale(saleKey(sale));}catch{}
      if(!needsReprocess(detail))return result;
      const overlay=[...document.querySelectorAll('.modal')].reverse().find(x=>x.querySelector('.sale-actions'));
      const actions=overlay?.querySelector('.sale-actions');if(!actions||actions.querySelector('#v103ReprocessSale'))return result;
      const button=document.createElement('button');button.type='button';button.id='v103ReprocessSale';button.className='secondary';button.textContent='Reprocessar';button.title=`Reprocessar mantendo ${modelLabel(documentModel(detail))}`;
      button.onclick=()=>{overlay.remove();void reprocessSale(detail);};
      actions.prepend(button);
      return result;
    };
    window.openSaleDetail=openSaleDetail;
  }
})();
