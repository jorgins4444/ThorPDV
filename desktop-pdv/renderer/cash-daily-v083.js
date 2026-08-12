const cashDailyMoney=(value)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const cashDailyDate=(value)=>{if(!value)return '—';const [y,m,d]=String(value).slice(0,10).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(value)};
const cashDailyStatus=(row)=>String(row?.status||'');
const cashDailyStatusLabel=(row)=>cashDailyStatus(row)==='open'?'Aberto hoje':cashDailyStatus(row)==='pending_close'?'Pendente de fechamento':cashDailyStatus(row)==='closed'?'Fechado':cashDailyStatus(row)==='closing_pending'?'Fechamento pendente':cashDailyStatus(row)||'—';
const cashDailyStatusClass=(row)=>cashDailyStatus(row)==='open'?'current':cashDailyStatus(row)==='pending_close'?'overdue':cashDailyStatus(row)==='closed'?'closed':'neutral';

function cashDailyPaymentRows(preview){
  return (preview.payments||[]).map((row,index)=>({
    method:String(row.method||''),name:String(row.name||row.method||'Forma'),category:String(row.category||'other'),
    sort_order:Number(row.sort_order||100+index),expected:Number(row.amount||0),count:Number(row.count||0),
  })).sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name,'pt-BR'));
}

