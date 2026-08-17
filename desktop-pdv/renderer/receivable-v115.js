(function(){
  if(window.__thorReceivableV115)return;
  window.__thorReceivableV115=true;

  const n=(value)=>{const x=Number(value||0);return Number.isFinite(x)?x:0;};
  const brMoney=(value)=>n(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const digits=(value)=>String(value||'').replace(/\D/g,'');
  const brDate=(value)=>{if(!value)return '—';const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value))?`${value}T12:00:00`:value);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('pt-BR');};
  const methodIcon=(code)=>({cash:'▤',pix:'◇',debit_card:'▣',credit_card:'▣',other:'•••'}[code]||'●');
  const methodLabel=(code,name)=>name||({cash:'Dinheiro',pix:'PIX',debit_card:'Cartão de débito',credit_card:'Cartão de crédito',other:'Outros'}[code]||code);
  const formatDoc=(value)=>{
    const d=digits(value);
    if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
    if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
    return String(value||'—');
  };

  function friendly(code){
    const map={
      invalid_device:'Este caixa precisa estar conectado ao ThorGestão para consultar o crediário.',
      cash_not_open:'Abra o caixa antes de realizar um recebimento.',
      customer_required:'Selecione um cliente para realizar o recebimento.',
      customer_not_found:'Cliente não localizado ou inativo.',
      operator_required:'Identifique um operador antes de receber o crediário.',
      receivable_items_required:'Selecione pelo menos uma parcela para receber.',
      invalid_receivable_amount:'Informe um valor válido para cada parcela selecionada.',
      receivable_not_open:'Uma das parcelas já foi quitada ou alterada. Atualize a consulta.',
      crediario_receivable_only:'Esta conta não pertence ao crediário e não pode ser recebida por este módulo.',
      receivable_amount_exceeds_remaining:'O valor informado é maior que o saldo atual da parcela.',
      duplicate_receivable_item:'A mesma parcela foi selecionada mais de uma vez.',
      invalid_payment_method:'A forma de pagamento escolhida não está habilitada para recebimentos.',
      sync_timeout:'A consulta ao ThorGestão demorou mais que o esperado. Verifique a conexão e tente novamente.',
      sync_busy:'O ThorPDV está sincronizando. Aguarde alguns segundos e tente novamente.',
      thermal_printer_required:'Configure uma impressora térmica para imprimir o comprovante de recebimento.',
      printer_not_configured:'Nenhuma impressora está configurada neste caixa.'
    };
    return map[String(code||'')]||(typeof friendlyError==='function'?friendlyError(String(code||'')):String(code||'Erro não identificado.'));
  }

  function ensureActionButton(){
    document.querySelectorAll('.v089-actions-modal .v089-menu-grid').forEach(grid=>{
      if(grid.querySelector('[data-act="receivable"]'))return;
      const button=document.createElement('button');
      button.type='button';
      button.dataset.act='receivable';
      button.className='v115-receivable-action';
      button.innerHTML='<i>R$</i><b>Recebimento</b><small>Receber parcelas do crediário</small>';
      const fiscal=grid.querySelector('[data-act="fiscal"]');
      if(fiscal)grid.insertBefore(button,fiscal);
      else grid.appendChild(button);
      button.onclick=()=>{
        const wrap=button.closest('.modal');
        wrap?.remove();
        setTimeout(openReceivable,20);
      };
    });
  }

  function customerAddress(customer){
    return [[customer?.street,customer?.number].filter(Boolean).join(', '),customer?.district,[customer?.city,customer?.state].filter(Boolean).join('/'),customer?.postal_code?`CEP ${customer.postal_code}`:''].filter(Boolean).join(' • ');
  }

  async function openReceivable(){
    try{await refreshStatus?.();}catch{}
    if(!state?.status?.cashOpenEventId){
      infoModal('Recebimento','O caixa precisa estar aberto antes de receber parcelas do crediário.');
      return;
    }

    const m=modal(`<div class="v115-head"><div class="v115-head-icon">R$</div><div><small>AÇÕES • FINANCEIRO</small><h3>Recebimento de Crediário</h3><p>Localize o cliente pelo nome ou CPF/CNPJ e receba uma ou várias parcelas, de forma total ou parcial.</p></div><button type="button" class="v115-close" id="v115Close">×</button></div>
      <div class="v115-online-note"><span>●</span><div><b>Consulta em tempo real</b><small>Os saldos são conferidos no ThorGestão antes da baixa para evitar recebimento duplicado.</small></div></div>
      <div class="v115-search"><span>⌕</span><input id="v115Query" autocomplete="off" placeholder="Nome do cliente ou CPF/CNPJ"><button class="primary" id="v115Search">Localizar</button></div>
      <div id="v115Body" class="v115-body"><div class="v115-empty"><i>◎</i><b>Localize o cliente</b><span>Digite parte do nome, CPF ou CNPJ para consultar as contas em aberto do crediário.</span></div></div>`, 'wide');
    m.classList.add('v115-receivable-modal');
    const query=m.querySelector('#v115Query'),body=m.querySelector('#v115Body');
    m.querySelector('#v115Close').onclick=()=>m.remove();

    const search=async()=>{
      const q=query.value.trim();
      if(q.length<2&&digits(q).length<3){body.innerHTML='<div class="v115-empty warn"><i>⌕</i><b>Informe mais dados</b><span>Digite pelo menos 2 letras do nome ou 3 números do CPF/CNPJ.</span></div>';query.focus();return;}
      body.innerHTML='<div class="v115-loading"><span></span><b>Consultando crediário...</b><small>Buscando clientes e saldos atualizados no ThorGestão.</small></div>';
      try{
        const result=await window.thor.receivables(q,null);
        renderCustomers(m,result);
      }catch(error){body.innerHTML=`<div class="v115-empty error"><i>!</i><b>Não foi possível consultar</b><span>${esc(friendly(error?.message))}</span><button class="secondary" id="v115Retry">Tentar novamente</button></div>`;body.querySelector('#v115Retry').onclick=search;}
    };
    m.querySelector('#v115Search').onclick=search;
    query.onkeydown=(event)=>{if(event.key==='Enter'){event.preventDefault();search();}};
    setTimeout(()=>query.focus(),50);
  }

  function renderCustomers(m,result){
    const body=m.querySelector('#v115Body');
    const rows=Array.isArray(result?.customers)?result.customers:[];
    if(!rows.length){body.innerHTML='<div class="v115-empty"><i>✓</i><b>Nenhum crediário em aberto</b><span>Não encontramos parcelas pendentes para a pesquisa informada.</span></div>';return;}
    body.innerHTML=`<div class="v115-section-title"><div><small>RESULTADOS</small><b>${rows.length} cliente(s) com crediário em aberto</b></div></div><div class="v115-customers">${rows.map((c,index)=>`<button type="button" class="v115-customer" data-v115-customer="${index}"><span class="v115-avatar">${esc(String(c.name||'?').trim().slice(0,1).toUpperCase())}</span><div class="v115-customer-main"><b>${esc(c.name||'Cliente')}</b><small>${esc(formatDoc(c.document))}${c.phone?` • ${esc(c.phone)}`:''}</small></div><div class="v115-customer-kpi ${Number(c.overdue_count||0)>0?'overdue':''}"><span>${Number(c.open_count||0)} parcela(s)</span><b>${brMoney(c.open_total)}</b>${Number(c.overdue_count||0)>0?`<small>${Number(c.overdue_count)} vencida(s)</small>`:'<small>em aberto</small>'}</div><i class="v115-arrow">›</i></button>`).join('')}</div>`;
    body.querySelectorAll('[data-v115-customer]').forEach(button=>button.onclick=()=>loadCustomer(m,rows[Number(button.dataset.v115Customer)],result.payment_methods||[]));
  }

  async function loadCustomer(m,customer,knownMethods=[]){
    const body=m.querySelector('#v115Body');
    body.innerHTML='<div class="v115-loading"><span></span><b>Carregando parcelas...</b><small>Conferindo vencimentos e saldos do cliente.</small></div>';
    try{
      const result=await window.thor.receivables('',customer.id);
      renderEntries(m,result,knownMethods.length?knownMethods:(result.payment_methods||[]));
    }catch(error){body.innerHTML=`<div class="v115-empty error"><i>!</i><b>Falha ao carregar parcelas</b><span>${esc(friendly(error?.message))}</span><button class="secondary" id="v115BackSearch">Voltar à pesquisa</button></div>`;body.querySelector('#v115BackSearch').onclick=()=>m.querySelector('#v115Search').click();}
  }

  function renderEntries(m,result,methods){
    const body=m.querySelector('#v115Body');
    const customer=result.customer||{};
    const entries=Array.isArray(result.entries)?result.entries:[];
    const overdue=entries.filter(row=>row.overdue).length;
    const allowedMethods=(methods||[]).filter(row=>['cash','pix','debit_card','credit_card','other'].includes(String(row.code||'')));
    if(!entries.length){body.innerHTML=`<div class="v115-empty"><i>✓</i><b>Crediário quitado</b><span>${esc(customer.name||'O cliente')} não possui parcelas pendentes.</span><button class="secondary" id="v115NewSearch">Pesquisar outro cliente</button></div>`;body.querySelector('#v115NewSearch').onclick=()=>{m.querySelector('#v115Query').value='';m.querySelector('#v115Body').innerHTML='<div class="v115-empty"><i>◎</i><b>Localize o cliente</b><span>Digite o nome ou CPF/CNPJ.</span></div>';m.querySelector('#v115Query').focus();};return;}

    body.innerHTML=`<div class="v115-customer-head"><button type="button" class="secondary" id="v115Back">← Voltar</button><div class="v115-selected-customer"><span class="v115-avatar">${esc(String(customer.name||'?').slice(0,1).toUpperCase())}</span><div><small>CLIENTE SELECIONADO</small><b>${esc(customer.name||'Cliente')}</b><span>${esc(formatDoc(customer.document))}${customerAddress(customer)?` • ${esc(customerAddress(customer))}`:''}</span></div></div><div class="v115-credit-total"><span>Saldo do crediário</span><b>${brMoney(result.open_total)}</b><small>${entries.length} parcela(s)${overdue?` • ${overdue} vencida(s)`:''}</small></div></div>
      <div class="v115-selection-tools"><label><input type="checkbox" id="v115SelectAll"><span>Selecionar todas as parcelas</span></label><div><span>Selecionado</span><b id="v115SelectedTotal">${brMoney(0)}</b></div></div>
      <div class="v115-entry-list">${entries.map((row,index)=>`<div class="v115-entry ${row.overdue?'overdue':''}" data-v115-entry="${index}"><label class="v115-check"><input type="checkbox" data-v115-check="${index}"><span></span></label><div class="v115-entry-id"><b>${row.installment&&row.installments?`${row.installment}/${row.installments}`:'Parcela'}</b><small>${row.sale_number?`Venda #${esc(row.sale_number)}`:esc(row.description||'Crediário')}</small></div><div><span>Vencimento</span><b>${brDate(row.due_date)}</b>${row.overdue?'<small class="bad">Vencida</small>':'<small>Em aberto</small>'}</div><div><span>Valor original</span><b>${brMoney(row.amount)}</b><small>Recebido ${brMoney(row.paid_amount)}</small></div><div><span>Saldo atual</span><b>${brMoney(row.remaining)}</b><small>${String(row.status)==='partial'?'Pagamento parcial':'A receber'}</small></div><label class="v115-amount"><span>Receber agora</span><div><em>R$</em><input data-v115-amount="${index}" type="number" min="0.01" max="${Number(row.remaining).toFixed(2)}" step="0.01" value="${Number(row.remaining).toFixed(2)}" disabled></div></label></div>`).join('')}</div>
      <section class="v115-payment"><div class="v115-section-title"><div><small>FORMA DE RECEBIMENTO</small><b>Como o cliente está pagando?</b></div><span>O recebimento será registrado no fechamento deste caixa.</span></div><div class="v115-methods">${allowedMethods.length?allowedMethods.map((method,index)=>`<button type="button" data-v115-method="${esc(method.code)}" class="${index===0?'active':''}"><i>${methodIcon(method.code)}</i><b>${esc(methodLabel(method.code,method.name))}</b><small>${method.code==='cash'?'Entra no dinheiro físico da gaveta':method.code==='pix'?'Recebimento eletrônico':method.code.includes('card')?'Pagamento por cartão':'Outra forma'}</small></button>`).join(''):'<div class="v115-method-empty">Nenhuma forma de pagamento compatível está habilitada no ThorGestão.</div>'}</div></section>
      <div class="v115-footer"><label class="v115-notes"><span>Observação</span><input id="v115Notes" maxlength="160" placeholder="Opcional: referência, observação do recebimento..."></label><div class="v115-receive-summary"><span>Total a receber</span><b id="v115FooterTotal">${brMoney(0)}</b><small id="v115AfterHint">Selecione as parcelas.</small></div><button class="primary" id="v115Receive" disabled>Confirmar recebimento</button></div>`;

    let selectedMethod=allowedMethods[0]?.code||'';
    const checks=[...body.querySelectorAll('[data-v115-check]')];
    const amounts=[...body.querySelectorAll('[data-v115-amount]')];
    const recalc=()=>{
      let total=0,count=0;
      checks.forEach((check,index)=>{
        const input=amounts[index];
        input.disabled=!check.checked;
        const row=entries[index];
        let value=n(input.value);
        if(value>n(row.remaining)){value=n(row.remaining);input.value=value.toFixed(2);}
        if(check.checked&&value>0){total+=value;count++;}
        body.querySelector(`[data-v115-entry="${index}"]`)?.classList.toggle('selected',check.checked);
      });
      body.querySelector('#v115SelectedTotal').textContent=brMoney(total);
      body.querySelector('#v115FooterTotal').textContent=brMoney(total);
      body.querySelector('#v115AfterHint').textContent=count?`${count} parcela(s) selecionada(s) • total ou parcial por parcela`:'Selecione uma ou mais parcelas.';
      const receive=body.querySelector('#v115Receive');receive.disabled=!(count&&total>0.009&&selectedMethod);
      const all=body.querySelector('#v115SelectAll');all.checked=checks.length>0&&checks.every(x=>x.checked);all.indeterminate=checks.some(x=>x.checked)&&!checks.every(x=>x.checked);
      return {total,count};
    };
    checks.forEach((check,index)=>check.onchange=()=>{if(check.checked&&n(amounts[index].value)<=0)amounts[index].value=Number(entries[index].remaining).toFixed(2);recalc();});
    amounts.forEach(input=>input.oninput=recalc);
    body.querySelector('#v115SelectAll').onchange=(event)=>{checks.forEach((check,index)=>{check.checked=event.target.checked;if(check.checked)amounts[index].value=Number(entries[index].remaining).toFixed(2);});recalc();};
    body.querySelectorAll('[data-v115-method]').forEach(button=>button.onclick=()=>{selectedMethod=button.dataset.v115Method;body.querySelectorAll('[data-v115-method]').forEach(x=>x.classList.toggle('active',x===button));recalc();});
    body.querySelector('#v115Back').onclick=()=>m.querySelector('#v115Search').click();
    body.querySelector('#v115Receive').onclick=()=>receive(m,result,entries,checks,amounts,selectedMethod);
    recalc();
  }

  async function receive(m,result,entries,checks,amounts,paymentMethod){
    const body=m.querySelector('#v115Body');
    const items=[];
    checks.forEach((check,index)=>{if(check.checked){const amount=n(amounts[index].value);if(amount>0)items.push({financialEntryId:entries[index].financial_entry_id,amount});}});
    if(!items.length)return;
    const total=items.reduce((sum,item)=>sum+n(item.amount),0);
    if(!confirm(`Confirmar recebimento de ${brMoney(total)}?\n\nCliente: ${result.customer?.name||'Cliente'}\nParcelas: ${items.length}\nForma: ${paymentMethod==='cash'?'Dinheiro':paymentMethod==='pix'?'PIX':paymentMethod==='debit_card'?'Cartão de débito':paymentMethod==='credit_card'?'Cartão de crédito':'Outros'}`))return;
    const button=body.querySelector('#v115Receive');
    button.disabled=true;button.textContent='Recebendo...';
    try{
      const response=await window.thor.receiveReceivables({customerId:result.customer.id,paymentMethod,notes:body.querySelector('#v115Notes')?.value||'',items});
      let printed=false,printError='';
      try{await window.thor.printReceivableReceipt(response.receipt);printed=true;}catch(error){printError=friendly(error?.message);}
      try{await refreshStatus?.();}catch{}
      renderSuccess(m,response.receipt,printed,printError);
    }catch(error){
      button.disabled=false;button.textContent='Confirmar recebimento';
      const message=friendly(error?.message);
      infoModal('Recebimento',message);
      if(['receivable_not_open','receivable_amount_exceeds_remaining'].includes(String(error?.message||'')))setTimeout(()=>loadCustomer(m,result.customer,result.payment_methods||[]),50);
    }
  }

  function renderSuccess(m,receipt,printed,printError){
    const body=m.querySelector('#v115Body');
    body.innerHTML=`<div class="v115-success"><div class="v115-success-icon">✓</div><small>RECEBIMENTO CONCLUÍDO</small><h3>${brMoney(receipt.total_amount)}</h3><p>Recebimento nº <b>${esc(receipt.number)}</b> registrado para <b>${esc(receipt.customer?.name||'cliente')}</b>.</p><div class="v115-success-grid"><article><span>Forma</span><b>${esc(receipt.payment_method_name||methodLabel(receipt.payment_method))}</b></article><article><span>Parcelas recebidas</span><b>${Array.isArray(receipt.items)?receipt.items.length:0}</b></article><article><span>Parcelas ainda pendentes</span><b>${Number(receipt.pending_count_after||0)}</b></article><article><span>Saldo pendente</span><b>${brMoney(receipt.pending_total_after)}</b></article></div>${printed?'<div class="v115-print-ok">✓ Comprovante enviado para a impressora térmica.</div>':`<div class="v115-print-warning"><b>Recebimento concluído, mas o comprovante não foi impresso.</b><span>${esc(printError||'Verifique a impressora.')}</span></div>`}<div class="actions"><button class="secondary" id="v115PrintAgain">Imprimir comprovante</button><button class="secondary" id="v115Another">Novo recebimento</button><button class="primary" id="v115Done">Concluir</button></div></div>`;
    body.querySelector('#v115Done').onclick=()=>m.remove();
    body.querySelector('#v115Another').onclick=()=>{m.remove();setTimeout(openReceivable,20);};
    body.querySelector('#v115PrintAgain').onclick=async()=>{const btn=body.querySelector('#v115PrintAgain');try{btn.disabled=true;btn.textContent='Imprimindo...';await window.thor.printReceivableReceipt(receipt);showToast('Comprovante de recebimento impresso.');btn.textContent='Imprimir novamente';}catch(error){infoModal('Impressão',friendly(error?.message));btn.textContent='Imprimir comprovante';}finally{btn.disabled=false;}};
  }

  const oldFriendly=typeof friendlyError==='function'?friendlyError:null;
  if(oldFriendly){
    friendlyError=function(code){
      const mapped=friendly(code);
      if(mapped!==String(code||''))return mapped;
      return oldFriendly(code);
    };
  }

  new MutationObserver(ensureActionButton).observe(document.documentElement,{childList:true,subtree:true});
  ensureActionButton();
})();
