(function(){
  const n=(value)=>{const x=Number(value||0);return Number.isFinite(x)?x:0};
  const commercial=()=>{const v=v3State();if(!v.commercialV070)v.commercialV070={salesOrderId:null,salesOrderNumber:null,orderPriceLock:false,term:null,preferredPaymentMethod:null};return v.commercialV070;};
  const salesOptions=()=>v3State().salesOptions||state.status?.salesOptions||{};
  const termEnabled=()=>((salesOptions().payment_methods||[]).some(x=>String(x.code)==='term_sale'&&x.active!==false));
  const termLabel=(method)=>String(method)==='boleto'?'Boleto':'Crediário';
  const brDate=(iso)=>{if(!iso)return '—';const d=new Date(`${iso}T12:00:00`);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR')};
  const addDays=(base,days)=>{const d=new Date(base);d.setHours(12,0,0,0);d.setDate(d.getDate()+Number(days||0));return d};

  function schedule(principal,term,baseDate=new Date()){
    principal=Math.max(Math.round(n(principal)*100)/100,0);
    const count=Math.max(Number(term?.installments||1),1);
    const rate=Math.max(n(term?.interest_percent),0);
    const interest=Math.round(principal*rate)/100;
    const total=Math.round((principal+interest)*100)/100;
    const each=Math.round((total/count)*100)/100;
    const first=Math.max(Number(term?.first_due_days??30),0);
    const interval=Math.max(Number(term?.interval_days??30),1);
    let inserted=0;const rows=[];
    for(let i=1;i<=count;i++){
      const amount=i===count?Math.round((total-inserted)*100)/100:each;
      inserted=Math.round((inserted+amount)*100)/100;
      rows.push({installment:i,installments:count,amount,dueDate:addDays(baseDate,first+(i-1)*interval).toISOString().slice(0,10)});
    }
    return {principal,rate,interest,total,count,first,interval,rows};
  }

  async function refreshCredit(){
    const v=v3State();
    if(!v.customerId){v.customerCreditBalance=0;return 0;}
    try{
      const rows=await window.thor.customers(v.customerName||String(v.customerId));
      const customer=(rows||[]).find(x=>String(x.id)===String(v.customerId));
      v.customerCreditBalance=Math.max(n(customer?.store_credit_balance),0);
      return v.customerCreditBalance;
    }catch{return Math.max(n(v.customerCreditBalance),0);}
  }

  function pendingStoreCredit(){return (v3State().payments||[]).reduce((sum,p)=>p.method==='store_credit'?sum+Math.max(n(p.amount),0):sum,0);}
  function availableStoreCredit(){return Math.max(n(v3State().customerCreditBalance)-pendingStoreCredit(),0);}

  function patchWorkspace(){
    document.getElementById('c70TermPayment')?.remove();
    const credit=document.querySelector('[data-v3-pay="store_credit"]');
    if(credit){
      const available=availableStoreCredit();
      credit.style.display=v3State().customerId&&available>0.009?'':'none';
      const span=credit.querySelector('span');if(span&&available>0.009)span.textContent=`Crédito loja (${money(available)})`;
    }
  }

  function installmentTable(term,principal){
    const plan=schedule(principal,term);
    if(plan.principal<=0.009)return `<div class="v73-paid-note">Saldo já quitado. Nenhuma parcela será gerada e a venda será concluída como pagamento integral.</div>`;
    return `<div class="v73-finance-head"><span>Principal <b>${money(plan.principal)}</b></span><span>Taxa <b>${plan.rate.toLocaleString('pt-BR')}%</b></span><span>Juros <b>${money(plan.interest)}</b></span><span>Total financiado <b>${money(plan.total)}</b></span></div>
      <div class="v73-installments"><div class="v73-installment-row head"><span>Parcela</span><span>Vencimento</span><span>Valor</span></div>${plan.rows.map(r=>`<div class="v73-installment-row"><b>${r.installment}/${r.installments}</b><span>${brDate(r.dueDate)}</span><strong>${money(r.amount)}</strong></div>`).join('')}</div>`;
  }

  function renderTermSummary(paymentModal){
    if(!paymentModal?.isConnected)return;
    let holder=paymentModal.querySelector('#v73TermSummary');
    if(!holder){holder=document.createElement('section');holder.id='v73TermSummary';holder.className='v73-term-summary';const footer=paymentModal.querySelector('.payment-footer');paymentModal.querySelector('.modal-card')?.insertBefore(holder,footer||null);}
    const c=commercial();
    const btn=paymentModal.querySelector('[data-v73-term]');
    btn?.classList.toggle('active',Boolean(c.term));
    if(!c.term){holder.innerHTML='';holder.hidden=true;return;}
    holder.hidden=false;
    holder.innerHTML=`<div class="v73-summary-title"><div><small>VENDA A PRAZO</small><b>${esc(termLabel(c.term.method))} • ${Number(c.term.installments||1)}x</b></div><button type="button" id="v73RemoveTerm">Remover</button></div>${installmentTable(c.term,v3Remaining())}`;
    holder.querySelector('#v73RemoveTerm').onclick=()=>{c.term=null;renderTermSummary(paymentModal);};
  }

  async function openTermPicker(paymentModal){
    const v=v3State();
    if(!v.customerId)return infoModal('Venda a Prazo','Identifique um cliente cadastrado antes de selecionar Boleto ou Crediário.');
    const principal=v3Remaining();
    if(principal<=0.009)return infoModal('Venda a Prazo','A venda já está integralmente paga. Remova um pagamento à vista para financiar o saldo.');
    const terms=(await window.thor.paymentTerms().catch(()=>[])).filter(x=>x.active!==false);
    if(!terms.length)return infoModal('Venda a Prazo','Nenhum plano ativo foi sincronizado. Configure em Gestão → Administrativo → Configurações → Opções de Vendas.');
    const c=commercial();
    const selectedIndex=Math.max(terms.findIndex(x=>String(x.id)===String(c.term?.payment_term_id||'')),0);
    const m=modal(`<div class="v47-modal-head"><div><small>FORMA DE PAGAMENTO</small><h3>Venda a Prazo</h3><p>Confira o parcelamento completo antes de finalizar.</p></div><span>📅</span></div>
      <div class="field"><label>Plano<select id="v73TermPlan">${terms.map((t,i)=>`<option value="${i}" ${i===selectedIndex?'selected':''}>${esc(t.name)} — ${esc(termLabel(t.method))} • ${Number(t.installments||1)}x</option>`).join('')}</select></label></div>
      <div id="v73TermDetail"></div>
      <div class="actions"><button class="secondary" id="v73TermCancel">Cancelar</button><button class="primary" id="v73TermApply">Confirmar parcelamento</button></div>`, 'wide');
    const select=m.querySelector('#v73TermPlan'),detail=m.querySelector('#v73TermDetail');
    const current=()=>terms[Number(select.value)]||terms[0];
    const normalized=()=>{const t=current();return {payment_term_id:t.id,method:t.method,installments:Number(t.installments||1),first_due_days:Number(t.first_due_days??30),interval_days:Number(t.interval_days??30),interest_percent:n(t.interest_percent)};};
    const render=()=>{const t=normalized();detail.innerHTML=`<div class="v73-plan-name"><b>${esc(current().name)}</b><span>1º vencimento em ${t.first_due_days} dias • intervalo ${t.interval_days} dias</span></div>${installmentTable(t,v3Remaining())}`;};
    select.onchange=render;
    m.querySelector('#v73TermCancel').onclick=()=>m.remove();
    m.querySelector('#v73TermApply').onclick=()=>{c.term=normalized();m.remove();renderTermSummary(paymentModal);showToast(`${termLabel(c.term.method)} selecionado em ${c.term.installments}x.`);};
    render();
  }

  function patchPaymentModal(wrap,openTerm=false){
    if(!wrap||!wrap.isConnected)return;
    const grid=wrap.querySelector('.payment-method-grid');if(!grid)return;
    let termButton=grid.querySelector('[data-v73-term]');
    if(termEnabled()&&!termButton){termButton=document.createElement('button');termButton.type='button';termButton.dataset.v73Term='1';termButton.textContent='Venda a Prazo';grid.appendChild(termButton);termButton.onclick=(event)=>{event.preventDefault();event.stopPropagation();openTermPicker(wrap);};}

    const credit=grid.querySelector('[data-method="store_credit"]');
    const available=availableStoreCredit();
    if(credit){credit.style.display=v3State().customerId&&available>0.009?'':'none';credit.title=available>0?`Disponível: ${money(available)}`:'Disponível somente para cliente com crédito de devolução.';}

    if(wrap.dataset.v73CreditGuard!=='1'){
      wrap.dataset.v73CreditGuard='1';
      wrap.addEventListener('click',(event)=>{
        const target=event.target.closest?.('button');if(!target)return;
        const active=grid.querySelector('[data-method].active')?.dataset.method;
        if(active!=='store_credit')return;
        if(target.id!=='addPayment'&&target.id!=='integratedPay')return;
        const err=wrap.querySelector('#payError');
        if(target.id==='integratedPay'){
          event.preventDefault();event.stopImmediatePropagation();if(err)err.textContent='Crédito da loja é saldo interno gerado por devolução e não utiliza TEF/PIX.';return;
        }
        const creditNow=availableStoreCredit();const requested=Math.max(n(wrap.querySelector('#payAmount')?.value),0);
        if(!v3State().customerId||creditNow<=0.009){event.preventDefault();event.stopImmediatePropagation();if(err)err.textContent='Crédito da loja só é liberado para cliente com saldo disponível de devolução.';return;}
        if(requested>creditNow+0.001){event.preventDefault();event.stopImmediatePropagation();if(err)err.textContent=`Saldo de crédito insuficiente. Disponível: ${money(creditNow)}.`;return;}
      },true);
    }
    renderTermSummary(wrap);
    if(openTerm&&termEnabled())setTimeout(()=>openTermPicker(wrap),20);
  }

  const previousPaymentModal=v3PaymentModal;
  v3PaymentModal=async function(initialMethod='cash'){
    await refreshCredit();patchWorkspace();
    const openTerm=initialMethod==='term_sale';
    const result=previousPaymentModal(openTerm?'cash':initialMethod);
    queueMicrotask(()=>{const modals=[...document.querySelectorAll('.modal')];patchPaymentModal(modals[modals.length-1],openTerm);});
    return result;
  };

  const previousRender=renderSaleWorkspace;
  renderSaleWorkspace=function(){const result=previousRender();queueMicrotask(async()=>{await refreshCredit();patchWorkspace();});setTimeout(patchWorkspace,5);return result;};

  const previousCart=v3RenderCart;
  v3RenderCart=function(){const result=previousCart();queueMicrotask(()=>{patchWorkspace();const modals=[...document.querySelectorAll('.modal')];for(const m of modals)if(m.querySelector('.payment-method-grid')){patchPaymentModal(m,false);}});return result;};
  renderCart=v3RenderCart;

  let pendingDuplicate=null;
  const previousComplete=v3CompleteCheckout;
  v3CompleteCheckout=async function(){
    const c=commercial(),v=v3State();
    const principal=v3Remaining();
    const snapshot=c.term&&principal>0.009?{
      term:{...c.term},principal,customerName:v.customerName||'',customerDocument:v.consumerDocument||'',salesOrderId:c.salesOrderId||null,salesOrderNumber:c.salesOrderNumber||'',baseDate:new Date().toISOString()
    }:null;
    if(snapshot)pendingDuplicate=snapshot;
    try{return await previousComplete();}
    finally{if(pendingDuplicate===snapshot)pendingDuplicate=null;}
  };

  function askDuplicate(snapshot){
    const plan=schedule(snapshot.principal,snapshot.term,new Date(snapshot.baseDate));
    const m=modal(`<div class="v47-modal-head"><div><small>VENDA A PRAZO CONCLUÍDA</small><h3>Deseja imprimir as duplicatas?</h3><p>Será gerado um único PDF com ${plan.count} ${plan.count===1?'página':'páginas'}, uma duplicata para cada parcela.</p></div><span>📄</span></div>
      <div class="v73-duplicate-summary"><div><span>Modalidade</span><b>${esc(termLabel(snapshot.term.method))}</b></div><div><span>Parcelas</span><b>${plan.count}x</b></div><div><span>Financiado</span><b>${money(plan.total)}</b></div><div><span>Cliente</span><b>${esc(snapshot.customerName||'Cliente identificado')}</b></div></div>
      <div class="actions"><button class="secondary" id="v73NoDuplicate">Não imprimir</button><button class="primary" id="v73PrintDuplicate">Gerar PDF (${plan.count} ${plan.count===1?'duplicata':'duplicatas'})</button></div>`,'wide');
    m.querySelector('#v73NoDuplicate').onclick=()=>m.remove();
    m.querySelector('#v73PrintDuplicate').onclick=async()=>{const btn=m.querySelector('#v73PrintDuplicate');try{btn.disabled=true;btn.textContent='Gerando PDF...';const result=await window.thor.saveTermDuplicatesPdf(snapshot);if(result?.cancelled){btn.disabled=false;btn.textContent=`Gerar PDF (${plan.count} ${plan.count===1?'duplicata':'duplicatas'})`;return;}m.remove();showToast(`PDF com ${plan.count} duplicata(s) gerado.`);}catch(error){btn.disabled=false;btn.textContent=`Gerar PDF (${plan.count} ${plan.count===1?'duplicata':'duplicatas'})`;infoModal('Duplicatas',friendlyError(error?.message));}};
  }

  const originalPostSalePrint=postSalePrint;
  postSalePrint=async function(eventId){
    const snapshot=pendingDuplicate;
    if(!snapshot)return originalPostSalePrint(eventId);
    pendingDuplicate=null;
    const next=()=>setTimeout(()=>askDuplicate(snapshot),10);
    const mode=state.settings?.printMode||'ask';const doc=state.settings?.printDocument||'ask';
    if(mode==='never'){next();return;}
    if(mode==='direct'&&doc!=='ask'){
      if(doc==='pre_sale')await safePrint(`local:${eventId}`,'pre_sale');
      else if(doc==='nfce')await requestNfceAndMaybePrint(`local:${eventId}`);
      next();return;
    }
    const m=modal(`<h3>Venda finalizada</h3><p class="muted">O que deseja fazer com o documento desta venda?</p><div class="document-choice"><button class="doc-choice" id="v73NoPrint"><b>Não imprimir</b><span>Finalizar sem comprovante</span></button><button class="doc-choice" id="v73PrintPre"><b>Pré-venda / cupom</b><span>Comprovante não fiscal</span></button><button class="doc-choice fiscal-choice" id="v73PrintNfce"><b>NFC-e</b><span>Solicitar documento fiscal e imprimir após autorização</span></button></div>`);
    m.querySelector('#v73NoPrint').onclick=()=>{m.remove();next();};
    m.querySelector('#v73PrintPre').onclick=async()=>{m.remove();await safePrint(`local:${eventId}`,'pre_sale');next();};
    m.querySelector('#v73PrintNfce').onclick=async()=>{m.remove();await requestNfceAndMaybePrint(`local:${eventId}`);next();};
  };

  const oldFriendly=friendlyError;
  friendlyError=function(code){const map={term_sale_has_no_financed_balance:'A venda foi totalmente quitada. O financiamento foi removido automaticamente; tente concluir novamente.',term_required_for_unpaid_balance:'Existe saldo pendente. Selecione Venda a Prazo dentro de Formas de Pagamento.',insufficient_store_credit:'O cliente não possui crédito de devolução suficiente.'};return map[String(code||'')]||oldFriendly(code);};
})();