function cashDailyCloseModal(preview,{historical=false,readonly=false,onDone=null}={}){
  const methods=cashDailyPaymentRows(preview);
  const pending=Number(preview.pending_events||0),rejected=Number(preview.rejected_events||0);
  const closed=readonly||String(preview.status)==='closed';
  const business=cashDailyDate(preview.business_date);
  const m=modal(`<div class="cash-close-head"><div><small>CAIXA • ${esc(business)}</small><h3>${closed?'Conferência do caixa fechado':historical?'Fechar caixa pendente':'Fechamento do caixa de hoje'}</h3><p>Origem: <b>${esc(cashClosingSourceLabel(preview.source))}</b> • Abertura: ${dt(preview.opened_at)}</p></div><div class="cash-close-total"><span>Dinheiro esperado</span><strong>${money(preview.expected_cash)}</strong></div></div>
    ${historical&&!closed?`<div class="cash-overdue-warning"><b>Caixa de ${esc(business)} pendente.</b><span>Novas vendas não podem ser registradas nele. Este fechamento afetará somente a sessão selecionada.</span></div>`:''}
    ${(pending||rejected)?`<div class="cash-sync-warning">⚠ Existem ${pending} evento(s) pendente(s) e ${rejected} com erro. O fechamento inclui o que está disponível localmente.</div>`:''}
    <div class="cash-summary-grid"><article><span>Fundo inicial</span><strong>${money(preview.opening_amount)}</strong></article><article><span>Vendas</span><strong>${Number(preview.sales_count||0)}</strong><small>${money(preview.sales_total)}</small></article><article><span>Venda a prazo</span><strong>${money(preview.term_sales_total)}</strong><small>não entra no numerário</small></article><article><span>Suprimentos</span><strong>${money(preview.supply)}</strong></article><article><span>Sangrias</span><strong>${money(preview.withdrawal)}</strong></article>${Number(preview.receivable_received||0)?`<article><span>Recebimentos</span><strong>${money(preview.receivable_received)}</strong></article>`:''}${Number(preview.refund||0)?`<article><span>Devoluções em dinheiro</span><strong>${money(preview.refund)}</strong></article>`:''}</div>
    <div class="cash-payment-title"><div><b>Formas de pagamento</b><small>Todas as formas liberadas no Thor Gestão aparecem aqui, mesmo com movimento zero.</small></div></div>
    <div class="cash-payment-table"><div class="cash-payment-row head"><span>Forma</span><span>Sistema</span><span>${closed?'Conferido':'Conferir'}</span><span>Diferença</span></div>${methods.map(x=>`<div class="cash-payment-row ${x.category==='term'?'term':''}"><strong>${esc(x.name)}${x.category==='term'?'<small>Não entra no dinheiro físico</small>':''}</strong><span>${money(x.expected)}${x.count?`<small>${x.count} operação(ões)</small>`:''}</span>${closed?`<span>${money((preview.counted_payments||[]).find(p=>String(p.method)===x.method)?.counted??x.expected)}</span><b>${money((preview.counted_payments||[]).find(p=>String(p.method)===x.method)?.difference||0)}</b>`:`<input data-cash-daily-count="${esc(x.method)}" type="number" min="0" step="0.01" value="${Number(x.expected).toFixed(2)}"><b data-cash-daily-diff="${esc(x.method)}">${money(0)}</b>`}</div>`).join('')}</div>
    <div class="cash-drawer-count"><div><label>Dinheiro físico contado no caixa</label><small>Fundo + vendas em dinheiro + recebimentos/suprimentos − sangrias, despesas e devoluções.</small></div>${closed?`<strong class="cash-closed-amount">${money(preview.closing_amount)}</strong>`:`<input id="cashDailyDrawerCount" type="number" min="0" step="0.01" value="${Number(preview.expected_cash||0).toFixed(2)}">`}<div><span>Diferença do caixa</span><strong id="cashDailyDrawerDiff">${money(closed?Number(preview.closing_amount||0)-Number(preview.expected_cash||0):0)}</strong></div></div>
    ${closed?`${preview.notes?`<div class="cash-close-read-note"><b>Observação</b><span>${esc(preview.notes)}</span></div>`:''}<div class="cash-close-actions"><button class="primary" id="cashDailyDone">Fechar visualização</button></div>`:`<label class="cash-close-notes"><span>Observação do fechamento</span><textarea id="cashDailyNotes" rows="2" placeholder="Opcional"></textarea></label><div class="cash-close-actions">${!historical?'<button class="secondary" id="cashDailySupply">+ Suprimento</button><button class="secondary" id="cashDailyWithdrawal">− Sangria</button>':''}<button class="secondary" id="cashDailyBack">Voltar</button><button class="primary danger" id="cashDailyConfirm">Conferir e fechar ${historical?'caixa pendente':'caixa'}</button></div>`}`,'wide cash-close-modal cash-daily-close-modal');

  if(closed){m.querySelector('#cashDailyDone').onclick=()=>m.remove();return m;}
  const update=()=>{
    m.querySelectorAll('[data-cash-daily-count]').forEach(input=>{const method=input.dataset.cashDailyCount;const expected=methods.find(x=>x.method===method)?.expected||0;const diff=Number(input.value||0)-expected;const el=m.querySelector(`[data-cash-daily-diff="${method}"]`);if(el){el.textContent=money(diff);el.classList.toggle('negative',Math.abs(diff)>0.009);}});
    const drawerDiff=Number(m.querySelector('#cashDailyDrawerCount').value||0)-Number(preview.expected_cash||0);const el=m.querySelector('#cashDailyDrawerDiff');el.textContent=money(drawerDiff);el.classList.toggle('negative',Math.abs(drawerDiff)>0.009);
  };
  m.querySelectorAll('[data-cash-daily-count]').forEach(input=>input.oninput=update);m.querySelector('#cashDailyDrawerCount').oninput=update;update();
  if(m.querySelector('#cashDailySupply'))m.querySelector('#cashDailySupply').onclick=()=>cashClosingMovement('supply',m);
  if(m.querySelector('#cashDailyWithdrawal'))m.querySelector('#cashDailyWithdrawal').onclick=()=>cashClosingMovement('withdrawal',m);
  m.querySelector('#cashDailyBack').onclick=()=>{m.remove();openCashModal();};
  m.querySelector('#cashDailyConfirm').onclick=async()=>{
    const closingAmount=Number(m.querySelector('#cashDailyDrawerCount').value||0);if(!Number.isFinite(closingAmount)||closingAmount<0)return infoModal('Fechamento','Informe o dinheiro físico contado no caixa.');
    const countedPayments=methods.map(x=>{const counted=Number(m.querySelector(`[data-cash-daily-count="${x.method}"]`).value||0);return {method:x.method,name:x.name,category:x.category,expected:x.expected,counted,difference:counted-x.expected};});
    const reconciliation={...preview,counted_payments:countedPayments,closing_amount:closingAmount,difference:closingAmount-Number(preview.expected_cash||0)};
    if(!confirm(`Confirmar fechamento do caixa de ${business}?\n\nDinheiro esperado: ${money(preview.expected_cash)}\nDinheiro contado: ${money(closingAmount)}\nDiferença: ${money(reconciliation.difference)}`))return;
    const btn=m.querySelector('#cashDailyConfirm');btn.disabled=true;btn.textContent='Fechando...';
    try{
      const payload={cashOpenEventId:preview.client_event_id,closingAmount,notes:m.querySelector('#cashDailyNotes').value,reconciliation};
      const result=historical?await window.thor.closeHistoricalCash(payload):await window.thor.closeCash(payload);
      m.remove();await refreshStatus();await window.thor.sync().catch(()=>{});
      let printed=false;try{const p=await window.thor.printCashClose(result.summary);printed=!p?.cancelled;}catch(e){infoModal('Caixa fechado',`O caixa foi fechado, mas o comprovante não foi impresso: ${friendlyError(e.message)}.`);return;}
      showToast(`Caixa de ${business} fechado${printed?' e comprovante impresso':''}. Diferença: ${money(result.summary?.difference||0)}.`);
      if(typeof onDone==='function')await onDone();else openCashModal();
    }catch(e){btn.disabled=false;btn.textContent=`Conferir e fechar ${historical?'caixa pendente':'caixa'}`;infoModal('Fechamento de caixa',friendlyError(e.message));}
  };
  return m;
}

