(function(){
  const TYPE_LABEL={sale:'Venda',receivable:'Recebimento de crediário',cash_supply:'Suprimento',cash_withdrawal:'Sangria',sale_cancel:'Cancelamento',sale_return:'Devolução',cash_open:'Abertura de caixa',cash_close:'Fechamento de caixa'};
  const date=v=>{try{return new Date(v).toLocaleString('pt-BR')}catch{return v||'—'}};
  const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let activeDraftId=null;

  async function supervisorAuthorization(action,title,requestedValue=0){
    const users=(await window.thor.operators()).filter(u=>u.permissions?.supervisor?.authorize);
    if(!users.length)throw new Error('Nenhum supervisor habilitado foi sincronizado.');
    return new Promise((resolve,reject)=>{
      const m=modal(`<div class="oc120-head"><div><small>AUTORIZAÇÃO GERENCIAL</small><h3>${safe(title)}</h3><p>Esta ação ficará registrada com operador, supervisor, data e motivo.</p></div><span>🔐</span></div>
        <div class="oc120-auth-grid"><label>Supervisor<select id="oc120Supervisor">${users.map(u=>`<option value="${safe(u.id)}">${safe(u.name)}</option>`).join('')}</select></label><label>Senha<input id="oc120Pin" type="password" inputmode="numeric" autocomplete="off"></label></div>
        <label class="oc120-label">Motivo da autorização<textarea id="oc120Reason" rows="3" maxlength="240" placeholder="Informe um motivo claro (mínimo 5 caracteres)"></textarea></label>
        <div id="oc120AuthError" class="settings-error"></div><div class="actions"><button class="secondary" id="oc120AuthCancel">Cancelar</button><button class="primary" id="oc120AuthConfirm">Autorizar</button></div>`,'wide');
      let settled=false;const cancel=()=>{if(settled)return;settled=true;m.remove();reject(new Error('authorization_cancelled'));};
      m.querySelector('#oc120AuthCancel').onclick=cancel;
      m.querySelector('#oc120AuthConfirm').onclick=async()=>{const reason=m.querySelector('#oc120Reason').value.trim(),error=m.querySelector('#oc120AuthError');if(reason.length<5){error.textContent='Descreva o motivo com pelo menos 5 caracteres.';return;}const button=m.querySelector('#oc120AuthConfirm');try{button.disabled=true;button.textContent='Validando...';const result=await window.thor.authorizeSensitiveAction({userId:m.querySelector('#oc120Supervisor').value,pin:m.querySelector('#oc120Pin').value,action,requestedValue,reason});settled=true;m.remove();resolve({...result.authorization,reason});}catch(e){error.textContent=friendlyError(e?.message||String(e));button.disabled=false;button.textContent='Autorizar';}};
      setTimeout(()=>m.querySelector('#oc120Pin')?.focus(),30);
    });
  }

  function summaryOf(doc){const p=doc.payload||{};if(p.total!=null)return money(p.total);if(p.amount!=null)return money(p.amount);if(p.opening_amount!=null)return money(p.opening_amount);if(p.closing_amount!=null)return money(p.closing_amount);return '—';}
  async function openCenter(initial='documents'){
    const m=modal(`<div class="oc120-head"><div><small>CENTRAL OPERACIONAL</small><h3>Histórico, contingência e pré-vendas</h3><p>Controle local do terminal, inclusive durante indisponibilidade da internet.</p></div><span>◫</span></div>
      <div class="oc120-tabs"><button data-tab="documents">Reimpressão</button><button data-tab="pending">Pendências <i id="oc120PendingBadge">0</i></button><button data-tab="drafts">Pré-vendas</button></div>
      <div class="oc120-tools"><input id="oc120Search" placeholder="Número, cliente, operador ou referência"><select id="oc120Type"><option value="all">Todos os documentos</option>${Object.entries(TYPE_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button class="secondary" id="oc120Refresh">Atualizar</button></div>
      <div id="oc120Body" class="oc120-body"></div><div class="actions"><button class="secondary" id="oc120Close">Fechar</button></div>`,'wide');
    m.classList.add('oc120-modal');let tab=initial,timer;
    const body=m.querySelector('#oc120Body'),search=m.querySelector('#oc120Search'),type=m.querySelector('#oc120Type');
    const selectTab=next=>{tab=next;m.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));type.style.display=tab==='documents'?'':'none';load();};
    async function load(){
      body.innerHTML='<div class="oc120-loading">Carregando...</div>';
      try{
        const pending=await window.thor.pendingOperations();m.querySelector('#oc120PendingBadge').textContent=pending.length;
        if(tab==='documents'){
          const rows=await window.thor.operationHistory({query:search.value,type:type.value,limit:250});
          body.innerHTML=rows.length?`<div class="oc120-list">${rows.map(d=>`<article><span class="oc120-icon">${({sale:'▤',receivable:'$',cash_supply:'+',cash_withdrawal:'−',sale_cancel:'×',sale_return:'↩',cash_open:'◉',cash_close:'●'})[d.type]||'•'}</span><div><small>${safe(TYPE_LABEL[d.type]||d.type)} ${d.sensitive?'<b>SENSÍVEL</b>':''}</small><strong>${safe(d.reference||'Sem referência')}</strong><em>${date(d.created_at)} • ${summaryOf(d)}</em></div><button data-reprint="${d.id}" data-sensitive="${d.sensitive?'1':'0'}">Imprimir 2ª via</button></article>`).join('')}</div>`:'<div class="oc120-empty">Nenhum documento encontrado.</div>';
          body.querySelectorAll('[data-reprint]').forEach(button=>button.onclick=async()=>{try{let authorization=null,reason='Reimpressão operacional';if(button.dataset.sensitive==='1')authorization=await supervisorAuthorization('sensitive_reprint','Reimpressão sensível');button.disabled=true;button.textContent='Imprimindo...';await window.thor.reprintOperation({documentId:button.dataset.reprint,supervisorAuthorization:authorization,reason:authorization?.reason||reason});button.textContent='2ª via impressa';showToast('Comprovante reimpresso e auditado como 2ª via.');}catch(e){if(e.message!=='authorization_cancelled')infoModal('Reimpressão',friendlyError(e?.message||String(e)));button.disabled=false;button.textContent='Imprimir 2ª via';}});
        }else if(tab==='pending'){
          body.innerHTML=pending.length?`<div class="oc120-list pending">${pending.map(e=>`<article class="${e.state}"><span class="oc120-icon">${e.state==='rejected'?'!':'↻'}</span><div><small>${e.state==='rejected'?'REJEITADA':'PENDENTE'} • tentativa ${e.attempts||0}</small><strong>${safe(e.type)}</strong><em>${date(e.created_at)}${e.last_error?' • '+safe(friendlyError(e.last_error)):''}</em></div><button data-retry="${e.id}">${e.state==='rejected'?'Corrigir / reenviar':'Tentar agora'}</button></article>`).join('')}</div><div class="oc120-queue-actions"><button class="secondary" id="oc120OpenFiscal">Abrir painel fiscal</button><button class="primary" id="oc120RetryAll">Retentar todas</button></div>`:'<div class="oc120-empty ok">✓ Não existem operações pendentes.</div>';
          body.querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{try{b.disabled=true;b.textContent='Reenviando...';await window.thor.retryOperation(b.dataset.retry);showToast('Operação reenviada.');await load();}catch(e){infoModal('Contingência',friendlyError(e?.message||String(e)));b.disabled=false;}});
          body.querySelector('#oc120RetryAll')?.addEventListener('click',async()=>{try{await window.thor.retryPendingOperations();await refreshStatus();showToast('Retentativa automática executada.');await load();}catch(e){infoModal('Contingência',friendlyError(e?.message||String(e)));}});
          body.querySelector('#oc120OpenFiscal')?.addEventListener('click',()=>{m.remove();setView('fiscal');});
        }else{
          const rows=await window.thor.draftSales(search.value);
          body.innerHTML=rows.length?`<div class="oc120-list drafts">${rows.map(d=>`<article><span class="oc120-icon">◫</span><div><small>PRÉ-VENDA • ${safe(d.operator_name||'Operador')}</small><strong>${safe(d.number)}${d.customer_name?' • '+safe(d.customer_name):''}</strong><em>${date(d.updated_at)} • ${d.payload?.items?.length||0} item(ns)</em></div><button data-load-draft="${d.id}">Retomar</button><button class="danger-link" data-delete-draft="${d.id}">Cancelar</button></article>`).join('')}</div>`:'<div class="oc120-empty">Nenhuma pré-venda em aberto.</div>';
          body.querySelectorAll('[data-load-draft]').forEach(b=>b.onclick=async()=>{try{if(state.cart.length&&!confirm('A venda atual será substituída pela pré-venda. Continuar?'))return;const d=await window.thor.loadDraftSale(b.dataset.loadDraft),p=d.payload||{},v=v3State();state.cart=p.items||[];v.customerId=p.customerId||null;v.customerName=p.customerName||'';v.consumerDocument=p.consumerDocument||'';v.discount=Number(p.discount||0);v.surcharge=Number(p.surcharge||0);v.payments=[];activeDraftId=d.id;m.remove();renderSaleWorkspace();queueMicrotask(()=>{v3RenderCart();showToast(`Pré-venda ${d.number} carregada. Conclua normalmente para convertê-la em venda.`);});}catch(e){infoModal('Pré-venda',friendlyError(e?.message||String(e)));}});
          body.querySelectorAll('[data-delete-draft]').forEach(b=>b.onclick=async()=>{if(!confirm('Cancelar esta pré-venda?'))return;await window.thor.deleteDraftSale(b.dataset.deleteDraft);await load();});
        }
      }catch(e){body.innerHTML=`<div class="oc120-empty error">${safe(friendlyError(e?.message||String(e)))}</div>`;}
    }
    search.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,180)};type.onchange=load;m.querySelector('#oc120Refresh').onclick=load;m.querySelector('#oc120Close').onclick=()=>m.remove();m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));selectTab(initial);
  }

  async function suspendSale(){
    if(!state.cart.length)return infoModal('Pré-venda','Inclua pelo menos um produto antes de suspender a venda.');
    const v=v3State();try{const result=await window.thor.saveDraftSale({id:activeDraftId,items:state.cart,customerId:v.customerId||null,customerName:v.customerName||'',consumerDocument:v.consumerDocument||'',discount:v.discount||0,surcharge:v.surcharge||0,notes:v.notes||''});state.cart=[];activeDraftId=null;v3ResetSale();renderSaleWorkspace();showToast(`Venda suspensa como ${result.number}.`);}catch(e){infoModal('Pré-venda',friendlyError(e?.message||String(e)));}
  }

  function decorateActions(){
    document.querySelectorAll('.v089-menu-grid').forEach(grid=>{
      if(grid.querySelector('[data-oc120-center]'))return;
      const center=document.createElement('button');center.dataset.oc120Center='1';center.innerHTML='<i>◫</i><b>Central operacional</b><small>2ª via, pendências e pré-vendas</small>';center.onclick=()=>{grid.closest('.modal')?.remove();setTimeout(()=>openCenter('documents'),20);};
      const suspend=document.createElement('button');suspend.dataset.oc120Suspend='1';suspend.innerHTML='<i>Ⅱ</i><b>Suspender venda</b><small>Salvar e atender outro cliente</small>';suspend.onclick=()=>{grid.closest('.modal')?.remove();setTimeout(suspendSale,20);};grid.append(center,suspend);
    });
  }
  if(typeof v3CompleteCheckout==='function'){
    const previous=v3CompleteCheckout;
    v3CompleteCheckout=async function(){const draft=activeDraftId;const result=await previous.apply(this,arguments);if(draft){try{await window.thor.completeDraftSale(draft,result?.eventId||'');activeDraftId=null;}catch{}}return result;};
  }
  window.openOperationsCenterV120=openCenter;
  window.requestSupervisorAuthorizationV120=supervisorAuthorization;
  new MutationObserver(decorateActions).observe(document.documentElement,{childList:true,subtree:true});decorateActions();
})();