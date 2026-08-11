const app=document.getElementById('app');
const paymentLabels={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher'};
const reservedShortcuts=new Set(['F2','F3','F4','F6','F12','ENTER','ESCAPE']);
let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',capturingShortcut:false};

const money=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dt=(v)=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const saleKey=(sale)=>String(sale.id||sale.local_key||sale.client_event_id||sale.number||'');
const NFCE_CANCEL_WINDOW_MS=30*60*1000;
function nfceCancellationState(sale){
  const fiscal=sale?.fiscal||null;
  const saleStatus=String(sale?.status||'');
  if(['cancelled','cancel_pending'].includes(saleStatus)||Number(sale?.returned_total||0)>0)return {available:false,authorized:false,expired:false,deadline:null,remainingMs:0};
  if(fiscal?.status!=='authorized')return {available:true,authorized:false,expired:false,deadline:null,remainingMs:0};
  const authAt=Date.parse(String(fiscal.authorization_at||''));
  const serverDeadline=Date.parse(String(fiscal.cancel_deadline||''));
  const deadline=Number.isFinite(serverDeadline)?serverDeadline:(Number.isFinite(authAt)?authAt+NFCE_CANCEL_WINDOW_MS:NaN);
  if(!Number.isFinite(deadline))return {available:false,authorized:true,expired:false,deadline:null,remainingMs:0};
  const remainingMs=deadline-Date.now();
  return {available:remainingMs>0,authorized:true,expired:remainingMs<=0,deadline,remainingMs:Math.max(remainingMs,0)};
}
function cancelDeadlineLabel(deadline){return deadline?new Date(deadline).toLocaleString('pt-BR'):'indisponível';}
function cancelRemainingLabel(ms){const total=Math.max(Math.ceil(ms/1000),0),m=Math.floor(total/60),s=total%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}

const fiscalTerminalStatuses=new Set(['authorized','rejected','transmission_error','cancelled','contingency']);
const sefazQuickCodes={
  '106':'Lote não localizado','108':'Serviço paralisado momentaneamente','110':'Uso denegado',
  '202':'Falha no reconhecimento da autoria ou integridade do arquivo digital','203':'Emissor não habilitado para emissão',
  '204':'Duplicidade de NF-e/NFC-e','207':'CNPJ do emitente inválido','209':'IE do emitente inválida',
  '225':'Falha no Schema XML do lote','230':'IE do emitente não cadastrada','231':'IE do emitente não vinculada ao CNPJ',
  '243':'XML mal formado','245':'CNPJ emitente não cadastrado','280':'Certificado transmissor inválido',
  '281':'Certificado transmissor fora da validade','283':'Erro na cadeia do certificado transmissor',
  '290':'Certificado da assinatura inválido','291':'Certificado da assinatura fora da validade','293':'Erro na cadeia do certificado da assinatura',
  '301':'Irregularidade fiscal do emitente','302':'Irregularidade fiscal do destinatário',
  '387':'Código de enquadramento legal do IPI inválido','388':'CST do IPI incompatível com o enquadramento legal'
};
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function fiscalCode(fiscal){return String(fiscal?.cStat||fiscal?.rejection_code||'').trim();}
function fiscalReason(fiscal){
  if(!fiscal)return '';
  const code=fiscalCode(fiscal);
  if(fiscal.status==='transmission_error'){
    const e=String(fiscal.last_error_code||'');
    if(e==='tls_unknown_issuer')return 'Falha TLS: a cadeia do certificado do servidor da SEFAZ não foi reconhecida pelo ambiente de transmissão.';
    if(e==='sefaz_timeout')return 'Tempo limite excedido aguardando comunicação com a SEFAZ.';
    return fiscal.last_error_message||'Falha de comunicação com a SEFAZ.';
  }
  return fiscal.xMotivo||fiscal.rejection_message||(code?sefazQuickCodes[code]:'')||'';
}
function fiscalTimelineHtml(fiscal){
  const events=Array.isArray(fiscal?.events)?fiscal.events:[];
  if(!events.length)return '<div class="fiscal-log-empty">Ainda não há eventos sincronizados para esta tentativa.</div>';
  return `<div class="fiscal-event-list">${events.map(e=>`<div class="fiscal-event fiscal-event-${esc(e.level||'info')}"><i></i><div><b>${esc(e.message||e.type||'Evento fiscal')}</b><small>${dt(e.created_at)}${e.code?` • ${esc(e.code)}`:''}</small></div></div>`).join('')}</div>`;
}
function fiscalDiagnosticHtml(fiscal){
  if(!fiscal)return '<div class="fiscal-diagnostic neutral">NFC-e ainda não solicitada.</div>';
  const code=fiscalCode(fiscal),reason=fiscalReason(fiscal);
  if(fiscal.status==='authorized')return `<div class="fiscal-diagnostic success"><b>Autorizada pela SEFAZ</b><span>${code?`cStat ${esc(code)} • `:''}${esc(reason||'Autorização concluída.')}</span></div>`;
  if(fiscal.status==='rejected')return `<div class="fiscal-diagnostic error"><b>Rejeitada pela SEFAZ${code?` — código ${esc(code)}`:''}</b><span>${esc(reason||'A SEFAZ rejeitou o documento.')}</span></div>`;
  if(fiscal.status==='transmission_error')return `<div class="fiscal-diagnostic error"><b>Falha de transmissão${fiscal.last_error_code?` — ${esc(fiscal.last_error_code)}`:''}</b><span>${esc(reason)}</span>${fiscal.last_error_message&&fiscal.last_error_message!==reason?`<code>${esc(fiscal.last_error_message)}</code>`:''}</div>`;
  return `<div class="fiscal-diagnostic processing"><b><i class="fiscal-live-dot"></i> Comunicação fiscal em andamento</b><span>${esc(reason||'Aguardando conclusão da transmissão.')}</span></div>`;
}
function fiscalProgressSteps(fiscal,phase){
  const status=String(fiscal?.status||'requested');
  const hasKey=Boolean(fiscal?.access_key);
  const hasResponse=Boolean(fiscalCode(fiscal))||['authorized','rejected'].includes(status);
  const failed=status==='transmission_error';
  const steps=[
    ['Preparando solicitação',true,phase==='queueing'],
    ['Gerando e assinando XML',hasKey,phase==='building'],
    ['Enviando à SEFAZ',hasResponse||failed||status==='processing',phase==='sending'||status==='processing'],
    ['Recebendo retorno',hasResponse,phase==='waiting'&&!failed],
    ['Resultado fiscal',fiscalTerminalStatuses.has(status),false],
  ];
  return `<div class="fiscal-progress-steps">${steps.map(([label,done,active])=>`<div class="fiscal-progress-step ${done?'done':''} ${active&&!done?'active':''}"><i>${done?'✓':''}</i><span>${label}</span></div>`).join('')}</div>`;
}
function paintFiscalProgress(m,sale,phase='waiting'){
  if(!m?.isConnected)return;
  const fiscal=sale?.fiscal||{status:'requested'};
  const status=String(fiscal.status||'requested');
  const title=status==='authorized'?'NFC-e autorizada':status==='rejected'?'NFC-e rejeitada':status==='transmission_error'?'Falha no envio da NFC-e':'Transmitindo NFC-e';
  const body=m.querySelector('#fiscalProgressBody');if(!body)return;
  body.innerHTML=`<div class="fiscal-progress-head"><div class="fiscal-spinner ${fiscalTerminalStatuses.has(status)?'stopped':''}"></div><div><small>THORFISCAL / SEFAZ</small><h3>${esc(title)}</h3><p>${status==='processing'?'Aguarde o retorno do autorizador. Não feche o PDV.':esc(fiscalReason(fiscal)||'Acompanhando a solicitação fiscal em tempo real.')}</p></div></div>${fiscalProgressSteps(fiscal,phase)}${fiscalDiagnosticHtml(fiscal)}<div class="fiscal-progress-meta"><span>Chave: <b>${esc(fiscal.access_key||'aguardando geração')}</b></span><span>Tentativas: <b>${Number(fiscal.attempt_count||0)}</b></span>${fiscalCode(fiscal)?`<span>cStat: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}</div><h4>Eventos da transmissão</h4>${fiscalTimelineHtml(fiscal)}<div class="actions" id="fiscalProgressActions"></div>`;
  const actions=body.querySelector('#fiscalProgressActions');
  if(status==='transmission_error'||status==='rejected'){
    actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRetry">Tentar novamente</button>';
    actions.querySelector('#fiscalClose').onclick=()=>m.remove();
    actions.querySelector('#fiscalRetry').onclick=()=>{m.remove();requestNfceAndMaybePrint(saleKey(sale));};
  }else if(status==='authorized'){
    actions.innerHTML='<button class="primary" id="fiscalClose">Fechar</button>';
    actions.querySelector('#fiscalClose').onclick=()=>m.remove();
  }
}

async function boot(){
  state.status=await window.thor.status();
  state.settings=state.status.settings||await window.thor.settings();
  render();
  if(state.status.enrolled){await refreshProducts('');await refreshFiscalSales('');setInterval(async()=>{await refreshStatus();if(state.view==='fiscal'||state.fiscalSales.some(x=>['requested','draft','processing'].includes(String(x.fiscal?.status||''))))await refreshFiscalSales();},3000);}
}

async function refreshStatus(){state.status=await window.thor.status();state.settings=state.status.settings||state.settings;updateTop();}
async function refreshProducts(q=state.query){state.query=q;state.products=await window.thor.searchProducts(q);if(state.view==='sale')renderProducts();}
async function refreshFiscalSales(q=state.fiscalQuery){state.fiscalQuery=q;state.fiscalSales=await window.thor.fiscalSales(q);if(state.view==='fiscal')renderFiscalTable();}
function total(){return state.cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0);}

function render(){
  if(!state.status?.enrolled)return renderSetup();
  app.innerHTML=`<div class="shell"><header class="topbar"><div class="top-left"><div class="logo">ϟ THOR<b>PDV</b></div><span id="context"></span></div><div class="top-right"><button class="nav-button ${state.view==='sale'?'active':''}" id="navSale">Venda</button><button class="nav-button ${state.view==='fiscal'?'active':''}" id="navFiscal">Fiscal <kbd>F3</kbd></button><span id="queue" class="queue"></span><span id="status" class="status"><i></i><b></b></span><button class="secondary" id="sync">Sincronizar <kbd>F6</kbd></button><button class="secondary" id="settings">Configurações <kbd>F12</kbd></button></div></header><div id="workspace" class="workspace"></div><footer class="bottom"><span id="hotkeyHelp"></span><span id="footerSync"></span></footer></div>`;
  document.getElementById('navSale').onclick=()=>setView('sale');
  document.getElementById('navFiscal').onclick=()=>setView('fiscal');
  document.getElementById('sync').onclick=async()=>{await window.thor.sync();await refreshStatus();await refreshProducts();await refreshFiscalSales();showToast('Sincronização concluída.');};
  document.getElementById('settings').onclick=settingsModal;
  renderWorkspace();updateTop();
}

function renderSetup(){
  app.innerHTML=`<main class="setup"><section class="setup-card"><div class="brand">ϟ THOR<span>PDV</span></div><h1>Ativar este caixa</h1><p class="muted">No ThorERP Gestão, abra Administrativo → PDV Desktop, escolha o caixa e gere um código de ativação.</p><div class="field"><label>Código de ativação</label><input id="code" maxlength="8" autocomplete="off" placeholder="XXXXXXXX"></div><div class="field"><label>Nome deste terminal</label><input id="name" value="Caixa - ${esc(location.hostname||'Windows')}"></div><button id="activate" class="primary">Ativar e sincronizar</button><div id="setupError"></div></section></main>`;
  document.getElementById('activate').onclick=async()=>{const b=document.getElementById('activate'),err=document.getElementById('setupError');try{b.disabled=true;b.textContent='Ativando...';state.status=await window.thor.enroll({code:document.getElementById('code').value.trim(),name:document.getElementById('name').value.trim()});state.settings=state.status.settings;render();await refreshProducts('');await refreshFiscalSales('');}catch(e){err.className='error';err.textContent=e.message;}finally{b.disabled=false;b.textContent='Ativar e sincronizar';}};
}

function setView(view){state.view=view;render();if(view==='fiscal')refreshFiscalSales(state.fiscalQuery);else refreshProducts(state.query);}
function renderWorkspace(){if(state.view==='fiscal')renderFiscalWorkspace();else renderSaleWorkspace();}

function renderSaleWorkspace(){
  const box=document.getElementById('workspace');
  box.innerHTML=`<main class="work"><section class="catalog"><div class="search-row"><input id="search" class="search" placeholder="Código principal, referência interna, EAN ou descrição..." autofocus><button class="secondary" id="cash">Caixa <kbd>F4</kbd></button></div><div id="products" class="products"></div></section><aside class="cart-panel"><div class="cart-head"><div><small>VENDA ATUAL</small><h2>Cupom</h2></div><button class="secondary" id="clear">Limpar</button></div><div id="cart" class="cart"></div><div><div class="totals"><div class="total-row"><span>Itens</span><b id="itemsCount">0</b></div><div class="total-row grand"><span>Total</span><span id="grand">R$ 0,00</span></div></div><div class="payment-methods">${Object.entries(paymentLabels).map(([k,n])=>`<button class="pay ${state.payment===k?'active':''}" data-pay="${k}"><span>${n}</span><kbd>${esc(state.settings?.shortcuts?.[k]||'')}</kbd></button>`).join('')}</div><button class="primary finalize" id="finalize">Finalizar venda <kbd>F2</kbd></button></div></aside></main>`;
  bindSale();renderProducts();renderCart();
}

function bindSale(){
  const search=document.getElementById('search');let timer;
  search.value=state.query;
  search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>refreshProducts(search.value),120)};
  search.onkeydown=e=>{if(e.key==='Enter'&&state.products[0]){e.preventDefault();add(state.products[0]);search.select();}};
  document.getElementById('clear').onclick=()=>{state.cart=[];renderCart();};
  document.getElementById('finalize').onclick=finalize;
  document.getElementById('cash').onclick=openCashModal;
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>selectPayment(b.dataset.pay));
}

function selectPayment(method){state.payment=method;document.querySelectorAll('[data-pay]').forEach(x=>x.classList.toggle('active',x.dataset.pay===method));}

function renderProducts(){
  const box=document.getElementById('products');if(!box)return;
  box.innerHTML=state.products.length?state.products.map((p,i)=>`<div class="product" data-index="${i}"><div><strong>${esc(p.name)}</strong><small>Cód. ${esc(p.product_code||'—')} • Ref. ${esc(p.sku||'—')} • EAN ${esc((p.barcodes||[])[0]||'—')}</small></div><div class="stock">Estoque<br><b>${Number(p.quantity||0).toFixed(3).replace(/\.000$/,'')}</b></div><div class="price">${money(p.base_price)}</div></div>`).join(''):`<div class="empty">Nenhum produto encontrado.</div>`;
  box.querySelectorAll('.product').forEach(el=>el.onclick=()=>add(state.products[Number(el.dataset.index)]));
}

async function add(p){
  const found=state.cart.find(i=>i.productId===p.id);if(found)found.quantity++;else state.cart.push({productId:p.id,name:p.name,sku:p.sku,quantity:1,unitPrice:Number(p.base_price||p.sale_price||0)});
  await repriceCart();
}

async function repriceCart(){
  if(!state.cart.length){renderCart();return;}
  try{const quote=await window.thor.quoteSale(state.cart.map(i=>({productId:i.productId,quantity:i.quantity})),0);for(const q of quote.items||[]){const item=state.cart.find(i=>i.productId===q.productId);if(item)item.unitPrice=Number(q.unitPrice||0);} }catch{}
  renderCart();
}

function renderCart(){
  const box=document.getElementById('cart');if(!box)return;
  box.innerHTML=state.cart.length?state.cart.map((i,n)=>`<div class="cart-item"><div><strong>${esc(i.name)}</strong><small>${money(i.unitPrice)} un.</small></div><div class="qty"><button data-minus="${n}">−</button><b>${i.quantity}</b><button data-plus="${n}">+</button></div></div>`).join(''):`<div class="empty">Leia um código de barras ou selecione um produto.</div>`;
  box.querySelectorAll('[data-minus]').forEach(b=>b.onclick=async()=>{const i=state.cart[Number(b.dataset.minus)];i.quantity--;if(i.quantity<=0)state.cart.splice(Number(b.dataset.minus),1);await repriceCart();});
  box.querySelectorAll('[data-plus]').forEach(b=>b.onclick=async()=>{state.cart[Number(b.dataset.plus)].quantity++;await repriceCart();});
  document.getElementById('itemsCount').textContent=state.cart.reduce((s,i)=>s+i.quantity,0);document.getElementById('grand').textContent=money(total());
}

async function finalize(){
  if(state.busy||!state.cart.length)return;
  if(!state.status.cashOpenEventId)return openCashModal();
  const t=total();
  try{
    state.busy=true;
    const result=await window.thor.finalizeSale({items:state.cart.map(i=>({productId:i.productId,quantity:i.quantity})),payments:[{method:state.payment,amount:t}]});
    state.cart=[];renderCart();await refreshProducts();await refreshStatus();await refreshFiscalSales();
    showToast(`Venda registrada: ${money(result.total)}.`);
    await postSalePrint(result.eventId);
  }catch(e){alert(`Não foi possível finalizar: ${friendlyError(e.message)}`);}finally{state.busy=false;}
}

async function postSalePrint(eventId){
  const mode=state.settings?.printMode||'ask';
  const doc=state.settings?.printDocument||'ask';
  if(mode==='never')return;
  if(mode==='direct'&&doc!=='ask'){
    if(doc==='pre_sale')return safePrint(`local:${eventId}`,'pre_sale');
    if(doc==='nfce')return requestNfceAndMaybePrint(`local:${eventId}`);
  }
  return postSaleModal(`local:${eventId}`);
}

function postSaleModal(key){
  const m=modal(`<h3>Venda finalizada</h3><p class="muted">O que deseja fazer com o documento desta venda?</p><div class="document-choice"><button class="doc-choice" id="noPrint"><b>Não imprimir</b><span>Finalizar sem documento</span></button><button class="doc-choice" id="printPre"><b>Pré-venda / cupom</b><span>Comprovante não fiscal</span></button><button class="doc-choice fiscal-choice" id="printNfce"><b>NFC-e</b><span>Solicitar documento fiscal e imprimir após autorização</span></button></div>`);
  m.querySelector('#noPrint').onclick=()=>m.remove();
  m.querySelector('#printPre').onclick=async()=>{m.remove();await safePrint(key,'pre_sale');};
  m.querySelector('#printNfce').onclick=async()=>{m.remove();await requestNfceAndMaybePrint(key);};
}

async function requestNfceAndMaybePrint(key){
  const m=modal('<div id="fiscalProgressBody"></div>','wide');
  paintFiscalProgress(m,{fiscal:{status:'requested',events:[]}},'queueing');
  try{
    const requested=await window.thor.requestNfce({saleKey:key});
    if(requested.alreadyAuthorized){
      const done=await window.thor.fiscalSale(key);paintFiscalProgress(m,done,'done');await safePrint(key,'nfce');return;
    }

    paintFiscalProgress(m,{fiscal:{status:'processing',events:[]}},'sending');
    await window.thor.sync().catch(()=>{});
    const deadline=Date.now()+45000;
    let sale=null;
    while(Date.now()<deadline){
      await refreshFiscalSales();
      sale=await window.thor.fiscalSale(key);
      paintFiscalProgress(m,sale,'waiting');
      const status=String(sale?.fiscal?.status||'');
      if(fiscalTerminalStatuses.has(status))break;
      await wait(1500);
      await window.thor.sync().catch(()=>{});
    }

    if(!sale){sale=await window.thor.fiscalSale(key);paintFiscalProgress(m,sale,'waiting');}
    const status=String(sale?.fiscal?.status||'');
    if(status==='authorized'){
      await safePrint(key,'nfce');
      return;
    }
    if(status==='rejected'||status==='transmission_error')return;

    const actions=m.querySelector('#fiscalProgressActions');
    if(actions){actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRefreshNow">Atualizar agora</button>';actions.querySelector('#fiscalClose').onclick=()=>m.remove();actions.querySelector('#fiscalRefreshNow').onclick=async()=>{await window.thor.sync().catch(()=>{});await refreshFiscalSales();const current=await window.thor.fiscalSale(key);paintFiscalProgress(m,current,'waiting');};}
    const diag=m.querySelector('.fiscal-diagnostic');if(diag)diag.outerHTML='<div class="fiscal-diagnostic warning"><b>Tempo de acompanhamento excedido</b><span>A solicitação não ficará escondida: use “Atualizar agora” para consultar o estado sincronizado.</span></div>';
  }catch(e){
    const body=m.querySelector('#fiscalProgressBody');if(body)body.innerHTML=`<h3>Falha ao iniciar NFC-e</h3><div class="fiscal-diagnostic error"><b>Não foi possível iniciar a transmissão</b><span>${esc(friendlyError(e.message))}</span></div><div class="actions"><button class="primary" id="fiscalClose">Fechar</button></div>`;
    m.querySelector('#fiscalClose')?.addEventListener('click',()=>m.remove());
  }
}

async function safePrint(key,type){
  try{const r=await window.thor.printSale(key,type);if(r?.cancelled)return;showToast(type==='nfce'?'NFC-e enviada para impressão.':'Comprovante enviado para impressão.');}
  catch(e){if(e.message==='printer_not_configured'){infoModal('Impressora não configurada','Abra Configurações (F12), escolha uma impressora instalada no Windows ou “Salvar como PDF”.');}else infoModal('Impressão',friendlyError(e.message));}
}

function renderFiscalWorkspace(){
  const box=document.getElementById('workspace');
  box.innerHTML=`<main class="fiscal-workspace"><section class="fiscal-head"><div><small>MENU FISCAL</small><h1>Vendas e operações fiscais</h1><p>Visualize vendas, reimprima comprovantes, solicite NFC-e, cancele e faça devoluções.</p></div><button class="secondary" id="fiscalRefresh">Atualizar / sincronizar</button></section><section class="fiscal-toolbar"><input id="fiscalSearch" placeholder="Venda, cliente, chave de acesso ou status..." value="${esc(state.fiscalQuery)}"><span class="fiscal-count">${state.fiscalSales.length} operação(ões)</span></section><section class="fiscal-table-card"><div id="fiscalTable"></div></section></main>`;
  let timer;const search=document.getElementById('fiscalSearch');search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>refreshFiscalSales(search.value),150)};
  document.getElementById('fiscalRefresh').onclick=async()=>{await window.thor.sync();await refreshStatus();await refreshFiscalSales();showToast('Histórico fiscal atualizado.');};
  renderFiscalTable();
}

function renderFiscalTable(){
  const box=document.getElementById('fiscalTable');if(!box)return;
  if(!state.fiscalSales.length){box.innerHTML='<div class="empty">Nenhuma venda encontrada neste terminal/filial.</div>';return;}
  box.innerHTML=`<table class="fiscal-table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Total</th><th>Devolvido</th><th>Venda</th><th>NFC-e</th><th>Ações</th></tr></thead><tbody>${state.fiscalSales.map((s,i)=>`<tr><td><strong>${s.number?`#${esc(s.number)}`:'Pendente'}</strong><small>${esc(String(s.client_event_id||'').slice(0,8))}</small></td><td>${dt(s.completed_at||s.created_at)}</td><td>${esc(s.customer_name||'Consumidor')}</td><td><strong>${money(s.total)}</strong></td><td>${money(s.returned_total||0)}</td><td><span class="sale-status status-${esc(s.status||'pending')}">${saleStatusLabel(s.status)}</span></td><td>${fiscalBadge(s.fiscal)}</td><td><button class="table-action" data-view-sale="${i}">Abrir</button></td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=()=>openSaleDetail(state.fiscalSales[Number(b.dataset.viewSale)]));
}

