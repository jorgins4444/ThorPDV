(function(){
  const fallback=[{code:'cash',name:'Dinheiro'},{code:'pix',name:'PIX'},{code:'debit_card',name:'Débito'},{code:'credit_card',name:'Crédito'},{code:'voucher',name:'Voucher'}];
  const val=(v)=>String(v??'').trim();
  const number=(v)=>{const n=Number(v||0);return Number.isFinite(n)?n:0};
  function options(){return v3State().salesOptions||state.status?.salesOptions||{};}
  function methods(){const rows=(options().payment_methods||[]).filter(x=>x.active!==false&&x.code!=='term_sale');return rows.length?rows:fallback;}
  function brands(){return (options().card_brands||[]).filter(x=>x.active!==false);}
  function acquirers(){return (options().card_acquirers||[]).filter(x=>x.active!==false);}
  function installments(){const rows=(options().credit_installments||[]).filter(x=>x.active!==false).sort((a,b)=>Number(a.installments)-Number(b.installments));return rows.length?rows:Array.from({length:12},(_,i)=>({installments:i+1,interest_percent:0}));}
  function label(code){return val(methods().find(x=>x.code===code)?.name)||({cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher',store_credit:'Crédito loja',other:'Outro'})[code]||code;}
  function preferredAcquirer(){return acquirers().find(x=>x.preferred)||acquirers()[0]||null;}

  const previousHydrate=v3Hydrate;
  v3Hydrate=async function(){await previousHydrate();try{const status=await window.thor.status();v3State().salesOptions=status.salesOptions||{};}catch{}}

  function patchButtons(){
    const allowed=new Map(methods().map(x=>[val(x.code),val(x.name)]));
    const holder=document.querySelector('.payment-methods');if(!holder)return;
    holder.querySelectorAll('[data-v3-pay]').forEach(btn=>{const code=btn.dataset.v3Pay;btn.style.display=allowed.has(code)?'':'none';const span=btn.querySelector('span');if(span&&allowed.has(code))span.textContent=allowed.get(code);});
    for(const [code,name] of allowed){if(holder.querySelector(`[data-v3-pay="${CSS.escape(code)}"]`))continue;const b=document.createElement('button');b.className='pay';b.dataset.v3Pay=code;b.innerHTML=`<span>${esc(name)}</span><kbd></kbd>`;b.onclick=()=>v3PaymentModal(code);holder.appendChild(b);}
  }
  const previousRenderSale=renderSaleWorkspace;
  renderSaleWorkspace=function(){previousRenderSale();setTimeout(patchButtons,0);};

  v3PaymentModal=function(initialMethod='cash'){
    const v=v3State();if(!state.cart.length)return;
    const available=methods();let selected=available.some(x=>x.code===initialMethod)?initialMethod:val(available[0]?.code||'cash');
    const orderCard=v.salesOptionsOrderCard||{};
    let selectedBrand=val(orderCard.brand)||val(brands()[0]?.code||'');
    let selectedAcquirer=val(orderCard.acquirer)||val(preferredAcquirer()?.cnpj||'');
    let selectedInstallment=Math.max(Number(orderCard.installments||installments()[0]?.installments||1),1);
    const methodButtons=()=>available.map(x=>`<button data-method="${esc(x.code)}" class="${x.code===selected?'active':''}">${esc(x.name)}</button>`).join('');
    const m=modal(`<div class="payment-head"><div><small>FECHAMENTO</small><h3>Formas de pagamento</h3></div><strong>${money(v3Total())}</strong></div><div id="payList" class="pay-list"></div><div class="payment-entry"><div class="payment-method-grid">${methodButtons()}</div><div class="field"><label>Valor desta forma</label><input id="payAmount" type="number" min="0.01" step="0.01" value="${v3Remaining().toFixed(2)}"></div><div class="field" id="cashTenderWrap"><label>Valor entregue pelo cliente</label><input id="cashTender" type="number" min="0.01" step="0.01" value="${v3Remaining().toFixed(2)}"></div><div id="s71CardFields"></div><div class="payment-entry-actions"><button class="secondary" id="integratedPay">Autorizar TEF/PIX</button><button class="primary" id="addPayment">Adicionar pagamento</button></div><div id="payError" class="settings-error"></div></div><div class="payment-footer"><div><span>Pago</span><b id="modalPaid"></b><span>Restante</span><b id="modalRemaining"></b><span>Troco</span><b id="modalChange"></b></div><div class="actions"><button class="secondary" id="payBack">Voltar</button><button class="primary" id="finishCheckout">Concluir venda</button></div></div>`,'wide');
    const amount=m.querySelector('#payAmount'),tender=m.querySelector('#cashTender'),err=m.querySelector('#payError'),cardHolder=m.querySelector('#s71CardFields');

    function renderCard(){
      m.querySelector('#cashTenderWrap').style.display=selected==='cash'?'':'none';
      if(selected==='credit_card'){
        const ins=installments();
        cardHolder.innerHTML=`<div class="s71-card-grid s71-credit-installments-only"><div class="field"><label>Parcelas</label><select id="s71Installments">${ins.map(x=>`<option value="${Number(x.installments)}" ${Number(x.installments)===selectedInstallment?'selected':''}>${Number(x.installments)}x${number(x.interest_percent)>0?` • taxa ${number(x.interest_percent).toLocaleString('pt-BR')}%`:''}</option>`).join('')}</select></div></div>`;
        cardHolder.querySelector('#s71Installments')?.addEventListener('change',e=>selectedInstallment=Math.max(Number(e.target.value||1),1));
        return;
      }
      if(selected==='debit_card'){
        const bs=brands(),acs=acquirers();
        cardHolder.innerHTML=`<div class="s71-card-grid"><div class="field"><label>Bandeira</label><select id="s71Brand"><option value="">Selecione...</option>${bs.map(x=>`<option value="${esc(x.code)}" ${x.code===selectedBrand?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Credenciadora</label><select id="s71Acquirer"><option value="">Selecione...</option>${acs.map(x=>`<option value="${esc(x.cnpj)}" ${x.cnpj===selectedAcquirer?'selected':''}>${esc(x.name)} — ${esc(x.cnpj)}</option>`).join('')}</select></div></div>${!acs.length?'<div class="settings-error">Nenhuma credenciadora habilitada. Configure em Gestão → Administrativo → Configurações → Opções de Vendas.</div>':''}`;
        cardHolder.querySelector('#s71Brand')?.addEventListener('change',e=>selectedBrand=e.target.value);
        cardHolder.querySelector('#s71Acquirer')?.addEventListener('change',e=>selectedAcquirer=e.target.value);
        return;
      }
      cardHolder.innerHTML='';
    }

    function cardData(){
      if(selected==='credit_card'){
        const brand=selectedBrand||val(brands()[0]?.code||'');
        const acquirer=selectedAcquirer||val(preferredAcquirer()?.cnpj||'');
        return {provider:acquirer||null,metadata:{card_brand_code:brand,card_acquirer_cnpj:acquirer,card_installments:selectedInstallment}};
      }
      if(selected==='debit_card')return {provider:selectedAcquirer,metadata:{card_brand_code:selectedBrand,card_acquirer_cnpj:selectedAcquirer,card_installments:1}};
      return {};
    }

    function validateCard(){
      if(selected==='credit_card'){
        if(!brands().length)return 'Nenhuma bandeira de cartão está habilitada no ThorGestão.';
        if(!acquirers().length)return 'Nenhuma credenciadora está habilitada no ThorGestão.';
        return installments().some(x=>Number(x.installments)===selectedInstallment)?'':'Parcelamento não habilitado.';
      }
      if(selected==='debit_card'){
        if(!selectedBrand)return 'Selecione a bandeira do cartão.';
        if(!selectedAcquirer)return 'Selecione a credenciadora do cartão.';
      }
      return '';
    }

    const paymentDetail=(p)=>{
      const parts=[];
      if(p.metadata?.card_brand_code)parts.push(esc(p.metadata.card_brand_code));
      if(p.method==='credit_card'&&p.metadata?.card_installments)parts.push(`${Number(p.metadata.card_installments)}x`);
      return parts.length?` <small>${parts.join(' • ')}</small>`:'';
    };
    const refresh=()=>{const list=m.querySelector('#payList');list.innerHTML=v.payments.length?v.payments.map((p,i)=>`<div class="pay-line"><span>${esc(label(p.method))}${p.integrated?' <small>integrado</small>':''}${paymentDetail(p)}</span><b>${money(p.amount)}</b>${Number(p.changeAmount||0)>0?`<em>Troco ${money(p.changeAmount)}</em>`:''}<button data-pay-remove="${i}">Remover</button></div>`).join(''):'<div class="empty small">Nenhum pagamento adicionado.</div>';list.querySelectorAll('[data-pay-remove]').forEach(b=>b.onclick=()=>{v.payments.splice(Number(b.dataset.payRemove),1);amount.value=v3Remaining().toFixed(2);tender.value=amount.value;refresh();v3RenderCart();});m.querySelector('#modalPaid').textContent=money(v3Paid());m.querySelector('#modalRemaining').textContent=money(v3Remaining());m.querySelector('#modalChange').textContent=money(v3Change());};
    m.querySelectorAll('[data-method]').forEach(b=>b.onclick=()=>{selected=b.dataset.method;m.querySelectorAll('[data-method]').forEach(x=>x.classList.toggle('active',x.dataset.method===selected));amount.value=v3Remaining().toFixed(2);tender.value=amount.value;err.textContent='';renderCard();});
    const addManual=()=>{const cardError=validateCard();if(cardError)return err.textContent=cardError;const remaining=v3Remaining();const requested=Math.max(Number(amount.value||0),0);if(requested<=0)return err.textContent='Informe um valor.';const applied=Math.min(requested,remaining);if(selected==='cash'){const delivered=Math.max(Number(tender.value||0),0);if(delivered+0.001<applied)return err.textContent='Valor entregue é menor que o valor aplicado.';v.payments.push({method:'cash',amount:applied,tenderedAmount:delivered,changeAmount:Math.max(delivered-applied,0)});}else v.payments.push({method:selected,amount:applied,...cardData()});amount.value=v3Remaining().toFixed(2);tender.value=amount.value;refresh();v3RenderCart();};
    m.querySelector('#addPayment').onclick=addManual;
    m.querySelector('#integratedPay').onclick=async()=>{if(selected==='cash')return err.textContent='Dinheiro não usa TEF/PIX.';const cardError=validateCard();if(cardError)return err.textContent=cardError;try{const applied=Math.min(Math.max(Number(amount.value||0),0),v3Remaining());if(applied<=0)return;const r=await window.thor.beginPayment({method:selected,amount:applied});const card=cardData();v.payments.push({method:selected,amount:applied,integrated:true,provider:card.provider||r.provider,externalId:r.externalId,txid:r.txid,metadata:{...(r.metadata||{}),...(card.metadata||{})}});amount.value=v3Remaining().toFixed(2);refresh();v3RenderCart();}catch(e){err.textContent=friendlyError(e.message);}};
    m.querySelector('#payBack').onclick=()=>m.remove();m.querySelector('#finishCheckout').onclick=async()=>{if(v3Remaining()>0.01)return err.textContent=`Ainda faltam ${money(v3Remaining())}.`;m.remove();await v3CompleteCheckout();};renderCard();refresh();
  };

  const oldRenderCart=v3RenderCart;
  v3RenderCart=function(){oldRenderCart();const pay=document.getElementById('paymentSummary');if(pay&&v3State().payments.length)pay.querySelectorAll('span').forEach((span,i)=>{const p=v3State().payments[i];if(p)span.childNodes[0].textContent=label(p.method);});};renderCart=v3RenderCart;
})();
