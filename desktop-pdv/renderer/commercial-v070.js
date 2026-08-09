(function () {
  function c70State() {
    const v = v3State();
    if (!v.commercialV070) v.commercialV070 = { salesOrderId:null, salesOrderNumber:null, orderPriceLock:false, term:null, preferredPaymentMethod:null };
    return v.commercialV070;
  }
  const c70Num = (v) => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
  const c70Qty = (v) => c70Num(v).toFixed(3).replace(/\.000$/,'').replace(/(\.\d*[1-9])0+$/,'$1');
  const c70TermLabel = (method) => method==='boleto'?'Boleto':'Crediário';
  const c70PayLabel = (method) => ({cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher',store_credit:'Crédito loja',other:'Outro'})[method] || method || 'A definir';

  function c70TermSummary() {
    const c=c70State(), v=v3State();
    if (!c.term) return '';
    const principal=Math.max(v3Remaining(),0);
    const rate=c70Num(c.term.interest_percent);
    const interest=Math.round(principal*rate)/100;
    const total=principal+interest;
    const installments=Math.max(Number(c.term.installments||1),1);
    const each=total/installments;
    return `<div class="c70-term-summary"><div><span>VENDA A PRAZO</span><b>${esc(c70TermLabel(c.term.method))} • ${installments}x</b></div><small>Saldo ${money(principal)}${rate>0?` + taxa ${rate.toLocaleString('pt-BR')}% (${money(interest)})`:''} • financiado ${money(total)} • aprox. ${money(each)}/parcela</small><button type="button" id="c70RemoveTerm">×</button></div>`;
  }

  function c70PatchCommercialUi() {
    if (state.view!=='sale') return;
    const searchRow=document.querySelector('.search-row');
    if (searchRow && !document.getElementById('c70SalesOrder')) {
      const order=document.createElement('button');order.id='c70SalesOrder';order.type='button';order.className='secondary c70-order-button';order.innerHTML='<span>Pedido de venda</span><small>Buscar pedido</small>';order.onclick=c70OpenOrders;
      const other=document.createElement('button');other.id='c70OtherOptions';other.type='button';other.className='secondary c70-other-button';other.innerHTML='<span>Outras opções</span><small>Suprimento / Sangria</small>';other.onclick=c70OtherOptions;
      const cash=document.getElementById('cash');searchRow.insertBefore(order,cash||null);searchRow.insertBefore(other,cash||null);
    }
    const methods=document.querySelector('.payment-methods');
    if (methods && !document.getElementById('c70TermPayment')) {
      const term=document.createElement('button');term.id='c70TermPayment';term.type='button';term.className='pay c70-term-pay';term.innerHTML='<span>Venda a Prazo</span><kbd>Boleto / Crediário</kbd>';term.onclick=c70OpenTerm;
      methods.appendChild(term);
    }
    const paymentSummary=document.getElementById('paymentSummary');
    if (paymentSummary) {
      let holder=document.getElementById('c70CommercialSummary');
      if (!holder) {holder=document.createElement('div');holder.id='c70CommercialSummary';paymentSummary.parentNode.insertBefore(holder,paymentSummary);}
      const c=c70State();
      const orderHtml=c.salesOrderId?`<div class="c70-order-summary"><span>PEDIDO DE VENDA</span><b>#${esc(c.salesOrderNumber||'')}</b><small>${c.preferredPaymentMethod?`Negociação: ${esc(c70PayLabel(c.preferredPaymentMethod))}`:'Carregado do Gestão'}</small><button id="c70RemoveOrder" type="button">×</button></div>`:'';
      holder.innerHTML=orderHtml+c70TermSummary();
      holder.querySelector('#c70RemoveTerm')?.addEventListener('click',()=>{c.term=null;c70PatchCommercialUi();});
      holder.querySelector('#c70RemoveOrder')?.addEventListener('click',()=>{c.salesOrderId=null;c.salesOrderNumber=null;c.orderPriceLock=false;c.preferredPaymentMethod=null;c.term=null;c70PatchCommercialUi();});
    }
  }

  async function c70OpenOrders() {
    const m=modal(`<div class="v47-modal-head"><div><small>PEDIDOS DO GESTÃO</small><h3>Buscar pedido de venda</h3><p>Carregue um pedido aberto para o caixa e conclua a venda normalmente.</p></div><span>🧾</span></div>
      <div class="c70-order-search"><input id="c70OrderSearch" autocomplete="off" placeholder="Número do pedido ou nome do cliente"><button class="secondary" id="c70OrderSync">Sincronizar</button></div>
      <div id="c70OrderResults" class="c70-order-results"></div><div class="actions"><button class="secondary" id="c70OrderClose">Fechar</button></div>`, 'wide');
    const input=m.querySelector('#c70OrderSearch'), results=m.querySelector('#c70OrderResults');let timer;
    const load=async()=>{try{const rows=await window.thor.salesOrders(input.value);results.innerHTML=rows.length?rows.map((o,i)=>`<button class="c70-order-row" data-order="${i}"><span><small>PEDIDO #${esc(o.number)}</small><b>${esc(o.customer_name||'Cliente')}</b><em>${esc(o.payment_condition==='term'?`${c70TermLabel(o.term_method)} • ${o.installments||1}x`:c70PayLabel(o.payment_method))}</em></span><strong>${money(o.total)}</strong></button>`).join(''):'<div class="c70-empty">Nenhum pedido aberto encontrado.</div>';results.querySelectorAll('[data-order]').forEach(btn=>btn.onclick=()=>c70LoadOrder(rows[Number(btn.dataset.order)],m));}catch(e){results.innerHTML=`<div class="c70-empty">${esc(friendlyError(e?.message))}</div>`;}};
    input.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,140)};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
    m.querySelector('#c70OrderSync').onclick=async()=>{await window.thor.sync();await load();showToast('Pedidos atualizados com o Gestão.');};
    m.querySelector('#c70OrderClose').onclick=()=>m.remove();await load();input.focus();
  }

  async function c70LoadOrder(order,m) {
    try {
      const products=await window.thor.allProducts();const byId=new Map(products.map(p=>[String(p.id),p]));
      const items=[];
      for(const oi of order.items||[]) {const p=byId.get(String(oi.product_id));if(!p)throw new Error(`Produto ${oi.name||oi.product_id} não está sincronizado neste terminal.`);items.push({productId:p.id,name:p.name||oi.name,productCode:p.product_code||oi.product_code||'',reference:p.sku||oi.sku||'',sku:p.sku||oi.sku||'',quantity:c70Num(oi.quantity),unitPrice:c70Num(oi.unit_price),discount:c70Num(oi.discount),unit:p.unit||oi.unit||'UN',isWeighable:Boolean(p.is_weighable),fractioned:Boolean(p.is_weighable)||Boolean(p.fractioned),promptQuantity:Boolean(p.prompt_quantity),allowDiscount:p.allow_discount!==false});}
      state.cart=items;
      const v=v3State(), c=c70State();
      v.customerId=order.customer_id;v.customerName=order.customer_name||'';v.payments=[];v.discount=c70Num(order.discount);v.surcharge=c70Num(order.surcharge);v.supervisorAuthorization=null;
      try{const customers=await window.thor.customers(order.customer_name||'');const cust=(customers||[]).find(x=>String(x.id)===String(order.customer_id));if(cust){v.consumerDocument=String(cust.document||'').replace(/\D/g,'');v.customerEmail=cust.email||'';v.customerPhone=cust.phone||'';}}catch{}
      c.salesOrderId=order.id;c.salesOrderNumber=order.number;c.orderPriceLock=true;c.preferredPaymentMethod=order.payment_condition==='immediate'?order.payment_method:null;
      c.term=order.payment_condition==='term'?{payment_term_id:order.payment_term_id||null,method:order.term_method,installments:Number(order.installments||1),first_due_days:Number(order.first_due_days??30),interval_days:Number(order.interval_days??30),interest_percent:c70Num(order.interest_percent)}:null;
      v.quote={subtotal:c70Num(order.subtotal),discount:v.discount,surcharge:v.surcharge,total:c70Num(order.total)};
      m.remove();renderSaleWorkspace();queueMicrotask(()=>{v.quote={subtotal:c70Num(order.subtotal),discount:v.discount,surcharge:v.surcharge,total:c70Num(order.total)};v3RenderCart();c70PatchCommercialUi();});
      showToast(`Pedido #${order.number} carregado para ${order.customer_name}.`);
    } catch(e){infoModal('Pedido de venda',friendlyError(e?.message));}
  }

  async function c70OpenTerm() {
    const v=v3State();if(!v.customerId)return infoModal('Venda a Prazo','Selecione primeiro um cliente cadastrado no Gestão. Vendas a prazo exigem cliente identificado.');
    const terms=await window.thor.paymentTerms().catch(()=>[]);if(!terms.length)return infoModal('Venda a Prazo','Nenhum plano de Boleto/Crediário foi sincronizado. Cadastre um plano em Gestão → Vendas → Pedidos de Venda.');
    const c=c70State();
    const m=modal(`<div class="v47-modal-head"><div><small>NEGOCIAÇÃO</small><h3>Venda a Prazo</h3><p>O saldo não pago agora será enviado para Contas a Receber.</p></div><span>📅</span></div>
      <div class="field"><label>Plano<select id="c70TermPlan">${terms.map((t,i)=>`<option value="${i}">${esc(t.name)} — ${esc(c70TermLabel(t.method))}</option>`).join('')}</select></label></div>
      <div class="c70-term-grid"><label>Parcelas<input id="c70Installments" type="number" min="1" max="60"></label><label>1º vencimento (dias)<input id="c70FirstDue" type="number" min="0"></label><label>Intervalo (dias)<input id="c70Interval" type="number" min="1"></label><label>Taxa %<input id="c70Interest" type="number" min="0" step="0.01"></label></div>
      <div id="c70TermPreview" class="c70-term-preview"></div><div class="actions"><button class="secondary" id="c70TermCancel">Cancelar</button><button class="primary" id="c70TermApply">Usar venda a prazo</button></div>`, 'wide');
    const plan=m.querySelector('#c70TermPlan'),ins=m.querySelector('#c70Installments'),first=m.querySelector('#c70FirstDue'),interval=m.querySelector('#c70Interval'),interest=m.querySelector('#c70Interest'),preview=m.querySelector('#c70TermPreview');
    const fill=()=>{const t=terms[Number(plan.value)]||terms[0];ins.value=t.installments||1;first.value=t.first_due_days??30;interval.value=t.interval_days??30;interest.value=t.interest_percent||0;calc();};
    const calc=()=>{const principal=Math.max(v3Remaining(),0),rate=c70Num(interest.value),total=principal+(principal*rate/100),n=Math.max(Number(ins.value||1),1);preview.innerHTML=`<span>Saldo a financiar <b>${money(principal)}</b></span><span>Total com taxa <b>${money(total)}</b></span><span>${n} parcela(s) de aprox. <b>${money(total/n)}</b></span>`;};
    plan.onchange=fill;[ins,first,interval,interest].forEach(x=>x.oninput=calc);m.querySelector('#c70TermCancel').onclick=()=>m.remove();m.querySelector('#c70TermApply').onclick=()=>{const t=terms[Number(plan.value)]||terms[0];c.term={payment_term_id:t.id,method:t.method,installments:Math.max(Number(ins.value||1),1),first_due_days:Math.max(Number(first.value||0),0),interval_days:Math.max(Number(interval.value||1),1),interest_percent:Math.max(c70Num(interest.value),0)};m.remove();c70PatchCommercialUi();showToast(`${c70TermLabel(t.method)} configurado em ${c.term.installments} parcela(s).`);};
    fill();
  }

  function c70OtherOptions() {
    const m=modal(`<div class="v47-modal-head"><div><small>OUTRAS OPÇÕES</small><h3>Movimentação de caixa</h3><p>Registre suprimento ou sangria. O motivo é obrigatório e deve ter no mínimo 15 caracteres.</p></div><span>↕</span></div>
      <div class="c70-movement-types"><button type="button" class="active" data-c70-type="supply"><b>Suprimento</b><small>Entrada manual de dinheiro no caixa</small></button><button type="button" data-c70-type="withdrawal"><b>Sangria</b><small>Retirada manual de dinheiro do caixa</small></button></div>
      <div class="field"><label>Valor<input id="c70MovementAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></label></div>
      <div class="field"><label>Motivo da operação<textarea id="c70MovementReason" rows="3" maxlength="240" placeholder="Descreva o motivo com pelo menos 15 caracteres"></textarea><small id="c70ReasonCount">0 / mínimo 15</small></label></div>
      <div id="c70MovementError" class="settings-error"></div><div class="actions"><button class="secondary" id="c70MovementCancel">Cancelar</button><button class="primary" id="c70MovementConfirm">Confirmar e imprimir</button></div>`, 'wide');
    let type='supply';const reason=m.querySelector('#c70MovementReason'),count=m.querySelector('#c70ReasonCount'),err=m.querySelector('#c70MovementError');
    m.querySelectorAll('[data-c70-type]').forEach(b=>b.onclick=()=>{type=b.dataset.c70Type;m.querySelectorAll('[data-c70-type]').forEach(x=>x.classList.toggle('active',x===b));});
    reason.oninput=()=>{count.textContent=`${reason.value.trim().length} / mínimo 15`;reason.classList.toggle('invalid',reason.value.trim().length<15);};m.querySelector('#c70MovementCancel').onclick=()=>m.remove();
    m.querySelector('#c70MovementConfirm').onclick=async()=>{const amount=c70Num(m.querySelector('#c70MovementAmount').value),notes=reason.value.trim();if(amount<=0){err.textContent='Informe um valor maior que zero.';return;}if(notes.length<15){err.textContent='O motivo precisa ter no mínimo 15 caracteres.';reason.focus();return;}const btn=m.querySelector('#c70MovementConfirm');try{btn.disabled=true;btn.textContent='Registrando...';const result=await window.thor.cashMovement({movementType:type,amount,notes});let printError='';try{await window.thor.printCashMovement(result.receipt);}catch(e){printError=friendlyError(e?.message);}m.remove();showToast(`${type==='supply'?'Suprimento':'Sangria'} de ${money(amount)} registrado.${printError?' Comprovante não impresso.':''}`);if(printError)infoModal('Impressão',`A operação foi registrada, mas o comprovante não foi impresso: ${printError}`);}catch(e){err.textContent=friendlyError(e?.message);btn.disabled=false;btn.textContent='Confirmar e imprimir';}};
  }

  const previousReprice=v3Reprice;
  v3Reprice=async function(){const c=c70State(),v=v3State();if(c.orderPriceLock&&c.salesOrderId){const subtotal=state.cart.reduce((s,i)=>s+c70Num(i.quantity)*c70Num(i.unitPrice)-c70Num(i.discount),0);v.quote={subtotal,discount:c70Num(v.discount),surcharge:c70Num(v.surcharge),total:Math.max(subtotal-c70Num(v.discount)+c70Num(v.surcharge),0)};v3RenderCart();c70PatchCommercialUi();return v.quote;}const r=await previousReprice();c70PatchCommercialUi();return r;};repriceCart=v3Reprice;

  const previousComplete=v3CompleteCheckout;
  v3CompleteCheckout=async function(){const c=c70State(),v=v3State();const remaining=v3Remaining();if(c.term&&!v.customerId)return infoModal('Venda a Prazo','Venda a prazo exige um cliente cadastrado e identificado.');if(!c.term&&remaining>0.01)return infoModal('Pagamento pendente','A venda à vista precisa estar totalmente paga. Para deixar saldo, escolha Venda a Prazo (Boleto ou Crediário).');if(c.term&&remaining<=0.01)return infoModal('Venda a Prazo','Não existe saldo restante para financiar. Remova a venda a prazo ou reduza os pagamentos à vista.');try{await window.thor.setCommercialContext({salesOrderId:c.salesOrderId,term:c.term});return await previousComplete();}finally{try{await window.thor.setCommercialContext({});}catch{}}};

  const previousReset=v3ResetSale;
  v3ResetSale=function(){const result=previousReset();const c=c70State();c.salesOrderId=null;c.salesOrderNumber=null;c.orderPriceLock=false;c.term=null;c.preferredPaymentMethod=null;return result;};

  const previousWorkspace=renderSaleWorkspace;
  renderSaleWorkspace=function(){const result=previousWorkspace();queueMicrotask(c70PatchCommercialUi);return result;};
  const previousCart=v3RenderCart;
  v3RenderCart=function(){const result=previousCart();queueMicrotask(c70PatchCommercialUi);return result;};renderCart=v3RenderCart;

  const previousFriendly=friendlyError;
  friendlyError=function(code){const map={cash_movement_reason_min_15:'Informe um motivo com pelo menos 15 caracteres.',term_sale_requires_customer:'Venda a prazo exige cliente cadastrado.',term_required_for_unpaid_balance:'Existe saldo pendente. Use Venda a Prazo para gerar Contas a Receber.',term_sale_has_no_financed_balance:'Não há saldo para financiar.',sales_order_customer_mismatch:'O cliente selecionado não corresponde ao cliente do pedido.',invalid_term_method:'Plano de venda a prazo inválido.',invalid_installment_count:'Quantidade de parcelas inválida.',invalid_term_schedule:'Prazo de vencimento inválido.'};return map[String(code||'')]||previousFriendly(code);};
})();