async function cashDailyOpenSession(session){
  const loading=modal(`<h3>Carregando caixa</h3><p class="muted">Buscando vendas e formas de pagamento do dia ${esc(cashDailyDate(session.business_date))}...</p><div class="cash-loading">Conferindo valores...</div>`);
  try{const preview=await window.thor.cashPreview({cashOpenEventId:session.client_event_id});loading.remove();cashDailyCloseModal(preview,{historical:String(preview.status)==='pending_close',readonly:String(preview.status)==='closed'});}catch(e){loading.remove();infoModal('Caixa',friendlyError(e.message));}
}

async function cashDailyLoadSessions(m){
  const host=m.querySelector('#cashDailySessions');if(!host)return;
  host.innerHTML='<div class="cash-loading">Buscando caixas...</div>';
  try{
    const result=await window.thor.cashSessions({from:m.querySelector('#cashDailyFrom')?.value||'',to:m.querySelector('#cashDailyTo')?.value||'',status:m.querySelector('#cashDailyStatus')?.value||'open'});
    const rows=result.sessions||[];
    host.innerHTML=rows.length?`<div class="cash-session-list">${rows.map((row,index)=>`<div class="cash-session-row ${cashDailyStatusClass(row)}"><div><b>${esc(cashDailyDate(row.business_date))}</b><small>${dt(row.opened_at)}${row.operator_name?` • ${esc(row.operator_name)}`:''}</small></div><span class="cash-session-status ${cashDailyStatusClass(row)}">${esc(cashDailyStatusLabel(row))}</span><div><small>Vendas</small><b>${money(row.sales_total)}</b></div><div><small>Dinheiro esperado</small><b>${money(row.expected_cash)}</b></div><button class="secondary" data-cash-session-view="${index}">${String(row.status)==='pending_close'?'Fechar pendente':'Visualizar'}</button></div>`).join('')}</div>`:'<div class="cash-session-empty">Nenhum caixa encontrado para os filtros selecionados.</div>';
    host.querySelectorAll('[data-cash-session-view]').forEach(btn=>btn.onclick=()=>{const row=rows[Number(btn.dataset.cashSessionView)];m.remove();cashDailyOpenSession(row);});
  }catch(e){host.innerHTML=`<div class="cash-session-empty error">${esc(friendlyError(e.message))}</div>`;}
}

