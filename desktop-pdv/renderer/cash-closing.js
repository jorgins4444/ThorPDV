const cashClosingLabels={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher',store_credit:'Crédito em loja',other:'Outros'};
const previousOpenCashModal=openCashModal;

function cashClosingMethods(preview){
  const order=['cash','pix','debit_card','credit_card','voucher','store_credit','other'];
  const map=new Map((preview.payments||[]).map(p=>[String(p.method),Number(p.amount||0)]));
  return [...new Set([...order,...map.keys()])].filter(method=>map.has(method)||['cash','pix','debit_card','credit_card'].includes(method)).map(method=>({method,expected:Number(map.get(method)||0)}));
}

function cashClosingSourceLabel(source){return source==='server'?'Gestão / servidor':source==='server+local'?'Gestão + operações locais pendentes':'SQLite local / offline';}

async function cashClosingMovement(type,previewModal){
  const label=type==='supply'?'Suprimento':'Sangria';
  const value=prompt(`Valor do ${label.toLowerCase()}:`,'0');if(value===null)return;
  const amount=Number(String(value).replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return infoModal(label,'Informe um valor maior que zero.');
  const notes=prompt(`Motivo / observação do ${label.toLowerCase()}:`,'')||'';
  try{
    let auth=null;
    if(!v3Perm('cash.movement',false))auth=await v3NeedSupervisor('cash_movement',amount,notes||label);
    const operator=v3State()?.operator||state?.status?.operator||{};
    const result=await window.thor.cashMovement({movementType:type,amount,notes,reason:notes,operatorId:operator.id||null,operatorName:operator.name||operator.full_name||operator.display_name||'',supervisorAuthorization:auth});
    let printWarning='';
    try{await window.thor.printCashMovement(result?.receipt||{});}catch(printError){printWarning=friendlyError(printError?.message||'print_failed');}
    previewModal?.remove();await window.thor.sync().catch(()=>{});await refreshStatus();
    showToast(printWarning?`${label} registrado. Impressão pendente: ${printWarning}`:`${label} registrado e comprovante impresso.`);openCashModal();
  }catch(e){if(e.message!=='authorization_cancelled')infoModal(label,friendlyError(e.message));}
}

function renderCashClosingModal(preview){
  const methods=cashClosingMethods(preview);
  const pending=Number(preview.pending_events||0),rejected=Number(preview.rejected_events||0);
  const m=modal(`<div class="cash-close-head"><div><small>FECHAMENTO DE CAIXA</small><h3>Conferência por forma de pagamento</h3><p>Origem: <b>${esc(cashClosingSourceLabel(preview.source))}</b></p></div><div class="cash-close-total"><span>Esperado em dinheiro</span><strong>${money(preview.expected_cash)}</strong></div></div>
    ${(pending||rejected)?`<div class="cash-sync-warning">⚠ Existem ${pending} evento(s) pendente(s) e ${rejected} com erro. O fechamento inclui o que está disponível localmente.</div>`:''}
    <div class="cash-summary-grid"><article><span>Fundo inicial</span><strong>${money(preview.opening_amount)}</strong></article><article><span>Vendas</span><strong>${Number(preview.sales_count||0)}</strong><small>${money(preview.sales_total)}</small></article><article><span>Suprimentos</span><strong>${money(preview.supply)}</strong></article><article><span>Sangrias</span><strong>${money(preview.withdrawal)}</strong></article>${Number(preview.refund||0)?`<article><span>Devoluções em dinheiro</span><strong>${money(preview.refund)}</strong></article>`:''}</div>
    <div class="cash-payment-table"><div class="cash-payment-row head"><span>Forma</span><span>Sistema</span><span>Conferido</span><span>Diferença</span></div>${methods.map(x=>`<div class="cash-payment-row"><strong>${esc(cashClosingLabels[x.method]||x.method)}</strong><span>${money(x.expected)}</span><input data-cash-count="${esc(x.method)}" type="number" min="0" step="0.01" value="${Number(x.expected).toFixed(2)}"><b data-cash-diff="${esc(x.method)}">${money(0)}</b></div>`).join('')}</div>
    <div class="cash-drawer-count"><div><label>Dinheiro físico contado no caixa</label><small>Inclui fundo inicial + vendas em dinheiro + suprimentos − sangrias/devoluções.</small></div><input id="cashDrawerCount" type="number" min="0" step="0.01" value="${Number(preview.expected_cash||0).toFixed(2)}"><div><span>Diferença do caixa</span><strong id="cashDrawerDiff">${money(0)}</strong></div></div>
    <label class="cash-close-notes"><span>Observação do fechamento</span><textarea id="cashCloseNotes" rows="2" placeholder="Opcional"></textarea></label>
    <div class="cash-close-actions"><button class="secondary" id="cashSupply">+ Suprimento</button><button class="secondary" id="cashWithdrawal">− Sangria</button><button class="secondary" id="cashCancel">Voltar</button><button class="primary danger" id="cashConfirmClose">Conferir e fechar caixa</button></div>`,'wide cash-close-modal');

  const update=()=>{
    m.querySelectorAll('[data-cash-count]').forEach(input=>{const method=input.dataset.cashCount;const expected=methods.find(x=>x.method===method)?.expected||0;const diff=Number(input.value||0)-expected;const el=m.querySelector(`[data-cash-diff="${method}"]`);if(el){el.textContent=money(diff);el.classList.toggle('negative',Math.abs(diff)>0.009);}});
    const drawerDiff=Number(m.querySelector('#cashDrawerCount').value||0)-Number(preview.expected_cash||0);const el=m.querySelector('#cashDrawerDiff');el.textContent=money(drawerDiff);el.classList.toggle('negative',Math.abs(drawerDiff)>0.009);
  };
  m.querySelectorAll('[data-cash-count]').forEach(input=>input.oninput=update);m.querySelector('#cashDrawerCount').oninput=update;update();
  m.querySelector('#cashSupply').onclick=()=>cashClosingMovement('supply',m);
  m.querySelector('#cashWithdrawal').onclick=()=>cashClosingMovement('withdrawal',m);
  m.querySelector('#cashCancel').onclick=()=>m.remove();
  m.querySelector('#cashConfirmClose').onclick=async()=>{
    const closingAmount=Number(m.querySelector('#cashDrawerCount').value||0);if(!Number.isFinite(closingAmount)||closingAmount<0)return infoModal('Fechamento','Informe o dinheiro físico contado no caixa.');
    const countedPayments=methods.map(x=>{const counted=Number(m.querySelector(`[data-cash-count="${x.method}"]`).value||0);return {method:x.method,expected:x.expected,counted,difference:counted-x.expected};});
    const reconciliation={...preview,counted_payments:countedPayments,closing_amount:closingAmount,difference:closingAmount-Number(preview.expected_cash||0)};
    if(!confirm(`Confirmar fechamento?\n\nDinheiro esperado: ${money(preview.expected_cash)}\nDinheiro contado: ${money(closingAmount)}\nDiferença: ${money(reconciliation.difference)}`))return;
    const btn=m.querySelector('#cashConfirmClose');btn.disabled=true;btn.textContent='Fechando...';
    try{
      const result=await window.thor.closeCash({closingAmount,notes:m.querySelector('#cashCloseNotes').value,reconciliation});
      m.remove();await refreshStatus();await window.thor.sync().catch(()=>{});
      let printed=false;try{const p=await window.thor.printCashClose(result.summary);printed=!p?.cancelled;}catch(e){infoModal('Caixa fechado',`O caixa foi fechado, mas o comprovante não foi impresso: ${friendlyError(e.message)}. Você poderá reimprimir o último fechamento nas configurações futuras.`);return;}
      showToast(`Caixa fechado${printed?' e comprovante impresso':''}. Diferença: ${money(result.summary?.difference||0)}.`);
    }catch(e){btn.disabled=false;btn.textContent='Conferir e fechar caixa';infoModal('Fechamento de caixa',friendlyError(e.message));}
  };
}

openCashModal=async function(){
  const v=v3State();if(!v.operator)return v3OperatorModal(true);
  if(!state.status.cashOpenEventId)return previousOpenCashModal();
  const loading=modal(`<h3>Preparando fechamento</h3><p class="muted">Sincronizando vendas, pagamentos e movimentações do caixa...</p><div class="cash-loading">Conferindo valores...</div>`);
  try{const preview=await window.thor.cashPreview();loading.remove();renderCashClosingModal(preview);}catch(e){loading.remove();infoModal('Fechamento de caixa',friendlyError(e.message));}
};

const cashClosingErrors={cash_close_receipt_not_found:'Nenhum comprovante de fechamento foi encontrado.',cash_not_open:'Não existe caixa aberto para conferência.'};
const cashClosingOldFriendly=friendlyError;friendlyError=function(code){return cashClosingErrors[code]||cashClosingOldFriendly(code);};