async function openSaleDetail(sale){
  const key=saleKey(sale);let detail=sale;try{detail=await window.thor.fiscalSale(key);}catch{}
  const items=detail.items||[],payments=detail.payments||[],fiscal=detail.fiscal||null;
  const cancelState=nfceCancellationState(detail);
  const cancelAction=cancelState.available?`<button class="danger primary" id="cancelSale">${cancelState.authorized?'Cancelar venda + NFC-e':'Cancelar venda'}</button>`:cancelState.authorized?`<span class="muted" id="cancelDeadlineNote">${cancelState.expired?`Prazo de cancelamento encerrado em ${esc(cancelDeadlineLabel(cancelState.deadline))}`:'Prazo de cancelamento fiscal indisponível'}</span>`:'';
  const cancelMeta=cancelState.authorized&&cancelState.deadline?`<span>Cancelamento normal até: <b>${esc(cancelDeadlineLabel(cancelState.deadline))}</b></span>`:'';
  const m=modal(`<div class="sale-detail-head"><div><small>VENDA ${detail.number?`#${esc(detail.number)}`:'LOCAL'}</small><h3>${money(detail.total)}</h3><p>${dt(detail.completed_at||detail.created_at)} • ${esc(detail.customer_name||'Consumidor')}</p></div>${fiscalBadge(fiscal)}</div><div class="sale-detail-grid"><section><h4>Itens</h4><div class="detail-items">${items.map(i=>`<div><span><b>${Number(i.quantity||0)}×</b> ${esc(i.name||i.description||i.sku||'Item')}</span><strong>${money(i.total??(Number(i.quantity||0)*Number(i.unit_price||0)-Number(i.discount||0)))}</strong></div>`).join('')||'<p>Nenhum item disponível.</p>'}</div></section><section><h4>Pagamento</h4><div class="detail-items">${payments.map(p=>`<div><span>${esc(paymentLabels[p.method]||p.method||'Forma')}</span><strong>${money(p.amount)}</strong></div>`).join('')||'<p>Sem pagamento sincronizado.</p>'}</div><h4>Fiscal</h4><div class="fiscal-meta"><span>Status: <b>${esc(fiscal?.status||'Não solicitado')}</b></span><span>Chave: <b>${esc(fiscal?.access_key||'—')}</b></span><span>Protocolo: <b>${esc(fiscal?.protocol||'—')}</b></span>${fiscal?.cancellation_protocol?`<span>Protocolo cancelamento: <b>${esc(fiscal.cancellation_protocol)}</b></span>`:''}${cancelMeta}${fiscalCode(fiscal)?`<span>cStat SEFAZ: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}<span>Tentativas: <b>${Number(fiscal?.attempt_count||0)}</b></span></div>${fiscalDiagnosticHtml(fiscal)}<h4>Log da transmissão</h4>${fiscalTimelineHtml(fiscal)}</section></div><div class="sale-actions"><button class="secondary" id="reprintSale">Pré-venda</button><button class="secondary" id="nfceSale">${fiscal?.status==='authorized'?'Imprimir NFC-e':fiscal?.status==='transmission_error'?'Tentar envio novamente':'Solicitar NFC-e'}</button><button class="secondary warning-button" id="returnSale">Devolver</button>${cancelAction}</div>`,'wide');
  m.querySelector('#reprintSale').onclick=()=>safePrint(key,'pre_sale');
  m.querySelector('#nfceSale').onclick=()=>{m.remove();requestNfceAndMaybePrint(key);};
  m.querySelector('#returnSale').onclick=()=>{m.remove();returnSaleModal(detail);};
  const cancelButton=m.querySelector('#cancelSale');
  if(cancelButton)cancelButton.onclick=()=>{m.remove();cancelSaleModal(detail);};
  if(cancelButton&&cancelState.authorized&&cancelState.deadline){const timer=setInterval(()=>{if(!m.isConnected){clearInterval(timer);return;}const remaining=cancelState.deadline-Date.now();if(remaining<=0){cancelButton.remove();const actions=m.querySelector('.sale-actions');if(actions){const note=document.createElement('span');note.className='muted';note.textContent=`Prazo de cancelamento encerrado em ${cancelDeadlineLabel(cancelState.deadline)}`;actions.appendChild(note);}clearInterval(timer);return;}cancelButton.textContent=`Cancelar venda + NFC-e (${cancelRemainingLabel(remaining)})`;},1000);}
}

function cancelSaleModal(sale){
  const stateNow=nfceCancellationState(sale);
  if(stateNow.authorized&&!stateNow.available){infoModal('Cancelamento',friendlyError('nfce_cancellation_window_expired'));return;}
  const fiscalCancellation=stateNow.authorized;
  const intro=fiscalCancellation?`A NFC-e será cancelada primeiro na SEFAZ. Somente após a autorização do evento o THOR estornará estoque e financeiro da venda. Prazo normal: até ${esc(cancelDeadlineLabel(stateNow.deadline))}.`:'O cancelamento estorna o estoque e o financeiro da venda.';
  const m=modal(`<h3>${fiscalCancellation?'Cancelar venda + NFC-e':'Cancelar venda'} ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">${intro}</p>${fiscalCancellation?`<div class="fiscal-diagnostic processing"><b>Tempo restante</b><span id="cancelCountdown">${cancelRemainingLabel(stateNow.remainingMs)}</span></div>`:''}<div class="field"><label>Motivo do cancelamento</label><textarea id="cancelReason" rows="3" maxlength="255" placeholder="${fiscalCancellation?'Informe ao menos 15 caracteres...':'Informe o motivo...'}"></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="danger primary" id="confirmCancel">${fiscalCancellation?'Cancelar na SEFAZ e estornar venda':'Confirmar cancelamento'}</button></div>`);
  m.querySelector('#back').onclick=()=>m.remove();
  if(fiscalCancellation&&stateNow.deadline){const timer=setInterval(()=>{if(!m.isConnected){clearInterval(timer);return;}const rem=stateNow.deadline-Date.now(),label=m.querySelector('#cancelCountdown'),button=m.querySelector('#confirmCancel');if(label)label.textContent=cancelRemainingLabel(rem);if(rem<=0){if(button)button.disabled=true;if(label)label.textContent='Prazo encerrado';clearInterval(timer);}},1000);}
  m.querySelector('#confirmCancel').onclick=async()=>{try{const reason=m.querySelector('#cancelReason').value.trim().replace(/\s+/g,' ');if(!reason)return alert('Informe o motivo.');if(fiscalCancellation&&(reason.length<15||reason.length>255))return alert('A justificativa fiscal deve ter entre 15 e 255 caracteres.');const button=m.querySelector('#confirmCancel');button.disabled=true;button.textContent=fiscalCancellation?'Cancelando na SEFAZ...':'Cancelando...';await window.thor.cancelSale({saleKey:saleKey(sale),reason});m.remove();await window.thor.sync();await refreshProducts();await refreshFiscalSales();showToast(fiscalCancellation?'NFC-e cancelada na SEFAZ e venda estornada.':'Cancelamento enviado para o Gestão.');}catch(e){const code=String(e.message||'');const detail=e?.fiscal?.message;infoModal('Cancelamento',detail||friendlyError(code));const button=m.querySelector('#confirmCancel');if(button){button.disabled=false;button.textContent=fiscalCancellation?'Cancelar na SEFAZ e estornar venda':'Confirmar cancelamento';}}};
}

function returnSaleModal(sale){
  const items=sale.items||[];
  const m=modal(`<h3>Devolução da venda ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">Informe a quantidade de cada item que será devolvida. A devolução pode ser parcial.</p><div class="return-items">${items.map((i,n)=>{const max=Math.max(Number(i.quantity||0)-Number(i.returned_quantity||0),0);return `<label><span><b>${esc(i.name||i.description||i.sku||'Item')}</b><small>Vendido: ${Number(i.quantity||0)} • Já devolvido: ${Number(i.returned_quantity||0)}</small></span><input type="number" min="0" max="${max}" step="0.001" value="0" data-return-index="${n}"></label>`}).join('')}</div><div class="field"><label>Forma de restituição</label><select id="refundMethod">${Object.entries(paymentLabels).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}<option value="store_credit">Crédito em loja</option><option value="other">Outra</option></select></div><div class="field"><label>Motivo</label><textarea id="returnReason" rows="3" placeholder="Motivo da devolução..."></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="primary" id="confirmReturn">Concluir devolução</button></div>`,'wide');
  m.querySelector('#back').onclick=()=>m.remove();
  m.querySelector('#confirmReturn').onclick=async()=>{try{const selected=[];m.querySelectorAll('[data-return-index]').forEach(input=>{const qty=Number(input.value||0);if(qty>0){const original=items[Number(input.dataset.returnIndex)];selected.push({sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,quantity:qty});}});if(!selected.length)return alert('Informe ao menos uma quantidade para devolver.');const refundMethod=m.querySelector('#refundMethod').value;if(refundMethod==='cash'&&!state.status.cashOpenEventId)return alert('Abra o caixa antes de realizar devolução em dinheiro.');const result=await window.thor.returnSale({saleKey:saleKey(sale),items:selected,refundMethod,reason:m.querySelector('#returnReason').value.trim()});m.remove();await window.thor.sync();await refreshProducts();await refreshFiscalSales();showToast(`Devolução registrada (${money(result.estimatedTotal)} estimado).`);}catch(e){infoModal('Devolução',friendlyError(e.message));}};
}

async function settingsModal(){
  const [printers,ports,settings]=await Promise.all([window.thor.printers().catch(()=>[]),window.thor.serialPorts().catch(()=>[]),window.thor.settings()]);
  const shortcuts={...settings.shortcuts};
  const m=modal(`<div class="settings-head"><div><small>CONFIGURAÇÕES DO TERMINAL</small><h3>Impressão e atalhos</h3></div><span>ThorPDV ${esc(state.status?.appVersion||'')}</span></div><div class="settings-grid"><section><h4>Impressora</h4><div class="field"><label>Destino de impressão</label><select id="printerSelect"><option value="">Não configurada</option>${printers.map(p=>`<option value="${esc(p.Name)}" ${settings.printerName===p.Name?'selected':''}>${esc(p.DisplayName||p.Name)}${p.PortName?` — ${esc(p.PortName)}`:''}</option>`).join('')}</select></div><div class="printer-info">${printers.filter(p=>p.Name!=='__PDF__').map(p=>`<div><b>${esc(p.Name)}</b><span>${esc(p.DriverName||'')} • ${esc(p.PortName||'')}</span></div>`).join('')||'<span>Nenhuma impressora física detectada.</span>'}</div><p class="muted">“Salvar como PDF” abre uma janela para escolher o arquivo no Windows.</p><h4>Comportamento após a venda</h4><div class="field"><label>Modo de impressão</label><select id="printMode"><option value="ask" ${settings.printMode==='ask'?'selected':''}>Perguntar após finalizar</option><option value="direct" ${settings.printMode==='direct'?'selected':''}>Imprimir / solicitar direto</option><option value="never" ${settings.printMode==='never'?'selected':''}>Não imprimir automaticamente</option></select></div><div class="field"><label>Documento padrão</label><select id="printDocument"><option value="ask" ${settings.printDocument==='ask'?'selected':''}>Perguntar: pré-venda ou NFC-e</option><option value="pre_sale" ${settings.printDocument==='pre_sale'?'selected':''}>Pré-venda / comprovante não fiscal</option><option value="nfce" ${settings.printDocument==='nfce'?'selected':''}>NFC-e</option></select></div></section><section><h4>Atalhos das formas de pagamento</h4><p class="muted">Clique em um campo e pressione a tecla que deseja usar. F2, F3, F4, F6 e F12 são reservadas pelo sistema.</p><div class="shortcut-list">${Object.entries(paymentLabels).map(([k,n])=>`<label><span>${n}</span><input readonly data-shortcut="${k}" value="${esc(shortcuts[k]||'')}"></label>`).join('')}</div><h4>Hardware detectado</h4><div class="hardware-list"><span>Portas COM: ${ports.map(p=>esc(p.DeviceID)).join(', ')||'nenhuma'}</span></div></section></div><div id="settingsError" class="settings-error"></div><div class="actions"><button class="secondary" id="closeSettings">Cancelar</button><button class="primary" id="saveSettings">Salvar configurações</button></div>`,'wide');
  m.querySelector('#closeSettings').onclick=()=>m.remove();
  m.querySelectorAll('[data-shortcut]').forEach(input=>{input.onfocus=()=>{state.capturingShortcut=true;input.value='Pressione...';};input.onblur=()=>{state.capturingShortcut=false;if(input.value==='Pressione...')input.value=shortcuts[input.dataset.shortcut]||'';};input.onkeydown=e=>{e.preventDefault();const key=normalizeKey(e);if(!key)return;if(reservedShortcuts.has(key)){m.querySelector('#settingsError').textContent=`${key} é reservado pelo sistema.`;return;}shortcuts[input.dataset.shortcut]=key;input.value=key;m.querySelector('#settingsError').textContent='';input.blur();};});
  m.querySelector('#saveSettings').onclick=async()=>{const values=Object.values(shortcuts).filter(Boolean);if(new Set(values).size!==values.length){m.querySelector('#settingsError').textContent='Cada forma de pagamento precisa ter uma tecla diferente.';return;}state.settings=await window.thor.saveSettings({printerName:m.querySelector('#printerSelect').value,printMode:m.querySelector('#printMode').value,printDocument:m.querySelector('#printDocument').value,shortcuts});state.status.settings=state.settings;state.status.printer=state.settings.printerName;m.remove();render();showToast('Configurações salvas neste caixa.');};
}

function openCashModal(){
  const opened=state.status.cashOpenEventId;
  const m=modal(opened?`<h3>Caixa aberto</h3><p class="muted">Você pode lançar suprimento/sangria ou fechar o caixa.</p><div class="field"><label>Valor</label><input id="cashValue" type="number" step="0.01" value="0"></div><div class="actions"><button class="secondary" id="supply">Suprimento</button><button class="secondary" id="withdraw">Sangria</button><button class="danger primary" id="closeCash">Fechar caixa</button></div>`:`<h3>Abrir caixa</h3><p class="muted">Informe o fundo de troco inicial.</p><div class="field"><label>Valor de abertura</label><input id="cashValue" type="number" step="0.01" value="0"></div><div class="actions"><button class="primary" id="openCash">Abrir caixa</button></div>`);
  if(opened){m.querySelector('#supply').onclick=async()=>{await window.thor.cashMovement({movementType:'supply',amount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};m.querySelector('#withdraw').onclick=async()=>{await window.thor.cashMovement({movementType:'withdrawal',amount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};m.querySelector('#closeCash').onclick=async()=>{await window.thor.closeCash({closingAmount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};}else m.querySelector('#openCash').onclick=async()=>{await window.thor.openCash({openingAmount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};
}

function modal(html,size=''){const wrap=document.createElement('div');wrap.className='modal';wrap.innerHTML=`<div class="modal-card ${size}">${html}</div>`;document.body.appendChild(wrap);wrap.onclick=e=>{if(e.target===wrap)wrap.remove();};return wrap;}
function infoModal(title,text){const m=modal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="actions"><button class="primary" id="ok">OK</button></div>`);m.querySelector('#ok').onclick=()=>m.remove();}
function showToast(text){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t);}t.textContent=text;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2500);}

function fiscalBadge(fiscal){
  if(!fiscal)return '<span class="fiscal-status none">Não solicitada</span>';
  const status=String(fiscal.status||''),code=fiscalCode(fiscal);
  const labels={requested:'Solicitada',draft:'Rascunho',processing:'Processando',authorized:'Autorizada',rejected:'Rejeitada',transmission_error:'Falha no envio',cancelled:'Cancelada',contingency:'Contingência'};
  const live=status==='processing'?'<i class="fiscal-live-dot"></i> ':'';
  const suffix=(status==='rejected'&&code)?` ${esc(code)}`:'';
  return `<span class="fiscal-status fiscal-${esc(status)}">${live}${esc(labels[status]||status)}${suffix}</span>`;
}
function saleStatusLabel(status){return ({completed:'Concluída',cancelled:'Cancelada',pending_sync:'Pendente sync',cancel_pending:'Cancelando',return_pending:'Devolução pendente'}[status]||String(status||'Pendente'));}
function friendlyError(code){return ({printer_not_configured:'Nenhuma impressora foi configurada.',nfce_not_authorized:'A NFC-e ainda não foi autorizada.',nfce_pdf_unavailable:'A NFC-e está autorizada, mas o PDF/DANFE ainda não está disponível.',nfce_pdf_url_unavailable:'O caminho do PDF da NFC-e ainda não pode ser aberto pelo terminal.',authorized_fiscal_document_requires_fiscal_cancellation:'Esta venda possui documento fiscal autorizado. É necessário cancelar primeiro a NFC-e junto à SEFAZ/provedor fiscal.',nfce_cancellation_window_expired:'O prazo normal de 30 minutos para cancelar esta NFC-e já encerrou.',nfce_cancellation_deadline_unavailable:'Não foi possível determinar o prazo de cancelamento da NFC-e.',nfce_cancellation_reason_invalid:'Para cancelar uma NFC-e, informe uma justificativa entre 15 e 255 caracteres.',nfce_cancellation_rejected:'A SEFAZ rejeitou o evento de cancelamento da NFC-e. A venda não foi cancelada.',nfce_cancellation_transmission_error:'Não foi possível transmitir o cancelamento para a SEFAZ. A venda permanece ativa.',nfce_cancellation_failed:'O cancelamento fiscal não foi concluído. A venda permanece ativa.',sale_has_returns:'A venda possui devolução registrada e não pode ser cancelada integralmente.',sale_already_cancelled:'A venda já está cancelada.',sale_cancelled:'A venda está cancelada.',cash_required_for_cash_refund:'Para devolver em dinheiro é necessário haver um caixa aberto.',return_quantity_exceeds_remaining:'A quantidade informada supera o saldo disponível para devolução.',sale_not_found:'Venda não encontrada.',sale_item_not_found:'Item da venda não encontrado.'}[code]||code||'Erro inesperado');}

function normalizeKey(e){if(e.key.startsWith('F')&&/^F\d{1,2}$/i.test(e.key))return e.key.toUpperCase();if(e.key.length===1)return e.key.toUpperCase();if(['Insert','Delete','Home','End','PageUp','PageDown'].includes(e.key))return e.key.toUpperCase();return '';}

function handleHotkey(e){
  if(state.capturingShortcut)return;
  if(document.querySelector('.modal')){if(e.key==='Escape')document.querySelector('.modal')?.remove();return;}
  const key=normalizeKey(e)||e.key.toUpperCase();
  if(key==='F2'){e.preventDefault();if(state.view==='sale')finalize();return;}
  if(key==='F3'){e.preventDefault();setView(state.view==='fiscal'?'sale':'fiscal');return;}
  if(key==='F4'){e.preventDefault();openCashModal();return;}
  if(key==='F6'){e.preventDefault();window.thor.sync().then(async()=>{await refreshStatus();await refreshProducts();await refreshFiscalSales();showToast('Sincronizado.');});return;}
  if(key==='F12'){e.preventDefault();settingsModal();return;}
  if(state.view==='sale')for(const [method,shortcut] of Object.entries(state.settings?.shortcuts||{}))if(String(shortcut).toUpperCase()===key){e.preventDefault();selectPayment(method);showToast(`${paymentLabels[method]||method} selecionado.`);return;}
}

document.addEventListener('keydown',handleHotkey);

function updateTop(){
  if(!state.status)return;
  const s=document.getElementById('status'),q=document.getElementById('queue'),ctx=document.getElementById('context'),foot=document.getElementById('footerSync'),help=document.getElementById('hotkeyHelp');
  if(s){s.className=`status ${state.status.online?'online':'offline'}`;s.querySelector('b').textContent=state.status.syncing?'Sincronizando':state.status.online?'Online':'Offline';}
  if(q)q.textContent=`Fila: ${state.status.queue?.pending||0} pendente(s)${state.status.queue?.rejected?` • ${state.status.queue.rejected} rejeitado(s)`:''}`;
  if(ctx)ctx.textContent=`${state.status.context?.branch_name||''} • ${state.status.context?.pos_name||''}`;
  if(foot)foot.textContent=state.status.lastSyncAt?`Última sincronização: ${new Date(state.status.lastSyncAt).toLocaleTimeString('pt-BR')}`:'Ainda não sincronizado';
  if(help)help.textContent=state.view==='sale'?`F2 Finalizar • F3 Fiscal • F4 Caixa • F6 Sync • F12 Configurações • ${Object.entries(state.settings?.shortcuts||{}).map(([m,k])=>`${k} ${paymentLabels[m]||m}`).join(' • ')}`:'F3 Voltar para venda • F6 Atualizar • F12 Configurações';
}

boot().catch(e=>{app.innerHTML=`<main class="setup"><section class="setup-card"><h1>Falha ao iniciar</h1><div class="error">${esc(e.message)}</div></section></main>`;});
