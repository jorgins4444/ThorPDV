(()=>{
  let cachedTerms=[];
  const termIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16M8 13h3M13 13h3M8 17h3"/></svg>';
  const h=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v)=>{const x=Number(v??0);return Number.isFinite(x)?x:0;};
  const br=(v)=>n(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const shortcut=()=>{try{return String(state?.settings?.shortcuts?.term_sale||'').trim().toUpperCase();}catch{return '';}};

  function commercial(){
    const v=v3State();
    if(!v.commercialV070)v.commercialV070={salesOrderId:null,salesOrderNumber:null,orderPriceLock:false,term:null,preferredPaymentMethod:null};
    return v.commercialV070;
  }

  function addDaysLocal(days){
    const now=new Date();
    return new Date(now.getFullYear(),now.getMonth(),now.getDate()+Math.max(Math.trunc(n(days)),0),12,0,0,0);
  }
  function addDaysTo(date,days){return new Date(date.getFullYear(),date.getMonth(),date.getDate()+Math.trunc(n(days)),12,0,0,0);}
  function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function displayDate(date){return date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});}

  function scheduleFor(term,count,principal){
    const c=Math.max(Math.trunc(n(count)),1);
    const principalCents=Math.max(Math.round(n(principal)*100),0);
    const rate=Math.max(n(term.interest_percent),0);
    const interestCents=Math.round(principalCents*rate/100);
    const financedCents=principalCents+interestCents;
    const each=Math.round(financedCents/c);
    const first=Math.max(Math.trunc(n(term.first_due_days)),0);
    const interval=Math.max(Math.trunc(n(term.interval_days)),1);
    const base=addDaysLocal(first);
    const rows=[];
    let allocated=0;
    for(let i=1;i<=c;i++){
      const cents=i===c?financedCents-allocated:each;
      allocated+=cents;
      const due=addDaysTo(base,(i-1)*interval);
      rows.push({installment:i,installments:c,due_date:isoDate(due),due_label:displayDate(due),amount:cents/100});
    }
    return {principal:principalCents/100,interest:interestCents/100,total:financedCents/100,rows};
  }

  function termMethodEnabled(){
    try{
      const options=v3State()?.salesOptions||state?.status?.salesOptions||state?.salesOptions||{};
      const methods=Array.isArray(options.payment_methods)?options.payment_methods:[];
      if(!methods.length)return true;
      const row=methods.find(x=>String(x?.code||'')==='term_sale');
      return row?row.active!==false:true;
    }catch{return true;}
  }

  function findCheckout(){
    const overlay=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('.payment-head'));
    if(!overlay)return null;
    const card=overlay.querySelector('.modal-card');
    const entry=card?.querySelector('.payment-entry');
    const grid=entry?.querySelector('.v089-pay-methods,.payment-method-grid');
    if(!card||!entry||!grid)return null;
    return {overlay,card,entry,grid};
  }

  function ensureTermButton(ctx){
    let button=[...ctx.grid.querySelectorAll('button')].find(b=>String(b.dataset.method||'')==='term_sale'||/venda\s+a\s+prazo/i.test(b.textContent||''));
    if(!button&&termMethodEnabled()){
      button=document.createElement('button');
      button.type='button';
      button.dataset.method='term_sale';
      button.className='v101-term-button';
      ctx.grid.appendChild(button);
    }
    if(!button)return null;
    button.dataset.method='term_sale';
    button.classList.add('v101-term-button');
    if(button.dataset.v101Ready!=='1'){
      button.dataset.v101Ready='1';
      button.innerHTML=`<i>${termIcon}</i><span>Venda a Prazo</span>`;
      const key=shortcut();
      if(key){const k=document.createElement('kbd');k.className='v100-method-shortcut';k.textContent=key;button.appendChild(k);button.title=`Atalho: ${key}`;}
    }
    return button;
  }

  function setError(ctx,text=''){
    const el=ctx.card.querySelector('#payError');
    if(el)el.textContent=text;
  }

  async function loadTerms(){
    try{cachedTerms=(await window.thor.paymentTerms()).filter(t=>t&&t.active!==false);}catch{cachedTerms=[];}
    return cachedTerms;
  }

  function showImmediateMode(ctx){
    ctx.entry.classList.remove('v101-term-mode');
    const panel=ctx.entry.querySelector('.v101-term-panel');
    if(panel)panel.hidden=true;
  }

  function renderPlanPanel(ctx,terms,termButton){
    let panel=ctx.entry.querySelector('.v101-term-panel');
    if(!panel){panel=document.createElement('section');panel.className='v101-term-panel';ctx.grid.after(panel);}
    panel.hidden=false;
    ctx.entry.classList.add('v101-term-mode');
    ctx.grid.querySelectorAll('[data-method]').forEach(b=>b.classList.toggle('active',b===termButton));

    const c=commercial();
    const current=c.term||{};
    const currentPlan=terms.find(t=>String(t.id)===String(current.payment_term_id))||terms[0];
    const currentCount=Math.max(Math.trunc(n(current.installments)),0);
    panel.innerHTML=`
      <div class="v101-term-head">
        <div><small>VENDA A PRAZO</small><strong>Defina o parcelamento</strong><p>O limite de parcelas, vencimentos e juros vêm das configurações do ThorGestão.</p></div>
        <span class="v101-gestao-badge">ThorGestão</span>
      </div>
      <div class="v101-term-fields">
        <label>Condição de venda<select id="v101TermPlan">${terms.map(t=>`<option value="${h(t.id)}" ${String(t.id)===String(currentPlan?.id)?'selected':''}>${h(t.name||'Venda a prazo')} · ${String(t.method)==='boleto'?'Boleto':'Crediário'}</option>`).join('')}</select></label>
        <label>Quantidade de parcelas<select id="v101TermCount"><option value="">Selecione...</option></select><small id="v101TermLimit"></small></label>
      </div>
      <div id="v101TermWarning"></div>
      <div id="v101TermPreview" class="v101-term-empty">Selecione a quantidade de parcelas para visualizar os vencimentos.</div>
      <div class="v101-term-actions"><button type="button" id="v101TermRemove" class="secondary">Remover prazo</button><button type="button" id="v101TermConfirm" class="primary" disabled>Usar Venda a Prazo</button></div>`;

    const planSelect=panel.querySelector('#v101TermPlan');
    const countSelect=panel.querySelector('#v101TermCount');
    const limit=panel.querySelector('#v101TermLimit');
    const warning=panel.querySelector('#v101TermWarning');
    const preview=panel.querySelector('#v101TermPreview');
    const confirm=panel.querySelector('#v101TermConfirm');
    const remove=panel.querySelector('#v101TermRemove');
    let chosen=null;

    const selectedPlan=()=>terms.find(t=>String(t.id)===String(planSelect.value))||terms[0];
    const fillCounts=(prefer=0)=>{
      const t=selectedPlan();
      const max=Math.min(Math.max(Math.trunc(n(t?.installments)),1),60);
      countSelect.innerHTML='<option value="">Selecione...</option>'+Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1}x</option>`).join('');
      if(prefer>=1&&prefer<=max)countSelect.value=String(prefer);
      limit.textContent=`Permitido pelo Gestão: até ${max}x`;
      const interval=Math.max(Math.trunc(n(t?.interval_days)),1);
      const first=Math.max(Math.trunc(n(t?.first_due_days)),0);
      warning.innerHTML=`<div class="v101-rule-line"><span>1º vencimento <b>${first} dias</b></span><span>Intervalo entre parcelas <b>${interval} dias</b></span><span>Juros <b>${br(t?.interest_percent)}%</b></span></div>${interval>90?`<div class="v101-term-alert">Atenção: o ThorGestão está configurado com intervalo de <b>${interval} dias entre as parcelas</b>. O PDV respeitará exatamente essa regra.</div>`:''}`;
    };

    const drawPreview=()=>{
      const t=selectedPlan();
      const count=Math.trunc(n(countSelect.value));
      const principal=Math.max(n(v3Remaining()),0);
      if(!count){chosen=null;confirm.disabled=true;preview.className='v101-term-empty';preview.textContent='Selecione a quantidade de parcelas para visualizar os vencimentos.';return;}
      const max=Math.max(Math.trunc(n(t?.installments)),1);
      if(count>max){chosen=null;confirm.disabled=true;preview.className='v101-term-empty error';preview.textContent=`O plano permite no máximo ${max} parcelas.`;return;}
      chosen=scheduleFor(t,count,principal);
      confirm.disabled=principal<=0.01;
      preview.className='v101-term-preview';
      preview.innerHTML=`<div class="v101-finance-kpis"><span><small>Saldo financiado</small><b>R$ ${br(chosen.principal)}</b></span><span><small>Juros</small><b>R$ ${br(chosen.interest)}</b></span><span><small>Total a receber</small><b>R$ ${br(chosen.total)}</b></span></div><div class="v101-schedule-title"><b>Parcelamento detalhado</b><small>${count} parcela${count>1?'s':''} · vencimentos definidos pelo Gestão</small></div><div class="v101-schedule-grid">${chosen.rows.map(r=>`<article><span>${r.installment}/${r.installments}</span><b>${r.due_label}</b><strong>R$ ${br(r.amount)}</strong></article>`).join('')}</div>`;
    };

    planSelect.onchange=()=>{fillCounts(0);drawPreview();};
    countSelect.onchange=drawPreview;
    fillCounts(currentPlan&&String(currentPlan.id)===String(current.payment_term_id)?currentCount:0);
    if(countSelect.value)drawPreview();

    confirm.onclick=()=>{
      const t=selectedPlan();
      const count=Math.trunc(n(countSelect.value));
      if(!chosen||!count)return;
      const max=Math.max(Math.trunc(n(t.installments)),1);
      if(count>max)return setError(ctx,`A condição ${t.name||''} permite no máximo ${max} parcelas.`);
      c.term={
        payment_term_id:t.id,
        plan_name:t.name||'Venda a Prazo',
        method:t.method||'crediario',
        installments:count,
        configured_installment_limit:max,
        first_due_days:Math.max(Math.trunc(n(t.first_due_days)),0),
        interval_days:Math.max(Math.trunc(n(t.interval_days)),1),
        interest_percent:Math.max(n(t.interest_percent),0),
        principal_amount:chosen.principal,
        interest_amount:chosen.interest,
        financed_total:chosen.total,
        schedule:chosen.rows.map(r=>({installment:r.installment,due_date:r.due_date,amount:r.amount}))
      };
      termButton.classList.add('active','v101-term-confirmed');
      setError(ctx,'');
      confirm.textContent=`Venda a Prazo configurada · ${count}x`;
      confirm.disabled=true;
      panel.classList.add('confirmed');
    };

    remove.onclick=()=>{
      c.term=null;
      termButton.classList.remove('active','v101-term-confirmed');
      countSelect.value='';
      drawPreview();
      panel.classList.remove('confirmed');
      confirm.textContent='Usar Venda a Prazo';
      setError(ctx,'Venda a Prazo removida desta venda.');
    };
  }

  async function openTerm(ctx,button){
    setError(ctx,'');
    const v=v3State();
    if(!v.customerId){setError(ctx,'Selecione um cliente antes de usar Venda a Prazo.');return;}
    const terms=await loadTerms();
    if(!terms.length){setError(ctx,'Nenhum plano de Venda a Prazo ativo foi sincronizado do ThorGestão.');return;}
    renderPlanPanel(ctx,terms,button);
  }

  function bindCheckout(){
    const ctx=findCheckout();
    if(!ctx||ctx.card.dataset.v101Bound==='1')return false;
    ctx.card.dataset.v101Bound='1';
    ctx.overlay.classList.add('v101-checkout');
    const termButton=ensureTermButton(ctx);
    if(!termButton)return true;

    ctx.grid.addEventListener('click',e=>{
      const button=e.target.closest('button');
      if(!button||!ctx.grid.contains(button))return;
      const code=String(button.dataset.method||'');
      if(code==='term_sale'){
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
        openTerm(ctx,button);
        return;
      }
      showImmediateMode(ctx);
    },true);

    const finish=ctx.card.querySelector('#finishCheckout');
    if(finish&&finish.dataset.v101Bound!=='1'){
      finish.dataset.v101Bound='1';
      finish.addEventListener('click',e=>{
        const c=commercial();
        if(!c.term)return;
        const term=cachedTerms.find(t=>String(t.id)===String(c.term.payment_term_id));
        if(!term)return;
        const count=Math.max(Math.trunc(n(c.term.installments)),1);
        const max=Math.max(Math.trunc(n(term.installments)),1);
        if(count>max){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();setError(ctx,`A condição ${term.name||''} permite no máximo ${max} parcelas.`);return;}
        const sc=scheduleFor(term,count,Math.max(n(v3Remaining()),0));
        c.term={...c.term,installments:count,configured_installment_limit:max,principal_amount:sc.principal,interest_amount:sc.interest,financed_total:sc.total,schedule:sc.rows.map(r=>({installment:r.installment,due_date:r.due_date,amount:r.amount}))};
      },true);
    }
    return true;
  }

  function scheduleBind(){
    let tries=0;
    const tick=()=>{tries++;if(bindCheckout())return;if(tries<12)setTimeout(tick,45);};
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){const result=previous.apply(this,args);scheduleBind();return result;};
  }
})();