openCashModal=async function(){
  const v=v3State();if(!v.operator)return v3OperatorModal(true);
  await refreshStatus();
  const opened=Boolean(state.status.cashOpenEventId);const today=state.status.cashBusinessDate||new Date().toISOString().slice(0,10);
  const m=modal(`<div class="cash-daily-header"><div><small>CONTROLE DIÁRIO DE CAIXA</small><h3>Caixa de ${esc(cashDailyDate(today))}</h3><p>Cada data possui sua própria sessão. Caixas antigos ficam pendentes para fechamento e não recebem novas operações.</p></div><span class="cash-session-status ${opened?'current':'neutral'}">${opened?'Aberto hoje':'Sem caixa aberto hoje'}</span></div>
    ${Number(state.status.overdueCashCount||0)>0?`<div class="cash-overdue-warning"><b>${Number(state.status.overdueCashCount)} caixa(s) anterior(es) pendente(s)</b><span>Você pode abrir o caixa de hoje normalmente e fechar os anteriores pelo buscador abaixo.</span></div>`:''}
    <div class="cash-today-panel">${opened?`<div><b>Caixa de hoje está aberto</b><small>Novas vendas, suprimentos e sangrias serão registradas somente nesta sessão.</small></div><div class="cash-today-actions"><button class="secondary" id="cashTodaySupply">+ Suprimento</button><button class="secondary" id="cashTodayWithdrawal">− Sangria</button><button class="primary danger" id="cashTodayClose">Fechar caixa de hoje</button></div>`:`<div class="cash-open-form"><label><span>Fundo inicial</span><input id="cashTodayOpening" type="number" min="0" step="0.01" value="0"></label><label class="grow"><span>Observação da abertura</span><input id="cashTodayOpeningNotes" placeholder="Opcional"></label><button class="primary" id="cashTodayOpen">Abrir caixa de hoje</button></div>`}</div>
    <div class="cash-browser"><div class="cash-browser-head"><div><b>Buscar caixas</b><small>Localize caixas abertos, pendentes ou já fechados por período.</small></div><button class="secondary" id="cashDailyRefresh">Atualizar</button></div><div class="cash-browser-filters"><label><span>De</span><input id="cashDailyFrom" type="date"></label><label><span>Até</span><input id="cashDailyTo" type="date"></label><label><span>Status</span><select id="cashDailyStatus"><option value="open">Abertos / pendentes</option><option value="pending_close">Somente pendentes</option><option value="closed">Fechados</option><option value="all">Todos</option></select></label><button class="secondary" id="cashDailyClear">Limpar filtros</button></div><div id="cashDailySessions"></div></div><div class="cash-close-actions"><button class="secondary" id="cashDailyExit">Fechar</button></div>`,'wide cash-daily-browser-modal');
  m.querySelector('#cashDailyExit').onclick=()=>m.remove();
  m.querySelector('#cashDailyRefresh').onclick=()=>cashDailyLoadSessions(m);
  m.querySelector('#cashDailyClear').onclick=()=>{m.querySelector('#cashDailyFrom').value='';m.querySelector('#cashDailyTo').value='';m.querySelector('#cashDailyStatus').value='open';cashDailyLoadSessions(m);};
  ['#cashDailyFrom','#cashDailyTo','#cashDailyStatus'].forEach(sel=>{const el=m.querySelector(sel);if(el)el.onchange=()=>cashDailyLoadSessions(m);});
  if(opened){
    m.querySelector('#cashTodaySupply').onclick=()=>cashClosingMovement('supply',m);
    m.querySelector('#cashTodayWithdrawal').onclick=()=>cashClosingMovement('withdrawal',m);
    m.querySelector('#cashTodayClose').onclick=async()=>{const loading=modal('<h3>Preparando fechamento de hoje</h3><div class="cash-loading">Sincronizando e conferindo...</div>');try{const preview=await window.thor.cashPreview({cashOpenEventId:state.status.cashOpenEventId});loading.remove();m.remove();cashDailyCloseModal(preview);}catch(e){loading.remove();infoModal('Fechamento',friendlyError(e.message));}};
  }else{
    m.querySelector('#cashTodayOpen').onclick=async()=>{const btn=m.querySelector('#cashTodayOpen');try{btn.disabled=true;btn.textContent='Abrindo...';await window.thor.openCash({openingAmount:Number(m.querySelector('#cashTodayOpening').value||0),notes:m.querySelector('#cashTodayOpeningNotes').value});m.remove();await refreshStatus();showToast(`Caixa de ${cashDailyDate(today)} aberto.`);openCashModal();}catch(e){infoModal('Abertura de caixa',friendlyError(e.message));}finally{btn.disabled=false;btn.textContent='Abrir caixa de hoje';}};
  }
  cashDailyLoadSessions(m);
};

const cashDailyOldFriendly=friendlyError;
friendlyError=function(code){
  const map={cash_day_expired:'O caixa anterior pertence a outro dia e não pode receber novas operações. Abra o caixa de hoje; o anterior continuará disponível como pendente de fechamento.',cash_day_mismatch:'A operação pertence a uma data diferente da sessão de caixa selecionada.',historical_cash_close_requires_online:'Para fechar um caixa de dia anterior, conecte o ThorPDV à internet para validar e registrar o fechamento no servidor.',cash_not_found:'A sessão de caixa selecionada não foi encontrada.'};
  return map[code]||cashDailyOldFriendly(code);
};
