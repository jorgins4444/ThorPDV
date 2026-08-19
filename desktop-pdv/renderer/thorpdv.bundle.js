/* ---- app.js ---- */
const app=document.getElementById('app');
const paymentLabels={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher'};
const reservedShortcuts=new Set(['F2','F3','F4','F6','F12','ENTER','ESCAPE']);
let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',fiscalFilter:{status:'all',from:'',to:''},capturingShortcut:false};
const SETTINGS_HARDWARE_CACHE_TTL_MS=45_000;
let settingsHardwareCache={printers:null,ports:null,loadedAt:0,promise:null};

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
  const phaseIndex={queueing:0,building:1,sending:2,waiting:3,done:3,printing:4,printed:5}[phase]??0;
  const authorized=status==='authorized',rejected=status==='rejected',failed=status==='transmission_error';
  const steps=[['Preparando NFC-e',0],['Assinando XML',1],['Enviando à SEFAZ',2],['Autorização',3],['Impressão',4]];
  return `<div class="fiscal-progress-steps smooth">${steps.map(([label,index])=>{const done=phase==='printed'||index<phaseIndex||(index===3&&authorized)||(index===2&&(authorized||rejected||failed));const active=!done&&index===Math.min(phaseIndex,4)&&!(rejected||failed);const error=(rejected||failed)&&index===3;return `<div class="fiscal-progress-step ${done?'done':''} ${active?'active':''} ${error?'error':''}"><i>${done?'✓':error?'!':''}</i><span>${label}</span></div>`}).join('')}</div>`;
}
function paintFiscalProgress(m,sale,phase='waiting'){
  if(!m?.isConnected)return;
  if(!m.dataset.fiscalStartedAt)m.dataset.fiscalStartedAt=String(Date.now());
  const elapsed=Math.max(0,Date.now()-Number(m.dataset.fiscalStartedAt||Date.now()));
  const fiscal=sale?.fiscal||{status:'requested'},status=String(fiscal.status||'requested');
  const isError=status==='rejected'||status==='transmission_error';
  const pctMap={queueing:9,building:28,sending:55,waiting:78,done:88,printing:95,printed:100};const pct=isError?82:(pctMap[phase]??15);
  let title='Preparando NFC-e',subtitle='Organizando os dados fiscais da venda.';
  if(phase==='building'){title='Gerando e assinando XML';subtitle='Aplicando certificado A1 e chave de acesso.';}
  if(phase==='sending'){title='Enviando para a SEFAZ';subtitle='Conexão segura com o autorizador fiscal.';}
  if(phase==='waiting'){title='Aguardando autorização';subtitle='A SEFAZ está validando a NFC-e.';}
  if(status==='authorized'){title=phase==='printing'?'NFC-e autorizada — imprimindo':phase==='printed'?'NFC-e autorizada e impressa':'NFC-e autorizada';subtitle=phase==='printing'?'Gerando o DANFE e enviando para a impressora.':phase==='printed'?'Documento fiscal concluído com sucesso.':'Autorização concluída.';}
  if(status==='rejected'){title='NFC-e rejeitada';subtitle=fiscalReason(fiscal)||'A SEFAZ rejeitou o documento.';}
  if(status==='transmission_error'){title='Falha no envio da NFC-e';subtitle=fiscalReason(fiscal)||'Não foi possível concluir a comunicação fiscal.';}
  const stopped=isError||phase==='printed';const details=isError?`<details class="fiscal-progress-details"><summary>Ver detalhes da transmissão</summary>${fiscalTimelineHtml(fiscal)}</details>`:'';
  const body=m.querySelector('#fiscalProgressBody');if(!body)return;
  body.innerHTML=`<div class="fiscal-progress-head smooth"><div class="fiscal-spinner ${stopped?'stopped':''} ${phase==='printed'?'success':''}">${phase==='printed'?'✓':''}</div><div><small>THORFISCAL / SEFAZ</small><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span class="fiscal-elapsed">${(elapsed/1000).toFixed(1)}s</span></div><div class="fiscal-flight"><div class="fiscal-flight-fill" style="width:${pct}%"></div><div class="fiscal-flight-glow" style="left:${Math.max(pct-2,0)}%"></div></div>${fiscalProgressSteps(fiscal,phase)}${isError?fiscalDiagnosticHtml(fiscal):''}<div class="fiscal-progress-meta"><span>Chave: <b>${esc(fiscal.access_key||'gerando...')}</b></span>${fiscal.protocol?`<span>Protocolo: <b>${esc(fiscal.protocol)}</b></span>`:''}${fiscalCode(fiscal)?`<span>cStat: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}</div>${details}<div class="actions" id="fiscalProgressActions"></div>`;
  const actions=body.querySelector('#fiscalProgressActions');if(isError){actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRetry">Tentar novamente</button>';actions.querySelector('#fiscalClose').onclick=()=>m.remove();actions.querySelector('#fiscalRetry').onclick=()=>{m.remove();requestNfceAndMaybePrint(saleKey(sale));};}else if(phase==='printed'){actions.innerHTML='<button class="primary" id="fiscalClose">Concluir</button>';actions.querySelector('#fiscalClose').onclick=()=>m.remove();}
}

async function boot(){
  const started=performance.now();
  state.status=await window.thor.status();
  state.settings=state.status.settings||await window.thor.settings();
  render();
  if(state.status.enrolled){
    await refreshProducts('');
    void refreshFiscalSales('').catch(()=>{});
    setInterval(async()=>{await refreshStatus();if(state.view==='fiscal'||state.fiscalSales.some(x=>['requested','draft','processing'].includes(String(x.fiscal?.status||''))))await refreshFiscalSales();},3000);
  }
  void window.thor.recordPerformance?.('ui.boot',performance.now()-started,{enrolled:Boolean(state.status.enrolled)});
}

async function refreshStatus(){state.status=await window.thor.status();state.settings=state.status.settings||state.settings;updateTop();}
async function refreshProducts(q=state.query){state.query=q;state.products=await window.thor.searchProducts(q);if(state.view==='sale')renderProducts();}
async function refreshFiscalSales(q=state.fiscalQuery){state.fiscalQuery=q;state.fiscalSales=await window.thor.fiscalSales(q);if(state.view==='fiscal')renderFiscalTable();}
function total(){return state.cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0);}

function render(){
  if(!state.status?.enrolled)return renderSetup();
  app.innerHTML=`<div class="shell"><header class="topbar"><div class="top-left"><div class="logo">ϟ THOR<b>PDV</b></div><span id="context"></span></div><div class="top-right"><button class="nav-button ${state.view==='sale'?'active':''}" id="navSale">Venda</button><button class="nav-button ${state.view==='fiscal'?'active':''}" id="navFiscal">Fiscal <kbd>F3</kbd></button><span id="queue" class="queue"></span><span id="status" class="status"><i></i><b></b></span><span class="pdv-version-chip" title="Versão atual do ThorPDV">v${esc(state.status?.appVersion||'—')}</span><button class="secondary" id="sync">Sincronizar <kbd>F6</kbd></button><button class="secondary" id="settings">Configurações <kbd>F12</kbd></button></div></header><div id="workspace" class="workspace"></div><footer class="bottom"><span id="hotkeyHelp"></span><span id="footerSync"></span></footer></div>`;
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
  search.oninput=()=>{clearTimeout(timer);const value=search.value;timer=setTimeout(()=>refreshProducts(value),220)};
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
  const started=performance.now(),t=total();
  const soldItems=state.cart.map(i=>({productId:i.productId,quantity:i.quantity}));
  try{
    state.busy=true;
    const result=await window.thor.finalizeSale({items:soldItems,payments:[{method:state.payment,amount:t}]});
    for(const sold of soldItems){const product=state.products.find(p=>p.id===sold.productId);if(product)product.quantity=Math.max(0,Number(product.quantity||0)-Number(sold.quantity||0));}
    state.cart=[];renderCart();renderProducts();
    state.busy=false;
    showToast(`Venda registrada: ${money(result.total)}.`);
    void window.thor.recordPerformance?.('ui.sale_released',performance.now()-started,{items:soldItems.length});
    setTimeout(()=>{void refreshStatus().catch(()=>{});void postSalePrint(result.eventId).catch(e=>showToast(`Venda salva. Impressão pendente: ${friendlyError(e.message)}`));},0);
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
  const m=modal('<div id="fiscalProgressBody"></div>','wide');m.dataset.fiscalStartedAt=String(Date.now());paintFiscalProgress(m,{fiscal:{status:'requested',events:[]}},'queueing');
  try{
    const requested=await window.thor.requestNfce({saleKey:key});
    if(requested.alreadyAuthorized){const done=await window.thor.fiscalSale(key);paintFiscalProgress(m,done,'printing');const printed=await safePrint(key,'nfce');paintFiscalProgress(m,done,printed?'printed':'done');if(printed)setTimeout(()=>{if(m.isConnected)m.remove()},1100);return;}
    const started=Date.now(),deadline=started+45000;let sale=null,recoveryTriggered=false;
    while(Date.now()<deadline){
      const elapsed=Date.now()-started;const visualPhase=elapsed<420?'building':elapsed<1200?'sending':'waiting';
      try{sale=await window.thor.fiscalSale(key)}catch{}
      paintFiscalProgress(m,sale||{fiscal:{status:'processing',events:[]}},visualPhase);
      const status=String(sale?.fiscal?.status||'');if(fiscalTerminalStatuses.has(status))break;
      // requestNfce já dispara o sync em segundo plano. Um segundo sync aqui duplicava push/pull/heartbeat.
      if(!recoveryTriggered&&elapsed>6000){recoveryTriggered=true;window.thor.sync().catch(()=>{});}
      await wait(140);
    }
    if(!sale){try{sale=await window.thor.fiscalSale(key)}catch{}}
    const status=String(sale?.fiscal?.status||'');
    if(status==='authorized'){paintFiscalProgress(m,sale,'printing');void refreshFiscalSales();const printed=await safePrint(key,'nfce');paintFiscalProgress(m,sale,printed?'printed':'done');if(printed)setTimeout(()=>{if(m.isConnected)m.remove()},1100);return;}
    if(status==='rejected'||status==='transmission_error'){void refreshFiscalSales();paintFiscalProgress(m,sale,'waiting');return;}
    const actions=m.querySelector('#fiscalProgressActions');if(actions){actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRefreshNow">Atualizar agora</button>';actions.querySelector('#fiscalClose').onclick=()=>m.remove();actions.querySelector('#fiscalRefreshNow').onclick=async()=>{window.thor.sync().catch(()=>{});await wait(250);const current=await window.thor.fiscalSale(key);paintFiscalProgress(m,current,'waiting');};}
    const body=m.querySelector('#fiscalProgressBody');if(body&&!body.querySelector('.fiscal-timeout-note'))body.insertAdjacentHTML('beforeend','<div class="fiscal-diagnostic warning fiscal-timeout-note"><b>A autorização continua sendo acompanhada</b><span>Use “Atualizar agora” para consultar o retorno sem gerar outra numeração.</span></div>');
  }catch(e){const body=m.querySelector('#fiscalProgressBody');if(body)body.innerHTML=`<h3>Falha ao iniciar NFC-e</h3><div class="fiscal-diagnostic error"><b>Não foi possível iniciar a transmissão</b><span>${esc(friendlyError(e.message))}</span></div><div class="actions"><button class="primary" id="fiscalClose">Fechar</button></div>`;m.querySelector('#fiscalClose')?.addEventListener('click',()=>m.remove());}
}

async function safePrint(key,type){
  try{const r=await window.thor.printSale(key,type);if(r?.cancelled)return false;showToast(type==='nfce'?'NFC-e enviada para impressão.':'Comprovante enviado para impressão.');return true;}
  catch(e){if(e.message==='printer_not_configured')infoModal('Impressora não configurada','Abra Configurações (F12), escolha uma impressora instalada no Windows ou “Salvar como PDF”.');else infoModal('Impressão',friendlyError(e.message));return false;}
}

function fiscalOperationBucket(sale){
  const saleStatus=String(sale?.status||'');
  const fiscalStatus=String(sale?.fiscal?.status||'');
  if(saleStatus==='cancelled'||saleStatus==='cancel_pending'||fiscalStatus==='cancelled')return 'cancelled';
  if(['rejected','transmission_error','requested','draft','processing'].includes(fiscalStatus))return 'pending';
  if(fiscalStatus==='authorized'||(!fiscalStatus&&saleStatus==='completed'))return 'completed';
  return 'pending';
}
function fiscalFilteredSales(){
  const filter=state.fiscalFilter||{status:'all',from:'',to:''};
  const from=filter.from?new Date(`${filter.from}T00:00:00`).getTime():null;
  const to=filter.to?new Date(`${filter.to}T23:59:59.999`).getTime():null;
  return state.fiscalSales.filter(sale=>{
    if(filter.status!=='all'&&fiscalOperationBucket(sale)!==filter.status)return false;
    const raw=sale.completed_at||sale.created_at||sale.fiscal?.authorization_at||'';
    const time=Date.parse(String(raw));
    if(filter.from&&(!Number.isFinite(time)||time<from))return false;
    if(filter.to&&(!Number.isFinite(time)||time>to))return false;
    return true;
  });
}
function fiscalFilterSummary(){
  const all=state.fiscalSales;
  return {
    completed:all.filter(x=>fiscalOperationBucket(x)==='completed').length,
    cancelled:all.filter(x=>fiscalOperationBucket(x)==='cancelled').length,
    pending:all.filter(x=>fiscalOperationBucket(x)==='pending').length,
  };
}
function renderFiscalWorkspace(){
  const box=document.getElementById('workspace');
  const filter=state.fiscalFilter||{status:'all',from:'',to:''};
  box.innerHTML=`<main class="fiscal-workspace"><section class="fiscal-head"><div><small>MENU FISCAL</small><h1>Vendas e operações fiscais</h1><p>Visualize vendas, reimprima comprovantes, solicite NFC-e, cancele, faça devoluções e acompanhe pendências fiscais.</p></div><button class="secondary" id="fiscalRefresh">Atualizar / sincronizar</button></section><section class="fiscal-toolbar fiscal-toolbar-v079"><div class="fiscal-search-wrap"><label>Pesquisar</label><input id="fiscalSearch" placeholder="Venda, cliente, chave de acesso ou status..." value="${esc(state.fiscalQuery)}"></div><div class="fiscal-filter-field"><label>De</label><input id="fiscalDateFrom" type="date" value="${esc(filter.from||'')}"></div><div class="fiscal-filter-field"><label>Até</label><input id="fiscalDateTo" type="date" value="${esc(filter.to||'')}"></div><div class="fiscal-filter-field fiscal-status-filter"><label>Situação</label><select id="fiscalStatusFilter"><option value="all" ${filter.status==='all'?'selected':''}>Todas</option><option value="completed" ${filter.status==='completed'?'selected':''}>Concluído</option><option value="cancelled" ${filter.status==='cancelled'?'selected':''}>Cancelado</option><option value="pending" ${filter.status==='pending'?'selected':''}>Pendências fiscais</option></select></div><button class="secondary fiscal-today" id="fiscalToday">Hoje</button><button class="secondary fiscal-clear" id="fiscalClear">Limpar</button><span class="fiscal-count" id="fiscalCount"></span></section><section class="fiscal-filter-chips" id="fiscalFilterChips"></section><section class="fiscal-table-card"><div id="fiscalTable"></div></section></main>`;
  let timer;const search=document.getElementById('fiscalSearch');search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>refreshFiscalSales(search.value),150)};
  const from=document.getElementById('fiscalDateFrom'),to=document.getElementById('fiscalDateTo'),status=document.getElementById('fiscalStatusFilter');
  from.onchange=()=>{state.fiscalFilter.from=from.value;renderFiscalTable();};
  to.onchange=()=>{state.fiscalFilter.to=to.value;renderFiscalTable();};
  status.onchange=()=>{state.fiscalFilter.status=status.value;renderFiscalTable();};
  document.getElementById('fiscalToday').onclick=()=>{const now=new Date();const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0'),today=`${y}-${m}-${d}`;state.fiscalFilter.from=today;state.fiscalFilter.to=today;from.value=today;to.value=today;renderFiscalTable();};
  document.getElementById('fiscalClear').onclick=()=>{state.fiscalFilter={status:'all',from:'',to:''};from.value='';to.value='';status.value='all';renderFiscalTable();};
  document.getElementById('fiscalRefresh').onclick=async()=>{await window.thor.sync();await refreshStatus();await refreshFiscalSales();showToast('Histórico fiscal atualizado.');};
  renderFiscalTable();
}

function renderFiscalTable(){
  const box=document.getElementById('fiscalTable');if(!box)return;
  const rows=fiscalFilteredSales(),summary=fiscalFilterSummary();
  const count=document.getElementById('fiscalCount');if(count)count.textContent=`${rows.length} de ${state.fiscalSales.length} operação(ões)`;
  const chips=document.getElementById('fiscalFilterChips');if(chips)chips.innerHTML=`<button class="fiscal-chip ${state.fiscalFilter.status==='completed'?'active':''}" data-fiscal-chip="completed"><b>${summary.completed}</b> Concluídas</button><button class="fiscal-chip ${state.fiscalFilter.status==='cancelled'?'active':''}" data-fiscal-chip="cancelled"><b>${summary.cancelled}</b> Canceladas</button><button class="fiscal-chip pending ${state.fiscalFilter.status==='pending'?'active':''}" data-fiscal-chip="pending"><b>${summary.pending}</b> Pendências fiscais</button>`;
  if(chips)chips.querySelectorAll('[data-fiscal-chip]').forEach(button=>button.onclick=()=>{const selected=button.dataset.fiscalChip;state.fiscalFilter.status=state.fiscalFilter.status===selected?'all':selected;const select=document.getElementById('fiscalStatusFilter');if(select)select.value=state.fiscalFilter.status;renderFiscalTable();});
  if(!rows.length){box.innerHTML='<div class="empty">Nenhuma operação encontrada para os filtros selecionados.</div>';return;}
  box.innerHTML=`<table class="fiscal-table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Total</th><th>Devolvido</th><th>Venda</th><th>NFC-e</th><th>Ações</th></tr></thead><tbody>${rows.map((s,i)=>`<tr class="fiscal-row-${fiscalOperationBucket(s)}"><td><strong>${s.number?`#${esc(s.number)}`:'Pendente'}</strong><small>${esc(String(s.client_event_id||'').slice(0,8))}</small></td><td>${dt(s.completed_at||s.created_at)}</td><td>${esc(s.customer_name||'Consumidor')}</td><td><strong>${money(s.total)}</strong></td><td>${money(s.returned_total||0)}</td><td><span class="sale-status status-${esc(s.status||'pending')}">${saleStatusLabel(s.status)}</span></td><td>${fiscalBadge(s.fiscal)}</td><td><button class="table-action" data-view-sale="${i}">Visualizar</button></td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=async()=>{const index=Number(b.dataset.viewSale);const target=rows[index];if(!target){infoModal('Visualizar venda','Não foi possível localizar esta venda na lista atual. Atualize o Fiscal e tente novamente.');return;}try{await openSaleDetail(target);}catch(e){console.error('sale_detail_open_failed',e);infoModal('Visualizar venda',`Não foi possível carregar os detalhes desta venda. ${friendlyError(String(e?.message||e||''))}`);}});
}

function saleItemCode(i){
  return String(i?.sku||i?.code||i?.internal_code||i?.product_code||i?.product_id||'—');
}

function saleDiscountTotals(detail,items){
  const safeItems=Array.isArray(items)?items:[];
  const gross=safeItems.reduce((sum,i)=>sum+(Number(i?.quantity||0)*Number(i?.unit_price||i?.unitPrice||0)),0);
  const itemDiscount=safeItems.reduce((sum,i)=>sum+Number(i?.discount||0),0);
  const saleDiscount=Number(detail?.discount||detail?.sale_discount||0);
  return {gross,itemDiscount,saleDiscount,totalDiscount:itemDiscount+saleDiscount};
}

function whatsappSaleModal(sale,type){
  const key=saleKey(sale),fiscalCancelled=String(sale?.fiscal?.status||'')==='cancelled';
  if(type==='pre_sale'&&fiscalCancelled){infoModal('Pré-venda indisponível',friendlyError('pre_sale_unavailable_cancelled_nfce'));return;}
  if(type==='nfce'&&!['authorized','cancelled'].includes(String(sale?.fiscal?.status||''))){infoModal('NFC-e',friendlyError('nfce_not_authorized'));return;}
  const label=type==='nfce'?'NFC-e':'pré-venda';
  const preset=String(sale?.customer_phone||sale?.phone||sale?.customer?.phone||'').replace(/\D/g,'');
  const m=modal(`<h3>Enviar ${esc(label)} pelo WhatsApp</h3><p class="muted">O THOR gera o PDF, abre a conversa no WhatsApp Web e deixa o arquivo selecionado no Explorador para anexação.</p><div class="field"><label>WhatsApp do cliente</label><input id="waPhone" inputmode="tel" autocomplete="tel" value="${esc(preset)}" placeholder="86999999999"></div><div class="whatsapp-share-note"><b>Documento</b><span>${esc(label)} ${sale?.number?`da venda #${esc(sale.number)}`:''}</span></div><div class="actions"><button class="secondary" id="waBack">Voltar</button><button class="primary whatsapp-button" id="waSend">Abrir WhatsApp</button></div>`);
  m.querySelector('#waBack').onclick=()=>m.remove();
  m.querySelector('#waSend').onclick=async()=>{
    const button=m.querySelector('#waSend');
    try{
      const phone=m.querySelector('#waPhone').value.trim();
      button.disabled=true;button.textContent='Gerando PDF...';
      const r=await window.thor.shareSaleWhatsapp(key,type,phone);
      m.remove();
      showToast(`WhatsApp aberto • ${r.filename} pronto em Downloads.`);
      setTimeout(()=>infoModal('Arquivo pronto',`O PDF ${r.filename} foi gerado e selecionado no Explorador. Arraste-o para a conversa do WhatsApp Web ou use o clipe para anexar.`),450);
    }catch(e){
      button.disabled=false;button.textContent='Abrir WhatsApp';
      infoModal('WhatsApp',friendlyError(String(e?.message||e)));
    }
  };
}

async function openSaleDetail(sale){
  const key=saleKey(sale);let detail=sale;try{detail=await window.thor.fiscalSale(key);}catch{}
  const items=detail.items||[],payments=detail.payments||[],fiscal=detail.fiscal||null;
  const fiscalCancelled=String(fiscal?.status||'')==='cancelled';
  const cancelledSale=['cancelled','cancel_pending'].includes(String(detail.status||''));
  const locked=fiscalCancelled||cancelledSale;
  const totals=saleDiscountTotals(detail,items);
  const cancelState=nfceCancellationState(detail);
  const cancelAction=cancelState.available?`<button class="danger primary" id="cancelSale">${cancelState.authorized?'Cancelar venda + NFC-e':'Cancelar venda'}</button>`:cancelState.authorized?`<span class="muted" id="cancelDeadlineNote">${cancelState.expired?`Prazo de cancelamento encerrado em ${esc(cancelDeadlineLabel(cancelState.deadline))}`:'Prazo de cancelamento fiscal indisponível'}</span>`:'';
  const cancelMeta=cancelState.authorized&&cancelState.deadline?`<span>Cancelamento normal até: <b>${esc(cancelDeadlineLabel(cancelState.deadline))}</b></span>`:'';
  const nfceLabel=fiscalCancelled?'Imprimir NFC-e cancelada':fiscal?.status==='authorized'?'Imprimir NFC-e':fiscal?.status==='transmission_error'?'Tentar envio novamente':'Solicitar NFC-e';
  const itemHtml=items.map(i=>{const qty=Number(i.quantity||0),unit=Number(i.unit_price||i.unitPrice||0),discount=Number(i.discount||0),line=Number(i.total??(qty*unit-discount));return `<div class="sale-item-detailed"><div class="sale-item-main"><b>${esc(i.name||i.description||i.sku||'Item')}</b><small>Código: ${esc(saleItemCode(i))}</small></div><div class="sale-item-numbers"><span><small>Qtd.</small><b>${qty}</b></span><span><small>Unitário</small><b>${money(unit)}</b></span><span><small>Desconto</small><b class="${discount>0?'discount-value':''}">${money(discount)}</b></span><span><small>Total</small><b>${money(line)}</b></span></div></div>`;}).join('')||'<p>Nenhum item disponível.</p>';
  const discountSummary=totals.totalDiscount>0?`<div class="sale-discount-highlight"><span>Desconto total aplicado</span><b>${money(totals.totalDiscount)}</b></div>`:'';
  const m=modal(`<div class="sale-detail-head"><div><small>VENDA ${detail.number?`#${esc(detail.number)}`:'LOCAL'}</small><h3>${money(detail.total)}</h3><p>${dt(detail.completed_at||detail.created_at)} • ${esc(detail.customer_name||'Consumidor')}</p></div>${fiscalBadge(fiscal)}</div>${fiscalCancelled?'<div class="sale-locked-banner"><b>Venda encerrada por cancelamento fiscal</b><span>Pré-venda, nova solicitação de NFC-e e devolução estão bloqueadas. A NFC-e cancelada continua disponível para consulta/reimpressão.</span></div>':''}<div class="sale-totals-grid"><div><small>Total bruto</small><strong>${money(totals.gross)}</strong></div><div><small>Desconto nos itens</small><strong>${money(totals.itemDiscount)}</strong></div><div><small>Desconto geral</small><strong>${money(totals.saleDiscount)}</strong></div><div><small>Total da venda</small><strong>${money(detail.total)}</strong></div></div>${discountSummary}<div class="sale-detail-grid"><section><h4>Itens vendidos</h4><div class="detail-items detailed">${itemHtml}</div></section><section><h4>Pagamento</h4><div class="detail-items">${payments.map(p=>`<div><span>${esc(paymentLabels[p.method]||p.method||'Forma')}</span><strong>${money(p.amount)}</strong></div>`).join('')||'<p>Sem pagamento sincronizado.</p>'}</div><h4>Fiscal</h4><div class="fiscal-meta"><span>Status: <b>${esc(fiscal?.status||'Não solicitado')}</b></span><span>Chave: <b>${esc(fiscal?.access_key||'—')}</b></span><span>Protocolo: <b>${esc(fiscal?.protocol||'—')}</b></span>${fiscal?.cancellation_protocol?`<span>Protocolo cancelamento: <b>${esc(fiscal.cancellation_protocol)}</b></span>`:''}${fiscal?.cancellation_at?`<span>Cancelada em: <b>${dt(fiscal.cancellation_at)}</b></span>`:''}${cancelMeta}${fiscalCode(fiscal)?`<span>cStat SEFAZ: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}<span>Tentativas: <b>${Number(fiscal?.attempt_count||0)}</b></span></div>${fiscalDiagnosticHtml(fiscal)}<h4>Log da transmissão</h4>${fiscalTimelineHtml(fiscal)}</section></div><div class="sale-actions"><button class="secondary" id="reprintSale" ${locked?'disabled title="Bloqueado após cancelamento da NFC-e"':''}>Pré-venda</button><button class="secondary" id="waPre" ${locked?'disabled title="Pré-venda bloqueada após cancelamento"':''}>WhatsApp pré-venda</button><button class="secondary" id="nfceSale">${esc(nfceLabel)}</button><button class="secondary whatsapp-button" id="waNfce" ${['authorized','cancelled'].includes(String(fiscal?.status||''))?'':'disabled title="NFC-e ainda não autorizada"'}>WhatsApp NFC-e</button><button class="secondary warning-button" id="returnSale" ${locked?'disabled title="Devolução bloqueada após cancelamento da NFC-e"':''}>Devolver</button>${cancelAction}</div>`,'wide');
  const reprint=m.querySelector('#reprintSale');if(reprint&&!locked)reprint.onclick=()=>safePrint(key,'pre_sale');
  const waPre=m.querySelector('#waPre');if(waPre&&!locked)waPre.onclick=()=>whatsappSaleModal(detail,'pre_sale');
  const nfceButton=m.querySelector('#nfceSale');
  if(fiscalCancelled)nfceButton.onclick=()=>safePrint(key,'nfce');else nfceButton.onclick=()=>{m.remove();requestNfceAndMaybePrint(key);};
  const waNfce=m.querySelector('#waNfce');if(waNfce&&!waNfce.disabled)waNfce.onclick=()=>whatsappSaleModal(detail,'nfce');
  const returnButton=m.querySelector('#returnSale');if(returnButton&&!locked)returnButton.onclick=()=>{m.remove();returnSaleModal(detail);};
  const cancelButton=m.querySelector('#cancelSale');
  if(cancelButton)cancelButton.onclick=()=>{m.remove();cancelSaleModal(detail);};
  if(cancelButton&&cancelState.authorized&&cancelState.deadline){const timer=setInterval(()=>{if(!m.isConnected){clearInterval(timer);return;}const remaining=cancelState.deadline-Date.now();if(remaining<=0){cancelButton.remove();const actions=m.querySelector('.sale-actions');if(actions){const note=document.createElement('span');note.className='muted';note.textContent=`Prazo de cancelamento encerrado em ${cancelDeadlineLabel(cancelState.deadline)}`;actions.appendChild(note);}clearInterval(timer);return;}cancelButton.textContent=`Cancelar venda + NFC-e (${cancelRemainingLabel(remaining)})`;},1000);}
}

function cancelProgressSteps(fiscalCancellation,phase,errorStage=0){
  const steps=fiscalCancellation?['Validando prazo','Preparando evento','Assinando evento','Enviando à SEFAZ','Evento aceito','Estorno da venda']:['Validando','Estornando venda','Sincronizando Gestão'];
  const map=fiscalCancellation?{validating:0,building:1,signing:2,sending:3,accepted:4,reversing:5,done:6}:{validating:0,reversing:1,syncing:2,done:3};
  const phaseIndex=phase==='error'?errorStage:(map[phase]??0);
  return `<div class="fiscal-progress-steps smooth cancel-progress-steps ${fiscalCancellation?'fiscal-cancel':'sale-cancel'}">${steps.map((label,index)=>{const done=phase==='done'||index<phaseIndex;const active=phase!=='done'&&phase!=='error'&&index===phaseIndex;const error=phase==='error'&&index===phaseIndex;return `<div class="fiscal-progress-step ${done?'done':''} ${active?'active':''} ${error?'error':''}"><i>${done?'✓':error?'!':''}</i><span>${label}</span></div>`}).join('')}</div>`;
}
function paintCancelProgress(m,sale,{fiscalCancellation,phase='validating',error='',errorStage=0,syncPending=false}={}){
  if(!m?.isConnected)return;
  if(!m.dataset.cancelStartedAt)m.dataset.cancelStartedAt=String(Date.now());
  const elapsed=Math.max(0,Date.now()-Number(m.dataset.cancelStartedAt||Date.now()));
  const fiscal=sale?.fiscal||{};
  const fiscalPct={validating:8,building:23,signing:40,sending:62,accepted:80,reversing:94,done:100,error:Math.max(14,Math.min(88,(errorStage+1)*16))};
  const localPct={validating:12,reversing:62,syncing:88,done:100,error:35};
  const pct=(fiscalCancellation?fiscalPct:localPct)[phase]??10;
  let title=fiscalCancellation?'Validando cancelamento da NFC-e':'Validando cancelamento da venda';
  let subtitle=fiscalCancellation?'Conferindo prazo fiscal e dados do documento.':'Conferindo venda e permissões do operador.';
  if(phase==='building'){title='Preparando evento de cancelamento';subtitle='Montando o evento 110111 com protocolo e justificativa.';}
  if(phase==='signing'){title='Assinando evento com certificado A1';subtitle='Aplicando assinatura digital antes da transmissão.';}
  if(phase==='sending'){title='Enviando cancelamento para a SEFAZ';subtitle='Aguardando o registro do evento no autorizador.';}
  if(phase==='accepted'){title='Cancelamento aceito pela SEFAZ';subtitle='Evento registrado. Finalizando o estorno da venda neste caixa.';}
  if(phase==='reversing'){title=fiscalCancellation?'NFC-e cancelada — estorno concluído':'Venda estornada';subtitle='Estoque e financeiro locais foram revertidos; sincronizando o Thor Gestão.';}
  if(phase==='syncing'){title='Venda estornada';subtitle='Sincronizando o cancelamento com o Thor Gestão.';}
  if(phase==='done'){title=fiscalCancellation?'NFC-e e venda canceladas':'Venda cancelada';subtitle=syncPending?'Cancelamento concluído neste caixa. A sincronização com o Gestão ficará pendente e será reenviada automaticamente.':'Estoque, financeiro e Gestão estão atualizados.';}
  if(phase==='error'){title='Cancelamento não concluído';subtitle=error||'O cancelamento foi interrompido.';}
  const body=m.querySelector('#cancelProgressBody');if(!body)return;
  const protocol=fiscal.cancellation_protocol||'';
  const code=String(fiscal.cancellation_cstat||fiscal.cStat||'').trim();
  const deadline=nfceCancellationState(sale).deadline;
  const stopped=phase==='done'||phase==='error';
  body.innerHTML=`<div class="fiscal-progress-head smooth cancel-progress-head"><div class="fiscal-spinner ${stopped?'stopped':''} ${phase==='done'?'success':''} ${phase==='error'?'cancel-error-spinner':''}">${phase==='done'?'✓':phase==='error'?'!':''}</div><div><small>${fiscalCancellation?'THORFISCAL / CANCELAMENTO':'THORPDV / CANCELAMENTO'}</small><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span class="fiscal-elapsed">${(elapsed/1000).toFixed(1)}s</span></div><div class="fiscal-flight cancel-flight ${phase==='error'?'error':''}"><div class="fiscal-flight-fill" style="width:${pct}%"></div><div class="fiscal-flight-glow" style="left:${Math.max(pct-2,0)}%"></div></div>${cancelProgressSteps(fiscalCancellation,phase,errorStage)}<div class="fiscal-progress-meta"><span>Venda: <b>${sale.number?`#${esc(sale.number)}`:'local'}</b></span>${fiscalCancellation?`<span>Chave: <b>${esc(fiscal.access_key||'—')}</b></span>`:''}${deadline?`<span>Prazo: <b>${esc(cancelDeadlineLabel(deadline))}</b></span>`:''}${protocol?`<span>Protocolo cancelamento: <b>${esc(protocol)}</b></span>`:''}${code?`<span>cStat: <b>${esc(code)}</b></span>`:''}</div>${phase==='error'?`<div class="fiscal-diagnostic error cancel-progress-error"><b>Cancelamento interrompido</b><span>${esc(error||'Verifique o retorno e tente novamente somente se necessário.')}</span></div>`:''}${phase==='done'&&syncPending?'<div class="fiscal-diagnostic warning"><b>Sincronização pendente</b><span>O cancelamento fiscal e o estorno local já foram concluídos. O ThorPDV tentará reenviar a atualização ao Gestão nas próximas sincronizações.</span></div>':''}<div class="actions" id="cancelProgressActions"></div>`;
  const actions=body.querySelector('#cancelProgressActions');
  if(phase==='done'){actions.innerHTML='<button class="primary" id="cancelFinish">Concluir</button>';actions.querySelector('#cancelFinish').onclick=()=>m.remove();}
  if(phase==='error'){const stateNow=nfceCancellationState(sale);const retryable=!fiscalCancellation||stateNow.available;actions.innerHTML=`<button class="secondary" id="cancelClose">Fechar</button>${retryable?'<button class="danger primary" id="cancelRetry">Tentar novamente</button>':''}`;actions.querySelector('#cancelClose').onclick=()=>m.remove();const retry=actions.querySelector('#cancelRetry');if(retry)retry.onclick=()=>{m.remove();cancelSaleModal(sale);};}
}

function cancelSaleModal(sale){
  const stateNow=nfceCancellationState(sale);
  if(stateNow.authorized&&!stateNow.available){infoModal('Cancelamento',friendlyError('nfce_cancellation_window_expired'));return;}
  const fiscalCancellation=stateNow.authorized;
  const intro=fiscalCancellation?`A NFC-e será cancelada primeiro na SEFAZ. Somente após o registro do evento o THOR concluirá o estorno da venda. Prazo normal: até ${esc(cancelDeadlineLabel(stateNow.deadline))}.`:'O cancelamento estorna o estoque e o financeiro da venda.';
  const m=modal(`<h3>${fiscalCancellation?'Cancelar venda + NFC-e':'Cancelar venda'} ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">${intro}</p>${fiscalCancellation?`<div class="fiscal-diagnostic processing"><b>Tempo restante</b><span id="cancelCountdown">${cancelRemainingLabel(stateNow.remainingMs)}</span></div>`:''}<div class="field"><label>Motivo do cancelamento</label><textarea id="cancelReason" rows="3" maxlength="255" placeholder="${fiscalCancellation?'Informe ao menos 15 caracteres...':'Informe o motivo...'}"></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="danger primary" id="confirmCancel">${fiscalCancellation?'Cancelar na SEFAZ e estornar venda':'Confirmar cancelamento'}</button></div>`,'wide');
  m.querySelector('#back').onclick=()=>m.remove();
  let countdownTimer=null;
  if(fiscalCancellation&&stateNow.deadline){countdownTimer=setInterval(()=>{if(!m.isConnected){clearInterval(countdownTimer);return;}const rem=stateNow.deadline-Date.now(),label=m.querySelector('#cancelCountdown'),button=m.querySelector('#confirmCancel');if(label)label.textContent=cancelRemainingLabel(rem);if(rem<=0){if(button)button.disabled=true;if(label)label.textContent='Prazo encerrado';clearInterval(countdownTimer);}},1000);}
  m.querySelector('#confirmCancel').onclick=async()=>{
    const reason=m.querySelector('#cancelReason').value.trim().replace(/\s+/g,' ');
    if(!reason)return alert('Informe o motivo.');
    if(fiscalCancellation&&(reason.length<15||reason.length>255))return alert('A justificativa fiscal deve ter entre 15 e 255 caracteres.');
    if(countdownTimer)clearInterval(countdownTimer);
    const card=m.querySelector('.modal-card');card.innerHTML='<div id="cancelProgressBody"></div>';m.dataset.cancelStartedAt=String(Date.now());
    paintCancelProgress(m,sale,{fiscalCancellation,phase:'validating'});
    let settled=false,cancelError=null,cancelResult=null;
    const task=window.thor.cancelSale({saleKey:saleKey(sale),reason}).then(result=>{cancelResult=result;settled=true;}).catch(e=>{cancelError=e;settled=true;});
    while(!settled&&m.isConnected){const elapsed=Date.now()-Number(m.dataset.cancelStartedAt||Date.now());const phase=fiscalCancellation?(elapsed<350?'validating':elapsed<800?'building':elapsed<1350?'signing':'sending'):(elapsed<350?'validating':'reversing');paintCancelProgress(m,sale,{fiscalCancellation,phase});await wait(120);}
    await task;
    if(cancelError){const raw=String(cancelError?.message||cancelError||'');let stage=fiscalCancellation?3:1;if(raw.includes('window_expired'))stage=0;else if(raw.includes('reason_invalid'))stage=1;else if(raw.includes('rejected'))stage=4;else if(raw.includes('transmission'))stage=3;paintCancelProgress(m,sale,{fiscalCancellation,phase:'error',error:friendlyError(raw),errorStage:stage});return;}
    let finalSale=sale;try{finalSale=await window.thor.fiscalSale(saleKey(sale));}catch{}
    if(fiscalCancellation){paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'accepted'});await wait(180);}
    paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'reversing'});
    let syncPending=false;
    try{await window.thor.sync();}catch{syncPending=true;}
    try{await refreshProducts();}catch{}
    try{await refreshFiscalSales();}catch{}
    try{finalSale=await window.thor.fiscalSale(saleKey(sale));}catch{}
    let printWarning='';
    try{await window.thor.printSaleCancellation(cancelResult?.receipt||{});}catch(printError){printWarning=friendlyError(printError?.message||'print_failed');}
    paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'done',syncPending});
    const successMessage=fiscalCancellation?'NFC-e cancelada e venda estornada.':'Venda cancelada.';
    showToast(printWarning?`${successMessage} Impressão pendente: ${printWarning}`:`${successMessage} Comprovante impresso.`);
  };
}

function returnSaleModal(sale){
  const items=sale.items||[];
  const m=modal(`<h3>Devolução da venda ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">Informe a quantidade de cada item que será devolvida. A devolução pode ser parcial.</p><div class="return-items">${items.map((i,n)=>{const max=Math.max(Number(i.quantity||0)-Number(i.returned_quantity||0),0);return `<label><span><b>${esc(i.name||i.description||i.sku||'Item')}</b><small>Vendido: ${Number(i.quantity||0)} • Já devolvido: ${Number(i.returned_quantity||0)}</small></span><input type="number" min="0" max="${max}" step="0.001" value="0" data-return-index="${n}"></label>`}).join('')}</div><div class="field"><label>Forma de restituição</label><select id="refundMethod">${Object.entries(paymentLabels).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}<option value="store_credit">Crédito em loja</option><option value="other">Outra</option></select></div><div class="field"><label>Motivo</label><textarea id="returnReason" rows="3" placeholder="Motivo da devolução..."></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="primary" id="confirmReturn">Concluir devolução</button></div>`,'wide');
  m.querySelector('#back').onclick=()=>m.remove();
  m.querySelector('#confirmReturn').onclick=async()=>{try{const selected=[];m.querySelectorAll('[data-return-index]').forEach(input=>{const qty=Number(input.value||0);if(qty>0){const original=items[Number(input.dataset.returnIndex)];selected.push({sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,quantity:qty});}});if(!selected.length)return alert('Informe ao menos uma quantidade para devolver.');const refundMethod=m.querySelector('#refundMethod').value;if(refundMethod==='cash'&&!state.status.cashOpenEventId)return alert('Abra o caixa antes de realizar devolução em dinheiro.');const result=await window.thor.returnSale({saleKey:saleKey(sale),items:selected,refundMethod,reason:m.querySelector('#returnReason').value.trim()});m.remove();await window.thor.sync();await refreshProducts();await refreshFiscalSales();showToast(`Devolução registrada (${money(result.estimatedTotal)} estimado).`);}catch(e){infoModal('Devolução',friendlyError(e.message));}};
}

function settingsFallbackHardware(settings){
  const virtualPdf={Name:'__PDF__',DisplayName:'Salvar como PDF',DriverName:'ThorPDV PDF',PortName:'Arquivo PDF',IsVirtual:true};
  const configured=String(settings?.printerName||'').trim();
  const printers=[virtualPdf];
  if(configured&&configured!=='__PDF__')printers.push({Name:configured,DisplayName:configured,DriverName:'',PortName:'',IsVirtual:false,ConfiguredOnly:true});
  return {printers,ports:[]};
}
function settingsPrinterOptions(printers,selected=''){
  const byName=new Map();
  for(const p of Array.isArray(printers)?printers:[]){const name=String(p?.Name||'').trim();if(name&&!byName.has(name))byName.set(name,p);}
  if(!byName.has('__PDF__'))byName.set('__PDF__',{Name:'__PDF__',DisplayName:'Salvar como PDF',PortName:'Arquivo PDF',IsVirtual:true});
  if(selected&&!byName.has(selected))byName.set(selected,{Name:selected,DisplayName:selected,ConfiguredOnly:true});
  return `<option value="">Não configurada</option>${[...byName.values()].map(p=>`<option value="${esc(p.Name)}" ${selected===p.Name?'selected':''}>${esc(p.DisplayName||p.Name)}${p.PortName?` — ${esc(p.PortName)}`:''}</option>`).join('')}`;
}
function applySettingsHardware(m,settings,printers,ports,{loading=false,cached=false}={}){
  if(!m?.isConnected)return;
  const select=m.querySelector('#printerSelect');
  const selected=String(select?.value||settings?.printerName||'');
  if(select){select.innerHTML=settingsPrinterOptions(printers,selected);if([...select.options].some(o=>o.value===selected))select.value=selected;}
  const info=m.querySelector('#printerInfo');
  if(info){const physical=(Array.isArray(printers)?printers:[]).filter(p=>p.Name!=='__PDF__'&&!p.ConfiguredOnly);info.innerHTML=physical.map(p=>`<div><b>${esc(p.Name)}</b><span>${esc(p.DriverName||'')} ${p.DriverName&&p.PortName?'•':''} ${esc(p.PortName||'')}</span></div>`).join('')||(loading?'<span>Detectando impressoras do Windows em segundo plano...</span>':'<span>Nenhuma impressora física detectada.</span>');}
  const printerStatus=m.querySelector('#printerHardwareStatus');
  if(printerStatus)printerStatus.textContent=loading?(cached?'Atualizando lista em segundo plano...':'Detectando em segundo plano...'):(cached?'Lista carregada do cache local.':'Hardware atualizado.');
  const serial=m.querySelector('#serialHardware');
  if(serial)serial.textContent=`Portas COM: ${(Array.isArray(ports)?ports:[]).map(p=>String(p?.DeviceID||'')).filter(Boolean).join(', ')||'nenhuma'}`;
  const serialStatus=m.querySelector('#serialHardwareStatus');
  if(serialStatus)serialStatus.textContent=loading?'A detecção não bloqueia mais esta tela.':'';
}
function loadSettingsHardware(m,settings,{force=false}={}){
  const now=Date.now();
  const fallback=settingsFallbackHardware(settings);
  const hasCache=Array.isArray(settingsHardwareCache.printers)&&Array.isArray(settingsHardwareCache.ports);
  const fresh=hasCache&&(now-settingsHardwareCache.loadedAt)<SETTINGS_HARDWARE_CACHE_TTL_MS;
  if(fresh&&!force){applySettingsHardware(m,settings,settingsHardwareCache.printers,settingsHardwareCache.ports,{cached:true});return Promise.resolve(settingsHardwareCache);}
  const initialPrinters=hasCache?settingsHardwareCache.printers:fallback.printers;
  const initialPorts=hasCache?settingsHardwareCache.ports:fallback.ports;
  applySettingsHardware(m,settings,initialPrinters,initialPorts,{loading:true,cached:hasCache});
  if(!settingsHardwareCache.promise||force){
    settingsHardwareCache.promise=Promise.all([
      window.thor.printers().catch(()=>null),
      window.thor.serialPorts().catch(()=>null),
    ]).then(([printers,ports])=>{
      settingsHardwareCache.printers=Array.isArray(printers)&&printers.length?printers:initialPrinters;
      settingsHardwareCache.ports=Array.isArray(ports)?ports:initialPorts;
      settingsHardwareCache.loadedAt=Date.now();
      return settingsHardwareCache;
    }).finally(()=>{settingsHardwareCache.promise=null;});
  }
  const pending=settingsHardwareCache.promise;
  return pending.then(cache=>{applySettingsHardware(m,settings,cache.printers,cache.ports,{cached:false});return cache;}).catch(()=>{applySettingsHardware(m,settings,initialPrinters,initialPorts,{cached:hasCache});return settingsHardwareCache;});
}

function settingsModal(){
  const settings=state.settings||state.status?.settings||{printerName:'',printMode:'ask',printDocument:'ask',shortcuts:{}};
  const shortcuts={...(settings.shortcuts||{})};
  const cached=Array.isArray(settingsHardwareCache.printers)&&Array.isArray(settingsHardwareCache.ports);
  const initial=cached?{printers:settingsHardwareCache.printers,ports:settingsHardwareCache.ports}:settingsFallbackHardware(settings);
  const m=modal(`<div class="settings-head"><div><small>CONFIGURAÇÕES DO TERMINAL</small><h3>Impressão e atalhos</h3></div><span>ThorPDV ${esc(state.status?.appVersion||'')}</span></div><div class="settings-grid"><section><h4>Impressora</h4><div class="field"><label>Destino de impressão</label><select id="printerSelect">${settingsPrinterOptions(initial.printers,String(settings.printerName||''))}</select><small class="muted" id="printerHardwareStatus">${cached?'Lista carregada do cache local.':'Abrindo configurações...'}</small></div><div class="printer-info" id="printerInfo"></div><p class="muted">“Salvar como PDF” abre uma janela para escolher o arquivo no Windows.</p><h4>Comportamento após a venda</h4><div class="field"><label>Modo de impressão</label><select id="printMode"><option value="ask" ${settings.printMode==='ask'?'selected':''}>Perguntar após finalizar</option><option value="direct" ${settings.printMode==='direct'?'selected':''}>Imprimir / solicitar direto</option><option value="never" ${settings.printMode==='never'?'selected':''}>Não imprimir automaticamente</option></select></div><div class="field"><label>Documento padrão</label><select id="printDocument"><option value="ask" ${settings.printDocument==='ask'?'selected':''}>Perguntar: pré-venda ou NFC-e</option><option value="pre_sale" ${settings.printDocument==='pre_sale'?'selected':''}>Pré-venda / comprovante não fiscal</option><option value="nfce" ${settings.printDocument==='nfce'?'selected':''}>NFC-e</option></select></div></section><section><h4>Atalhos das formas de pagamento</h4><p class="muted">Clique em um campo e pressione a tecla que deseja usar. F2, F3, F4, F6 e F12 são reservadas pelo sistema.</p><div class="shortcut-list">${Object.entries(paymentLabels).map(([k,n])=>`<label><span>${n}</span><input readonly data-shortcut="${k}" value="${esc(shortcuts[k]||'')}"></label>`).join('')}</div><h4>Hardware detectado</h4><div class="hardware-list"><span id="serialHardware">Portas COM: ${(initial.ports||[]).map(p=>esc(p.DeviceID)).join(', ')||'nenhuma'}</span><small class="muted" id="serialHardwareStatus"></small></div></section></div><div id="settingsError" class="settings-error"></div><div class="actions"><button class="secondary" id="refreshHardware">Atualizar hardware</button><button class="secondary" id="closeSettings">Cancelar</button><button class="primary" id="saveSettings">Salvar configurações</button></div>`,'wide');
  applySettingsHardware(m,settings,initial.printers,initial.ports,{loading:!cached,cached});
  setTimeout(()=>{void loadSettingsHardware(m,settings);},0);
  m.querySelector('#refreshHardware').onclick=()=>{settingsHardwareCache.loadedAt=0;void loadSettingsHardware(m,settings,{force:true});};
  m.querySelector('#closeSettings').onclick=()=>m.remove();
  m.querySelectorAll('[data-shortcut]').forEach(input=>{input.onfocus=()=>{state.capturingShortcut=true;input.value='Pressione...';};input.onblur=()=>{state.capturingShortcut=false;if(input.value==='Pressione...')input.value=shortcuts[input.dataset.shortcut]||'';};input.onkeydown=e=>{e.preventDefault();const key=normalizeKey(e);if(!key)return;if(reservedShortcuts.has(key)){m.querySelector('#settingsError').textContent=`${key} é reservado pelo sistema.`;return;}shortcuts[input.dataset.shortcut]=key;input.value=key;m.querySelector('#settingsError').textContent='';input.blur();};});
  m.querySelector('#saveSettings').onclick=async()=>{const values=Object.values(shortcuts).filter(Boolean);if(new Set(values).size!==values.length){m.querySelector('#settingsError').textContent='Cada forma de pagamento precisa ter uma tecla diferente.';return;}state.settings=await window.thor.saveSettings({printerName:m.querySelector('#printerSelect').value,printMode:m.querySelector('#printMode').value,printDocument:m.querySelector('#printDocument').value,shortcuts});state.status.settings=state.settings;state.status.printer=state.settings.printerName;m.remove();render();showToast('Configurações salvas neste caixa.');};
}

function openCashModal(){
  const opened=state.status.cashOpenEventId;
  const m=modal(opened?`<h3>Caixa aberto</h3><p class="muted">Você pode lançar suprimento/sangria ou fechar o caixa.</p><div class="field"><label>Valor</label><input id="cashValue" type="number" step="0.01" value="0"></div><div class="actions"><button class="secondary" id="supply">Suprimento</button><button class="secondary" id="withdraw">Sangria</button><button class="danger primary" id="closeCash">Fechar caixa</button></div>`:`<h3>Abrir caixa</h3><p class="muted">Informe o fundo de troco inicial.</p><div class="field"><label>Valor de abertura</label><input id="cashValue" type="number" step="0.01" value="0"></div><div class="actions"><button class="primary" id="openCash">Abrir caixa</button></div>`);
  if(opened){m.querySelector('#supply').onclick=async()=>{const result=await window.thor.cashMovement({movementType:'supply',amount:Number(m.querySelector('#cashValue').value),operatorId:state.status?.operator?.id||null,operatorName:state.status?.operator?.name||''});await window.thor.printCashMovement(result?.receipt||{});m.remove();refreshStatus();};m.querySelector('#withdraw').onclick=async()=>{const result=await window.thor.cashMovement({movementType:'withdrawal',amount:Number(m.querySelector('#cashValue').value),operatorId:state.status?.operator?.id||null,operatorName:state.status?.operator?.name||''});await window.thor.printCashMovement(result?.receipt||{});m.remove();refreshStatus();};m.querySelector('#closeCash').onclick=async()=>{await window.thor.closeCash({closingAmount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};}else m.querySelector('#openCash').onclick=async()=>{await window.thor.openCash({openingAmount:Number(m.querySelector('#cashValue').value)});m.remove();refreshStatus();};
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
function friendlyError(code){return ({printer_not_configured:'Nenhuma impressora foi configurada.',nfce_not_authorized:'A NFC-e ainda não foi autorizada.',nfce_pdf_unavailable:'A NFC-e está autorizada, mas o PDF/DANFE ainda não está disponível.',nfce_pdf_url_unavailable:'O caminho do PDF da NFC-e ainda não pode ser aberto pelo terminal.',authorized_fiscal_document_requires_fiscal_cancellation:'Esta venda possui documento fiscal autorizado. É necessário cancelar primeiro a NFC-e junto à SEFAZ/provedor fiscal.',nfce_cancellation_window_expired:'O prazo normal de 30 minutos para cancelar esta NFC-e já encerrou.',nfce_cancellation_deadline_unavailable:'Não foi possível determinar o prazo de cancelamento da NFC-e.',nfce_cancellation_reason_invalid:'Para cancelar uma NFC-e, informe uma justificativa entre 15 e 255 caracteres.',nfce_cancellation_rejected:'A SEFAZ rejeitou o evento de cancelamento da NFC-e. A venda não foi cancelada.',nfce_cancellation_transmission_error:'Não foi possível transmitir o cancelamento para a SEFAZ. A venda permanece ativa.',nfce_cancellation_failed:'O cancelamento fiscal não foi concluído. A venda permanece ativa.',sale_has_returns:'A venda possui devolução registrada e não pode ser cancelada integralmente.',sale_already_cancelled:'A venda já está cancelada.',sale_cancelled:'A venda está cancelada.',cash_required_for_cash_refund:'Para devolver em dinheiro é necessário haver um caixa aberto.',return_quantity_exceeds_remaining:'A quantidade informada supera o saldo disponível para devolução.',sale_not_found:'Venda não encontrada.',sale_item_not_found:'Item da venda não encontrado.',pre_sale_unavailable_cancelled_nfce:'A pré-venda fica indisponível depois que a NFC-e é cancelada.',whatsapp_phone_invalid:'Informe um telefone válido com DDD. Ex.: 86999999999.',whatsapp_document_invalid:'Documento inválido para envio pelo WhatsApp.'}[code]||code||'Erro inesperado');}

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

;

/* ---- checkout-v3.js ---- */
const v3PaymentLabels={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher'};
const v3OriginalRender=render;
const v3OriginalUpdateTop=updateTop;

function v3State(){
  if(!state.v3) state.v3={operator:null,operators:[],seller:null,sellerInitialized:false,consumerDocument:'',discount:0,surcharge:0,supervisorAuthorization:null,payments:[],quote:null,lastProductId:null,operatorPromptOpen:false,settings:null};
  return state.v3;
}
function v3Perm(path,fallback=false){const op=v3State().operator;return path.split('.').reduce((o,k)=>o&&o[k],op?.permissions)??fallback;}
function v3Digits(v){return String(v||'').replace(/\D/g,'');}
function v3Cpf(cpf){cpf=v3Digits(cpf);if(cpf.length!==11||/^(\d)\1+$/.test(cpf))return false;let s=0;for(let i=0;i<9;i++)s+=Number(cpf[i])*(10-i);let d=(s*10)%11;if(d===10)d=0;if(d!==Number(cpf[9]))return false;s=0;for(let i=0;i<10;i++)s+=Number(cpf[i])*(11-i);d=(s*10)%11;if(d===10)d=0;return d===Number(cpf[10]);}
function v3Cnpj(cnpj){cnpj=v3Digits(cnpj);if(cnpj.length!==14||/^(\d)\1+$/.test(cnpj))return false;const calc=(len)=>{let size=len-7,pos=len-1,sum=0;for(let i=len;i>=1;i--){sum+=Number(cnpj[size-len])*pos--;if(pos<2)pos=9;size++;}const r=sum%11;return r<2?0:11-r;};return calc(12)===Number(cnpj[12])&&calc(13)===Number(cnpj[13]);}
function v3ValidDocument(v){const d=v3Digits(v);return !d||v3Cpf(d)||v3Cnpj(d);}
function v3Total(){const q=v3State().quote;return Number(q?.total??state.cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0));}
function v3Paid(){return v3State().payments.reduce((s,p)=>s+Number(p.amount||0),0);}
function v3Remaining(){return Math.max(v3Total()-v3Paid(),0);}
function v3Change(){return v3State().payments.reduce((s,p)=>s+Number(p.changeAmount||p.change_amount||0),0);}
function v3ResetSale(){const v=v3State();v.consumerDocument='';v.discount=0;v.surcharge=0;v.supervisorAuthorization=null;v.payments=[];v.quote=null;v.lastProductId=null;v.seller=v.operator||null;v.sellerInitialized=Boolean(v.operator);}

async function v3Hydrate(){
  const v=v3State();
  try{v.operators=await window.thor.operators();}catch{v.operators=[];}
  v.operator=state.status?.operator||null;
  try{v.settings=await window.thor.v3Settings();}catch{v.settings={};}
  if(!v.operator&&!v.operatorPromptOpen&&state.status?.enrolled)setTimeout(()=>v3OperatorModal(true),80);
}

render=function(){
  v3OriginalRender();
  if(state.status?.enrolled){setTimeout(async()=>{await v3Hydrate();v3DecorateTop();if(state.view==='sale')renderSaleWorkspace();},0);}
};

updateTop=function(){v3OriginalUpdateTop();v3DecorateTop();};

function v3DecorateTop(){
  const top=document.querySelector('.top-right');if(!top||document.getElementById('operatorBtn'))return;
  const operator=v3State().operator;
  const btn=document.createElement('button');btn.id='operatorBtn';btn.className='operator-chip';btn.innerHTML=`<span>👤</span><b>${esc(operator?.name||'Entrar operador')}</b>`;btn.onclick=()=>v3OperatorModal(false);
  const queue=document.getElementById('queue');top.insertBefore(btn,queue||top.firstChild);
  const drawer=document.createElement('button');drawer.id='drawerBtn';drawer.className='secondary compact';drawer.textContent='Gaveta';drawer.onclick=async()=>{try{await window.thor.openDrawer();showToast('Comando de abertura enviado à gaveta.');}catch(e){infoModal('Gaveta',friendlyError(e.message));}};top.insertBefore(drawer,queue||top.firstChild);
}

async function v3OperatorModal(required=false){
  const v=v3State();if(v.operatorPromptOpen)return;v.operatorPromptOpen=true;
  try{v.operators=await window.thor.operators();}catch{}
  const current=v.operator;
  const m=modal(`<div class="operator-login-head"><div><small>OPERADOR DO CAIXA</small><h3>${current?'Trocar operador':'Identifique-se para operar'}</h3></div>${current?`<span class="operator-current">Atual: ${esc(current.name)}</span>`:''}</div>${v.operators.length?`<div class="field"><label>Usuário</label><select id="opUser">${v.operators.map(o=>`<option value="${esc(o.id)}">${esc(o.name)} — ${esc(o.profile_name||'PDV')}</option>`).join('')}</select></div><div class="field"><label>PIN</label><input id="opPin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="4 a 8 dígitos"></div><div id="opError" class="settings-error"></div><div class="actions">${current&&!required?'<button class="secondary" id="opLogout">Sair do operador</button>':''}${!required?'<button class="secondary" id="opCancel">Cancelar</button>':''}<button class="primary" id="opLogin">Entrar</button></div>`:`<div class="error">Nenhum usuário PDV foi sincronizado. Clique em Sincronizar no caixa ou cadastre um usuário PDV no Gestão.</div><div class="actions">${!required?'<button class="secondary" id="opCancel">Fechar</button>':''}<button class="primary" id="opSync">Sincronizar</button></div>`}`,'operator-modal');
  const release=()=>{v.operatorPromptOpen=false;};
  if(m.querySelector('#opCancel'))m.querySelector('#opCancel').onclick=()=>{m.remove();release();};
  if(m.querySelector('#opSync'))m.querySelector('#opSync').onclick=async()=>{await window.thor.sync();v.operators=await window.thor.operators();m.remove();release();v3OperatorModal(required);};
  if(m.querySelector('#opLogout'))m.querySelector('#opLogout').onclick=async()=>{await window.thor.operatorLogout();v.operator=null;state.status.operator=null;m.remove();release();render();};
  if(m.querySelector('#opLogin'))m.querySelector('#opLogin').onclick=async()=>{try{const r=await window.thor.operatorLogin({userId:m.querySelector('#opUser').value,pin:m.querySelector('#opPin').value});v.operator=r.operator;state.status.operator=r.operator;m.remove();release();render();showToast(`Operador ${r.operator.name} identificado.`);}catch(e){m.querySelector('#opError').textContent=friendlyError(e.message);}};
  const pin=m.querySelector('#opPin');if(pin){pin.focus();pin.onkeydown=e=>{if(e.key==='Enter')m.querySelector('#opLogin').click();};}
}

renderSaleWorkspace=function(){
  const v=v3State();const box=document.getElementById('workspace');if(!box)return;
  box.innerHTML=`<main class="work v3-work"><section class="catalog"><div class="search-row"><input id="search" class="search" placeholder="Código de barras, SKU ou descrição..." autofocus><button class="secondary" id="scaleRead">Balança</button><button class="secondary" id="cash">Caixa <kbd>F4</kbd></button></div><div id="products" class="products"></div></section><aside class="cart-panel v3-cart-panel"><div class="cart-head"><div><small>VENDA ATUAL</small><h2>Cupom</h2></div><button class="secondary" id="clear">Limpar</button></div><div class="checkout-meta"><label><span>CPF/CNPJ consumidor</span><input id="consumerDocument" inputmode="numeric" value="${esc(v.consumerDocument)}" placeholder="Opcional"></label><div class="adjustment-grid"><label><span>Desconto R$</span><input id="saleDiscount" type="number" min="0" step="0.01" value="${Number(v.discount||0).toFixed(2)}"></label><label><span>Acréscimo R$</span><input id="saleSurcharge" type="number" min="0" step="0.01" value="${Number(v.surcharge||0).toFixed(2)}"></label></div></div><div id="cart" class="cart"></div><div><div class="totals v3-totals"><div class="total-row"><span>Subtotal</span><b id="subtotalValue">${money(v.quote?.subtotal||0)}</b></div><div class="total-row discount-row"><span>Desconto</span><b id="discountValue">-${money(v.discount||0)}</b></div><div class="total-row"><span>Acréscimo</span><b id="surchargeValue">${money(v.surcharge||0)}</b></div><div class="total-row grand"><span>Total</span><span id="grand">${money(v3Total())}</span></div><div class="total-row paid-row"><span>Pago</span><b id="paidValue">${money(v3Paid())}</b></div><div class="total-row"><span>Restante</span><b id="remainingValue">${money(v3Remaining())}</b></div>${v3Change()>0?`<div class="change-banner"><span>TROCO</span><strong>${money(v3Change())}</strong></div>`:''}</div><div id="paymentSummary" class="payment-summary"></div><button class="secondary payment-open" id="paymentsButton">Pagamentos <kbd>F5</kbd></button><div class="payment-methods">${Object.entries(v3PaymentLabels).map(([k,n])=>`<button class="pay" data-v3-pay="${k}"><span>${n}</span><kbd>${esc(state.settings?.shortcuts?.[k]||'')}</kbd></button>`).join('')}</div><button class="primary finalize" id="finalize">Finalizar venda <kbd>F2</kbd></button></div></aside></main>`;
  const search=document.getElementById('search');let timer;search.value=state.query;search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>refreshProducts(search.value),120)};search.onkeydown=e=>{if(e.key==='Enter'&&state.products[0]){e.preventDefault();v3Add(state.products[0]);search.select();}};
  document.getElementById('clear').onclick=()=>{state.cart=[];v3ResetSale();renderSaleWorkspace();};
  document.getElementById('cash').onclick=openCashModal;document.getElementById('scaleRead').onclick=v3ReadScale;
  document.getElementById('paymentsButton').onclick=()=>v3PaymentModal();document.getElementById('finalize').onclick=finalize;
  document.querySelectorAll('[data-v3-pay]').forEach(b=>b.onclick=()=>v3PaymentModal(b.dataset.v3Pay));
  const doc=document.getElementById('consumerDocument');doc.oninput=()=>{v.consumerDocument=doc.value;doc.classList.toggle('invalid',!v3ValidDocument(doc.value));};
  const onAdjustment=async()=>{v.discount=Math.max(Number(document.getElementById('saleDiscount').value||0),0);v.surcharge=Math.max(Number(document.getElementById('saleSurcharge').value||0),0);v.supervisorAuthorization=null;await v3Reprice();};
  document.getElementById('saleDiscount').onchange=onAdjustment;document.getElementById('saleSurcharge').onchange=onAdjustment;
  renderProducts();v3RenderCart();v3Reprice();
};

async function v3Add(p){const v=v3State();const found=state.cart.find(i=>i.productId===p.id);if(found)found.quantity++;else state.cart.push({productId:p.id,name:p.name,sku:p.sku,quantity:1,unitPrice:Number(p.base_price||p.sale_price||0)});v.lastProductId=p.id;await v3Reprice();}
add=v3Add;

async function v3Reprice(){const v=v3State();try{v.quote=await window.thor.quoteCheckout({items:state.cart.map(i=>({productId:i.productId,quantity:i.quantity})),discount:v.discount,surcharge:v.surcharge});for(const q of v.quote.items||[]){const i=state.cart.find(x=>x.productId===q.productId);if(i)i.unitPrice=Number(q.unitPrice||0);}}catch{v.quote={subtotal:state.cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0),discount:v.discount,surcharge:v.surcharge,total:Math.max(state.cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0)-v.discount+v.surcharge,0)};}v3RenderCart();}
repriceCart=v3Reprice;

function v3RenderCart(){const v=v3State();const box=document.getElementById('cart');if(!box)return;box.innerHTML=state.cart.length?state.cart.map((i,n)=>`<div class="cart-item"><div><strong>${esc(i.name)}</strong><small>${money(i.unitPrice)} un.</small></div><div class="qty"><button data-minus="${n}">−</button><b>${Number(i.quantity).toFixed(3).replace(/\.000$/,'')}</b><button data-plus="${n}">+</button></div></div>`).join(''):`<div class="empty">Leia um código de barras ou selecione um produto.</div>`;box.querySelectorAll('[data-minus]').forEach(b=>b.onclick=async()=>{const i=state.cart[Number(b.dataset.minus)];i.quantity-=1;if(i.quantity<=0)state.cart.splice(Number(b.dataset.minus),1);await v3Reprice();});box.querySelectorAll('[data-plus]').forEach(b=>b.onclick=async()=>{state.cart[Number(b.dataset.plus)].quantity+=1;await v3Reprice();});const sub=document.getElementById('subtotalValue'),grand=document.getElementById('grand'),paid=document.getElementById('paidValue'),remain=document.getElementById('remainingValue'),pay=document.getElementById('paymentSummary');if(sub)sub.textContent=money(v.quote?.subtotal||0);if(grand)grand.textContent=money(v3Total());if(paid)paid.textContent=money(v3Paid());if(remain)remain.textContent=money(v3Remaining());if(pay)pay.innerHTML=v.payments.length?v.payments.map((p,i)=>`<div><span>${esc(v3PaymentLabels[p.method]||p.method)}${p.integrated?' • integrado':''}</span><b>${money(p.amount)}</b><button data-remove-pay="${i}">×</button></div>`).join(''):'<small>Nenhum pagamento lançado.</small>';document.querySelectorAll('[data-remove-pay]').forEach(b=>b.onclick=()=>{v.payments.splice(Number(b.dataset.removePay),1);v3RenderCart();});}
renderCart=v3RenderCart;

async function v3ReadScale(){const v=v3State();if(!v.lastProductId&&state.cart.length)v.lastProductId=state.cart[state.cart.length-1].productId;if(!v.lastProductId)return infoModal('Balança','Adicione primeiro o produto que receberá o peso.');try{const r=await window.thor.readScale();const item=state.cart.find(i=>i.productId===v.lastProductId);if(!item)return;item.quantity=Number(r.weight);await v3Reprice();showToast(`Peso recebido: ${Number(r.weight).toFixed(3)} kg.`);}catch(e){infoModal('Balança',friendlyError(e.message));}}

async function v3NeedSupervisor(action,requestedValue,reason=''){const v=v3State();if(v.supervisorAuthorization?.action===action)return v.supervisorAuthorization;const supervisors=(v.operators||[]).filter(o=>o.permissions?.supervisor?.authorize);return await new Promise((resolve,reject)=>{if(!supervisors.length)return reject(new Error('supervisor_not_available'));const m=modal(`<h3>Autorização de supervisor</h3><p class="muted">A operação ultrapassa a alçada do operador atual.</p><div class="field"><label>Supervisor</label><select id="supUser">${supervisors.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></div><div class="field"><label>PIN do supervisor</label><input id="supPin" type="password" inputmode="numeric" maxlength="8"></div><div class="field"><label>Motivo</label><input id="supReason" value="${esc(reason)}" placeholder="Motivo da autorização"></div><div id="supError" class="settings-error"></div><div class="actions"><button class="secondary" id="supCancel">Cancelar</button><button class="primary" id="supOk">Autorizar</button></div>`);m.querySelector('#supCancel').onclick=()=>{m.remove();reject(new Error('authorization_cancelled'));};m.querySelector('#supOk').onclick=async()=>{try{const r=await window.thor.supervisorAuthorize({userId:m.querySelector('#supUser').value,pin:m.querySelector('#supPin').value,action,requestedValue,reason:m.querySelector('#supReason').value});v.supervisorAuthorization=r.authorization;m.remove();resolve(r.authorization);}catch(e){m.querySelector('#supError').textContent=friendlyError(e.message);}};m.querySelector('#supPin').focus();});}

async function v3EnsureAdjustmentAuthorization(){const v=v3State();const subtotal=Number(v.quote?.subtotal||0);const op=v.operator;if(!op)throw new Error('operator_required');const dPct=subtotal?Number(v.discount||0)/subtotal*100:0,sPct=subtotal?Number(v.surcharge||0)/subtotal*100:0;const dLimit=Number(op.permissions?.discount?.max_percent||0),sLimit=Number(op.permissions?.surcharge?.max_percent||0);if(dPct>dLimit+0.0001||sPct>sLimit+0.0001)return v3NeedSupervisor(dPct>dLimit?'discount':'surcharge',Math.max(dPct,sPct),'Ajuste de valor da venda');return null;}

function v3PaymentModal(initialMethod='cash'){
  const v=v3State();if(!state.cart.length)return;const method=initialMethod||'cash';const m=modal(`<div class="payment-head"><div><small>FECHAMENTO</small><h3>Formas de pagamento</h3></div><strong>${money(v3Total())}</strong></div><div id="payList" class="pay-list"></div><div class="payment-entry"><div class="payment-method-grid">${Object.entries(v3PaymentLabels).map(([k,n])=>`<button data-method="${k}" class="${k===method?'active':''}">${n}</button>`).join('')}</div><div class="field"><label>Valor desta forma</label><input id="payAmount" type="number" min="0.01" step="0.01" value="${v3Remaining().toFixed(2)}"></div><div class="field" id="cashTenderWrap" ${method==='cash'?'':'style="display:none"'}><label>Valor entregue pelo cliente</label><input id="cashTender" type="number" min="0.01" step="0.01" value="${v3Remaining().toFixed(2)}"></div><div class="payment-entry-actions"><button class="secondary" id="integratedPay">Autorizar TEF/PIX</button><button class="primary" id="addPayment">Adicionar pagamento</button></div><div id="payError" class="settings-error"></div></div><div class="payment-footer"><div><span>Pago</span><b id="modalPaid"></b><span>Restante</span><b id="modalRemaining"></b><span>Troco</span><b id="modalChange"></b></div><div class="actions"><button class="secondary" id="payBack">Voltar</button><button class="primary" id="finishCheckout">Concluir venda</button></div></div>`,'wide');
  let selected=method;const amount=m.querySelector('#payAmount'),tender=m.querySelector('#cashTender'),err=m.querySelector('#payError');
  const refresh=()=>{const list=m.querySelector('#payList');list.innerHTML=v.payments.length?v.payments.map((p,i)=>`<div class="pay-line"><span>${esc(v3PaymentLabels[p.method]||p.method)}${p.integrated?' <small>integrado</small>':''}</span><b>${money(p.amount)}</b>${Number(p.changeAmount||0)>0?`<em>Troco ${money(p.changeAmount)}</em>`:''}<button data-pay-remove="${i}">Remover</button></div>`).join(''):'<div class="empty small">Nenhum pagamento adicionado.</div>';list.querySelectorAll('[data-pay-remove]').forEach(b=>b.onclick=()=>{v.payments.splice(Number(b.dataset.payRemove),1);amount.value=v3Remaining().toFixed(2);tender.value=amount.value;refresh();v3RenderCart();});m.querySelector('#modalPaid').textContent=money(v3Paid());m.querySelector('#modalRemaining').textContent=money(v3Remaining());m.querySelector('#modalChange').textContent=money(v3Change());};
  m.querySelectorAll('[data-method]').forEach(b=>b.onclick=()=>{selected=b.dataset.method;m.querySelectorAll('[data-method]').forEach(x=>x.classList.toggle('active',x.dataset.method===selected));m.querySelector('#cashTenderWrap').style.display=selected==='cash'?'':'none';amount.value=v3Remaining().toFixed(2);tender.value=amount.value;err.textContent='';});
  const addManual=()=>{const remaining=v3Remaining();const requested=Math.max(Number(amount.value||0),0);if(requested<=0)return err.textContent='Informe um valor.';const applied=Math.min(requested,remaining);if(selected==='cash'){const delivered=Math.max(Number(tender.value||0),0);if(delivered+0.001<applied)return err.textContent='Valor entregue é menor que o valor aplicado.';v.payments.push({method:'cash',amount:applied,tenderedAmount:delivered,changeAmount:Math.max(delivered-applied,0)});}else v.payments.push({method:selected,amount:applied});amount.value=v3Remaining().toFixed(2);tender.value=amount.value;refresh();v3RenderCart();};
  m.querySelector('#addPayment').onclick=addManual;
  m.querySelector('#integratedPay').onclick=async()=>{if(selected==='cash')return err.textContent='Dinheiro não usa TEF/PIX.';try{const applied=Math.min(Math.max(Number(amount.value||0),0),v3Remaining());if(applied<=0)return;const r=await window.thor.beginPayment({method:selected,amount:applied});v.payments.push({method:selected,amount:applied,integrated:true,provider:r.provider,externalId:r.externalId,txid:r.txid,metadata:r.metadata});amount.value=v3Remaining().toFixed(2);refresh();v3RenderCart();}catch(e){err.textContent=friendlyError(e.message);}};
  m.querySelector('#payBack').onclick=()=>m.remove();m.querySelector('#finishCheckout').onclick=async()=>{if(v3Remaining()>0.01)return err.textContent=`Ainda faltam ${money(v3Remaining())}.`;m.remove();await v3CompleteCheckout();};refresh();
}

finalize=function(){if(!state.cart.length)return;if(!v3State().operator)return v3OperatorModal(true);return v3PaymentModal(v3State().payments.length?'cash':state.payment||'cash');};

async function v3CompleteCheckout(){const v=v3State();if(state.busy)return;if(!state.status.cashOpenEventId)return openCashModal();if(!v3ValidDocument(v.consumerDocument))return infoModal('CPF/CNPJ','CPF/CNPJ inválido. Corrija ou deixe em branco.');try{state.busy=true;await v3EnsureAdjustmentAuthorization();const result=await window.thor.finalizeSale({clientRequestId:(v.checkoutRequestId||(v.checkoutRequestId=localStorage.getItem('thor_checkout_request_id')||crypto.randomUUID(),localStorage.setItem('thor_checkout_request_id',v.checkoutRequestId),v.checkoutRequestId)),items:state.cart.map(i=>({productId:i.productId,quantity:i.quantity,discount:i.discount||0})),customerId:v.customerId||null,sellerUserId:v.seller?.id||null,sellerName:v.seller?.name||'',consumerDocument:v.consumerDocument,payments:v.payments,discount:v.discount,surcharge:v.surcharge,supervisorAuthorization:v.supervisorAuthorization});localStorage.setItem('thor_checkout_request_id',v.checkoutRequestId);localStorage.removeItem('thor_checkout_request_id');v.checkoutRequestId=null;state.cart=[];v3ResetSale();renderSaleWorkspace();showToast(`Venda concluída: ${money(result.total)}${result.change>0?` • Troco ${money(result.change)}`:''}.`);const refreshStarted=performance.now();setTimeout(()=>Promise.all([refreshStatus(),refreshProducts(),refreshFiscalSales()]).then(()=>window.thor.recordPerformance?.('render.post_sale_refresh',performance.now()-refreshStarted,{background:true})).catch(()=>{}),0);await postSalePrint(result.eventId);}catch(e){if(String(e.message||'').startsWith('insufficient_stock_at_location')){try{v.supervisorAuthorization=await window.requestSupervisorAuthorizationV120('negative_stock','Autorizar venda sem estoque',Number(v.quote?.total||0));return v3CompleteCheckout();}catch{} }if(e.message==='supervisor_authorization_required'){try{await v3NeedSupervisor('discount',0,'Autorização do checkout');return v3CompleteCheckout();}catch{} }infoModal('Finalização',friendlyError(e.message));}finally{state.busy=false;}}

openCashModal=function(){const v=v3State();if(!v.operator)return v3OperatorModal(true);const opened=state.status.cashOpenEventId;const m=modal(opened?`<h3>Caixa aberto</h3><p class="muted">Operador: <b>${esc(v.operator.name)}</b>. Faça suprimento, sangria ou fechamento.</p><div class="field"><label>Valor</label><input id="cashValue" type="number" step="0.01" value="0"></div><div class="actions"><button class="secondary" id="supply">Suprimento</button><button class="secondary" id="withdraw">Sangria</button><button class="danger primary" id="closeCash">Fechar caixa</button></div>`:`<h3>Abrir caixa</h3><p class="muted">Operador: <b>${esc(v.operator.name)}</b></p><div class="field"><label>Fundo de troco</label><input id="opening" type="number" step="0.01" value="0"></div><div class="actions"><button class="secondary" id="back">Cancelar</button><button class="primary" id="openCash">Abrir caixa</button></div>`);if(opened){const movement=async(type)=>{try{let auth=null;if(!vPerm('cash.movement',false))auth=await v3NeedSupervisor('cash_movement',Number(m.querySelector('#cashValue').value||0),'Movimentação de caixa');const result=await window.thor.cashMovement({movementType:type,amount:Number(m.querySelector('#cashValue').value||0),supervisorAuthorization:auth});let printError='';try{await window.thor.printCashMovement(result?.receipt||{});}catch(error){printError=friendlyError(error?.message||'print_failed');}m.remove();await refreshStatus();const label=type==='supply'?'Suprimento':'Sangria';showToast(printError?`${label} registrado. Impressão pendente: ${printError}`:`${label} registrado e comprovante impresso.`);}catch(e){if(e.message!=='authorization_cancelled')infoModal('Caixa',friendlyError(e.message));}};m.querySelector('#supply').onclick=()=>movement('supply');m.querySelector('#withdraw').onclick=()=>movement('withdrawal');m.querySelector('#closeCash').onclick=async()=>{const value=prompt('Informe o valor contado no caixa:','0');if(value===null)return;try{await window.thor.closeCash({closingAmount:Number(value||0)});m.remove();await refreshStatus();showToast('Fechamento enviado.');}catch(e){infoModal('Caixa',friendlyError(e.message));}};}else{m.querySelector('#back').onclick=()=>m.remove();m.querySelector('#openCash').onclick=async()=>{try{await window.thor.openCash({openingAmount:Number(m.querySelector('#opening').value||0)});m.remove();await refreshStatus();showToast('Caixa aberto.');}catch(e){infoModal('Caixa',friendlyError(e.message));}};}};

const v3OldCancelModal=cancelSaleModal;
cancelSaleModal=function(sale){const v=v3State();const m=modal(`<h3>Cancelar venda ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">Informe o motivo. Se o operador não possuir permissão, será solicitado supervisor.</p><div class="field"><label>Motivo</label><textarea id="cancelReason" rows="3"></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="danger primary" id="confirmCancel">Cancelar venda</button></div>`);m.querySelector('#back').onclick=()=>m.remove();m.querySelector('#confirmCancel').onclick=async()=>{try{const reason=m.querySelector('#cancelReason').value.trim();if(!reason)return alert('Informe o motivo.');let auth=await window.requestSupervisorAuthorizationV120('cancel_sale','Autorizar cancelamento de venda',Number(sale.total||0));const result=await window.thor.cancelSale({saleKey:saleKey(sale),reason,supervisorAuthorization:auth});let printError='';try{await window.thor.printSaleCancellation(result?.receipt||{});}catch(error){printError=friendlyError(error?.message||'print_failed');}m.remove();await window.thor.sync().catch(()=>{});await refreshProducts();await refreshFiscalSales();showToast(printError?`Venda cancelada. Impressão pendente: ${printError}`:'Venda cancelada e comprovante impresso.');}catch(e){if(e.message!=='authorization_cancelled')infoModal('Cancelamento',friendlyError(e.message));}};};

const v3OldReturnModal=returnSaleModal;
returnSaleModal=function(sale){const items=sale.items||[];const m=modal(`<h3>Devolução da venda ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">Informe as quantidades devolvidas.</p><div class="return-items">${items.map((i,n)=>{const max=Math.max(Number(i.quantity||0)-Number(i.returned_quantity||0),0);return `<label><span><b>${esc(i.name||i.description||i.sku||'Item')}</b><small>Disponível para devolver: ${max}</small></span><input type="number" min="0" max="${max}" step="0.001" value="0" data-return-index="${n}"></label>`}).join('')}</div><div class="field"><label>Restituição</label><select id="refundMethod">${Object.entries(v3PaymentLabels).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}<option value="store_credit">Crédito em loja</option><option value="other">Outra</option></select></div><div class="field"><label>Motivo</label><textarea id="returnReason" rows="3"></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="primary" id="confirmReturn">Concluir devolução</button></div>`,'wide');m.querySelector('#back').onclick=()=>m.remove();m.querySelector('#confirmReturn').onclick=async()=>{try{const selected=[];m.querySelectorAll('[data-return-index]').forEach(input=>{const qty=Number(input.value||0);if(qty>0){const original=items[Number(input.dataset.returnIndex)];selected.push({sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,quantity:qty});}});if(!selected.length)return alert('Informe ao menos uma quantidade.');let auth=null;if(!vPerm('sale.return',false))auth=await v3NeedSupervisor('return',Number(sale.total||0),m.querySelector('#returnReason').value);const r=await window.thor.returnSale({saleKey:saleKey(sale),items:selected,refundMethod:m.querySelector('#refundMethod').value,reason:m.querySelector('#returnReason').value,supervisorAuthorization:auth});m.remove();await window.thor.sync();await refreshProducts();await refreshFiscalSales();showToast(`Devolução registrada: ${money(r.estimatedTotal)}.`);}catch(e){if(e.message!=='authorization_cancelled')infoModal('Devolução',friendlyError(e.message));}};};

const v3OldSettingsModal=settingsModal;
settingsModal=async function(){const [printers,ports,settings,v3s]=await Promise.all([window.thor.printers().catch(()=>[]),window.thor.serialPorts().catch(()=>[]),window.thor.settings(),window.thor.v3Settings()]);const shortcuts={...settings.shortcuts};const m=modal(`<div class="settings-head"><div><small>CONFIGURAÇÕES DO TERMINAL</small><h3>Impressão, hardware e pagamentos</h3></div><span>ThorPDV 0.3.0</span></div><div class="settings-grid v3-settings-grid"><section><h4>Impressão</h4><div class="field"><label>Destino</label><select id="printerSelect"><option value="">Não configurada</option>${printers.map(p=>`<option value="${esc(p.Name)}" ${settings.printerName===p.Name?'selected':''}>${esc(p.DisplayName||p.Name)}${p.PortName?` — ${esc(p.PortName)}`:''}</option>`).join('')}</select></div><div class="field"><label>Modo</label><select id="printMode"><option value="ask" ${settings.printMode==='ask'?'selected':''}>Perguntar após finalizar</option><option value="direct" ${settings.printMode==='direct'?'selected':''}>Imprimir / solicitar direto</option><option value="never" ${settings.printMode==='never'?'selected':''}>Não imprimir automaticamente</option></select></div><div class="field"><label>Documento padrão</label><select id="printDocument"><option value="ask" ${settings.printDocument==='ask'?'selected':''}>Perguntar</option><option value="pre_sale" ${settings.printDocument==='pre_sale'?'selected':''}>Pré-venda</option><option value="nfce" ${settings.printDocument==='nfce'?'selected':''}>NFC-e</option></select></div><h4>Gaveta</h4><label class="check-line"><input id="autoDrawer" type="checkbox" ${v3s.autoOpenDrawer?'checked':''}> Abrir automaticamente em pagamento em dinheiro</label><div class="field"><label>Impressora ligada à gaveta</label><select id="drawerPrinter"><option value="">Selecione...</option>${printers.filter(p=>p.Name!=='__PDF__').map(p=>`<option value="${esc(p.Name)}" ${v3s.drawerPrinter===p.Name?'selected':''}>${esc(p.Name)}</option>`).join('')}</select></div><button class="secondary" id="testDrawer">Testar gaveta</button></section><section><h4>Balança serial</h4><div class="field"><label>Porta COM</label><select id="scalePort"><option value="">Não configurada</option>${ports.map(p=>`<option value="${esc(p.DeviceID)}" ${v3s.scalePort===p.DeviceID?'selected':''}>${esc(p.DeviceID)} — ${esc(p.Name||p.Description||'Serial')}</option>`).join('')}</select></div><div class="field"><label>Baud rate</label><select id="scaleBaud">${[2400,4800,9600,19200,38400,57600,115200].map(x=>`<option value="${x}" ${Number(v3s.scaleBaud)===x?'selected':''}>${x}</option>`).join('')}</select></div><button class="secondary" id="testScale">Ler peso de teste</button><div id="scaleResult" class="hardware-result"></div><h4>TEF / PIX</h4><div class="field"><label>Bridge local HTTP (opcional)</label><input id="paymentUrl" value="${esc(v3s.localPaymentUrl||'')}" placeholder="http://127.0.0.1:porta"></div><p class="muted">Sem bridge/provedor configurado, cartão e PIX continuam disponíveis para registro manual; o ThorPDV não simula autorização.</p><h4>Atalhos</h4><div class="shortcut-list">${Object.entries(v3PaymentLabels).map(([k,n])=>`<label><span>${n}</span><input readonly data-shortcut="${k}" value="${esc(shortcuts[k]||'')}"></label>`).join('')}</div></section></div><div id="settingsError" class="settings-error"></div><div class="actions"><button class="secondary" id="closeSettings">Cancelar</button><button class="primary" id="saveSettings">Salvar configurações</button></div>`,'wide');m.querySelector('#closeSettings').onclick=()=>m.remove();m.querySelector('#testDrawer').onclick=async()=>{try{await window.thor.saveV3Settings({drawerPrinter:m.querySelector('#drawerPrinter').value});await window.thor.openDrawer();showToast('Pulso enviado à gaveta.');}catch(e){m.querySelector('#settingsError').textContent=friendlyError(e.message);}};m.querySelector('#testScale').onclick=async()=>{try{await window.thor.saveV3Settings({scalePort:m.querySelector('#scalePort').value,scaleBaud:Number(m.querySelector('#scaleBaud').value)});const r=await window.thor.readScale();m.querySelector('#scaleResult').textContent=`Peso lido: ${Number(r.weight).toFixed(3)}`;}catch(e){m.querySelector('#scaleResult').textContent=friendlyError(e.message);}};m.querySelectorAll('[data-shortcut]').forEach(input=>{input.onfocus=()=>{state.capturingShortcut=true;input.value='Pressione...';};input.onblur=()=>{state.capturingShortcut=false;if(input.value==='Pressione...')input.value=shortcuts[input.dataset.shortcut]||'';};input.onkeydown=e=>{e.preventDefault();const key=normalizeKey(e);if(!key)return;if(reservedShortcuts.has(key)||key==='F5'){m.querySelector('#settingsError').textContent=`${key} é reservado pelo sistema.`;return;}shortcuts[input.dataset.shortcut]=key;input.value=key;input.blur();};});m.querySelector('#saveSettings').onclick=async()=>{const values=Object.values(shortcuts).filter(Boolean);if(new Set(values).size!==values.length){m.querySelector('#settingsError').textContent='Cada forma de pagamento precisa ter uma tecla diferente.';return;}state.settings=await window.thor.saveSettings({printerName:m.querySelector('#printerSelect').value,printMode:m.querySelector('#printMode').value,printDocument:m.querySelector('#printDocument').value,shortcuts});v3State().settings=await window.thor.saveV3Settings({autoOpenDrawer:m.querySelector('#autoDrawer').checked,drawerPrinter:m.querySelector('#drawerPrinter').value,scalePort:m.querySelector('#scalePort').value,scaleBaud:Number(m.querySelector('#scaleBaud').value),localPaymentUrl:m.querySelector('#paymentUrl').value.trim()});m.remove();render();showToast('Configurações salvas.');};};

document.addEventListener('keydown',e=>{if(state.capturingShortcut||document.querySelector('.modal input:focus, .modal textarea:focus, .modal select:focus'))return;const key=normalizeKey(e);if(key==='F5'&&state.view==='sale'){e.preventDefault();e.stopImmediatePropagation();v3PaymentModal();return;}if(state.view==='sale'){for(const [method,shortcut] of Object.entries(state.settings?.shortcuts||{})){if(String(shortcut).toUpperCase()===key){e.preventDefault();e.stopImmediatePropagation();v3PaymentModal(method);return;}}}},true);

const v3Errors={operator_required:'Identifique o operador do caixa.',operator_pin_not_configured:'Este operador ainda não possui PIN configurado.',invalid_operator_pin:'PIN do operador inválido.',supervisor_pin_not_configured:'Supervisor sem PIN configurado.',invalid_supervisor_pin:'PIN do supervisor inválido.',user_is_not_supervisor:'O usuário informado não possui alçada de supervisor.',supervisor_authorization_required:'Esta operação exige autorização de supervisor.',supervisor_not_available:'Nenhum supervisor PDV foi sincronizado.',invalid_consumer_document:'CPF/CNPJ do consumidor é inválido.',payment_provider_not_configured:'Nenhum TEF/PIX integrado está configurado. Use registro manual ou configure um bridge/provedor.',cloud_payment_adapter_pending_provider_credentials:'Existe um provedor cadastrado no Gestão, mas ainda faltam credenciais/adaptador de autorização.',payment_not_authorized:'O pagamento integrado não foi autorizado.',drawer_printer_not_configured:'Configure a impressora associada à gaveta.',scale_port_not_configured:'Configure a porta COM da balança.',scale_weight_not_detected:'A balança não retornou um peso reconhecível.',authorization_cancelled:'Autorização cancelada.'};
const v3OldFriendly=friendlyError;friendlyError=function(code){return v3Errors[code]||v3OldFriendly(code);};

;

/* ---- hotfix-v042.js ---- */
// ThorPDV Desktop 0.4.2 hotfix
// Compatibility alias for checkout-v3.js: some operational flows still call vPerm().
// Keep permission checks centralized in v3Perm() so cancel, return and cash movement
// use the current operator profile consistently.
function vPerm(path, fallback = false) {
  return v3Perm(path, fallback);
}

;

/* ---- validation-v3.js ---- */
v3Cnpj = function (value) {
  const cnpj = v3Digits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const digit = (base) => {
    let weight = base.length - 7;
    let sum = 0;
    for (const ch of base) {
      sum += Number(ch) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = digit(cnpj.slice(0, 12));
  if (first !== Number(cnpj[12])) return false;
  const second = digit(cnpj.slice(0, 12) + first);
  return second === Number(cnpj[13]);
};

;

/* ---- sync-recovery.js ---- */
const recoveryOriginalRender = render;
const recoveryOriginalUpdateTop = updateTop;

render = function () {
  recoveryOriginalRender();
  if (state.status?.enrolled) setTimeout(renderSyncRecoveryIndicator, 0);
};

updateTop = function () {
  recoveryOriginalUpdateTop();
  if (state.status?.enrolled) renderSyncRecoveryIndicator();
};

function syncCount(diag, key) {
  return Number(diag?.stats?.[key] || 0);
}

async function renderSyncRecoveryIndicator() {
  const top = document.querySelector('.top-right');
  if (!top || document.getElementById('syncRecoveryBtn')) return;
  let diag = state.status?.syncDiagnostics;
  try { diag = await window.thor.syncDiagnostics(); } catch {}
  const pending = syncCount(diag, 'pending');
  const rejected = syncCount(diag, 'rejected');
  const button = document.createElement('button');
  button.id = 'syncRecoveryBtn';
  button.className = `secondary compact ${rejected ? 'sync-attention' : ''}`;
  button.innerHTML = `Fila ↑ <b>${pending}</b>${rejected ? ` / <b>${rejected} erro</b>` : ''}`;
  button.title = 'Diagnóstico e recuperação da sincronização PDV → Gestão';
  button.onclick = syncRecoveryModal;
  const syncButton = document.getElementById('sync');
  top.insertBefore(button, syncButton || null);
}

async function syncRecoveryModal() {
  let diag;
  try { diag = await window.thor.syncDiagnostics(); }
  catch (e) { return infoModal('Sincronização', friendlyError(e.message)); }
  const pending = syncCount(diag, 'pending');
  const rejected = syncCount(diag, 'rejected');
  const synced = syncCount(diag, 'synced');
  const events = Array.isArray(diag.events) ? diag.events : [];
  const rows = events.slice(0, 20).map((event) => `<tr><td>${esc(event.type)}</td><td>${esc(event.state)}</td><td>${Number(event.attempts || 0)}</td><td>${esc(event.last_error || '—')}</td></tr>`).join('');
  const m = modal(`<div class="settings-head"><div><small>SINCRONIZAÇÃO BIDIRECIONAL</small><h3>Fila PDV → Gestão</h3></div><span>ThorPDV ${esc(state.status?.appVersion || '')}</span></div>
    <div class="sync-health-grid">
      <article><small>Pendentes</small><strong>${pending}</strong></article>
      <article><small>Com erro</small><strong>${rejected}</strong></article>
      <article><small>Sincronizados</small><strong>${synced}</strong></article>
      <article><small>Último sync</small><strong>${diag.lastSyncAt ? dt(diag.lastSyncAt) : 'Nunca'}</strong></article>
    </div>
    ${diag.lastError ? `<div class="error"><b>Último erro:</b> ${esc(diag.lastError)}</div>` : ''}
    <p class="muted">Produtos, preços e estoque descem do Gestão. Vendas, pagamentos, caixa, devoluções e cancelamentos sobem pela fila local.</p>
    <div class="sync-events-table"><table class="fiscal-table"><thead><tr><th>Evento</th><th>Estado</th><th>Tentativas</th><th>Erro</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Nenhum evento pendente ou rejeitado.</td></tr>'}</tbody></table></div>
    <div id="recoverMessage" class="settings-error"></div>
    <div class="actions"><button class="danger" id="disconnectTerminal">Desconectar terminal</button><button class="secondary" id="closeRecovery">Fechar</button><button class="primary" id="recoverQueue">Reprocessar fila</button></div>`, 'wide');

  m.querySelector('#closeRecovery').onclick = () => m.remove();
  m.querySelector('#recoverQueue').onclick = async () => {
    const button = m.querySelector('#recoverQueue');
    const message = m.querySelector('#recoverMessage');
    try {
      button.disabled = true;
      button.textContent = 'Reprocessando...';
      const result = await window.thor.recoverSync();
      const d = result.diagnostics || await window.thor.syncDiagnostics();
      message.textContent = result.ok
        ? `Recuperação concluída. Pendentes: ${syncCount(d,'pending')}; erros: ${syncCount(d,'rejected')}.`
        : `A tentativa terminou com erro: ${d.lastError || result.sync?.error || 'erro desconhecido'}`;
      state.status = await window.thor.status();
      await refreshProducts();
      await refreshFiscalSales();
      setTimeout(() => { m.remove(); render(); }, 900);
    } catch (e) {
      message.textContent = friendlyError(e.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Reprocessar fila';
    }
  };
  m.querySelector('#disconnectTerminal').onclick = async () => {
    if (!confirm('Desconectar este computador do Gestão? As vendas e a fila local serão preservadas para subir após um novo pareamento.')) return;
    try {
      await window.thor.disconnectDevice();
      state.status = await window.thor.status();
      m.remove();
      render();
    } catch (e) { m.querySelector('#recoverMessage').textContent = friendlyError(e.message); }
  };
}

;

/* ---- operator-gate.js ---- */
let thorOperatorGateVisible = false;
let thorOperatorGateLoading = false;

function thorOperatorGateContext() {
  const context = state.status?.context || {};
  return {
    branch: context.branch_name || 'Filial',
    pos: context.pos_name || context.pos_code || 'PDV',
  };
}

function thorOperatorGateRemove() {
  document.getElementById('thorOperatorGate')?.remove();
  thorOperatorGateVisible = false;
  try { v3State().operatorPromptOpen = false; } catch {}
}

function thorGateProgress(gate, percent, label, detail = '') {
  const wrap = gate?.querySelector('#gateProgress');
  const bar = gate?.querySelector('#gateProgressBar');
  const pct = gate?.querySelector('#gateProgressPct');
  const text = gate?.querySelector('#gateProgressText');
  const sub = gate?.querySelector('#gateProgressDetail');
  if (!wrap) return;
  wrap.hidden = false;
  wrap.classList.remove('error', 'offline', 'success');
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  if (bar) bar.style.width = `${value}%`;
  if (pct) pct.textContent = `${Math.round(value)}%`;
  if (text) text.textContent = label || 'Sincronizando...';
  if (sub) sub.textContent = detail || '';
}

async function thorOperatorGateShow(message = '') {
  if (!state.status?.enrolled) return;
  const current = state.status?.operator || (() => { try { return v3State().operator; } catch { return null; } })();
  if (current) {
    thorOperatorGateRemove();
    return;
  }
  if (thorOperatorGateLoading) return;
  thorOperatorGateLoading = true;
  try {
    try { v3State().operatorPromptOpen = true; } catch {}
    let operators = [];
    try { operators = await window.thor.operators(); } catch {}
    const context = thorOperatorGateContext();
    let gate = document.getElementById('thorOperatorGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'thorOperatorGate';
      gate.className = 'operator-gate';
      document.body.appendChild(gate);
    }
    thorOperatorGateVisible = true;
    gate.innerHTML = `
      <section class="operator-gate-card">
        <div class="operator-gate-brand">ϟ THOR<span>PDV</span></div>
        <div class="operator-gate-terminal">
          <span>${esc(context.branch)}</span>
          <b>${esc(context.pos)}</b>
        </div>
        <div class="operator-gate-copy">
          <small>ACESSO AO FRENTE DE CAIXA</small>
          <h1>Identifique o operador</h1>
          <p>Após validar o PIN, o ThorPDV sincroniza vendas pendentes, produtos, estoque e permissões antes de liberar o caixa.</p>
        </div>
        ${operators.length ? `
          <div id="gateLoginFields">
            <label class="operator-gate-field"><span>Usuário PDV</span><select id="gateOperator">${operators.map(o => `<option value="${esc(o.id)}">${esc(o.name)} — ${esc(o.profile_name || 'PDV')}</option>`).join('')}</select></label>
            <label class="operator-gate-field"><span>PIN</span><input id="gatePin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Digite seu PIN"></label>
            <div id="gateError" class="operator-gate-error">${esc(message)}</div>
            <button id="gateLogin" class="operator-gate-primary">Entrar no caixa <kbd>Enter</kbd></button>
          </div>
          <div id="gateProgress" class="operator-sync-progress" hidden>
            <div class="operator-sync-title"><strong id="gateProgressText">Sincronizando...</strong><b id="gateProgressPct">0%</b></div>
            <div class="operator-sync-track"><i id="gateProgressBar"></i></div>
            <p id="gateProgressDetail">Preparando comunicação com o Gestão...</p>
            <div id="gateOfflineActions" class="operator-sync-actions"></div>
          </div>
        ` : `
          <div class="operator-gate-warning">Nenhum operador PDV está disponível neste terminal. Sincronize para baixar os usuários e perfis do Gestão.</div>
          <div id="gateError" class="operator-gate-error">${esc(message)}</div>
          <button id="gateSync" class="operator-gate-primary">Sincronizar operadores</button>
        `}
        <div class="operator-gate-foot"><span>Terminal pareado</span><span>Permissões por perfil</span><span>Sync automático a cada 5 min</span></div>
      </section>`;

    const pin = gate.querySelector('#gatePin');
    const login = gate.querySelector('#gateLogin');
    const error = gate.querySelector('#gateError');
    const fields = gate.querySelector('#gateLoginFields');
    const progress = gate.querySelector('#gateProgress');
    let progressTimer = null;

    const finishEntry = async (result, offline = false) => {
      state.status = await window.thor.status().catch(() => state.status);
      state.status.operator = result.operator;
      try {
        const v = v3State();
        v.operator = result.operator;
        v.operatorPromptOpen = false;
      } catch {}
      if (!offline) {
        thorGateProgress(gate, 100, 'Sincronização concluída', 'Produtos, estoque, permissões e fila estão atualizados.');
        progress?.classList.add('success');
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      thorOperatorGateRemove();
      render();
      showToast(offline ? `Operador ${result.operator.name} entrou em modo offline.` : `Operador ${result.operator.name} identificado e sincronizado.`);
    };

    const doLogin = async () => {
      if (!login || !pin) return;
      const userId = gate.querySelector('#gateOperator')?.value || '';
      const originalPin = pin.value;
      try {
        login.disabled = true;
        gate.querySelector('#gateOperator').disabled = true;
        pin.disabled = true;
        if (error) error.textContent = '';
        if (fields) fields.classList.add('syncing');
        thorGateProgress(gate, 8, 'Validando operador...', 'Conferindo usuário, PIN e perfil local.');
        let simulated = 8;
        progressTimer = setInterval(() => {
          simulated = Math.min(simulated + 5, 88);
          const label = simulated < 30 ? 'Enviando operações pendentes...' : simulated < 58 ? 'Atualizando produtos e estoque...' : simulated < 78 ? 'Atualizando usuários e permissões...' : 'Confirmando comunicação com o Gestão...';
          const detail = simulated < 30 ? 'Vendas, pagamentos e movimentos de caixa são enviados primeiro.' : simulated < 58 ? 'Recebendo catálogo, preços e posição de estoque.' : simulated < 78 ? 'Aplicando o perfil atualizado do operador.' : 'Finalizando heartbeat e estado do terminal.';
          thorGateProgress(gate, simulated, label, detail);
        }, 300);

        const result = await window.thor.operatorLogin({ userId, pin: originalPin });
        clearInterval(progressTimer);
        progressTimer = null;

        if (result?.sync?.ok === false) {
          thorGateProgress(gate, 100, 'Não foi possível sincronizar', `Gestão indisponível: ${friendlyError(result.sync.error || 'sync_unavailable')}`);
          progress?.classList.add('offline');
          const actions = gate.querySelector('#gateOfflineActions');
          if (actions) {
            actions.innerHTML = '<button id="gateRetry" class="operator-gate-primary">Tentar sincronizar novamente</button><button id="gateEnterOffline" class="operator-gate-secondary">Entrar offline</button>';
            actions.querySelector('#gateRetry').onclick = () => {
              actions.innerHTML = '';
              gate.querySelector('#gateOperator').disabled = false;
              pin.disabled = false;
              pin.value = originalPin;
              doLogin();
            };
            actions.querySelector('#gateEnterOffline').onclick = () => finishEntry(result, true);
          }
          return;
        }

        await finishEntry(result, false);
      } catch (e) {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
        if (progress) progress.hidden = true;
        if (fields) fields.classList.remove('syncing');
        if (error) error.textContent = friendlyError(e.message);
        pin.disabled = false;
        gate.querySelector('#gateOperator').disabled = false;
        pin.value = '';
        pin.focus();
      } finally {
        if (login && document.body.contains(login)) {
          login.disabled = false;
          login.innerHTML = 'Entrar no caixa <kbd>Enter</kbd>';
        }
      }
    };

    if (login) login.onclick = doLogin;
    if (pin) {
      pin.focus();
      pin.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doLogin();
        }
      };
    }
    const sync = gate.querySelector('#gateSync');
    if (sync) sync.onclick = async () => {
      try {
        sync.disabled = true;
        sync.textContent = 'Sincronizando...';
        await window.thor.sync();
        state.status = await window.thor.status();
        thorOperatorGateLoading = false;
        await thorOperatorGateShow('');
      } catch (e) {
        if (error) error.textContent = friendlyError(e.message);
      } finally {
        if (sync && document.body.contains(sync)) {
          sync.disabled = false;
          sync.textContent = 'Sincronizar operadores';
        }
      }
    };
  } finally {
    thorOperatorGateLoading = false;
  }
}

const thorOperatorOriginalRender = render;
render = function () {
  thorOperatorOriginalRender();
  if (state.status?.enrolled) queueMicrotask(() => thorOperatorGateShow());
  else thorOperatorGateRemove();
};

document.addEventListener('keydown', e => {
  if (!thorOperatorGateVisible) return;
  if (e.key === 'F2' || e.key === 'F3' || e.key === 'F4' || e.key === 'F5' || e.key === 'F6' || e.key === 'F12') {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

;

/* ---- cash-closing.js ---- */
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

;

/* ---- ux-v038.js ---- */
function uxFooterKey(key,label,payment=false){
  if(!key) return '';
  return `<span class="footer-key${payment?' payment':''}"><kbd>${esc(key)}</kbd><span>${esc(label)}</span></span>`;
}

function uxEnhanceFooter(){
  const help=document.getElementById('hotkeyHelp');
  const foot=document.getElementById('footerSync');
  if(help){
    if(state.view==='sale'){
      const fixed=[['F2','Finalizar'],['F3','Fiscal'],['F4','Caixa'],['F6','Sincronizar'],['F12','Configurações']];
      const payments=Object.entries(state.settings?.shortcuts||{}).filter(([,key])=>key).map(([method,key])=>[String(key),paymentLabels[method]||method]);
      help.innerHTML=[...fixed.map(([key,label])=>uxFooterKey(key,label)),...payments.map(([key,label])=>uxFooterKey(key,label,true))].join('');
    }else{
      help.innerHTML=[uxFooterKey('F3','Voltar para venda'),uxFooterKey('F6','Atualizar'),uxFooterKey('F12','Configurações')].join('');
    }
  }
  if(foot){
    const last=state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'ainda não sincronizado';
    foot.innerHTML=`<strong>Sync automático: a cada 5 min</strong><span>Último sync: ${esc(last)}</span>`;
  }
}

const uxOriginalUpdateTop=updateTop;
updateTop=function(){
  uxOriginalUpdateTop();
  uxEnhanceFooter();
};

const uxOriginalPaymentModal=v3PaymentModal;
v3PaymentModal=function(initialMethod='cash'){
  const result=uxOriginalPaymentModal(initialMethod);
  queueMicrotask(()=>{
    const add=document.querySelector('.modal #addPayment');
    if(add){
      add.innerHTML='Adicionar pagamento <kbd>Enter</kbd>';
      add.title='Pressione Enter para adicionar a forma de pagamento';
    }
  });
  return result;
};

document.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey) return;
  const modal=document.querySelector('.modal');
  if(!modal) return;
  const add=modal.querySelector('#addPayment');
  if(!add) return;
  if(event.target?.closest?.('#finishCheckout,#payBack,#integratedPay,[data-method],[data-pay-remove]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(typeof v3Remaining==='function'&&v3Remaining()<=0.01){
    modal.querySelector('#finishCheckout')?.click();
    return;
  }
  add.click();
},true);

queueMicrotask(uxEnhanceFooter);

;

/* ---- ux-v039.js ---- */
const ux39OriginalRefreshProducts = refreshProducts;
const ux39OriginalRenderProducts = renderProducts;
const ux39OriginalRenderSaleWorkspace = renderSaleWorkspace;
const ux39OriginalRenderWorkspace = renderWorkspace;

function ux39HasSaleQuery() {
  return Boolean(String(state.query || '').trim());
}

refreshProducts = async function (query = state.query) {
  const q = String(query ?? '');
  state.query = q;
  if (!q.trim()) {
    state.products = [];
    if (state.view === 'sale') renderProducts();
    return [];
  }
  return ux39OriginalRefreshProducts(q);
};

renderProducts = function () {
  const box = document.getElementById('products');
  if (!box) return;
  if (!ux39HasSaleQuery()) {
    box.classList.add('search-idle');
    box.innerHTML = `<div class="product-search-idle"><div class="icon">⌕</div><strong>Pesquise para localizar um produto</strong><small>Digite o nome, SKU ou leia o código de barras. O catálogo completo não fica mais exposto na tela de venda.<br>Para navegar por todos os itens, use <kbd>Todos os Produtos</kbd>.</small></div>`;
    return;
  }
  box.classList.remove('search-idle');
  ux39OriginalRenderProducts();
};

renderSaleWorkspace = function () {
  ux39OriginalRenderSaleWorkspace();
  const row = document.querySelector('.search-row');
  if (row && !document.getElementById('allProductsButton')) {
    const button = document.createElement('button');
    button.id = 'allProductsButton';
    button.className = 'all-products-button';
    button.type = 'button';
    button.textContent = 'Todos os Produtos';
    button.title = 'Abrir a listagem geral de produtos';
    const cash = row.querySelector('#cash');
    row.insertBefore(button, cash || null);
    button.onclick = ux39OpenProductList;
  }
  renderProducts();
};

renderWorkspace = function () {
  if (state.view === 'product_list') return ux39RenderProductListScreen();
  return ux39OriginalRenderWorkspace();
};

async function ux39OpenProductList() {
  state.view = 'product_list';
  render();
  await ux39LoadAllProducts();
}

async function ux39LoadAllProducts() {
  const count = document.getElementById('catalogListCount');
  const body = document.getElementById('catalogListBody');
  if (body) body.innerHTML = '<tr><td colspan="7" class="catalog-empty">Carregando catálogo local...</td></tr>';
  try {
    state.allProducts = await window.thor.allProducts();
    if (count) count.textContent = `${state.allProducts.length} produto(s)`;
    ux39RenderAllProducts('');
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="7" class="catalog-empty">Não foi possível carregar o catálogo: ${esc(friendlyError(error.message))}</td></tr>`;
  }
}

function ux39RenderProductListScreen() {
  const box = document.getElementById('workspace');
  if (!box) return;
  box.innerHTML = `<main class="catalog-screen">
    <header class="catalog-screen-head">
      <div><small>CATÁLOGO LOCAL DO CAIXA</small><h1>Todos os Produtos</h1><p>Consulte o catálogo completo sincronizado do Gestão e adicione itens à venda quando desejar.</p></div>
      <div class="actions"><button class="secondary" id="catalogSync">Sincronizar agora</button><button class="primary" id="catalogBack">Voltar à venda</button></div>
    </header>
    <div class="catalog-screen-toolbar"><input id="catalogFilter" placeholder="Filtrar por nome, SKU ou código de barras..." autocomplete="off"><span id="catalogListCount">Carregando...</span></div>
    <section class="catalog-list-card"><table class="catalog-list-table"><thead><tr><th>Código</th><th>Produto</th><th>Un.</th><th>EAN</th><th class="stock">Estoque</th><th class="price">Preço</th><th></th></tr></thead><tbody id="catalogListBody"><tr><td colspan="7" class="catalog-empty">Carregando catálogo local...</td></tr></tbody></table></section>
  </main>`;
  document.getElementById('catalogBack').onclick = () => setView('sale');
  document.getElementById('catalogSync').onclick = async event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = 'Sincronizando...';
      await window.thor.sync();
      await refreshStatus();
      await ux39LoadAllProducts();
      showToast('Catálogo sincronizado com o Gestão.');
    } catch (error) {
      infoModal('Sincronização', friendlyError(error.message));
    } finally {
      button.disabled = false;
      button.textContent = 'Sincronizar agora';
    }
  };
  let timer;
  document.getElementById('catalogFilter').oninput = event => {
    clearTimeout(timer);
    timer = setTimeout(() => ux39RenderAllProducts(event.target.value), 80);
  };
}

function ux39RenderAllProducts(filter = '') {
  const body = document.getElementById('catalogListBody');
  const count = document.getElementById('catalogListCount');
  if (!body) return;
  const q = String(filter || '').trim().toLowerCase();
  const all = Array.isArray(state.allProducts) ? state.allProducts : [];
  const filtered = q ? all.filter(product => {
    const barcodes = Array.isArray(product.barcodes) ? product.barcodes.join(' ') : String(product.barcodes || '');
    return [product.name, product.sku, barcodes].some(value => String(value || '').toLowerCase().includes(q));
  }) : all;
  if (count) count.textContent = q ? `${filtered.length} de ${all.length} produto(s)` : `${all.length} produto(s)`;
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="7" class="catalog-empty">Nenhum produto encontrado.</td></tr>';
    return;
  }
  body.innerHTML = filtered.map((product, index) => {
    const barcode = Array.isArray(product.barcodes) ? product.barcodes[0] : '';
    return `<tr><td>${esc(product.sku || '—')}</td><td><strong>${esc(product.name)}</strong><small>${esc(product.production_mode === 'on_demand' ? 'Produção sob demanda' : 'Produto de estoque')}</small></td><td>${esc(product.unit || 'UN')}</td><td>${esc(barcode || '—')}</td><td class="stock">${Number(product.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td class="price">${money(product.base_price || product.sale_price || 0)}</td><td><button class="catalog-add" data-catalog-index="${index}">Adicionar</button></td></tr>`;
  }).join('');
  body.querySelectorAll('[data-catalog-index]').forEach(button => {
    button.onclick = async () => {
      const product = filtered[Number(button.dataset.catalogIndex)];
      if (!product) return;
      await add(product);
      showToast(`${product.name} adicionado à venda.`);
    };
  });
}

const ux39OriginalEnhanceFooter = typeof uxEnhanceFooter === 'function' ? uxEnhanceFooter : null;
if (ux39OriginalEnhanceFooter) {
  uxEnhanceFooter = function () {
    ux39OriginalEnhanceFooter();
    if (state.view !== 'product_list') return;
    const help = document.getElementById('hotkeyHelp');
    if (help) help.innerHTML = `${uxFooterKey('F3', 'Voltar à venda')}${uxFooterKey('F6', 'Sincronizar')}`;
  };
}

document.addEventListener('keydown', event => {
  if (state.view !== 'product_list') return;
  if (event.key === 'F3') {
    event.preventDefault();
    event.stopImmediatePropagation();
    setView('sale');
  }
}, true);

;

/* ---- scanner-v039.js ---- */
const scannerV039OriginalRenderSaleWorkspace = renderSaleWorkspace;

renderSaleWorkspace = function () {
  scannerV039OriginalRenderSaleWorkspace();
  const search = document.getElementById('search');
  if (!search) return;
  search.onkeydown = async event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = String(search.value || '').trim();
    if (!query) return;
    await refreshProducts(query);
    const product = state.products?.[0];
    if (!product) {
      showToast('Produto não encontrado.');
      search.select();
      return;
    }
    await add(product);
    search.select();
  };
};

;

/* ---- cash-cycle-v040.js ---- */
let cash40PromptedOperatorId = '';
let cash40ClosedTransition = false;

function cash40ProductForItem(item) {
  const sources = [state.products || [], state.allProducts || []];
  for (const source of sources) {
    const found = source.find((product) => String(product.id) === String(item.productId));
    if (found) return found;
  }
  return null;
}

function cash40LineTotal(item) {
  const quoteItem = v3State()?.quote?.items?.find?.((row) => String(row.productId) === String(item.productId));
  if (quoteItem && Number.isFinite(Number(quoteItem.total))) return Number(quoteItem.total);
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

const cash40OriginalV3Add = v3Add;
v3Add = async function (product) {
  await cash40OriginalV3Add(product);
  const item = state.cart.find((row) => String(row.productId) === String(product.id));
  if (item) {
    item.unit = product.unit || item.unit || 'UN';
    item.barcode = Array.isArray(product.barcodes) ? (product.barcodes[0] || '') : (product.barcode || item.barcode || '');
  }
  v3RenderCart();
};
add = v3Add;

v3RenderCart = function () {
  const v = v3State();
  const box = document.getElementById('cart');
  if (!box) return;

  box.innerHTML = state.cart.length ? state.cart.map((item, index) => {
    const product = cash40ProductForItem(item);
    const unit = item.unit || product?.unit || 'UN';
    const sku = item.sku || product?.sku || '—';
    const lineTotal = cash40LineTotal(item);
    return `<div class="cart-item launched-item">
      <div class="launched-index">${index + 1}</div>
      <div class="launched-info">
        <strong>${esc(item.name)}</strong>
        <small>Cód. ${esc(sku)} • ${esc(unit)} • Unit. ${money(item.unitPrice)}</small>
      </div>
      <div class="launched-line-total">
        <small>${Number(item.quantity || 0).toLocaleString('pt-BR',{maximumFractionDigits:3})} × ${money(item.unitPrice)}</small>
        <strong>${money(lineTotal)}</strong>
      </div>
      <div class="qty launched-qty">
        <button data-minus="${index}" title="Diminuir quantidade">−</button>
        <b>${Number(item.quantity || 0).toFixed(3).replace(/\.000$/,'')}</b>
        <button data-plus="${index}" title="Aumentar quantidade">+</button>
      </div>
      <button class="launched-remove" data-remove-item="${index}" title="Remover item">×</button>
    </div>`;
  }).join('') : `<div class="empty launched-empty"><strong>Nenhum produto lançado</strong><span>Pesquise pelo nome, SKU ou código de barras para iniciar a venda.</span></div>`;

  box.querySelectorAll('[data-minus]').forEach((button) => button.onclick = async () => {
    const index = Number(button.dataset.minus);
    const item = state.cart[index];
    if (!item) return;
    item.quantity -= 1;
    if (item.quantity <= 0) state.cart.splice(index, 1);
    await v3Reprice();
  });
  box.querySelectorAll('[data-plus]').forEach((button) => button.onclick = async () => {
    const item = state.cart[Number(button.dataset.plus)];
    if (!item) return;
    item.quantity += 1;
    await v3Reprice();
  });
  box.querySelectorAll('[data-remove-item]').forEach((button) => button.onclick = async () => {
    state.cart.splice(Number(button.dataset.removeItem), 1);
    await v3Reprice();
  });

  const sub = document.getElementById('subtotalValue');
  const grand = document.getElementById('grand');
  const paid = document.getElementById('paidValue');
  const remain = document.getElementById('remainingValue');
  const pay = document.getElementById('paymentSummary');
  const itemCount = document.getElementById('itemsCount');
  if (sub) sub.textContent = money(v.quote?.subtotal || 0);
  if (grand) grand.textContent = money(v3Total());
  if (paid) paid.textContent = money(v3Paid());
  if (remain) remain.textContent = money(v3Remaining());
  if (itemCount) itemCount.textContent = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  if (pay) pay.innerHTML = v.payments.length ? v.payments.map((payment, index) => `<div><span>${esc(v3PaymentLabels[payment.method] || payment.method)}${payment.integrated ? ' • integrado' : ''}</span><b>${money(payment.amount)}</b><button data-remove-pay="${index}">×</button></div>`).join('') : '<small>Nenhum pagamento lançado.</small>';
  document.querySelectorAll('[data-remove-pay]').forEach((button) => button.onclick = () => {
    v.payments.splice(Number(button.dataset.removePay), 1);
    v3RenderCart();
  });
};
renderCart = v3RenderCart;

async function cash40MaybePromptOpening() {
  if (state.view === 'cash_closed' || !state.status?.enrolled) return;
  const operator = state.status?.operator || (() => { try { return v3State().operator; } catch { return null; } })();
  if (!operator) return;
  await refreshStatus().catch(() => {});
  if (state.status?.cashOpenEventId) return;

  const settings = await window.thor.v3Settings().catch(() => ({}));
  if (!settings.askCashOpening) return;
  if (cash40PromptedOperatorId === String(operator.id)) return;
  cash40PromptedOperatorId = String(operator.id);

  const m = modal(`<div class="cash-open-question">
    <small>INÍCIO DO TURNO</small>
    <h3>Deseja abrir o caixa agora?</h3>
    <p>Você pode informar um fundo inicial. Se escolher <b>Agora não</b>, o caixa só será criado automaticamente quando ocorrer a primeira venda ou movimentação financeira.</p>
    <label class="field"><span>Fundo de caixa</span><input id="cash40OpeningAmount" type="number" min="0" step="0.01" value="0.00" inputmode="decimal"></label>
    <label class="field"><span>Observação</span><input id="cash40OpeningNote" placeholder="Opcional"></label>
    <div id="cash40OpenError" class="settings-error"></div>
    <div class="actions cash-open-question-actions">
      <button class="secondary" id="cash40Later">Agora não</button>
      <button class="primary" id="cash40Open">Abrir caixa</button>
    </div>
  </div>`);

  m.querySelector('#cash40Later').onclick = () => {
    m.remove();
    showToast('Caixa será aberto automaticamente no primeiro movimento.');
  };
  m.querySelector('#cash40Open').onclick = async () => {
    const button = m.querySelector('#cash40Open');
    const error = m.querySelector('#cash40OpenError');
    const openingAmount = Math.max(Number(m.querySelector('#cash40OpeningAmount').value || 0), 0);
    try {
      button.disabled = true;
      button.textContent = 'Abrindo...';
      await window.thor.openCash({ openingAmount, notes: m.querySelector('#cash40OpeningNote').value || 'Abertura após login do operador' });
      await refreshStatus();
      m.remove();
      showToast(`Caixa aberto com fundo ${money(openingAmount)}.`);
    } catch (err) {
      error.textContent = friendlyError(err.message);
      button.disabled = false;
      button.textContent = 'Abrir caixa';
    }
  };
  const amount = m.querySelector('#cash40OpeningAmount');
  amount?.focus();
  amount?.select();
}

if (typeof thorOperatorGateShow === 'function') {
  const cash40OriginalGateShow = thorOperatorGateShow;
  thorOperatorGateShow = async function (message = '') {
    if (state.view === 'cash_closed' && !state.cashReopening) return;
    return cash40OriginalGateShow(message);
  };
}

if (typeof thorOperatorGateRemove === 'function') {
  const cash40OriginalGateRemove = thorOperatorGateRemove;
  thorOperatorGateRemove = function () {
    const wasVisible = Boolean(thorOperatorGateVisible);
    cash40OriginalGateRemove();
    if (wasVisible && state.status?.operator && state.view !== 'cash_closed') {
      state.cashReopening = false;
      setTimeout(() => cash40MaybePromptOpening().catch(() => {}), 120);
    }
  };
}

const cash40OriginalSettingsModal = settingsModal;
settingsModal = async function () {
  await cash40OriginalSettingsModal();
  const modals = [...document.querySelectorAll('.modal')];
  const m = modals[modals.length - 1];
  const grid = m?.querySelector('.settings-grid');
  if (!m || !grid || m.querySelector('#cash40OpeningPolicy')) return;
  const settings = await window.thor.v3Settings().catch(() => ({}));
  const section = document.createElement('section');
  section.className = 'cash40-settings-section';
  section.innerHTML = `<h4>Fluxo de abertura do caixa</h4>
    <div class="field"><label>Ao identificar o operador</label>
      <select id="cash40OpeningPolicy">
        <option value="ask" ${settings.askCashOpening !== false ? 'selected' : ''}>Perguntar se deseja abrir caixa e informar fundo</option>
        <option value="lazy" ${settings.askCashOpening === false ? 'selected' : ''}>Não perguntar — abrir no primeiro movimento</option>
      </select>
    </div>
    <p class="muted">No modo automático, nenhuma sessão de caixa é criada no login. A primeira venda, suprimento/sangria ou devolução em dinheiro cria o caixa com fundo R$ 0,00.</p>`;
  grid.appendChild(section);

  const save = m.querySelector('#saveSettings');
  if (save) {
    const originalSave = save.onclick;
    save.onclick = async (event) => {
      const askCashOpening = m.querySelector('#cash40OpeningPolicy').value === 'ask';
      const updated = await window.thor.saveV3Settings({ askCashOpening });
      try { v3State().settings = { ...(v3State().settings || {}), ...updated }; } catch {}
      return originalSave?.call(save, event);
    };
  }
};

async function cash40EnterClosedScreen() {
  if (cash40ClosedTransition) return;
  cash40ClosedTransition = true;
  try {
    const summary = await window.thor.lastCashClose().catch(() => null);
    await window.thor.operatorLogout().catch(() => {});
    try {
      const v = v3State();
      v.operator = null;
      v.operatorPromptOpen = false;
      v.payments = [];
      v.quote = null;
    } catch {}
    state.cart = [];
    state.query = '';
    state.products = [];
    state.status = await window.thor.status().catch(() => state.status);
    if (state.status) state.status.operator = null;
    state.lastCashCloseSummary = summary;
    state.cashReopening = false;
    cash40PromptedOperatorId = '';
    state.view = 'cash_closed';
    render();
  } finally {
    cash40ClosedTransition = false;
  }
}

const cash40OriginalShowToast = showToast;
showToast = function (message) {
  cash40OriginalShowToast(message);
  if (/^Caixa fechado/i.test(String(message || ''))) {
    setTimeout(() => cash40EnterClosedScreen().catch(() => {}), 180);
  }
};

const cash40OriginalRenderWorkspace = renderWorkspace;
renderWorkspace = function () {
  const shell = document.querySelector('.shell');
  if (state.view === 'cash_closed') {
    shell?.classList.add('cash-closed-mode');
    return cash40RenderClosedScreen();
  }
  shell?.classList.remove('cash-closed-mode');
  return cash40OriginalRenderWorkspace();
};

function cash40RenderClosedScreen() {
  const box = document.getElementById('workspace');
  if (!box) return;
  const summary = state.lastCashCloseSummary || {};
  const context = state.status?.context || {};
  box.innerHTML = `<main class="cash-closed-screen">
    <section class="cash-closed-card">
      <div class="cash-closed-icon">✓</div>
      <small>${esc(context.branch_name || 'FILIAL')} • ${esc(context.pos_name || context.pos_code || 'PDV')}</small>
      <h1>CAIXA FECHADO</h1>
      <p>O fechamento foi concluído e o operador foi desconectado deste caixa.</p>
      <div class="cash-closed-summary">
        <div><span>Fechamento</span><strong>${summary.closed_at ? new Date(summary.closed_at).toLocaleString('pt-BR') : 'Concluído'}</strong></div>
        <div><span>Dinheiro contado</span><strong>${money(summary.closing_amount || 0)}</strong></div>
        <div><span>Diferença</span><strong class="${Math.abs(Number(summary.difference || 0)) > 0.009 ? 'negative' : ''}">${money(summary.difference || 0)}</strong></div>
      </div>
      <div class="cash-closed-actions">
        <button class="secondary" id="cash40Reprint">Reimprimir fechamento</button>
        <button class="cash-reopen-primary" id="cash40Reopen">Reabrir caixa</button>
      </div>
      <small class="cash-closed-help">Ao reabrir, será necessário selecionar o usuário e informar o PIN novamente.</small>
    </section>
  </main>`;

  document.getElementById('cash40Reprint').onclick = async () => {
    try {
      const result = await window.thor.printCashClose(summary);
      if (!result?.cancelled) showToast('Comprovante de fechamento enviado para impressão.');
    } catch (error) {
      infoModal('Reimpressão', friendlyError(error.message));
    }
  };
  document.getElementById('cash40Reopen').onclick = async () => {
    state.cashReopening = true;
    cash40PromptedOperatorId = '';
    state.view = 'sale';
    render();
    setTimeout(() => thorOperatorGateShow?.('Selecione o operador que irá reabrir o caixa.').catch?.(() => {}), 50);
  };
}

;

/* ---- permissions-v041.js ---- */
function p41Operator() {
  try { return state.status?.operator || v3State?.().operator || null; } catch { return state.status?.operator || null; }
}

function p41Value(path, fallback = undefined) {
  const operator = p41Operator();
  if (!operator) return fallback;
  return path.split('.').reduce((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  }, operator.permissions || {}) ?? fallback;
}

function p41Allowed(path, fallback = false) {
  return Boolean(p41Value(path, fallback));
}

function p41Block(element, message = 'Sem permissão neste perfil') {
  if (!element) return;
  element.disabled = true;
  element.setAttribute('aria-disabled', 'true');
  element.title = message;
  element.classList.add('permission-disabled');
}

function p41ApplyTopPermissions() {
  const operator = p41Operator();
  if (!operator) return;

  const fiscal = document.getElementById('navFiscal');
  if (fiscal && !p41Allowed('fiscal.view')) fiscal.hidden = true;

  const settings = document.getElementById('settings');
  if (settings && !p41Allowed('settings.edit')) settings.hidden = true;

  const sync = document.getElementById('sync');
  if (sync && !p41Allowed('sync.manual')) sync.hidden = true;

  const drawer = document.getElementById('drawerBtn');
  if (drawer && !p41Allowed('hardware.manual_drawer')) drawer.hidden = true;
}

function p41ApplySalePermissions() {
  const operator = p41Operator();
  if (!operator || state.view !== 'sale') return;

  if (!p41Allowed('sale.create')) p41Block(document.getElementById('finalize'), 'Este perfil não pode realizar vendas');

  const documentInput = document.getElementById('consumerDocument');
  if (documentInput && !p41Allowed('customer.identify')) {
    documentInput.value = '';
    documentInput.disabled = true;
    documentInput.title = 'Este perfil não pode identificar o consumidor';
  }

  if (!p41Allowed('hardware.scale')) p41Block(document.getElementById('scaleRead'), 'Este perfil não pode usar a balança');

  document.querySelectorAll('[data-v3-pay]').forEach((button) => {
    const method = String(button.dataset.v3Pay || '');
    if (method && !p41Allowed(`payment.${method}`)) p41Block(button, 'Forma de pagamento não permitida para este perfil');
  });

  const cash = document.getElementById('cash');
  if (cash && !state.status?.cashOpenEventId && !p41Allowed('cash.open')) p41Block(cash, 'Este perfil não pode abrir caixa');
}

const p41OriginalRender = render;
render = function () {
  const result = p41OriginalRender();
  queueMicrotask(() => {
    p41ApplyTopPermissions();
    p41ApplySalePermissions();
  });
  return result;
};

const p41OriginalUpdateTop = updateTop;
updateTop = function () {
  const result = p41OriginalUpdateTop();
  p41ApplyTopPermissions();
  return result;
};

const p41OriginalSetView = setView;
setView = function (view) {
  if (view === 'fiscal' && p41Operator() && !p41Allowed('fiscal.view')) {
    infoModal('Acesso restrito', 'O perfil deste operador não possui acesso ao Menu Fiscal.');
    return;
  }
  return p41OriginalSetView(view);
};

const p41OriginalRenderSaleWorkspace = renderSaleWorkspace;
renderSaleWorkspace = function () {
  const result = p41OriginalRenderSaleWorkspace();
  queueMicrotask(p41ApplySalePermissions);
  return result;
};

const p41OriginalPaymentModal = v3PaymentModal;
v3PaymentModal = function (initialMethod = 'cash') {
  const operator = p41Operator();
  if (operator) {
    const allowedMethods = Object.keys(v3PaymentLabels || {}).filter((method) => p41Allowed(`payment.${method}`));
    if (!allowedMethods.length) {
      infoModal('Pagamento', 'Este perfil não possui nenhuma forma de pagamento liberada.');
      return;
    }
    if (!p41Allowed(`payment.${initialMethod}`)) initialMethod = allowedMethods[0];
  }

  const result = p41OriginalPaymentModal(initialMethod);
  queueMicrotask(() => {
    const modals = [...document.querySelectorAll('.modal')];
    const modalElement = modals[modals.length - 1];
    if (!modalElement || !p41Operator()) return;
    modalElement.querySelectorAll('[data-method]').forEach((button) => {
      const method = String(button.dataset.method || '');
      if (method && !p41Allowed(`payment.${method}`)) p41Block(button, 'Forma de pagamento não permitida para este perfil');
    });
    if (!p41Allowed('payment.integrated')) p41Block(modalElement.querySelector('#integratedPay'), 'Pagamento integrado não permitido para este perfil');
  });
  return result;
};

const p41OriginalSettingsModal = settingsModal;
settingsModal = async function () {
  if (p41Operator() && !p41Allowed('settings.edit')) {
    infoModal('Configurações', 'O perfil deste operador não pode alterar as configurações do terminal.');
    return;
  }
  return p41OriginalSettingsModal();
};

const p41OriginalSafePrint = safePrint;
safePrint = async function (key, type, reprint = false) {
  if (!reprint) return p41OriginalSafePrint(key, type);
  try {
    const result = await window.thor.printSale(key, type, true);
    if (result?.cancelled) return;
    showToast(type === 'nfce' ? 'NFC-e reenviada para impressão.' : 'Documento reenviado para impressão.');
  } catch (error) {
    if (error.message === 'printer_not_configured') infoModal('Impressora não configurada', 'Abra Configurações, escolha uma impressora instalada no Windows ou “Salvar como PDF”.');
    else infoModal('Reimpressão', friendlyError(error.message));
  }
};

const p41OriginalOpenSaleDetail = openSaleDetail;
openSaleDetail = async function (sale) {
  if (p41Operator() && !p41Allowed('fiscal.view')) {
    infoModal('Acesso restrito', 'O perfil deste operador não possui acesso aos detalhes fiscais da venda.');
    return;
  }

  await p41OriginalOpenSaleDetail(sale);
  const modals = [...document.querySelectorAll('.modal')];
  const modalElement = modals[modals.length - 1];
  if (!modalElement || !p41Operator()) return;

  const key = saleKey(sale);
  const reprint = modalElement.querySelector('#reprintSale');
  if (reprint) {
    if (p41Allowed('print.receipt') && p41Allowed('print.reprint')) reprint.onclick = () => safePrint(key, 'pre_sale', true);
    else p41Block(reprint, 'Este perfil não pode reimprimir documentos');
  }

  const nfce = modalElement.querySelector('#nfceSale');
  const authorized = sale.fiscal?.status === 'authorized';
  if (nfce && authorized) {
    if (p41Allowed('print.nfce') && p41Allowed('print.reprint') && p41Allowed('fiscal.reprint')) nfce.onclick = () => safePrint(key, 'nfce', true);
    else p41Block(nfce, 'Este perfil não pode reimprimir NFC-e');
  } else if (nfce && !p41Allowed('fiscal.request_nfce')) {
    p41Block(nfce, 'Este perfil não pode solicitar NFC-e');
  }
};

const p41OriginalFriendlyError = friendlyError;
friendlyError = function (code) {
  const text = String(code || '');
  if (text.startsWith('payment_method_not_allowed:')) return 'Esta forma de pagamento não está liberada para o perfil do operador.';
  const permissionErrors = {
    operator_not_allowed_to_sell: 'Este perfil não pode realizar vendas.',
    operator_not_allowed_to_identify_customer: 'Este perfil não pode identificar o consumidor na venda.',
    integrated_payment_not_allowed: 'Este perfil não pode usar TEF/PIX integrado.',
    manual_drawer_not_allowed: 'Este perfil não pode abrir a gaveta manualmente.',
    scale_not_allowed: 'Este perfil não pode usar a balança.',
    nfce_request_not_allowed: 'Este perfil não pode solicitar NFC-e.',
    fiscal_menu_not_allowed: 'Este perfil não possui acesso ao Menu Fiscal.',
    manual_sync_not_allowed: 'Este perfil não pode iniciar sincronização manual.',
    settings_edit_not_allowed: 'Este perfil não pode alterar as configurações do terminal.',
    receipt_print_not_allowed: 'Este perfil não pode imprimir comprovantes.',
    nfce_print_not_allowed: 'Este perfil não pode imprimir NFC-e.',
    document_reprint_not_allowed: 'Este perfil não pode reimprimir documentos.',
    nfce_reprint_not_allowed: 'Este perfil não pode reimprimir NFC-e.',
    operator_not_allowed_to_open_cash: 'Este perfil não pode abrir caixa.',
    operator_not_allowed_to_close_cash: 'Este perfil não pode fechar caixa.',
    cash_open_not_authorized: 'A abertura de caixa não está autorizada para este perfil.',
    cash_movement_not_authorized: 'A movimentação de caixa não está autorizada para este perfil.',
    sale_cancel_not_authorized: 'O cancelamento da venda não está autorizado para este perfil.',
    invalid_operator: 'O operador ou o perfil não está ativo para este terminal.',
  };
  return permissionErrors[text] || p41OriginalFriendlyError(code);
};

;

/* ---- cart-ui-v043.js ---- */
(function () {
  function cartV43State() {
    try { return v3State(); } catch { return state.v3 || {}; }
  }

  function cartV43Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function cartV43Price(product) {
    const value = Number(product?.base_price ?? product?.sale_price ?? product?.price ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function cartV43Qty(value) {
    const quantity = Number(value || 0);
    if (!Number.isFinite(quantity)) return '0';
    return quantity.toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  function cartV43Subtotal() {
    return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  }

  function cartV43UpdateSummary(v) {
    const fallbackSubtotal = cartV43Subtotal();
    const subtotal = Number(v.quote?.subtotal ?? fallbackSubtotal);
    const discount = Number(v.quote?.discount ?? v.discount ?? 0);
    const surcharge = Number(v.quote?.surcharge ?? v.surcharge ?? 0);
    const total = Number(v.quote?.total ?? Math.max(subtotal - discount + surcharge, 0));
    const paidValue = typeof v3Paid === 'function' ? Number(v3Paid() || 0) : 0;
    const remainingValue = Math.max(total - paidValue, 0);

    const sub = document.getElementById('subtotalValue');
    const disc = document.getElementById('discountValue');
    const sur = document.getElementById('surchargeValue');
    const grand = document.getElementById('grand');
    const paid = document.getElementById('paidValue');
    const remain = document.getElementById('remainingValue');

    if (sub) sub.textContent = money(subtotal);
    if (disc) disc.textContent = `-${money(discount)}`;
    if (sur) sur.textContent = money(surcharge);
    if (grand) grand.textContent = money(total);
    if (paid) paid.textContent = money(paidValue);
    if (remain) remain.textContent = money(remainingValue);

    const title = document.querySelector('.v3-cart-panel .cart-head h2');
    if (title) {
      const itemCount = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      title.innerHTML = `Cupom <span class="cart-v43-count">${cartV43Qty(itemCount)} item(ns)</span>`;
    }
  }

  function cartV43RenderPayments(v) {
    const pay = document.getElementById('paymentSummary');
    if (!pay) return;
    pay.innerHTML = v.payments?.length
      ? v.payments.map((payment, index) => `<div><span>${esc(v3PaymentLabels[payment.method] || payment.method)}${payment.integrated ? ' • integrado' : ''}</span><b>${money(payment.amount)}</b><button data-remove-pay="${index}" title="Remover pagamento">×</button></div>`).join('')
      : '<small>Nenhum pagamento lançado.</small>';
    pay.querySelectorAll('[data-remove-pay]').forEach((button) => {
      button.onclick = () => {
        v.payments.splice(Number(button.dataset.removePay), 1);
        cartV43Render();
      };
    });
  }

  function cartV43Render() {
    const v = cartV43State();
    const box = document.getElementById('cart');
    if (!box) return;
    const canRemove = cartV43Allowed('sale.remove_item', true);

    if (!state.cart.length) {
      box.innerHTML = '<div class="cart-v43-empty"><strong>Nenhum item na venda</strong><span>Leia um EAN, digite o código principal ou a referência interna, ou clique em um produto.</span></div>';
    } else {
      box.innerHTML = `<div class="cart-v43-list-head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span><span></span></div>${state.cart.map((item, index) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const lineTotal = quantity * unitPrice;
        const blockMinus = !canRemove && quantity <= 1;
        return `<div class="cart-v43-item" data-cart-index="${index}">
          <div class="cart-v43-product"><strong title="${esc(item.name || 'Produto')}">${esc(item.name || 'Produto')}</strong><small>Cód. ${esc(item.productCode || '—')} • Ref. ${esc(item.reference || item.sku || '—')}</small></div>
          <div class="cart-v43-qty"><button data-minus="${index}" title="${blockMinus ? 'Sem permissão para remover item' : 'Diminuir quantidade'}" ${blockMinus ? 'disabled' : ''}>−</button><b>${cartV43Qty(quantity)}</b><button data-plus="${index}" title="Aumentar quantidade">+</button></div>
          <div class="cart-v43-unit">${money(unitPrice)}</div>
          <div class="cart-v43-total">${money(lineTotal)}</div>
          <button class="cart-v43-remove" data-remove-item="${index}" title="${canRemove ? 'Remover item' : 'Perfil sem permissão para remover item'}" ${canRemove ? '' : 'disabled'}>×</button>
        </div>`;
      }).join('')}`;

      box.querySelectorAll('[data-minus]').forEach((button) => {
        button.onclick = async () => {
          const index = Number(button.dataset.minus);
          const item = state.cart[index];
          if (!item) return;
          if (Number(item.quantity || 0) <= 1 && !cartV43Allowed('sale.remove_item', true)) {
            infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
            return;
          }
          item.quantity = Number(item.quantity || 0) - 1;
          if (item.quantity <= 0) state.cart.splice(index, 1);
          cartV43Render();
          await v3Reprice();
        };
      });

      box.querySelectorAll('[data-plus]').forEach((button) => {
        button.onclick = async () => {
          const item = state.cart[Number(button.dataset.plus)];
          if (!item) return;
          item.quantity = Number(item.quantity || 0) + 1;
          cartV43Render();
          await v3Reprice();
        };
      });

      box.querySelectorAll('[data-remove-item]').forEach((button) => {
        button.onclick = async () => {
          if (!cartV43Allowed('sale.remove_item', true)) {
            infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
            return;
          }
          state.cart.splice(Number(button.dataset.removeItem), 1);
          cartV43Render();
          await v3Reprice();
        };
      });
    }

    cartV43UpdateSummary(v);
    cartV43RenderPayments(v);
  }

  async function cartV43Add(product) {
    if (!product || !product.id) {
      infoModal('Produto', 'Não foi possível identificar o produto selecionado. Sincronize o terminal e tente novamente.');
      return;
    }

    const v = cartV43State();
    const productId = String(product.id);
    const found = state.cart.find((item) => String(item.productId) === productId);

    if (found) { found.quantity = Number(found.quantity || 0) + 1; found.productCode = product.product_code || found.productCode || ''; found.reference = product.sku || found.reference || ''; found.image_url = product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || ''; }
    else state.cart.push({ productId: product.id, name: product.name || product.description || 'Produto', image_url: product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '', productCode: product.product_code || '', reference: product.sku || '', sku: product.sku || '', quantity: 1, unitPrice: cartV43Price(product) });

    v.lastProductId = product.id;
    const subtotal = cartV43Subtotal();
    const discount = Number(v.discount || 0);
    const surcharge = Number(v.surcharge || 0);
    v.quote = { ...(v.quote || {}), subtotal, discount, surcharge, total: Math.max(subtotal - discount + surcharge, 0) };

    cartV43Render();
    await v3Reprice();

    const current = state.cart.find((item) => String(item.productId) === productId);
    if (current && Number(current.unitPrice || 0) <= 0) showToast(`${current.name} adicionado, mas está sem preço de venda.`);
  }

  function cartV43ApplyControls() {
    const v = cartV43State();
    const clear = document.getElementById('clear');
    if (clear) {
      const canRemove = cartV43Allowed('sale.remove_item', true);
      clear.disabled = !canRemove;
      clear.title = canRemove ? 'Limpar itens da venda' : 'Perfil sem permissão para remover itens';
      clear.onclick = () => {
        if (!cartV43Allowed('sale.remove_item', true)) return infoModal('Limpar venda', 'O perfil deste operador não possui permissão para remover itens da venda.');
        state.cart = [];
        if (typeof v3ResetSale === 'function') v3ResetSale();
        renderSaleWorkspace();
      };
    }

    const discountInput = document.getElementById('saleDiscount');
    if (discountInput) {
      const canDiscount = cartV43Allowed('discount.apply', true);
      discountInput.disabled = !canDiscount;
      discountInput.title = canDiscount ? 'Desconto da venda' : 'Perfil sem permissão para aplicar desconto';
      if (!canDiscount) {
        v.discount = 0;
        discountInput.value = '0.00';
      } else {
        const originalChange = discountInput.onchange;
        discountInput.onchange = async (event) => {
          if (originalChange) await originalChange.call(discountInput, event);
          const subtotal = Number(v.quote?.subtotal ?? cartV43Subtotal());
          const discount = Number(v.discount || 0);
          if (discount <= 0 || subtotal <= 0) return;
          const percent = (discount / subtotal) * 100;
          const limit = Number(v.operator?.permissions?.discount?.max_percent || 0);
          const canOverride = cartV43Allowed('discount.override_limit', false);
          if (percent <= limit + 0.0001 || canOverride) return;
          try {
            await v3NeedSupervisor('discount', percent, `Desconto de ${percent.toFixed(2)}% acima da alçada de ${limit.toFixed(2)}%`);
            showToast('Desconto acima da alçada autorizado pelo supervisor.');
          } catch (error) {
            if (error?.message !== 'authorization_cancelled') infoModal('Desconto', friendlyError(error?.message));
            const allowedAmount = Math.round((subtotal * limit / 100) * 100) / 100;
            v.discount = allowedAmount;
            v.supervisorAuthorization = null;
            discountInput.value = allowedAmount.toFixed(2);
            await v3Reprice();
            if (error?.message === 'authorization_cancelled') showToast(`Desconto ajustado para a alçada permitida de ${limit.toFixed(2)}%.`);
          }
        };
      }
    }
  }

  v3RenderCart = cartV43Render;
  renderCart = cartV43Render;
  v3Add = cartV43Add;
  add = cartV43Add;

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(() => { cartV43Render(); cartV43ApplyControls(); });
    return result;
  };
})();

;

/* ---- messages-v044.js ---- */
const v44FriendlyBase=friendlyError;
let v44LastError=null;
function v44Clean(value){
  const original=String(value?.message||value||'').trim();
  let clean=original,channel='';
  const m=clean.match(/Error invoking remote method\s+['"]([^'"]+)['"]:\s*/i);
  if(m){channel=m[1];clean=clean.slice((m.index||0)+m[0].length);}
  clean=clean.replace(/^(?:Error:\s*)+/i,'').trim();
  return {original,clean,channel};
}
function v44Translate(code,parts){
  const fixed={
    insufficient_stock_at_location:'Produto sem estoque suficiente.',
    insufficient_stock:'Estoque insuficiente.',
    composition_required:'Produto configurado para produção sem composição cadastrada.',
    fractional_quantity_not_allowed:'Este produto não permite quantidade fracionada.',
    product_not_found:'Produto não encontrado ou não sincronizado.',
    cash_not_open:'O caixa está fechado.',
    cash_day_expired:'A sessão de caixa pertence a um dia anterior.',
    operator_required:'Identifique um operador antes de continuar.',
    invalid_credentials:'Usuário ou PIN inválido.',
    supervisor_authorization_required:'Esta operação exige autorização de supervisor.',
    payment_exceeds_total:'Os pagamentos ultrapassam o total da venda.',
    payment_method_not_enabled:'Esta forma de pagamento está desabilitada.',
    term_sale_requires_customer:'Venda a prazo exige um cliente identificado.',
    sale_not_found:'Venda não encontrada.',
    sync_recovery_failed:'A recuperação da venda não foi concluída.',
    pre_sale_reprocess_failed:'A venda foi recuperada, mas a Pré-venda não pôde ser reprocessada.',
    nfce_not_authorized:'A NFC-e ainda não foi autorizada.',
    nfce_request_failed:'Não foi possível solicitar a NFC-e.',
    printer_not_configured:'Nenhuma impressora foi configurada.',
    forbidden:'Você não possui permissão para esta operação.'
  };
  if(code==='insufficient_stock_at_location'){
    const [name,requested,available,unit]=parts,u=unit||'UN';
    return `Produto sem estoque suficiente${name?`: ${name}`:''}. Solicitado: ${requested||'—'} ${u} · Disponível: ${available||'—'} ${u}.`;
  }
  if(fixed[code])return fixed[code];
  if(/failed to fetch|networkerror/i.test(code))return 'Não foi possível conectar ao servidor.';
  if(code.includes('not_found'))return 'O registro necessário não foi encontrado. Atualize e tente novamente.';
  if(code.includes('required'))return 'Falta uma informação obrigatória para concluir a operação.';
  if(code.includes('invalid'))return 'Existe uma informação inválida nesta operação.';
  if(code.includes('not_authorized')||code.includes('not_allowed'))return 'O operador não possui autorização para esta operação.';
  if(code.includes('expired'))return 'Esta sessão ou informação expirou e precisa ser atualizada.';
  return 'Não foi possível concluir a operação. Consulte os detalhes técnicos.';
}
function v44Parse(value){
  const r=v44Clean(value),parts=r.clean.split('|').map(x=>x.trim()),code=String(parts.shift()||'unknown');
  const message=v44Translate(code,parts);
  const tech=[`Código: ${code}`,r.channel?`Origem: ${r.channel}`:'',`Versão: ${state?.status?.appVersion||'—'}`,`Filial: ${state?.status?.context?.branch_name||'—'}`,`PDV: ${state?.status?.context?.pos_name||'—'}`,parts.length?`Parâmetros: ${parts.join(' | ')}`:'',`Mensagem original: ${r.original}`].filter(Boolean).join('\n');
  return {code,message,technical:tech};
}
friendlyError=function(value){const r=v44Parse(value);v44LastError={...r,at:Date.now()};console.error('[ThorPDV]\n'+r.technical);return `${r.message}\n\nCódigo técnico: ${r.code}`||v44FriendlyBase(value);};
window.ThorErrorCenter={parse:v44Parse,last:()=>v44LastError};

;

/* ---- discount-v045.js ---- */
(function () {
  const EPSILON = 0.0001;

  function v45State() {
    const v = v3State();
    if (!v.discountMode) v.discountMode = 'amount';
    if (typeof v.discountPending !== 'boolean') v.discountPending = false;
    return v;
  }

  function v45Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v45Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v45Round(value) {
    return Math.round((v45Number(value) + Number.EPSILON) * 100) / 100;
  }

  function v45GrossSubtotal() {
    return state.cart.reduce((sum, item) => sum + v45Number(item.quantity) * v45Number(item.unitPrice), 0);
  }

  function v45ItemDiscountTotal() {
    return state.cart.reduce((sum, item) => sum + Math.max(v45Number(item.discount), 0), 0);
  }

  function v45SaleDiscountBase() {
    return Math.max(v45GrossSubtotal() - v45ItemDiscountTotal(), 0);
  }

  function v45Percent(amount, base) {
    return base > 0 ? (v45Number(amount) / base) * 100 : 0;
  }

  function v45DiscountLimit() {
    return Math.max(v45Number(v45State().operator?.permissions?.discount?.max_percent), 0);
  }

  function v45CanOverride() {
    return v45Allowed('discount.override_limit', false);
  }

  function v45CanDiscount() {
    return v45Allowed('discount.apply', true);
  }

  function v45FormatInput(amount, mode, base) {
    if (mode === 'percent') return v45Percent(amount, base).toFixed(2);
    return v45Round(amount).toFixed(2);
  }

  function v45AmountFromInput(raw, mode, base) {
    const value = Math.max(v45Number(raw), 0);
    return mode === 'percent' ? v45Round(base * Math.min(value, 100) / 100) : v45Round(value);
  }

  function v45ApprovalReason(scope, percent, limit, itemName = '') {
    if (scope === 'item') return `Desconto de ${percent.toFixed(2)}% no item ${itemName || 'da venda'} acima da alçada de ${limit.toFixed(2)}%`;
    return `Desconto total de ${percent.toFixed(2)}% acima da alçada de ${limit.toFixed(2)}%`;
  }

  async function v45AuthorizeDiscount(percent, reason) {
    const v = v45State();
    const previousAuthorization = v.supervisorAuthorization || null;
    v.supervisorAuthorization = null;
    v.discountPending = true;
    try {
      const authorization = await v3NeedSupervisor('discount', percent, reason);
      v.supervisorAuthorization = authorization;
      return authorization;
    } catch (error) {
      v.supervisorAuthorization = previousAuthorization;
      throw error;
    } finally {
      v.discountPending = false;
    }
  }

  async function v45ApplySaleDiscount(input, mode) {
    const v = v45State();
    const base = v45SaleDiscountBase();
    const previousAmount = Math.max(v45Number(v.discount), 0);
    const previousAuthorization = v.supervisorAuthorization || null;

    if (!v45CanDiscount()) {
      input.value = v45FormatInput(previousAmount, mode, base);
      return infoModal('Desconto', 'O perfil deste operador não possui permissão para aplicar desconto.');
    }
    if (base <= 0) {
      input.value = '0.00';
      return infoModal('Desconto', 'Inclua pelo menos um item com valor antes de aplicar desconto.');
    }

    const proposedAmount = Math.min(v45AmountFromInput(input.value, mode, base), base);
    const proposedPercent = v45Percent(proposedAmount, base);
    const limit = v45DiscountLimit();

    try {
      let authorization = null;
      if (proposedAmount > 0 && proposedPercent > limit + EPSILON && !v45CanOverride()) {
        authorization = await v45AuthorizeDiscount(proposedPercent, v45ApprovalReason('sale', proposedPercent, limit));
      }
      v.discount = proposedAmount;
      v.supervisorAuthorization = authorization;
      await v3Reprice();
      v45RefreshDiscountControls();
      if (authorization) showToast('Desconto aplicado após autorização do supervisor.');
      else showToast(proposedAmount > 0 ? 'Desconto aplicado.' : 'Desconto removido.');
    } catch (error) {
      v.discount = previousAmount;
      v.supervisorAuthorization = previousAuthorization;
      input.value = v45FormatInput(previousAmount, mode, base);
      await v3Reprice();
      if (error?.message !== 'authorization_cancelled') infoModal('Desconto', friendlyError(error?.message));
      else showToast('Autorização cancelada. O desconto não foi alterado.');
    }
  }

  function v45OpenItemDiscount(index) {
    const v = v45State();
    const item = state.cart[index];
    if (!item) return;
    if (!v45CanDiscount()) return infoModal('Desconto no item', 'O perfil deste operador não possui permissão para aplicar desconto.');

    const gross = Math.max(v45Number(item.quantity) * v45Number(item.unitPrice), 0);
    if (gross <= 0) return infoModal('Desconto no item', 'Este item não possui valor válido para desconto.');

    const currentAmount = Math.max(v45Number(item.discount), 0);
    const m = modal(`<h3>Desconto no item</h3><p class="muted"><b>${esc(item.name || 'Produto')}</b><br>Valor bruto do item: ${money(gross)}</p><div class="discount-v45-modal-grid"><label><span>Tipo</span><select id="itemDiscountMode"><option value="amount">Valor (R$)</option><option value="percent">Porcentagem (%)</option></select></label><label><span>Desconto</span><input id="itemDiscountInput" type="number" min="0" step="0.01" value="${currentAmount.toFixed(2)}"></label></div><div class="discount-v45-preview" id="itemDiscountPreview"></div><div id="itemDiscountError" class="settings-error"></div><div class="actions"><button class="secondary" id="itemDiscountCancel">Cancelar</button><button class="secondary" id="itemDiscountClear">Remover desconto</button><button class="primary" id="itemDiscountApply">Aplicar</button></div>`, 'wide');
    const mode = m.querySelector('#itemDiscountMode');
    const input = m.querySelector('#itemDiscountInput');
    const preview = m.querySelector('#itemDiscountPreview');
    const errorBox = m.querySelector('#itemDiscountError');

    const refresh = () => {
      const amount = Math.min(v45AmountFromInput(input.value, mode.value, gross), gross);
      const percent = v45Percent(amount, gross);
      preview.textContent = `Desconto proposto: ${money(amount)} (${percent.toFixed(2)}%) • Líquido do item: ${money(gross - amount)}`;
    };
    mode.onchange = () => {
      input.value = v45FormatInput(currentAmount, mode.value, gross);
      refresh();
    };
    input.oninput = refresh;
    refresh();

    m.querySelector('#itemDiscountCancel').onclick = () => m.remove();
    m.querySelector('#itemDiscountClear').onclick = async () => {
      item.discount = 0;
      v.supervisorAuthorization = null;
      m.remove();
      await v3Reprice();
      showToast('Desconto do item removido.');
    };
    m.querySelector('#itemDiscountApply').onclick = async () => {
      if (v.discountPending) return;
      const previousAmount = Math.max(v45Number(item.discount), 0);
      const previousAuthorization = v.supervisorAuthorization || null;
      const proposedAmount = Math.min(v45AmountFromInput(input.value, mode.value, gross), gross);
      const proposedPercent = v45Percent(proposedAmount, gross);
      const limit = v45DiscountLimit();
      errorBox.textContent = '';
      try {
        let authorization = null;
        if (proposedAmount > 0 && proposedPercent > limit + EPSILON && !v45CanOverride()) {
          authorization = await v45AuthorizeDiscount(proposedPercent, v45ApprovalReason('item', proposedPercent, limit, item.name));
        }
        item.discount = proposedAmount;
        v.supervisorAuthorization = authorization;
        m.remove();
        await v3Reprice();
        if (authorization) showToast('Desconto do item aplicado após autorização do supervisor.');
        else showToast(proposedAmount > 0 ? 'Desconto do item aplicado.' : 'Desconto do item removido.');
      } catch (error) {
        item.discount = previousAmount;
        v.supervisorAuthorization = previousAuthorization;
        if (error?.message === 'authorization_cancelled') {
          m.remove();
          showToast('Autorização cancelada. O desconto do item não foi alterado.');
        } else {
          errorBox.textContent = friendlyError(error?.message);
        }
      }
    };
  }

  function v45RenderCart() {
    const v = v45State();
    const box = document.getElementById('cart');
    if (!box) return;
    const canRemove = v45Allowed('sale.remove_item', true);
    const canDiscount = v45CanDiscount();

    if (!state.cart.length) {
      box.innerHTML = '<div class="cart-v43-empty"><strong>Nenhum item na venda</strong><span>Leia um código de barras, digite o SKU ou clique em um produto.</span></div>';
      v45UpdateSummary();
      return;
    }

    box.innerHTML = `<div class="cart-v43-list-head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span><span></span></div>${state.cart.map((item, index) => {
      const quantity = v45Number(item.quantity);
      const unitPrice = v45Number(item.unitPrice);
      const gross = quantity * unitPrice;
      const discount = Math.min(Math.max(v45Number(item.discount), 0), Math.max(gross, 0));
      const net = Math.max(gross - discount, 0);
      const blockMinus = !canRemove && quantity <= 1;
      const discountPercent = v45Percent(discount, gross);
      return `<div class="cart-v43-item discount-v45-item" data-cart-index="${index}">
        <div class="cart-v43-product"><strong title="${esc(item.name || 'Produto')}">${esc(item.name || 'Produto')}</strong><small>${esc(item.sku || 'Sem SKU')}</small><button class="discount-v45-item-button" data-item-discount="${index}" ${canDiscount ? '' : 'disabled'}>${discount > 0 ? `Desc. ${money(discount)} (${discountPercent.toFixed(2)}%)` : 'Aplicar desconto'}</button></div>
        <div class="cart-v43-qty"><button data-minus="${index}" ${blockMinus ? 'disabled' : ''}>−</button><b>${quantity.toFixed(3).replace(/\.000$/, '')}</b><button data-plus="${index}">+</button></div>
        <div class="cart-v43-unit">${money(unitPrice)}</div>
        <div class="cart-v43-total"><b>${money(net)}</b>${discount > 0 ? `<small>${money(gross)}</small>` : ''}</div>
        <button class="cart-v43-remove" data-remove-item="${index}" ${canRemove ? '' : 'disabled'}>×</button>
      </div>`;
    }).join('')}`;

    box.querySelectorAll('[data-item-discount]').forEach((button) => {
      button.onclick = () => v45OpenItemDiscount(Number(button.dataset.itemDiscount));
    });
    box.querySelectorAll('[data-minus]').forEach((button) => {
      button.onclick = async () => {
        const index = Number(button.dataset.minus);
        const item = state.cart[index];
        if (!item) return;
        if (v45Number(item.quantity) <= 1 && !canRemove) return infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
        item.quantity = v45Number(item.quantity) - 1;
        if (item.quantity <= 0) state.cart.splice(index, 1);
        else if (v45Number(item.discount) > v45Number(item.quantity) * v45Number(item.unitPrice)) item.discount = v45Number(item.quantity) * v45Number(item.unitPrice);
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    box.querySelectorAll('[data-plus]').forEach((button) => {
      button.onclick = async () => {
        const item = state.cart[Number(button.dataset.plus)];
        if (!item) return;
        item.quantity = v45Number(item.quantity) + 1;
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    box.querySelectorAll('[data-remove-item]').forEach((button) => {
      button.onclick = async () => {
        if (!canRemove) return infoModal('Remover item', 'O perfil deste operador não possui permissão para remover itens da venda.');
        state.cart.splice(Number(button.dataset.removeItem), 1);
        v.supervisorAuthorization = null;
        await v3Reprice();
      };
    });
    v45UpdateSummary();
  }

  function v45UpdateSummary() {
    const v = v45State();
    const gross = v45GrossSubtotal();
    const itemDiscount = v45ItemDiscountTotal();
    const saleDiscount = Math.max(v45Number(v.discount), 0);
    const surcharge = Math.max(v45Number(v.surcharge), 0);
    const total = v45Number(v.quote?.total ?? Math.max(gross - itemDiscount - saleDiscount + surcharge, 0));
    const paidValue = typeof v3Paid === 'function' ? v45Number(v3Paid()) : 0;

    const sub = document.getElementById('subtotalValue');
    const itemDisc = document.getElementById('itemDiscountValue');
    const saleDisc = document.getElementById('discountValue');
    const sur = document.getElementById('surchargeValue');
    const grand = document.getElementById('grand');
    const paid = document.getElementById('paidValue');
    const remain = document.getElementById('remainingValue');
    if (sub) sub.textContent = money(gross);
    if (itemDisc) itemDisc.textContent = `-${money(itemDiscount)}`;
    if (saleDisc) saleDisc.textContent = `-${money(saleDiscount)}`;
    if (sur) sur.textContent = money(surcharge);
    if (grand) grand.textContent = money(total);
    if (paid) paid.textContent = money(paidValue);
    if (remain) remain.textContent = money(Math.max(total - paidValue, 0));
  }

  async function v45Reprice() {
    const v = v45State();
    try {
      v.quote = await window.thor.quoteCheckout({
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: Math.max(v45Number(item.discount), 0) })),
        discount: Math.max(v45Number(v.discount), 0),
        surcharge: Math.max(v45Number(v.surcharge), 0),
      });
      for (const quoted of v.quote.items || []) {
        const item = state.cart.find((candidate) => String(candidate.productId) === String(quoted.productId));
        if (!item) continue;
        item.unitPrice = v45Number(quoted.unitPrice);
        item.discount = Math.max(v45Number(quoted.discount), 0);
      }
    } catch {
      const gross = v45GrossSubtotal();
      const itemDiscount = v45ItemDiscountTotal();
      const subtotal = Math.max(gross - itemDiscount, 0);
      v.quote = { subtotal, discount: v45Number(v.discount), surcharge: v45Number(v.surcharge), total: Math.max(subtotal - v45Number(v.discount) + v45Number(v.surcharge), 0) };
    }
    v45RenderCart();
    v45RefreshDiscountControls();
  }

  function v45RefreshDiscountControls() {
    const v = v45State();
    const input = document.getElementById('saleDiscount');
    const mode = document.getElementById('saleDiscountMode');
    const applied = document.getElementById('saleDiscountApplied');
    const applyButton = document.getElementById('saleDiscountApply');
    if (input && mode && document.activeElement !== input) input.value = v45FormatInput(v.discount, mode.value, v45SaleDiscountBase());
    if (applied) applied.textContent = v.discount > 0 ? `Aplicado: ${money(v.discount)} (${v45Percent(v.discount, v45SaleDiscountBase()).toFixed(2)}%)` : 'Nenhum desconto total aplicado.';
    if (applyButton) applyButton.disabled = !v45CanDiscount() || v.discountPending;
    v45UpdateSummary();
  }

  function v45InstallWorkspace() {
    const v = v45State();
    const grid = document.querySelector('.adjustment-grid');
    if (grid) {
      const first = grid.querySelector('label');
      if (first) {
        const canDiscount = v45CanDiscount();
        first.className = 'discount-v45-sale-field';
        first.innerHTML = `<span>Desconto da venda</span><div class="discount-v45-sale-entry"><select id="saleDiscountMode" ${canDiscount ? '' : 'disabled'}><option value="amount" ${v.discountMode === 'amount' ? 'selected' : ''}>R$</option><option value="percent" ${v.discountMode === 'percent' ? 'selected' : ''}>%</option></select><input id="saleDiscount" type="number" min="0" step="0.01" ${canDiscount ? '' : 'disabled'}><button type="button" id="saleDiscountApply" class="secondary" ${canDiscount ? '' : 'disabled'}>Aplicar</button></div><small id="saleDiscountApplied" class="discount-v45-applied"></small>`;
        const mode = first.querySelector('#saleDiscountMode');
        const input = first.querySelector('#saleDiscount');
        const apply = first.querySelector('#saleDiscountApply');
        input.value = v45FormatInput(v.discount, v.discountMode, v45SaleDiscountBase());
        mode.onchange = () => {
          v.discountMode = mode.value;
          input.value = v45FormatInput(v.discount, mode.value, v45SaleDiscountBase());
        };
        input.onkeydown = (event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply.click(); }
        };
        input.onchange = null;
        apply.onclick = () => v45ApplySaleDiscount(input, mode.value);
      }
    }

    const discountRow = document.getElementById('discountValue')?.closest('.total-row');
    if (discountRow) {
      const label = discountRow.querySelector('span');
      if (label) label.textContent = 'Desconto venda';
      if (!document.getElementById('itemDiscountValue')) {
        const row = document.createElement('div');
        row.className = 'total-row discount-row';
        row.innerHTML = '<span>Desconto itens</span><b id="itemDiscountValue">-R$ 0,00</b>';
        discountRow.parentElement.insertBefore(row, discountRow);
      }
    }

    const clear = document.getElementById('clear');
    if (clear) {
      const canRemove = v45Allowed('sale.remove_item', true);
      clear.disabled = !canRemove;
      clear.onclick = () => {
        if (!canRemove) return infoModal('Limpar venda', 'O perfil deste operador não possui permissão para remover itens da venda.');
        state.cart = [];
        v3ResetSale();
        renderSaleWorkspace();
      };
    }

    v45RefreshDiscountControls();
    v45RenderCart();
  }

  v3Reprice = v45Reprice;
  repriceCart = v45Reprice;
  v3RenderCart = v45RenderCart;
  renderCart = v45RenderCart;

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v45InstallWorkspace);
    return result;
  };

  v3CompleteCheckout = async function () {
    const v = v45State();
    if (v.discountPending) return infoModal('Desconto', 'Conclua ou cancele a autorização de desconto antes de finalizar a venda.');
    if (state.busy) return;
    if (!state.status.cashOpenEventId) return openCashModal();
    if (!v3ValidDocument(v.consumerDocument)) return infoModal('CPF/CNPJ', 'CPF/CNPJ inválido. Corrija ou deixe em branco.');
    try {
      state.busy = true;
      const result = await window.thor.finalizeSale({
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: Math.max(v45Number(item.discount), 0) })),
        consumerDocument: v.consumerDocument,
        payments: v.payments,
        discount: Math.max(v45Number(v.discount), 0),
        surcharge: Math.max(v45Number(v.surcharge), 0),
        supervisorAuthorization: v.supervisorAuthorization,
      });
      state.cart = [];
      v3ResetSale();
      await refreshProducts();
      await refreshStatus();
      await refreshFiscalSales();
      renderSaleWorkspace();
      showToast(`Venda concluída: ${money(result.total)}${result.change > 0 ? ` • Troco ${money(result.change)}` : ''}.`);
      await postSalePrint(result.eventId);
    } catch (error) {
      infoModal('Finalização', friendlyError(error?.message));
    } finally {
      state.busy = false;
    }
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const text = String(code || '');
    const messages = {
      discount_not_allowed: 'Este perfil não pode aplicar descontos.',
      item_discount_not_allowed: 'Este perfil não pode aplicar desconto em itens.',
      discount_exceeds_supervisor_limit: 'O desconto solicitado ultrapassa a alçada do supervisor selecionado.',
      supervisor_authorization_required: 'Este desconto exige autorização de supervisor.',
    };
    return messages[text] || previousFriendlyError(code);
  };
})();

;

/* ---- weighable-v046.js ---- */
(function () {
  function w46State() { return v3State(); }
  function w46Number(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function w46Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }
  function w46Qty(value) { return w46Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1'); }
  function w46ScaleWeight(value) {
    const raw = w46Number(value);
    if (raw <= 0) throw new Error('scale_invalid_weight');
    const grams = Number.isInteger(raw) && raw >= 50;
    const weight = grams ? raw / 1000 : raw;
    const normalized = Math.round(weight * 1000) / 1000;
    if (normalized <= 0) throw new Error('scale_invalid_weight');
    return { raw, weight: normalized, grams };
  }
  function w46ProductFlags(product) {
    return {
      isWeighable: Boolean(product?.is_weighable),
      fractioned: Boolean(product?.is_weighable) || Boolean(product?.fractioned),
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'UN'),
    };
  }

  async function w46Commit(product, quantity, replace = false, itemIndex = -1) {
    const qty = w46Number(quantity);
    if (qty <= 0) return infoModal('Quantidade', 'Informe uma quantidade maior que zero.');
    const flags = w46ProductFlags(product);
    if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) {
      return infoModal('Quantidade', 'Este produto não permite quantidade fracionada.');
    }

    const v = w46State();
    if (replace && itemIndex >= 0 && state.cart[itemIndex]) {
      state.cart[itemIndex].quantity = qty;
      Object.assign(state.cart[itemIndex], flags);
    } else {
      const found = state.cart.find((item) => String(item.productId) === String(product.id));
      if (found) {
        found.quantity = w46Number(found.quantity) + qty;
        found.image_url = product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || '';
        Object.assign(found, flags);
      } else {
        state.cart.push({
          productId: product.id,
          name: product.name || product.description || 'Produto',
          image_url: product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '',
          sku: product.sku || '',
          quantity: qty,
          unitPrice: w46Number(product.base_price ?? product.sale_price ?? product.price),
          discount: 0,
          ...flags,
        });
      }
    }
    v.lastProductId = product.id;
    v.supervisorAuthorization = null;
    await v3Reprice();
  }

  function w46QuantityModal(product, options = {}) {
    const flags = w46ProductFlags(product);
    const initial = options.initialQuantity ?? (flags.isWeighable ? '' : 1);
    const title = flags.isWeighable ? 'Informar peso do produto' : 'Informar quantidade';
    const label = flags.isWeighable ? `Peso (${flags.unit})` : `Quantidade (${flags.unit})`;
    const m = modal(`<div class="w46-head"><div><small>${flags.isWeighable ? 'PRODUTO PESÁVEL' : 'QUANTIDADE FRACIONADA'}</small><h3>${title}</h3><p>${esc(product.name || 'Produto')}</p></div><span>${flags.isWeighable ? '⚖' : '123'}</span></div><div class="field"><label>${label}</label><input id="w46Quantity" type="number" min="0.001" step="${flags.fractioned ? '0.001' : '1'}" value="${initial === '' ? '' : w46Qty(initial)}" placeholder="${flags.isWeighable ? 'Ex.: 0,750' : 'Ex.: 1'}"></div><div id="w46ScaleStatus" class="w46-scale-status">${flags.isWeighable ? 'Digite o peso manualmente ou leia a balança conectada.' : 'Informe a quantidade desejada.'}</div><div class="actions"><button class="secondary" id="w46Cancel">Cancelar</button>${flags.isWeighable ? '<button class="secondary" id="w46Scale">⚖ Ler balança</button>' : ''}<button class="primary" id="w46Apply">${options.replace ? 'Atualizar' : 'Adicionar'}</button></div>`, 'wide');
    const input = m.querySelector('#w46Quantity');
    const status = m.querySelector('#w46ScaleStatus');
    const scale = m.querySelector('#w46Scale');
    const apply = m.querySelector('#w46Apply');

    m.querySelector('#w46Cancel').onclick = () => m.remove();
    if (scale) {
      const allowed = w46Allowed('hardware.scale', true);
      scale.disabled = !allowed;
      scale.title = allowed ? 'Ler peso da balança configurada' : 'Perfil sem permissão para usar a balança';
      scale.onclick = async () => {
        if (!allowed) return;
        try {
          scale.disabled = true;
          status.textContent = 'Lendo balança...';
          const result = await window.thor.readScale();
          const reading = w46ScaleWeight(result?.weight);
          input.value = w46Qty(reading.weight);
          status.textContent = reading.grams
            ? `Leitura recebida: ${reading.raw} g = ${w46Qty(reading.weight)} ${flags.unit}. Confirme em ${options.replace ? 'Atualizar' : 'Adicionar'}.`
            : `Peso recebido: ${w46Qty(reading.weight)} ${flags.unit}. Confirme em ${options.replace ? 'Atualizar' : 'Adicionar'}.`;
          input.focus();
        } catch (error) {
          status.textContent = friendlyError(error?.message);
        } finally {
          scale.disabled = !allowed;
        }
      };
    }

    const submit = async () => {
      const qty = w46Number(String(input.value || '').replace(',', '.'));
      if (qty <= 0) {
        status.textContent = 'Informe ou leia um peso/quantidade maior que zero.';
        input.focus();
        return;
      }
      if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) {
        status.textContent = 'Este produto aceita somente quantidade inteira.';
        input.focus();
        return;
      }
      m.remove();
      await w46Commit(product, qty, Boolean(options.replace), Number(options.itemIndex ?? -1));
    };
    apply.onclick = submit;
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } };
    input.focus();
    input.select();
  }

  async function w46Add(product) {
    if (!product?.id) return infoModal('Produto', 'Não foi possível identificar o produto selecionado.');
    const flags = w46ProductFlags(product);
    if (flags.isWeighable || flags.promptQuantity) {
      w46QuantityModal(product);
      return;
    }
    return w46Commit(product, 1);
  }

  function w46CartProduct(item) {
    return {
      id: item.productId,
      name: item.name,
      sku: item.sku,
      unit: item.unit || 'UN',
      base_price: item.unitPrice,
      sale_price: item.unitPrice,
      is_weighable: Boolean(item.isWeighable),
      fractioned: Boolean(item.fractioned),
      prompt_quantity: Boolean(item.promptQuantity),
      allow_discount: item.allowDiscount !== false,
    };
  }

  function w46PatchCartControls() {
    document.querySelectorAll('.cart-v43-item[data-cart-index]').forEach((row) => {
      const index = Number(row.dataset.cartIndex);
      const item = state.cart[index];
      if (!item) return;
      const fractioned = Boolean(item.isWeighable) || Boolean(item.fractioned);
      if (!fractioned) return;
      const qty = row.querySelector('.cart-v43-qty');
      if (!qty) return;
      qty.innerHTML = `<button class="w46-quantity-button" data-w46-quantity="${index}" title="${item.isWeighable ? 'Alterar peso' : 'Alterar quantidade'}"><b>${w46Qty(item.quantity)}</b><small>${esc(item.unit || 'UN')}</small></button>`;
      qty.querySelector('[data-w46-quantity]').onclick = () => w46QuantityModal(w46CartProduct(item), { replace: true, itemIndex: index, initialQuantity: item.quantity });
      if (item.isWeighable) row.classList.add('w46-weighable-row');
    });
  }

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(w46PatchCartControls);
    return result;
  };
  repriceCart = v3Reprice;

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(w46PatchCartControls);
    return result;
  };
  renderCart = v3RenderCart;

  v3Add = w46Add;
  add = w46Add;

  v3ReadScale = async function () {
    const v = w46State();
    const index = state.cart.findIndex((item) => String(item.productId) === String(v.lastProductId));
    const item = index >= 0 ? state.cart[index] : state.cart[state.cart.length - 1];
    if (!item) return infoModal('Balança', 'Adicione primeiro um produto pesável.');
    if (!item.isWeighable) return infoModal('Balança', 'O último produto lançado não está configurado como pesável no Gestão.');
    if (!w46Allowed('hardware.scale', true)) return infoModal('Balança', 'O perfil deste operador não possui permissão para usar a balança.');
    try {
      const result = await window.thor.readScale();
      const reading = w46ScaleWeight(result?.weight);
      item.quantity = reading.weight;
      v.supervisorAuthorization = null;
      await v3Reprice();
      showToast(reading.grams
        ? `Balança: ${reading.raw} g convertidos para ${w46Qty(reading.weight)} ${item.unit || 'KG'}.`
        : `Peso atualizado: ${w46Qty(reading.weight)} ${item.unit || 'KG'}.`);
    } catch (error) {
      infoModal('Balança', friendlyError(error?.message));
    }
  };

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(w46PatchCartControls);
    return result;
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      fractional_quantity_not_allowed: 'Este produto não permite quantidade fracionada.',
      product_discount_not_allowed: 'Este produto está configurado para não aceitar desconto.',
      scale_port_not_configured: 'Nenhuma porta de balança foi configurada neste terminal.',
      scale_weight_not_detected: 'A balança não retornou um peso válido.',
      scale_invalid_weight: 'O peso retornado pela balança é inválido.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();

;

/* ---- product-policy-v046.js ---- */
(function () {
  function productPolicyPatch() {
    const hasBlockedDiscountProduct = state.cart.some((item) => item.allowDiscount === false);
    const saleApply = document.getElementById('saleDiscountApply');
    if (saleApply && !saleApply.dataset.productPolicyPatched) {
      const originalClick = saleApply.onclick;
      saleApply.dataset.productPolicyPatched = '1';
      saleApply.onclick = (event) => {
        if (state.cart.some((item) => item.allowDiscount === false)) {
          return infoModal('Desconto da venda', 'Há produto nesta venda configurado para não aceitar desconto. Aplique desconto por item somente nos produtos permitidos.');
        }
        return originalClick?.call(saleApply, event);
      };
    }

    document.querySelectorAll('[data-item-discount]').forEach((button) => {
      const index = Number(button.dataset.itemDiscount);
      const item = state.cart[index];
      if (!item || item.allowDiscount !== false) return;
      button.disabled = true;
      button.textContent = 'Desconto bloqueado';
      button.title = 'Produto configurado para não aceitar desconto';
    });

    const applied = document.getElementById('saleDiscountApplied');
    if (applied && hasBlockedDiscountProduct && Number(v3State().discount || 0) <= 0) {
      applied.textContent = 'Há item sem permissão de desconto: use desconto por item nos demais.';
    }
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(productPolicyPatch);
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(productPolicyPatch);
    return result;
  };
  renderCart = v3RenderCart;

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(productPolicyPatch);
    return result;
  };
  repriceCart = v3Reprice;
})();

;

/* ---- sale-layout-v047.js ---- */
(function () {
  function v47Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v47CartStats() {
    const lines = state.cart.length;
    const quantity = state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { lines, quantity };
  }

  function v47UpdateChrome() {
    if (state.view !== 'sale') return;
    const v = v3State();
    const stats = v47CartStats();
    const count = document.getElementById('v47ItemCount');
    if (count) count.textContent = stats.lines === 1 ? '1 item' : `${stats.lines} itens`;

    const consumer = document.getElementById('v47ConsumerAction');
    if (consumer) {
      const doc = String(v.consumerDocument || '').replace(/\D/g, '');
      consumer.classList.toggle('active', Boolean(doc));
      consumer.querySelector('b').textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
      consumer.querySelector('small').textContent = doc ? `Documento •••• ${doc.slice(-4)}` : 'CPF/CNPJ opcional';
    }

    const adjustments = document.getElementById('v47AdjustmentAction');
    if (adjustments) {
      const itemDiscount = state.cart.reduce((sum, item) => sum + Math.max(Number(item.discount || 0), 0), 0);
      const saleDiscount = Math.max(Number(v.discount || 0), 0);
      const surcharge = Math.max(Number(v.surcharge || 0), 0);
      const hasAdjustment = itemDiscount > 0 || saleDiscount > 0 || surcharge > 0;
      adjustments.classList.toggle('active', hasAdjustment);
      adjustments.querySelector('b').textContent = hasAdjustment ? 'Desconto / acréscimo ativo' : 'Desconto / acréscimo';
      const parts = [];
      if (itemDiscount + saleDiscount > 0) parts.push(`-${money(itemDiscount + saleDiscount)}`);
      if (surcharge > 0) parts.push(`+${money(surcharge)}`);
      adjustments.querySelector('small').textContent = parts.length ? parts.join(' • ') : 'Aplicar somente quando necessário';
    }
  }

  function v47OpenConsumer() {
    if (!v47Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }
    const host = document.getElementById('v47LegacyMetaHost');
    const meta = host?.querySelector('.checkout-meta');
    const field = meta?.querySelector(':scope > label');
    if (!host || !meta || !field) return infoModal('Consumidor', 'O campo de identificação do consumidor não está disponível.');

    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Informe CPF ou CNPJ somente quando necessário.</p></div><span>👤</span></div><div id="v47ConsumerSlot" class="v47-consumer-slot"></div><div class="v47-consumer-help">A identificação fica vinculada somente à venda atual e será enviada junto com o documento fiscal quando aplicável.</div><div class="actions"><button class="secondary" id="v47ConsumerClear">Limpar</button><button class="primary" id="v47ConsumerDone">Concluir</button></div>`);
    const slot = wrap.querySelector('#v47ConsumerSlot');
    slot.appendChild(field);
    const input = field.querySelector('#consumerDocument');
    if (input) { input.focus(); input.select(); }

    const close = () => {
      meta.insertBefore(field, meta.firstChild || null);
      wrap.remove();
      v47UpdateChrome();
    };
    wrap.onclick = event => { if (event.target === wrap) close(); };
    wrap.querySelector('#v47ConsumerDone').onclick = () => {
      if (input && !v3ValidDocument(input.value)) {
        input.classList.add('invalid');
        input.focus();
        return;
      }
      close();
    };
    wrap.querySelector('#v47ConsumerClear').onclick = () => {
      const v = v3State();
      v.consumerDocument = '';
      if (input) {
        input.value = '';
        input.classList.remove('invalid');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      close();
    };
  }

  function v47OpenAdjustments() {
    const host = document.getElementById('v47LegacyMetaHost');
    const meta = host?.querySelector('.checkout-meta');
    const grid = meta?.querySelector('.adjustment-grid');
    if (!host || !meta || !grid) return infoModal('Desconto / acréscimo', 'Os controles de ajuste da venda não estão disponíveis.');

    const wrap = modal(`<div class="v47-modal-head"><div><small>AJUSTES DA VENDA</small><h3>Desconto e acréscimo</h3><p>Use somente quando a operação exigir. Descontos acima da alçada continuam exigindo autorização do supervisor.</p></div><span>%</span></div><div id="v47AdjustmentSlot" class="v47-adjustment-slot"></div><div class="v47-adjustment-help"><b>Desconto por item</b><span>Para conceder desconto apenas em um produto, use “Aplicar desconto” diretamente na linha do item.</span></div><div class="actions"><button class="primary" id="v47AdjustmentDone">Concluir</button></div>`, 'wide');
    const slot = wrap.querySelector('#v47AdjustmentSlot');
    grid.classList.add('v47-adjustment-grid');
    slot.appendChild(grid);

    const close = () => {
      grid.classList.remove('v47-adjustment-grid');
      meta.appendChild(grid);
      wrap.remove();
      v47UpdateChrome();
    };
    wrap.onclick = event => { if (event.target === wrap) close(); };
    wrap.querySelector('#v47AdjustmentDone').onclick = close;
  }

  function v47ReorganizeWorkspace() {
    if (state.view !== 'sale') return;
    const work = document.querySelector('.v3-work');
    if (!work || work.dataset.v47Ready === '1') return;

    const catalog = work.querySelector('.catalog');
    const panel = work.querySelector('.v3-cart-panel');
    const searchRow = catalog?.querySelector('.search-row');
    const products = catalog?.querySelector('#products');
    const cartHead = panel?.querySelector('.cart-head');
    const meta = panel?.querySelector('.checkout-meta');
    const cart = panel?.querySelector('#cart');
    const totals = panel?.querySelector('.v3-totals');
    const paymentSummary = panel?.querySelector('#paymentSummary');
    const paymentsButton = panel?.querySelector('#paymentsButton');
    const paymentMethods = panel?.querySelector('.payment-methods');
    const finalize = panel?.querySelector('#finalize');

    if (!catalog || !panel || !searchRow || !products || !cartHead || !meta || !cart || !totals || !paymentSummary || !paymentsButton || !paymentMethods || !finalize) return;

    work.dataset.v47Ready = '1';
    work.classList.add('v47-work');
    catalog.classList.add('v47-main');
    panel.classList.add('v47-summary');

    const search = searchRow.querySelector('#search');
    if (search) search.placeholder = 'Buscar por código principal, referência interna, EAN ou nome...';

    const searchZone = document.createElement('section');
    searchZone.className = 'v47-search-zone';
    searchZone.append(searchRow, products);

    const itemsCard = document.createElement('section');
    itemsCard.className = 'v47-items-card';
    const headTitle = cartHead.querySelector('div');
    if (headTitle) headTitle.innerHTML = '<small>VENDA ATUAL</small><h2>Itens lançados <span id="v47ItemCount" class="v47-item-count">0 itens</span></h2>';
    itemsCard.append(cartHead, cart);
    catalog.replaceChildren(searchZone, itemsCard);

    const summaryHead = document.createElement('div');
    summaryHead.className = 'v47-summary-head';
    summaryHead.innerHTML = '<small>RESUMO DA VENDA</small><h2>Fechamento</h2><p>Confira valores e finalize quando estiver tudo certo.</p>';

    const actions = document.createElement('div');
    actions.className = 'v47-sale-actions';
    actions.innerHTML = `<button type="button" id="v47ConsumerAction" class="v47-sale-action"><span>👤</span><span><b>Identificar consumidor</b><small>CPF/CNPJ opcional</small></span><i>›</i></button><button type="button" id="v47AdjustmentAction" class="v47-sale-action"><span>%</span><span><b>Desconto / acréscimo</b><small>Aplicar somente quando necessário</small></span><i>›</i></button>`;

    const financialCard = document.createElement('section');
    financialCard.className = 'v47-financial-card';
    financialCard.appendChild(totals);

    const paymentCard = document.createElement('section');
    paymentCard.className = 'v47-payment-card';
    const paymentTitle = document.createElement('div');
    paymentTitle.className = 'v47-section-title';
    paymentTitle.innerHTML = '<div><small>PAGAMENTO</small><b>Recebimentos</b></div>';
    paymentCard.append(paymentTitle, paymentSummary, paymentsButton, paymentMethods);

    const legacyHost = document.createElement('div');
    legacyHost.id = 'v47LegacyMetaHost';
    legacyHost.hidden = true;
    legacyHost.appendChild(meta);

    panel.replaceChildren(summaryHead, actions, financialCard, paymentCard, finalize, legacyHost);
    panel.querySelector('#v47ConsumerAction').onclick = v47OpenConsumer;
    panel.querySelector('#v47AdjustmentAction').onclick = v47OpenAdjustments;

    v47UpdateChrome();
    v47RenderProductsState();
  }

  function v47RenderProductsState() {
    const box = document.getElementById('products');
    if (!box || state.view !== 'sale') return;
    const hasQuery = Boolean(String(state.query || '').trim());
    box.classList.toggle('v47-results-hidden', !hasQuery);
    if (!hasQuery) box.innerHTML = '';
  }

  const previousRenderProducts = renderProducts;
  renderProducts = function () {
    const result = previousRenderProducts();
    v47RenderProductsState();
    return result;
  };

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v47ReorganizeWorkspace);
    return result;
  };

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(v47UpdateChrome);
    return result;
  };
  repriceCart = v3Reprice;

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v47UpdateChrome);
    return result;
  };
  renderCart = v3RenderCart;
})();

;

/* ---- state-hotfix-v048.js ---- */
(function () {
  function v48Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v48Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v48DiscountBase() {
    return Math.max(state.cart.reduce((sum, item) => {
      const gross = v48Number(item.quantity) * v48Number(item.unitPrice);
      return sum + Math.max(gross - Math.max(v48Number(item.discount), 0), 0);
    }, 0), 0);
  }

  function v48DiscountDisplay(amount, mode) {
    const base = v48DiscountBase();
    if (mode === 'percent') return base > 0 ? ((v48Number(amount) / base) * 100).toFixed(2) : '0.00';
    return v48Number(amount).toFixed(2);
  }

  function v48SyncActionLabels() {
    const v = v3State();
    const consumer = document.getElementById('v47ConsumerAction');
    if (consumer) {
      const doc = String(v.consumerDocument || '').replace(/\D/g, '');
      consumer.classList.toggle('active', Boolean(doc));
      const title = consumer.querySelector('b');
      const subtitle = consumer.querySelector('small');
      if (title) title.textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
      if (subtitle) subtitle.textContent = doc ? `Documento •••• ${doc.slice(-4)}` : 'CPF/CNPJ opcional';
    }

    const adjustments = document.getElementById('v47AdjustmentAction');
    if (adjustments) {
      const itemDiscount = state.cart.reduce((sum, item) => sum + Math.max(v48Number(item.discount), 0), 0);
      const saleDiscount = Math.max(v48Number(v.discount), 0);
      const surcharge = Math.max(v48Number(v.surcharge), 0);
      const hasAdjustment = itemDiscount > 0 || saleDiscount > 0 || surcharge > 0;
      adjustments.classList.toggle('active', hasAdjustment);
      const title = adjustments.querySelector('b');
      const subtitle = adjustments.querySelector('small');
      if (title) title.textContent = hasAdjustment ? 'Desconto / acréscimo ativo' : 'Desconto / acréscimo';
      const parts = [];
      if (itemDiscount + saleDiscount > 0) parts.push(`-${money(itemDiscount + saleDiscount)}`);
      if (surcharge > 0) parts.push(`+${money(surcharge)}`);
      if (subtitle) subtitle.textContent = parts.length ? parts.join(' • ') : 'Aplicar somente quando necessário';
    }
  }

  function v48ModalLifecycle(wrap, onClose) {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (wrap.isConnected) wrap.remove();
      onClose?.();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    wrap.onclick = (event) => { if (event.target === wrap) close(); };
    return close;
  }

  function v48OpenConsumer() {
    if (!v48Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }
    const v = v3State();
    const current = String(v.consumerDocument || '');
    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Informe CPF ou CNPJ somente quando necessário.</p></div><span>👤</span></div><div class="field"><label>CPF / CNPJ</label><input id="v48ConsumerDocument" inputmode="numeric" autocomplete="off" value="${esc(current)}" placeholder="Opcional"></div><div id="v48ConsumerError" class="settings-error"></div><div class="v47-consumer-help">A identificação fica vinculada somente à venda atual e será enviada junto com o documento fiscal quando aplicável.</div><div class="actions"><button class="secondary" id="v48ConsumerClear">Limpar</button><button class="secondary" id="v48ConsumerCancel">Cancelar</button><button class="primary" id="v48ConsumerDone">Concluir</button></div>`);
    const input = wrap.querySelector('#v48ConsumerDocument');
    const error = wrap.querySelector('#v48ConsumerError');
    const close = v48ModalLifecycle(wrap, v48SyncActionLabels);

    const commit = () => {
      const value = String(input.value || '').trim();
      if (!v3ValidDocument(value)) {
        input.classList.add('invalid');
        error.textContent = 'CPF/CNPJ inválido. Corrija ou deixe em branco.';
        input.focus();
        return;
      }
      v.consumerDocument = value;
      const legacy = document.getElementById('consumerDocument');
      if (legacy) legacy.value = value;
      close();
    };

    input.oninput = () => { input.classList.remove('invalid'); error.textContent = ''; };
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } };
    wrap.querySelector('#v48ConsumerDone').onclick = commit;
    wrap.querySelector('#v48ConsumerCancel').onclick = close;
    wrap.querySelector('#v48ConsumerClear').onclick = () => {
      v.consumerDocument = '';
      const legacy = document.getElementById('consumerDocument');
      if (legacy) legacy.value = '';
      close();
    };
    input.focus();
    input.select();
  }

  function v48LegacyAdjustmentControls() {
    return {
      mode: document.getElementById('saleDiscountMode'),
      discount: document.getElementById('saleDiscount'),
      discountApply: document.getElementById('saleDiscountApply'),
      surcharge: document.getElementById('saleSurcharge'),
    };
  }

  function v48OpenAdjustments() {
    const controls = v48LegacyAdjustmentControls();
    if (!controls.mode || !controls.discount || !controls.discountApply || !controls.surcharge) {
      return infoModal('Desconto / acréscimo', 'Não foi possível iniciar os controles de ajuste. Feche e abra novamente a venda.');
    }

    const v = v3State();
    const modeValue = v.discountMode === 'percent' ? 'percent' : 'amount';
    const wrap = modal(`<div class="v47-modal-head"><div><small>AJUSTES DA VENDA</small><h3>Desconto e acréscimo</h3><p>Os valores só são gravados depois da aplicação. Desconto acima da alçada exige autorização do supervisor.</p></div><span>%</span></div><div class="discount-v45-modal-grid"><label><span>Tipo do desconto</span><select id="v48DiscountMode"><option value="amount" ${modeValue === 'amount' ? 'selected' : ''}>Valor (R$)</option><option value="percent" ${modeValue === 'percent' ? 'selected' : ''}>Porcentagem (%)</option></select></label><label><span>Desconto</span><input id="v48DiscountValue" type="number" min="0" step="0.01" value="${v48DiscountDisplay(v.discount, modeValue)}"></label><label><span>Acréscimo (R$)</span><input id="v48SurchargeValue" type="number" min="0" step="0.01" value="${Math.max(v48Number(v.surcharge), 0).toFixed(2)}"></label></div><div id="v48AdjustmentStatus" class="discount-v45-preview"></div><div class="v47-adjustment-help"><b>Desconto por item</b><span>Para conceder desconto somente em um produto, use “Aplicar desconto” diretamente na linha do item.</span></div><div class="actions"><button class="secondary" id="v48AdjustmentCancel">Fechar</button><button class="secondary" id="v48ApplySurcharge">Aplicar acréscimo</button><button class="primary" id="v48ApplyDiscount">Aplicar desconto</button></div>`, 'wide');

    const mode = wrap.querySelector('#v48DiscountMode');
    const discount = wrap.querySelector('#v48DiscountValue');
    const surcharge = wrap.querySelector('#v48SurchargeValue');
    const status = wrap.querySelector('#v48AdjustmentStatus');
    const applyDiscount = wrap.querySelector('#v48ApplyDiscount');
    const applySurcharge = wrap.querySelector('#v48ApplySurcharge');
    const close = v48ModalLifecycle(wrap, v48SyncActionLabels);

    const refreshStatus = () => {
      const base = v48DiscountBase();
      const raw = Math.max(v48Number(discount.value), 0);
      const proposed = mode.value === 'percent' ? Math.min(raw, 100) / 100 * base : Math.min(raw, base);
      status.textContent = `Desconto atual: ${money(v.discount)} • Proposto: ${money(proposed)} • Acréscimo atual: ${money(v.surcharge)}`;
    };
    refreshStatus();

    mode.onchange = () => {
      v.discountMode = mode.value;
      discount.value = v48DiscountDisplay(v.discount, mode.value);
      refreshStatus();
    };
    discount.oninput = refreshStatus;
    surcharge.oninput = refreshStatus;

    applyDiscount.onclick = async () => {
      if (v.discountPending) return;
      controls.mode.value = mode.value;
      controls.mode.dispatchEvent(new Event('change', { bubbles: true }));
      controls.discount.value = String(discount.value || '0');
      applyDiscount.disabled = true;
      try {
        const result = controls.discountApply.onclick?.call(controls.discountApply, new Event('click'));
        await Promise.resolve(result);
        discount.value = v48DiscountDisplay(v.discount, mode.value);
        refreshStatus();
        v48SyncActionLabels();
      } finally {
        applyDiscount.disabled = false;
      }
    };

    applySurcharge.onclick = async () => {
      const amount = Math.max(v48Number(surcharge.value), 0);
      v.surcharge = amount;
      v.supervisorAuthorization = null;
      controls.surcharge.value = amount.toFixed(2);
      await v3Reprice();
      refreshStatus();
      v48SyncActionLabels();
      showToast(amount > 0 ? 'Acréscimo aplicado.' : 'Acréscimo removido.');
    };

    wrap.querySelector('#v48AdjustmentCancel').onclick = close;
  }

  // Supervisor modal must always settle its Promise, including backdrop/Esc/removal.
  v3NeedSupervisor = async function (action, requestedValue, reason = '') {
    const v = v3State();
    if (v.supervisorAuthorization?.action === action) return v.supervisorAuthorization;
    const supervisors = (v.operators || []).filter((operator) => operator.permissions?.supervisor?.authorize);
    if (!supervisors.length) throw new Error('supervisor_not_available');

    return await new Promise((resolve, reject) => {
      let settled = false;
      const wrap = modal(`<h3>Autorização de supervisor</h3><p class="muted">A operação ultrapassa a alçada do operador atual.</p><div class="field"><label>Supervisor</label><select id="supUser">${supervisors.map((operator) => `<option value="${esc(operator.id)}">${esc(operator.name)}</option>`).join('')}</select></div><div class="field"><label>PIN do supervisor</label><input id="supPin" type="password" inputmode="numeric" maxlength="8"></div><div class="field"><label>Motivo</label><input id="supReason" value="${esc(reason)}" placeholder="Motivo da autorização"></div><div id="supError" class="settings-error"></div><div class="actions"><button class="secondary" id="supCancel">Cancelar</button><button class="primary" id="supOk">Autorizar</button></div>`);
      const pin = wrap.querySelector('#supPin');
      const ok = wrap.querySelector('#supOk');
      const error = wrap.querySelector('#supError');
      let observer;

      const cleanup = () => {
        document.removeEventListener('keydown', onKey, true);
        observer?.disconnect();
      };
      const rejectCancelled = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (wrap.isConnected) wrap.remove();
        reject(new Error('authorization_cancelled'));
      };
      const resolveAuthorization = (authorization) => {
        if (settled) return;
        settled = true;
        cleanup();
        v.supervisorAuthorization = authorization;
        if (wrap.isConnected) wrap.remove();
        resolve(authorization);
      };
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        rejectCancelled();
      };

      document.addEventListener('keydown', onKey, true);
      wrap.onclick = (event) => { if (event.target === wrap) rejectCancelled(); };
      wrap.querySelector('#supCancel').onclick = rejectCancelled;
      ok.onclick = async () => {
        if (settled) return;
        try {
          ok.disabled = true;
          error.textContent = '';
          const result = await window.thor.supervisorAuthorize({
            userId: wrap.querySelector('#supUser').value,
            pin: pin.value,
            action,
            requestedValue,
            reason: wrap.querySelector('#supReason').value,
          });
          resolveAuthorization(result.authorization);
        } catch (err) {
          error.textContent = friendlyError(err?.message);
          ok.disabled = false;
          pin.focus();
          pin.select();
        }
      };
      pin.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); ok.click(); } };

      observer = new MutationObserver(() => {
        if (!settled && !wrap.isConnected) rejectCancelled();
      });
      observer.observe(document.body, { childList: true });
      pin.focus();
    });
  };

  function v48PatchSaleButtons() {
    if (state.view !== 'sale') return;
    const consumer = document.getElementById('v47ConsumerAction');
    const adjustment = document.getElementById('v47AdjustmentAction');
    if (consumer) consumer.onclick = v48OpenConsumer;
    if (adjustment) adjustment.onclick = v48OpenAdjustments;
    v48SyncActionLabels();
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v48PatchSaleButtons);
    return result;
  };

  const previousReprice = v3Reprice;
  v3Reprice = async function () {
    const result = await previousReprice();
    queueMicrotask(v48SyncActionLabels);
    return result;
  };
  repriceCart = v3Reprice;
})();

;

/* ---- customer-identification-v049.js ---- */
(function () {
  function v49Digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function v49State() {
    const v = v3State();
    if (typeof v.customerId === 'undefined') v.customerId = null;
    if (typeof v.customerName === 'undefined') v.customerName = '';
    if (typeof v.customerEmail === 'undefined') v.customerEmail = '';
    if (typeof v.customerPhone === 'undefined') v.customerPhone = '';
    return v;
  }

  function v49Allowed(path, fallback = false) {
    try {
      if (typeof p41Allowed === 'function') return p41Allowed(path, fallback);
      if (typeof v3Perm === 'function') return Boolean(v3Perm(path, fallback));
    } catch {}
    return fallback;
  }

  function v49FormatDocument(value) {
    const digits = v49Digits(value);
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return String(value || '');
  }

  function v49FormatPhone(value) {
    const digits = v49Digits(value);
    if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return String(value || '');
  }

  function v49SyncAction() {
    if (state.view !== 'sale') return;
    const v = v49State();
    const button = document.getElementById('v47ConsumerAction');
    if (!button) return;
    const title = button.querySelector('b');
    const subtitle = button.querySelector('small');
    const identified = Boolean(v.customerId || v49Digits(v.consumerDocument));
    button.classList.toggle('active', identified);
    if (v.customerId && v.customerName) {
      if (title) title.textContent = v.customerName;
      const doc = v49Digits(v.consumerDocument);
      if (subtitle) subtitle.textContent = doc ? `${v49FormatDocument(doc)} • Cliente do Gestão` : 'Cliente do Gestão';
      return;
    }
    const doc = v49Digits(v.consumerDocument);
    if (title) title.textContent = doc ? 'Consumidor identificado' : 'Identificar consumidor';
    if (subtitle) subtitle.textContent = doc ? `${v49FormatDocument(doc)} • Sem cadastro vinculado` : 'Buscar cliente ou informar CPF/CNPJ';
  }

  function v49SetCustomer(customer) {
    const v = v49State();
    v.customerId = customer?.id || null;
    v.customerName = customer?.name || '';
    v.customerEmail = customer?.email || '';
    v.customerPhone = customer?.phone || '';
    const doc = v49Digits(customer?.document || '');
    v.consumerDocument = doc && v3ValidDocument(doc) ? doc : '';
    const legacy = document.getElementById('consumerDocument');
    if (legacy) legacy.value = v.consumerDocument;
    v49SyncAction();
  }

  function v49SetManualDocument(document) {
    const v = v49State();
    v.customerId = null;
    v.customerName = '';
    v.customerEmail = '';
    v.customerPhone = '';
    v.consumerDocument = v49Digits(document);
    const legacy = document.getElementById('consumerDocument');
    if (legacy) legacy.value = v.consumerDocument;
    v49SyncAction();
  }

  function v49ClearCustomer() {
    v49SetManualDocument('');
  }

  function v49CustomerRow(customer, index) {
    const document = customer.document ? v49FormatDocument(customer.document) : 'Sem CPF/CNPJ';
    const contact = [customer.phone ? v49FormatPhone(customer.phone) : '', customer.email || ''].filter(Boolean).join(' • ');
    return `<button type="button" class="v49-customer-row" data-v49-customer="${index}">
      <span class="v49-customer-avatar">${esc(String(customer.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
      <span class="v49-customer-main"><b>${esc(customer.name || 'Cliente')}</b><small>${esc(document)}${contact ? ` • ${esc(contact)}` : ''}</small></span>
      <span class="v49-customer-select">Selecionar ›</span>
    </button>`;
  }

  async function v49OpenConsumer() {
    if (!v49Allowed('customer.identify', true)) {
      return infoModal('Identificar consumidor', 'O perfil deste operador não possui permissão para identificar o consumidor.');
    }

    const v = v49State();
    const wrap = modal(`<div class="v47-modal-head"><div><small>CONSUMIDOR DA VENDA</small><h3>Identificar consumidor</h3><p>Busque um cliente sincronizado do Gestão ou informe somente CPF/CNPJ.</p></div><span>👤</span></div>
      <div class="v49-current" id="v49Current"></div>
      <section class="v49-section">
        <div class="v49-section-head"><div><b>Buscar cliente do Gestão</b><small>Pesquise pelo nome ou CPF/CNPJ do cadastro sincronizado.</small></div><span>CADASTRO</span></div>
        <div class="v49-search"><span>⌕</span><input id="v49CustomerSearch" autocomplete="off" placeholder="Nome ou CPF/CNPJ..."><button type="button" class="secondary" id="v49SyncCustomers">Sincronizar</button></div>
        <div class="v49-results" id="v49CustomerResults"><div class="v49-empty">Digite para pesquisar um cliente.</div></div>
      </section>
      <div class="v49-divider"><span>ou</span></div>
      <section class="v49-section v49-manual">
        <div class="v49-section-head"><div><b>Usar somente CPF/CNPJ</b><small>Não é necessário que o consumidor esteja cadastrado no Gestão.</small></div><span>RÁPIDO</span></div>
        <div class="v49-manual-row"><input id="v49ManualDocument" inputmode="numeric" autocomplete="off" value="${esc(v.customerId ? '' : (v.consumerDocument || ''))}" placeholder="CPF ou CNPJ"><button type="button" class="primary" id="v49UseDocument">Usar documento</button></div>
        <div id="v49ManualError" class="settings-error"></div>
      </section>
      <div class="actions"><button class="secondary" id="v49ClearCustomer">Remover identificação</button><button class="secondary" id="v49CloseCustomer">Fechar</button></div>`, 'wide');

    const current = wrap.querySelector('#v49Current');
    const search = wrap.querySelector('#v49CustomerSearch');
    const results = wrap.querySelector('#v49CustomerResults');
    const manual = wrap.querySelector('#v49ManualDocument');
    const manualError = wrap.querySelector('#v49ManualError');
    let rows = [];
    let timer = null;
    let closed = false;

    const renderCurrent = () => {
      if (v.customerId && v.customerName) {
        const pieces = [v.consumerDocument ? v49FormatDocument(v.consumerDocument) : '', v.customerPhone ? v49FormatPhone(v.customerPhone) : '', v.customerEmail || ''].filter(Boolean);
        current.innerHTML = `<div><span class="v49-current-icon">✓</span><span><small>IDENTIFICADO</small><b>${esc(v.customerName)}</b><em>${esc(pieces.join(' • ') || 'Cliente do Gestão')}</em></span></div>`;
        current.classList.add('active');
      } else if (v49Digits(v.consumerDocument)) {
        current.innerHTML = `<div><span class="v49-current-icon">✓</span><span><small>DOCUMENTO INFORMADO</small><b>${esc(v49FormatDocument(v.consumerDocument))}</b><em>Consumidor sem cadastro vinculado</em></span></div>`;
        current.classList.add('active');
      } else {
        current.innerHTML = '<div><span class="v49-current-icon">○</span><span><small>CONSUMIDOR</small><b>Não identificado</b><em>A identificação é opcional.</em></span></div>';
        current.classList.remove('active');
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (wrap.isConnected) wrap.remove();
      v49SyncAction();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    wrap.onclick = (event) => { if (event.target === wrap) close(); };

    const renderRows = () => {
      if (!rows.length) {
        results.innerHTML = `<div class="v49-empty">${search.value.trim() ? 'Nenhum cliente encontrado no cadastro local.' : 'Digite para pesquisar um cliente.'}</div>`;
        return;
      }
      results.innerHTML = rows.map(v49CustomerRow).join('');
      results.querySelectorAll('[data-v49-customer]').forEach((button) => {
        button.onclick = () => {
          const customer = rows[Number(button.dataset.v49Customer)];
          if (!customer) return;
          v49SetCustomer(customer);
          renderCurrent();
          showToast(`Cliente ${customer.name} identificado na venda.`);
          close();
        };
      });
    };

    const load = async (query) => {
      const q = String(query || '').trim();
      if (!q) {
        rows = [];
        renderRows();
        return;
      }
      results.innerHTML = '<div class="v49-empty">Pesquisando clientes...</div>';
      try {
        rows = await window.thor.customers(q);
        renderRows();
      } catch (error) {
        rows = [];
        results.innerHTML = `<div class="v49-empty">Não foi possível consultar os clientes: ${esc(friendlyError(error?.message))}</div>`;
      }
    };

    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(search.value), 120);
    };
    search.onkeydown = (event) => {
      if (event.key === 'Enter' && rows[0]) {
        event.preventDefault();
        v49SetCustomer(rows[0]);
        renderCurrent();
        showToast(`Cliente ${rows[0].name} identificado na venda.`);
        close();
      }
    };

    wrap.querySelector('#v49SyncCustomers').onclick = async (event) => {
      const button = event.currentTarget;
      try {
        button.disabled = true;
        button.textContent = 'Sincronizando...';
        await window.thor.sync();
        await load(search.value);
        showToast('Clientes atualizados com o Gestão.');
      } catch (error) {
        infoModal('Clientes', friendlyError(error?.message));
      } finally {
        button.disabled = false;
        button.textContent = 'Sincronizar';
      }
    };

    const useManual = async () => {
      const document = v49Digits(manual.value);
      if (!document || !v3ValidDocument(document)) {
        manualError.textContent = 'Informe um CPF ou CNPJ válido.';
        manual.classList.add('invalid');
        manual.focus();
        return;
      }
      manualError.textContent = '';
      manual.classList.remove('invalid');
      try {
        const matches = await window.thor.customers(document);
        const exact = (matches || []).find((customer) => v49Digits(customer.document) === document);
        if (exact) {
          v49SetCustomer(exact);
          showToast(`CPF/CNPJ localizado: ${exact.name}.`);
        } else {
          v49SetManualDocument(document);
          showToast('CPF/CNPJ informado para esta venda.');
        }
      } catch {
        v49SetManualDocument(document);
        showToast('CPF/CNPJ informado para esta venda.');
      }
      renderCurrent();
      close();
    };

    manual.oninput = () => { manual.classList.remove('invalid'); manualError.textContent = ''; };
    manual.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); useManual(); } };
    wrap.querySelector('#v49UseDocument').onclick = useManual;
    wrap.querySelector('#v49ClearCustomer').onclick = () => {
      v49ClearCustomer();
      renderCurrent();
      showToast('Identificação do consumidor removida.');
      close();
    };
    wrap.querySelector('#v49CloseCustomer').onclick = close;

    renderCurrent();
    search.focus();
  }

  const previousResetSale = v3ResetSale;
  v3ResetSale = function () {
    const result = previousResetSale();
    const v = v49State();
    v.customerId = null;
    v.customerName = '';
    v.customerEmail = '';
    v.customerPhone = '';
    return result;
  };

  // Keep the sale linked to the actual Gestão customer when one was selected.
  v3CompleteCheckout = async function () {
    const v = v49State();
    if (v.discountPending) return infoModal('Desconto', 'Conclua ou cancele a autorização de desconto antes de finalizar a venda.');
    if (state.busy) return;
    if (!state.status.cashOpenEventId) return openCashModal();
    if (!v3ValidDocument(v.consumerDocument)) return infoModal('CPF/CNPJ', 'CPF/CNPJ inválido. Corrija ou deixe em branco.');
    try {
      state.busy = true;
      const result = await window.thor.finalizeSale({
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity, discount: Math.max(Number(item.discount || 0), 0) })),
        customerId: v.customerId || null,
        consumerDocument: v.consumerDocument,
        payments: v.payments,
        discount: Math.max(Number(v.discount || 0), 0),
        surcharge: Math.max(Number(v.surcharge || 0), 0),
        supervisorAuthorization: v.supervisorAuthorization,
      });
      state.cart = [];
      v3ResetSale();
      await refreshProducts();
      await refreshStatus();
      await refreshFiscalSales();
      renderSaleWorkspace();
      showToast(`Venda concluída: ${money(result.total)}${result.change > 0 ? ` • Troco ${money(result.change)}` : ''}.`);
      await postSalePrint(result.eventId);
    } catch (error) {
      infoModal('Finalização', friendlyError(error?.message));
    } finally {
      state.busy = false;
    }
  };

  function v49PatchSale() {
    if (state.view !== 'sale') return;
    const button = document.getElementById('v47ConsumerAction');
    if (button) button.onclick = v49OpenConsumer;
    v49SyncAction();
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(v49PatchSale);
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v49SyncAction);
    return result;
  };
  renderCart = v3RenderCart;
})();

;

/* ---- store-credit-v050.js ---- */
(function () {
  v3PaymentLabels.store_credit = 'Crédito loja';

  function v50Number(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function v50State() {
    const v = v3State();
    if (typeof v.customerCreditBalance !== 'number') v.customerCreditBalance = 0;
    return v;
  }

  async function v50RefreshCustomerCredit() {
    const v = v50State();
    if (!v.customerId) {
      v.customerCreditBalance = 0;
      return null;
    }
    try {
      const query = v.customerName || v.consumerDocument || String(v.customerId);
      const rows = await window.thor.customers(query);
      const customer = (rows || []).find((row) => String(row.id) === String(v.customerId));
      if (!customer) return null;
      v.customerCreditBalance = Math.max(v50Number(customer.store_credit_balance), 0);
      v.customerName = customer.name || v.customerName || '';
      return customer;
    } catch {
      return null;
    }
  }

  function v50PendingCreditPayments() {
    return v50State().payments.reduce((sum, payment) => payment.method === 'store_credit' ? sum + Math.max(v50Number(payment.amount), 0) : sum, 0);
  }

  function v50AvailableCredit() {
    return Math.max(v50State().customerCreditBalance - v50PendingCreditPayments(), 0);
  }

  function v50PaymentModalPatch(modalWrap) {
    if (!modalWrap || modalWrap.dataset.v50CreditPatched === '1') return;
    modalWrap.dataset.v50CreditPatched = '1';
    const entry = modalWrap.querySelector('.payment-entry');
    const error = modalWrap.querySelector('#payError');
    const amount = modalWrap.querySelector('#payAmount');
    const integrated = modalWrap.querySelector('#integratedPay');
    if (!entry || !error || !amount) return;

    const balance = document.createElement('div');
    balance.className = 'v50-credit-balance';
    balance.hidden = true;
    entry.insertBefore(balance, entry.firstChild);

    const selectedMethod = () => modalWrap.querySelector('.payment-method-grid button.active')?.dataset.method || 'cash';
    const refresh = () => {
      const v = v50State();
      const selected = selectedMethod();
      const available = v50AvailableCredit();
      balance.hidden = selected !== 'store_credit';
      if (selected === 'store_credit') {
        if (!v.customerId) {
          balance.classList.add('blocked');
          balance.innerHTML = '<span><small>CRÉDITO EM LOJA</small><b>Cliente obrigatório</b><em>Identifique um cliente do Gestão antes de usar crédito.</em></span>';
          amount.value = '0.00';
        } else {
          balance.classList.toggle('blocked', available <= 0);
          balance.innerHTML = `<span><small>SALDO DISPONÍVEL • ${esc(v.customerName || 'CLIENTE')}</small><b>${money(available)}</b><em>Saldo sincronizado com o Gestão.</em></span>`;
          const remaining = typeof v3Remaining === 'function' ? v3Remaining() : 0;
          if (v50Number(amount.value) <= 0 || v50Number(amount.value) > available) amount.value = Math.min(remaining, available).toFixed(2);
        }
      }
    };

    modalWrap.querySelectorAll('.payment-method-grid button').forEach((button) => {
      button.addEventListener('click', () => queueMicrotask(refresh));
    });

    modalWrap.addEventListener('click', (event) => {
      const target = event.target.closest?.('button');
      if (!target) return;
      const selected = selectedMethod();
      if (selected !== 'store_credit') return;

      if (target.id === 'integratedPay') {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Crédito em loja é saldo interno do cliente e não utiliza TEF/PIX.';
        return;
      }
      if (target.id !== 'addPayment') return;
      const v = v50State();
      if (!v.customerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Identifique um cliente cadastrado no Gestão antes de usar crédito em loja.';
        return;
      }
      const available = v50AvailableCredit();
      const requested = Math.max(v50Number(amount.value), 0);
      if (available <= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'Este cliente não possui saldo de crédito em loja.';
        return;
      }
      if (requested > available + 0.001) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = `Saldo insuficiente. Disponível: ${money(available)}.`;
        amount.value = Math.min(available, typeof v3Remaining === 'function' ? v3Remaining() : available).toFixed(2);
        return;
      }
      queueMicrotask(refresh);
    }, true);

    if (integrated) integrated.title = 'Não aplicável a crédito em loja';
    refresh();
  }

  const originalPaymentModal = v3PaymentModal;
  v3PaymentModal = async function (initialMethod = 'cash') {
    const v = v50State();
    if (initialMethod === 'store_credit' && !v.customerId) {
      return infoModal('Crédito em loja', 'Identifique um cliente cadastrado no Gestão antes de usar crédito em loja.');
    }
    await v50RefreshCustomerCredit();
    if (initialMethod === 'store_credit' && v.customerCreditBalance <= 0) {
      return infoModal('Crédito em loja', 'Este cliente não possui saldo de crédito em loja.');
    }
    const result = originalPaymentModal(initialMethod);
    queueMicrotask(() => {
      const modals = [...document.querySelectorAll('.modal')];
      v50PaymentModalPatch(modals[modals.length - 1]);
    });
    return result;
  };

  const originalReturnModal = returnSaleModal;
  returnSaleModal = function (sale) {
    const result = originalReturnModal(sale);
    queueMicrotask(() => {
      const modals = [...document.querySelectorAll('.modal')];
      const wrap = modals[modals.length - 1];
      if (!wrap) return;
      const select = wrap.querySelector('#refundMethod');
      const option = select?.querySelector('option[value="store_credit"]');
      if (!select || !option) return;
      const customerId = sale?.customer_id || null;
      const customerName = sale?.customer_name || sale?.customer || '';
      const note = document.createElement('div');
      note.className = 'v50-return-note';
      if (!customerId) {
        option.disabled = true;
        note.innerHTML = '<strong>Crédito em loja indisponível.</strong> Para gerar crédito, a venda original precisa estar vinculada a um cliente do Gestão.';
      } else {
        option.textContent = `Crédito em loja${customerName ? ` — ${customerName}` : ''}`;
        note.innerHTML = `<strong>Crédito em loja:</strong> ao escolher esta restituição, o valor devolvido será lançado no saldo de ${esc(customerName || 'cliente vinculado')} e poderá ser usado em uma próxima compra.`;
      }
      select.closest('.field')?.insertAdjacentElement('afterend', note);
    });
    return result;
  };

  function v50UpdateConsumerCredit() {
    const v = v50State();
    const button = document.getElementById('v47ConsumerAction');
    if (!button || !v.customerId) return;
    const small = button.querySelector('small');
    if (!small) return;
    const existing = small.textContent || '';
    const credit = money(Math.max(v.customerCreditBalance, 0));
    if (!existing.includes('Crédito')) small.textContent = `${existing} • Crédito ${credit}`;
  }

  const previousRenderSaleWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousRenderSaleWorkspace();
    queueMicrotask(async () => {
      await v50RefreshCustomerCredit();
      v50UpdateConsumerCredit();
    });
    return result;
  };

  const previousRenderCart = v3RenderCart;
  v3RenderCart = function () {
    const result = previousRenderCart();
    queueMicrotask(v50UpdateConsumerCredit);
    return result;
  };
  renderCart = v3RenderCart;

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      store_credit_requires_customer: 'Crédito em loja exige uma venda vinculada a um cliente cadastrado no Gestão.',
      insufficient_store_credit: 'O cliente não possui saldo suficiente de crédito em loja.',
      customer_not_found: 'O cliente vinculado não está disponível no cadastro sincronizado deste caixa.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();

;

/* ---- scale-label-v060.js ---- */
(function () {
  let sl60Settings = { scaleLabelEnabled:true, scaleLabelCodeDigits:5, scaleLabelMode:'weight', scaleLabelPrefix:'2' };
  function sl60Digits(value) { return String(value || '').replace(/\D/g, ''); }
  function sl60Number(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function sl60Qty(value) { return Number(value || 0).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1'); }
  function sl60CurrentSettings() {
    try { return { ...sl60Settings, ...(typeof v3State === 'function' ? (v3State().settings || {}) : {}) }; } catch { return sl60Settings; }
  }
  async function sl60RefreshSettings() { sl60Settings = { ...sl60Settings, ...(await window.thor.v3Settings().catch(() => ({}))) }; return sl60Settings; }

  function sl60ValidEan13(code) {
    const digits = sl60Digits(code);
    if (digits.length !== 13) return false;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(digits[12]);
  }

  function sl60Parse(code, settings) {
    const digits = sl60Digits(code);
    if (!settings?.scaleLabelEnabled || digits.length !== 13 || !sl60ValidEan13(digits)) return null;
    const prefix = String(settings.scaleLabelPrefix || '2').slice(0, 1);
    if (digits[0] !== prefix) return null;
    const codeDigits = [4, 5, 6].includes(Number(settings.scaleLabelCodeDigits)) ? Number(settings.scaleLabelCodeDigits) : 5;
    const body = digits.slice(0, 12);
    const productCodeText = body.slice(1, 1 + codeDigits);
    const valueText = body.slice(1 + codeDigits);
    if (!productCodeText || !valueText) return null;
    return {
      raw: digits,
      productCode: Number(productCodeText),
      productCodeText,
      rawValue: Number(valueText),
      valueText,
      mode: settings.scaleLabelMode === 'total_price' ? 'total_price' : 'weight',
    };
  }

  async function sl60Commit(product, quantity) {
    const qty = sl60Number(quantity);
    if (qty <= 0) throw new Error('scale_label_invalid_quantity');
    const fractioned = Boolean(product?.is_weighable) || Boolean(product?.fractioned) || Boolean(product?.label_scale);
    if (!fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) throw new Error('fractional_quantity_not_allowed');
    const flags = {
      isWeighable: Boolean(product?.is_weighable) || Boolean(product?.label_scale),
      fractioned,
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'KG'),
    };
    const found = state.cart.find((item) => String(item.productId) === String(product.id));
    if (found) {
      found.quantity = sl60Number(found.quantity) + qty;
      found.image_url = product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || '';
      Object.assign(found, flags);
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name || product.description || 'Produto',
        image_url: product.image_url || product.imageUrl || product.menu_image_url || product.menuImageUrl || product.self_service_image_url || product.selfServiceImageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '',
        productCode: product.product_code || '',
        reference: product.sku || '',
        sku: product.sku || String(product.product_code || ''),
        quantity: qty,
        unitPrice: sl60Number(product.base_price ?? product.sale_price ?? product.price),
        discount: 0,
        ...flags,
      });
    }
    const v = typeof v3State === 'function' ? v3State() : null;
    if (v) { v.lastProductId = product.id; v.supervisorAuthorization = null; }
    await v3Reprice();
  }

  async function sl60Handle(code, search, settings) {
    const parsed = sl60Parse(code, settings);
    if (!parsed) return false;
    const results = await window.thor.searchProducts(String(parsed.productCode));
    const product = (results || []).find((item) => Number(item.product_code || item.sku || 0) === parsed.productCode);
    if (!product) {
      infoModal('Etiqueta de balança', `Produto de código ${parsed.productCodeText} não foi encontrado neste caixa.`);
      return true;
    }
    if (!(product.label_scale || product.is_weighable || product.fractioned)) {
      infoModal('Etiqueta de balança', `O produto ${product.name || parsed.productCodeText} não está configurado como pesável / balança etiquetadora.`);
      return true;
    }

    let quantity = 0;
    let detail = '';
    if (parsed.mode === 'weight') {
      quantity = parsed.rawValue / 1000;
      detail = `Peso ${sl60Qty(quantity)} ${product.unit || 'KG'}`;
    } else {
      const totalPrice = parsed.rawValue / 100;
      const unitPrice = sl60Number(product.base_price ?? product.sale_price ?? product.price);
      if (unitPrice <= 0) {
        infoModal('Etiqueta de balança', 'O produto está sem preço de venda e a etiqueta está configurada por preço total.');
        return true;
      }
      quantity = Math.round((totalPrice / unitPrice) * 1000) / 1000;
      detail = `Preço da etiqueta ${money(totalPrice)} • quantidade calculada ${sl60Qty(quantity)} ${product.unit || 'KG'}`;
    }
    if (quantity <= 0) {
      infoModal('Etiqueta de balança', 'A etiqueta não contém peso/preço válido.');
      return true;
    }
    try {
      await sl60Commit(product, quantity);
      showToast(`${product.name}: ${detail}.`);
      if (search) { search.value = ''; search.focus(); }
      state.query = '';
      return true;
    } catch (error) {
      infoModal('Etiqueta de balança', friendlyError(error?.message));
      return true;
    }
  }

  function sl60BindScanner() {
    const search = document.getElementById('search');
    if (!search || search.dataset.scaleLabelV060 === '1') return;
    search.dataset.scaleLabelV060 = '1';
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const code = String(search.value || '').trim();
      const settings = sl60CurrentSettings();
      if (!sl60Parse(code, settings)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void sl60Handle(code, search, settings);
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(() => { sl60BindScanner(); void sl60RefreshSettings(); });
    return result;
  };

  const previousSettingsModal = settingsModal;
  settingsModal = async function () {
    await previousSettingsModal();
    const modals = document.querySelectorAll('.modal');
    const m = modals[modals.length - 1];
    if (!m || m.querySelector('#scaleLabelCodeDigits')) return;
    const settings = await sl60RefreshSettings();
    const grid = m.querySelector('.v3-settings-grid') || m.querySelector('.settings-grid');
    if (!grid) return;
    const section = document.createElement('section');
    section.className = 'sl60-settings';
    section.innerHTML = `<h4>Etiquetas de balança</h4><p class="muted">Leitura de EAN-13 emitido por balança etiquetadora. O primeiro dígito é o prefixo; em seguida vem o código interno do produto.</p><label class="check-line"><input id="scaleLabelEnabled" type="checkbox" ${settings.scaleLabelEnabled !== false ? 'checked' : ''}> Identificar etiquetas de balança no scanner</label><div class="sl60-grid"><div class="field"><label>Prefixo da etiqueta</label><input id="scaleLabelPrefix" inputmode="numeric" maxlength="1" value="${esc(settings.scaleLabelPrefix || '2')}"></div><div class="field"><label>Dígitos do código do produto</label><select id="scaleLabelCodeDigits">${[4,5,6].map((value) => `<option value="${value}" ${Number(settings.scaleLabelCodeDigits || 5) === value ? 'selected' : ''}>${value} dígitos</option>`).join('')}</select></div></div><div class="field"><label>Conteúdo do valor da etiqueta</label><select id="scaleLabelMode"><option value="weight" ${settings.scaleLabelMode !== 'total_price' ? 'selected' : ''}>Peso (3 casas decimais)</option><option value="total_price" ${settings.scaleLabelMode === 'total_price' ? 'selected' : ''}>Preço total (2 casas decimais)</option></select></div><div class="sl60-example" id="scaleLabelExample"></div>`;
    grid.appendChild(section);

    const example = () => {
      const prefix = sl60Digits(m.querySelector('#scaleLabelPrefix').value).slice(0,1) || '2';
      const codeDigits = Number(m.querySelector('#scaleLabelCodeDigits').value || 5);
      const mode = m.querySelector('#scaleLabelMode').value;
      const valueDigits = 11 - codeDigits;
      m.querySelector('#scaleLabelExample').textContent = `${prefix} + ${codeDigits} dígitos do código + ${valueDigits} dígitos de ${mode === 'weight' ? 'peso' : 'preço'} + dígito verificador`;
    };
    m.querySelector('#scaleLabelPrefix').oninput = example;
    m.querySelector('#scaleLabelCodeDigits').onchange = example;
    m.querySelector('#scaleLabelMode').onchange = example;
    example();

    const save = m.querySelector('#saveSettings');
    if (save) {
      const previousSave = save.onclick;
      save.onclick = async function (event) {
        sl60Settings = await window.thor.saveV3Settings({
          scaleLabelEnabled: m.querySelector('#scaleLabelEnabled').checked,
          scaleLabelPrefix: sl60Digits(m.querySelector('#scaleLabelPrefix').value).slice(0,1) || '2',
          scaleLabelCodeDigits: Number(m.querySelector('#scaleLabelCodeDigits').value || 5),
          scaleLabelMode: m.querySelector('#scaleLabelMode').value,
        });
        if (typeof previousSave === 'function') return previousSave.call(this, event);
      };
    }
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      scale_label_invalid_quantity: 'A quantidade calculada pela etiqueta é inválida.',
      scale_label_product_not_found: 'O produto informado na etiqueta de balança não foi encontrado.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();

;

/* ---- scale-label-v061.js ---- */
(function () {
  let sl61Settings = { scaleLabelEnabled: true, scaleLabelPrefix: '2' };

  function sl61Digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function sl61CheckDigit(base12) {
    const digits = sl61Digits(base12);
    if (digits.length !== 12) return '';
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
  }

  function sl61CompleteEan13(base12) {
    const digits = sl61Digits(base12);
    if (digits.length !== 12) return digits;
    return digits + sl61CheckDigit(digits);
  }

  async function sl61RefreshSettings() {
    const settings = await window.thor.v3Settings().catch(() => ({}));
    sl61Settings = { ...sl61Settings, ...settings };
    return sl61Settings;
  }

  function sl61BindScanner() {
    const search = document.getElementById('search');
    if (!search || search.dataset.scaleLabelV061 === '1') return;
    search.dataset.scaleLabelV061 = '1';

    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const base12 = sl61Digits(search.value);
      if (base12.length !== 12) return;
      if (sl61Settings.scaleLabelEnabled === false) return;

      const prefix = String(sl61Settings.scaleLabelPrefix || '2').replace(/\D/g, '').slice(0, 1) || '2';
      if (base12[0] !== prefix) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const completed = sl61CompleteEan13(base12);
      search.value = completed;

      queueMicrotask(() => {
        search.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      });
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(() => {
      sl61BindScanner();
      void sl61RefreshSettings();
    });
    return result;
  };

  void sl61RefreshSettings();
})();

;

/* ---- quick-entry-v063.js ---- */
(function () {
  let q63ScanTimer = null;
  let q63LastInputAt = 0;
  let q63ScanStartedAt = 0;
  let q63ScanCount = 0;
  let q63Busy = false;

  function q63Text(value) {
    return String(value ?? '').trim();
  }

  function q63Number(value) {
    const number = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }

  function q63Qty(value) {
    return q63Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  function q63Barcodes(product) {
    const values = [];
    if (product?.barcode) values.push(product.barcode);
    const source = Array.isArray(product?.barcodes) ? product.barcodes : [];
    for (const item of source) {
      if (typeof item === 'string' || typeof item === 'number') values.push(item);
      else if (item && typeof item === 'object') values.push(item.barcode ?? item.code ?? item.value ?? '');
    }
    return values.map((value) => q63Text(value).toLowerCase()).filter(Boolean);
  }

  function q63ExplicitToken(rawToken) {
    const token = q63Text(rawToken);
    const match = token.match(/^(cod|codigo|c|ref|r|ean|e)\s*:\s*(.+)$/i);
    if (!match) return { kind: 'auto', value: token };
    const prefix = match[1].toLowerCase();
    const kind = ['cod', 'codigo', 'c'].includes(prefix) ? 'code' : ['ref', 'r'].includes(prefix) ? 'reference' : 'ean';
    return { kind, value: q63Text(match[2]) };
  }

  function q63MatchScore(product, rawToken) {
    const explicit = q63ExplicitToken(rawToken);
    const token = explicit.value.toLowerCase();
    if (!token) return -1;
    const digits = token.replace(/\D/g, '');
    const codeMatches = digits && /^\d+$/.test(token) && Number(product?.product_code || 0) === Number(digits);
    const referenceMatches = q63Text(product?.sku).toLowerCase() === token;
    const eanMatches = q63Barcodes(product).includes(token);

    if (explicit.kind === 'code') return codeMatches ? 400 : -1;
    if (explicit.kind === 'reference') return referenceMatches ? 400 : -1;
    if (explicit.kind === 'ean') return eanMatches ? 400 : -1;

    if (eanMatches) return 300;
    if (codeMatches) return 200;
    if (referenceMatches) return 100;
    return -1;
  }

  async function q63ResolveExact(rawToken) {
    const explicit = q63ExplicitToken(rawToken);
    const token = explicit.value;
    if (!token) return null;
    const results = await window.thor.searchProducts(token).catch(() => []);
    let best = null;
    let bestScore = -1;
    for (const product of Array.isArray(results) ? results : []) {
      const score = q63MatchScore(product, rawToken);
      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function q63ParseQuantity(raw) {
    const match = q63Text(raw).match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:\*|x)\s*(.+)$/i);
    if (!match) return null;
    const quantity = q63Number(match[1]);
    const token = q63Text(match[2]);
    if (!quantity || !token) return null;
    return { quantity, token };
  }

  function q63Flags(product) {
    return {
      isWeighable: Boolean(product?.is_weighable) || Boolean(product?.label_scale),
      fractioned: Boolean(product?.is_weighable) || Boolean(product?.fractioned) || Boolean(product?.label_scale),
      promptQuantity: Boolean(product?.prompt_quantity),
      allowDiscount: product?.allow_discount !== false,
      unit: String(product?.unit || 'UN'),
    };
  }

  async function q63CommitQuantity(product, quantity) {
    const qty = q63Number(quantity);
    if (!product?.id || qty <= 0) throw new Error('quick_entry_invalid_quantity');
    const flags = q63Flags(product);
    if (!flags.fractioned && Math.abs(qty - Math.round(qty)) > 0.000001) throw new Error('fractional_quantity_not_allowed');

    const productId = String(product.id);
    const found = state.cart.find((item) => String(item.productId) === productId);
    if (found) {
      found.quantity = q63Number(found.quantity) + qty;
      found.productCode = product.product_code || found.productCode || '';
      found.reference = product.sku || found.reference || '';
      found.sku = product.sku || found.sku || '';
      found.image_url = product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '' || found.image_url || '';
      Object.assign(found, flags);
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name || product.description || 'Produto',
        image_url: product.image_url || product.imageUrl || product.thumbnail_url || product.thumbnailUrl || product.photo_url || product.photoUrl || product.image || product.photo || '',
        productCode: product.product_code || '',
        reference: product.sku || '',
        sku: product.sku || '',
        quantity: qty,
        unitPrice: q63Number(product.base_price ?? product.sale_price ?? product.price),
        discount: 0,
        ...flags,
      });
    }

    const v = typeof v3State === 'function' ? v3State() : null;
    if (v) {
      v.lastProductId = product.id;
      v.supervisorAuthorization = null;
    }
    await v3Reprice();
  }

  function q63ResetSearch(search) {
    if (!search) return;
    search.value = '';
    search.focus();
    state.query = '';
    state.products = [];
    try { renderProducts(); } catch {}
  }

  async function q63LaunchProduct(product, search, quantity = null) {
    if (!product) return false;
    if (quantity != null) {
      await q63CommitQuantity(product, quantity);
      showToast(`${q63Qty(quantity)} × ${product.name || 'Produto'} lançado.`);
    } else {
      await add(product);
    }
    q63ResetSearch(search);
    return true;
  }

  async function q63Handle(raw, search) {
    if (q63Busy) return;
    q63Busy = true;
    try {
      const quantityEntry = q63ParseQuantity(raw);
      if (quantityEntry) {
        const product = await q63ResolveExact(quantityEntry.token);
        if (!product) {
          showToast(`Produto "${quantityEntry.token}" não encontrado.`);
          search.select();
          return;
        }
        await q63LaunchProduct(product, search, quantityEntry.quantity);
        return;
      }

      const exact = await q63ResolveExact(raw);
      if (exact) {
        await q63LaunchProduct(exact, search);
        return;
      }

      const normalized = q63Text(raw);
      const barcodeLike = /^\d{6,14}$/.test(normalized) || /^(ean|e)\s*:/i.test(normalized);
      const explicit = /^(cod|codigo|c|ref|r|ean|e)\s*:/i.test(normalized);
      if (barcodeLike || explicit) {
        showToast('Produto não encontrado para o código informado.');
        search.select();
        return;
      }

      await refreshProducts(normalized);
      const first = state.products?.[0];
      if (!first) {
        showToast('Produto não encontrado.');
        search.select();
        return;
      }
      await q63LaunchProduct(first, search);
    } catch (error) {
      const code = String(error?.message || error || '');
      if (code === 'quick_entry_invalid_quantity') infoModal('Quantidade', 'Informe uma quantidade maior que zero.');
      else infoModal('Lançamento rápido', friendlyError(code));
      search.select();
    } finally {
      q63Busy = false;
    }
  }

  function q63DispatchEnter(search) {
    search.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
  }

  function q63AutoScannerInput(search) {
    const now = performance.now();
    const gap = q63LastInputAt ? now - q63LastInputAt : 999;
    if (gap > 70) {
      q63ScanStartedAt = now;
      q63ScanCount = 1;
    } else {
      q63ScanCount += 1;
    }
    q63LastInputAt = now;

    if (q63ScanTimer) clearTimeout(q63ScanTimer);
    const raw = q63Text(search.value);
    const numericBarcode = /^\d{8}$|^\d{12,14}$/.test(raw);
    if (!numericBarcode || q63ScanCount < 6) return;

    const duration = Math.max(now - q63ScanStartedAt, 1);
    const averageGap = duration / Math.max(q63ScanCount - 1, 1);
    if (averageGap > 35) return;

    q63ScanTimer = setTimeout(() => {
      if (q63Text(search.value) !== raw || q63Busy) return;
      q63DispatchEnter(search);
    }, 45);
  }

  function q63AddHint(search) {
    const zone = search.closest('.v47-search-zone') || search.parentElement?.parentElement;
    if (!zone || zone.querySelector('.q63-hint')) return;
    const hint = document.createElement('small');
    hint.className = 'q63-hint';
    hint.innerHTML = '<b>Lançamento rápido:</b> bip EAN = adiciona direto • <code>2*3</code> = 2 un. do código 3 • <code>1,250*5</code> = quantidade fracionada • aceita código principal, referência ou EAN.';
    const products = zone.querySelector('#products');
    if (products) zone.insertBefore(hint, products);
    else zone.appendChild(hint);
  }

  function q63Bind() {
    const search = document.getElementById('search');
    if (!search || search.dataset.quickEntryV063 === '1') return;
    search.dataset.quickEntryV063 = '1';
    q63AddHint(search);

    search.addEventListener('input', () => q63AutoScannerInput(search));
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && q63Text(search.value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (q63ScanTimer) clearTimeout(q63ScanTimer);
        queueMicrotask(() => q63DispatchEnter(search));
        return;
      }
      if (event.key !== 'Enter') return;
      const raw = q63Text(search.value);
      if (!raw) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (q63ScanTimer) clearTimeout(q63ScanTimer);
      void q63Handle(raw, search);
    }, true);
  }

  const previousWorkspace = renderSaleWorkspace;
  renderSaleWorkspace = function () {
    const result = previousWorkspace();
    queueMicrotask(q63Bind);
    return result;
  };
})();

;

/* ---- commercial-v070.js ---- */
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
      v.salesOptionsOrderCard={brand:order.card_brand_code||'',acquirer:order.card_acquirer_cnpj||'',installments:Number(order.card_installments||1)};
      c.term=order.payment_condition==='term'?{payment_term_id:order.payment_term_id||null,method:order.term_method,installments:Number(order.installments||1),first_due_days:Number(order.first_due_days??30),interval_days:Number(order.interval_days??30),interest_percent:c70Num(order.interest_percent)}:null;
      v.quote={subtotal:c70Num(order.subtotal),discount:v.discount,surcharge:v.surcharge,total:c70Num(order.total)};
      m.remove();renderSaleWorkspace();queueMicrotask(()=>{v.quote={subtotal:c70Num(order.subtotal),discount:v.discount,surcharge:v.surcharge,total:c70Num(order.total)};v3RenderCart();c70PatchCommercialUi();});
      showToast(`Pedido #${order.number} carregado para ${order.customer_name}.`);
    } catch(e){infoModal('Pedido de venda',friendlyError(e?.message));}
  }

  async function c70OpenTerm() {
    const v=v3State();if(!v.customerId)return infoModal('Venda a Prazo','Selecione primeiro um cliente cadastrado no Gestão. Vendas a prazo exigem cliente identificado.');
    const terms=await window.thor.paymentTerms().catch(()=>[]);if(!terms.length)return infoModal('Venda a Prazo','Nenhum plano de Boleto/Crediário foi sincronizado. Cadastre em Gestão → Administrativo → Configurações → Opções de Vendas.');
    const c=c70State();
    const m=modal(`<div class="v47-modal-head"><div><small>NEGOCIAÇÃO</small><h3>Venda a Prazo</h3><p>Escolha uma condição cadastrada no Gestão. Parcelas, vencimentos e taxa são controlados centralmente.</p></div><span>📅</span></div>
      <div class="field"><label>Plano<select id="c70TermPlan">${terms.map((t,i)=>`<option value="${i}">${esc(t.name)} — ${esc(c70TermLabel(t.method))}</option>`).join('')}</select></label></div>
      <div id="c70TermPreview" class="c70-term-preview"></div><div class="actions"><button class="secondary" id="c70TermCancel">Cancelar</button><button class="primary" id="c70TermApply">Usar venda a prazo</button></div>`, 'wide');
    const plan=m.querySelector('#c70TermPlan'),preview=m.querySelector('#c70TermPreview');
    const calc=()=>{const t=terms[Number(plan.value)]||terms[0],principal=Math.max(v3Remaining(),0),rate=c70Num(t.interest_percent),total=principal+(principal*rate/100),count=Math.max(Number(t.installments||1),1);preview.innerHTML=`<span>${esc(c70TermLabel(t.method))} • <b>${count}x</b></span><span>1º vencimento em <b>${Number(t.first_due_days??30)} dias</b> • intervalo <b>${Number(t.interval_days??30)} dias</b></span><span>Saldo <b>${money(principal)}</b>${rate>0?` + taxa ${rate.toLocaleString('pt-BR')}%`:''} = <b>${money(total)}</b> • aprox. ${money(total/count)}/parcela</span>`;};
    plan.onchange=calc;m.querySelector('#c70TermCancel').onclick=()=>m.remove();m.querySelector('#c70TermApply').onclick=()=>{const t=terms[Number(plan.value)]||terms[0];c.term={payment_term_id:t.id,method:t.method,installments:Number(t.installments||1),first_due_days:Number(t.first_due_days??30),interval_days:Number(t.interval_days??30),interest_percent:c70Num(t.interest_percent)};m.remove();c70PatchCommercialUi();showToast(`${c70TermLabel(t.method)} selecionado: ${c.term.installments} parcela(s).`);};calc();
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
  v3ResetSale=function(){const result=previousReset();const c=c70State(),v=v3State();c.salesOrderId=null;c.salesOrderNumber=null;c.orderPriceLock=false;c.term=null;c.preferredPaymentMethod=null;v.salesOptionsOrderCard=null;return result;};

  const previousWorkspace=renderSaleWorkspace;
  renderSaleWorkspace=function(){const result=previousWorkspace();queueMicrotask(c70PatchCommercialUi);return result;};
  const previousCart=v3RenderCart;
  v3RenderCart=function(){const result=previousCart();queueMicrotask(c70PatchCommercialUi);return result;};renderCart=v3RenderCart;

  const previousFriendly=friendlyError;
  friendlyError=function(code){const map={cash_movement_reason_min_15:'Informe um motivo com pelo menos 15 caracteres.',term_sale_requires_customer:'Venda a prazo exige cliente cadastrado.',term_required_for_unpaid_balance:'Existe saldo pendente. Use Venda a Prazo para gerar Contas a Receber.',term_sale_has_no_financed_balance:'Não há saldo para financiar.',sales_order_customer_mismatch:'O cliente selecionado não corresponde ao cliente do pedido.',invalid_term_method:'Plano de venda a prazo inválido.',invalid_installment_count:'Quantidade de parcelas inválida.',invalid_term_schedule:'Prazo de vencimento inválido.'};return map[String(code||'')]||previousFriendly(code);};
})();

;

/* ---- sales-options-v071.js ---- */
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

;

/* ---- term-settlement-v072.js ---- */
(function(){
  const previousPaymentModal=v3PaymentModal;
  v3PaymentModal=function(initialMethod='cash'){
    const result=previousPaymentModal(initialMethod);
    queueMicrotask(()=>{
      const finish=document.getElementById('finishCheckout');
      if(!finish||finish.dataset.termSettlementV072==='1')return;
      finish.dataset.termSettlementV072='1';
      finish.onclick=async()=>{
        const remaining=v3Remaining();
        const commercial=v3State().commercialV070||{};
        const err=finish.closest('.modal')?.querySelector('#payError');
        if(remaining>0.01&&!commercial.term){
          if(err)err.textContent=`Ainda faltam ${money(remaining)}. Para deixar saldo, selecione Venda a Prazo.`;
          return;
        }
        finish.closest('.modal')?.remove();
        await v3CompleteCheckout();
      };
    });
    return result;
  };

  const previousComplete=v3CompleteCheckout;
  v3CompleteCheckout=async function(){
    const commercial=v3State().commercialV070||{};
    const remaining=v3Remaining();
    if(commercial.term&&remaining<=0.01){
      const originalTerm=commercial.term;
      commercial.term=null;
      try{
        const result=await previousComplete();
        showToast('Pedido quitado integralmente. Nenhum saldo foi financiado.');
        return result;
      }catch(error){
        commercial.term=originalTerm;
        throw error;
      }
    }
    return previousComplete();
  };
})();

;

/* ---- sales-settlement-v073.js ---- */
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

;

/* ---- update-center.js ---- */
(() => {
  let lastInfo = null;
  let currentModal = null;

  const escUpdate = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeUpdateErrorCode = (value) => {
    const raw = String(value || '');
    const match = raw.match(/(update_[a-z0-9_]+)/i);
    return match ? match[1].toLowerCase() : raw;
  };
  const updateError = (value) => {
    const code = normalizeUpdateErrorCode(value);
    return ({
    update_device_not_enrolled: 'Este terminal ainda não está ativado.',
    update_not_available: 'Não há atualização liberada para este terminal.',
    update_pending_sync: 'Existem operações locais ainda não sincronizadas. Sincronize antes de atualizar.',
    update_https_required: 'O pacote de atualização precisa usar HTTPS.',
    update_sha256_invalid: 'O SHA-256 da versão liberada é inválido.',
    update_sha256_mismatch: 'O arquivo baixado não corresponde ao SHA-256 cadastrado. A instalação foi bloqueada.',
    update_already_installing: 'Uma atualização já está em andamento.',
    update_helper_start_failed: 'O Atualizador Thor não conseguiu abrir. A instalação foi interrompida antes de fechar o PDV.',
    update_sale_in_progress: 'Há uma venda em edição. Finalize ou limpe o carrinho antes de atualizar para não perder essa venda ainda não gravada.',
    update_helper_powershell_failed: 'O helper visual do Windows falhou; o Thor tentará automaticamente o modo alternativo.',
    update_helper_fallback_failed: 'Os dois modos do atualizador foram bloqueados pelo Windows. Use a instalação manual desta versão e consulte o log update-helper.log.',
  }[code] || code || 'Falha ao atualizar o ThorPDV.');
  };

  function settingsButton() { return document.getElementById('settings'); }

  function paintBadge(info) {
    const button = settingsButton();
    if (!button) return;
    const old = button.querySelector('.update-pending-dot');
    if (info?.update_available) {
      if (!old) button.insertAdjacentHTML('beforeend', '<i class="update-pending-dot" title="Atualização disponível"></i>');
    } else old?.remove();
  }

  function parseReleaseNotes(value) {
    const raw = String(value || '').trim();
    const result = { changes: [], improvements: [], fixes: [] };
    if (!raw) return result;

    try {
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(result)) {
          if (Array.isArray(parsed?.[key])) result[key] = parsed[key].map(String).filter(Boolean);
        }
        if (Object.values(result).some(items => items.length)) return result;
      }
    } catch {}

    let current = 'changes';
    let sawHeading = false;
    for (const sourceLine of raw.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line) continue;
      const normalized = line.replace(/[\[\]#:]/g, '').trim().toUpperCase();
      if (/^(ALTERAÇÕES|ALTERACOES|MUDANÇAS|MUDANCAS|NOVIDADES)$/.test(normalized)) {
        current = 'changes'; sawHeading = true; continue;
      }
      if (/^MELHORIAS$/.test(normalized)) {
        current = 'improvements'; sawHeading = true; continue;
      }
      if (/^(CORREÇÕES|CORRECOES|BUGFIXES|BUG FIXES)$/.test(normalized)) {
        current = 'fixes'; sawHeading = true; continue;
      }
      const item = line.replace(/^[-•*]\s*/, '').trim();
      if (item) result[current].push(item);
    }

    if (!sawHeading && result.changes.length > 1) return result;
    if (!Object.values(result).some(items => items.length)) result.changes.push(raw);
    return result;
  }

  function releaseNotesHtml(value) {
    const sections = parseReleaseNotes(value);
    const blocks = [
      ['changes', 'Mudanças e novidades'],
      ['improvements', 'Melhorias'],
      ['fixes', 'Correções'],
    ].filter(([key]) => sections[key].length);

    if (!blocks.length) return '<p class="pdv-release-empty">Esta versão não possui notas cadastradas.</p>';
    return `<div class="pdv-release-notes">${blocks.map(([key,label]) => `<section class="pdv-release-note ${key}"><b>${label}</b><ul>${sections[key].map(item => `<li>${escUpdate(item)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  }

  function steps(stage) {
    const all = [
      ['checking','Buscando atualização'],
      ['syncing','Sincronizando dados'],
      ['downloading','Baixando pacote'],
      ['verified','Validando SHA-256'],
      ['handoff','Preparando instalação'],
      ['installed','Nova versão pronta'],
    ];
    const order = all.map(x => x[0]);
    let normalized = stage;
    if (stage === 'helper_ready') normalized = 'handoff';
    if (stage === 'restart_validating') normalized = 'installed';
    let idx = order.indexOf(normalized);
    if (stage === 'available' || stage === 'current' || stage === 'preparing') idx = 0;
    if (stage === 'error') idx = -1;
    return `<div class="update-progress-steps">${all.map(([key,label],i)=>`<div class="update-progress-step ${idx>i?'done':idx===i?'active':''}"><i>${idx>i?'✓':''}</i><span>${label}</span></div>`).join('')}</div>`;
  }

  function ensurePanel(modal) {
    if (!modal) return null;
    let panel = modal.querySelector('#pdvUpdatePanel');
    if (panel) return panel;
    const card = modal.querySelector('.modal-card');
    const actions = card?.querySelector(':scope > .actions');
    panel = document.createElement('section');
    panel.id = 'pdvUpdatePanel';
    panel.className = 'pdv-update-panel';
    panel.innerHTML = '<div class="pdv-update-loading">Carregando controle de atualizações...</div>';
    if (actions) card.insertBefore(panel, actions); else card?.appendChild(panel);
    return panel;
  }

  function render(info = lastInfo, progress = null) {
    if (!currentModal?.isConnected) return;
    const panel = ensurePanel(currentModal); if (!panel) return;
    const installed = state?.status?.appVersion || info?.current_version || info?.currentVersion || '—';
    const available = Boolean(info?.update_available);
    const target = info?.target_version || info?.release?.version || '';
    const direction = info?.direction === 'rollback' ? 'Rollback' : 'Atualização';
    const mode = info?.mode === 'mandatory' ? 'Prioritária' : 'Disponível';
    const stage = progress?.stage || (available ? 'available' : 'current');
    const downloading = stage === 'downloading';
    const percent = Number(progress?.progress || 0);
    const error = stage === 'error' ? updateError(progress?.error) : '';
    const busy = ['syncing','downloading','verified','handoff','helper_ready'].includes(stage);
    const pct = downloading ? percent : stage === 'verified' ? 70 : ['handoff','helper_ready'].includes(stage) ? 92 : stage === 'installed' ? 100 : 25;

    panel.innerHTML = `<div class="pdv-update-head"><div><small>ATUALIZAÇÕES DO THORPDV</small><h4>Central de atualização</h4><p>Versão instalada: <b>v${escUpdate(installed)}</b></p></div><span class="pdv-update-state ${available?'available':'current'}">${available?`${direction} ${mode}`:'Atualizado'}</span></div>
      ${available?`<div class="pdv-update-release"><div><strong>v${escUpdate(target)}</strong><span>${escUpdate(info?.release?.channel||'stable')} · ${escUpdate(info?.scope||'global')}</span></div>${releaseNotesHtml(info?.release?.release_notes||info?.reason||'')}${info?.direction==='rollback'?'<div class="pdv-update-rollback">↶ O ThorControl definiu uma versão anterior como alvo deste terminal. Rollback para versões anteriores à 0.8.2 pode pedir o PIN do operador novamente.</div>':''}</div>`:'<p class="muted">Nenhuma versão diferente foi liberada pelo ThorControl para este terminal.</p>'}
      ${progress && !['available','current'].includes(stage)?`<div class="pdv-update-progress"><div class="update-flight"><div style="width:${pct}%"></div></div>${steps(stage)}${downloading?`<p>Download: <b>${percent}%</b></p>`:''}${['handoff','helper_ready'].includes(stage)?'<div class="pdv-update-handoff">O Atualizador Thor vai permanecer visível enquanto o aplicativo principal reinicia e aplica os novos arquivos.</div>':''}${error?`<div class="pdv-update-error">${escUpdate(error)}</div>`:''}</div>`:''}
      <div class="pdv-update-actions"><button class="secondary" id="checkThorUpdate" ${busy?'disabled':''}>Buscar atualizações</button>${available?`<button class="primary" id="installThorUpdate" ${busy?'disabled':''}>${info?.direction==='rollback'?`Aplicar rollback para ${escUpdate(target)}`:`Baixar e instalar ${escUpdate(target)}`}</button>`:''}</div>
      <small class="pdv-update-security">Antes de instalar, o THOR sincroniza as operações persistidas e valida o SHA-256. A base SQLite do terminal não é removida pelo instalador. A venda que ainda estiver somente no carrinho precisa ser finalizada ou limpa.</small>`;
    panel.querySelector('#checkThorUpdate')?.addEventListener('click', () => void check(false));
    panel.querySelector('#installThorUpdate')?.addEventListener('click', () => void install());
  }

  async function check(silent = false) {
    try {
      if (!silent) render(lastInfo, { stage: 'checking' });
      const info = await window.thor.checkForUpdates();
      lastInfo = info; paintBadge(info); render(info, { stage: info.update_available ? 'available' : 'current' });
      return info;
    } catch (e) {
      if (!silent) render(lastInfo, { stage: 'error', error: String(e?.message || e) });
      return null;
    }
  }

  async function install() {
    if (Array.isArray(state?.cart) && state.cart.length) {
      render(lastInfo, { stage: 'error', error: 'update_sale_in_progress' });
      return;
    }
    if (!lastInfo?.update_available) { await check(false); if (!lastInfo?.update_available) return; }
    try {
      render(lastInfo, { stage: 'preparing' });
      await window.thor.installUpdate();
    } catch (e) {
      render(lastInfo, { stage: 'error', error: String(e?.message || e) });
    }
  }

  const originalSettingsModal = window.settingsModal;
  if (typeof originalSettingsModal === 'function') {
    window.settingsModal = async function(...args) {
      await originalSettingsModal(...args);
      const modals = [...document.querySelectorAll('.modal')];
      currentModal = modals[modals.length - 1] || null;
      ensurePanel(currentModal);
      render(lastInfo || { update_available: false, current_version: state?.status?.appVersion });
      void check(true).then(() => render(lastInfo));
    };
  }

  window.thor.onUpdateProgress?.((payload) => {
    if (payload?.stage === 'available' && payload.update_available != null) lastInfo = payload;
    render(lastInfo, payload);
  });
  window.thor.onUpdateStatus?.((info) => { if (info?.available) { lastInfo = info.available; paintBadge(lastInfo); } });

  setTimeout(() => {
    if (state?.status?.enrolled) void check(true);
  }, 1400);

  window.thorUpdateUI = { check, install, render, parseReleaseNotes };
})();

;

/* ---- cash-daily-v083.js ---- */
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
      let supervisorAuthorization=null;
      if(historical)supervisorAuthorization=await window.requestSupervisorAuthorizationV120('reopen_cash','Autorizar fechamento de caixa anterior',closingAmount);
      const payload={cashOpenEventId:preview.client_event_id,closingAmount,notes:m.querySelector('#cashDailyNotes').value,reconciliation,supervisorAuthorization};
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

;

/* ---- first-sale-sync-v087.js ---- */
(function () {
  const originalSaleStatusLabel = typeof saleStatusLabel === 'function' ? saleStatusLabel : null;

  saleStatusLabel = function (status) {
    const value = String(status || '');
    const labels = {
      completed: 'Concluída',
      cancelled: 'Cancelada',
      pending_sync: 'Aguardando sincronização',
      rejected: 'Erro de sincronização',
      cancel_pending: 'Cancelando',
      return_pending: 'Devolução pendente',
    };
    return labels[value] || (originalSaleStatusLabel ? originalSaleStatusLabel(status) : (value || 'Pendente'));
  };

  const originalFriendlyError = typeof friendlyError === 'function' ? friendlyError : null;
  friendlyError = function (code) {
    const value = String(code || '');
    const labels = {
      cash_open_sync_rejected: 'A abertura do caixa não foi confirmada pelo Gestão. Sincronize o caixa e tente novamente; a venda não foi criada para evitar uma rejeição incorreta.',
      cash_not_open: 'O caixa ainda não está aberto. Abra ou sincronize o caixa antes de finalizar a venda.',
    };
    return labels[value] || (originalFriendlyError ? originalFriendlyError(code) : (value || 'Erro inesperado'));
  };
})();

;

/* ---- redesign-v088.js ---- */
(function(){
  const VERSION='v088';
  let scheduled=false;

  function later(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      try{enhanceAll();}catch(error){console.warn('v088_enhance_failed',error);}
    });
  }

  function text(value,fallback='—'){
    const raw=String(value??'').trim();
    return raw||fallback;
  }

  function productImage(product){
    return product?.image_url||product?.imageUrl||product?.thumbnail_url||product?.thumbnailUrl||product?.photo_url||product?.photoUrl||product?.image||product?.photo||'';
  }

  function compactQuantity(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return '0';
    return n.toLocaleString('pt-BR',{maximumFractionDigits:3});
  }

  function currentOperator(){
    try{return v3State().operator||state.status?.operator||null;}catch{return state.status?.operator||null;}
  }

  function ensureSidebar(){
    const shell=document.querySelector('.shell');
    const workspace=document.getElementById('workspace');
    if(!shell||!workspace)return;
    shell.classList.add('v088-shell');
    document.body.classList.add('thor-v088');

    let sidebar=shell.querySelector('.v088-sidebar');
    if(!sidebar){
      sidebar=document.createElement('aside');
      sidebar.className='v088-sidebar';
      sidebar.innerHTML=`
        <div class="v088-brand">Thor<span>PDV</span></div>
        <nav class="v088-nav">
          <button data-v088-action="sale"><i>▣</i><span>Venda</span></button>
          <button data-v088-action="products"><i>◆</i><span>Produtos</span></button>
          <button data-v088-action="customer"><i>◉</i><span>Cliente</span></button>
          <button data-v088-action="cash"><i>▤</i><span>Caixa</span></button>
          <button data-v088-action="fiscal"><i>▥</i><span>Fiscal</span></button>
          <button data-v088-action="settings"><i>⚙</i><span>Configurações</span></button>
        </nav>
        <div class="v088-nav-bottom">
          <button data-v088-action="sync"><i>↻</i><span>Sincronizar</span></button>
          <button data-v088-action="operator"><i>●</i><span>Operador</span></button>
        </div>`;
      shell.insertBefore(sidebar,workspace);

      sidebar.querySelector('[data-v088-action="sale"]').onclick=()=>setView('sale');
      sidebar.querySelector('[data-v088-action="products"]').onclick=()=>{
        if(state.view!=='sale')setView('sale');
        setTimeout(()=>{document.getElementById('search')?.focus();document.querySelector('.v088-catalog-head')?.scrollIntoView({block:'nearest'});},30);
      };
      sidebar.querySelector('[data-v088-action="customer"]').onclick=()=>{
        if(state.view!=='sale')setView('sale');
        setTimeout(()=>document.getElementById('v47ConsumerAction')?.click(),40);
      };
      sidebar.querySelector('[data-v088-action="cash"]').onclick=()=>openCashModal();
      sidebar.querySelector('[data-v088-action="fiscal"]').onclick=()=>setView('fiscal');
      sidebar.querySelector('[data-v088-action="settings"]').onclick=()=>settingsModal();
      sidebar.querySelector('[data-v088-action="sync"]').onclick=async()=>{
        try{
          await window.thor.sync();
          await refreshStatus();
          await refreshProducts();
          await refreshFiscalSales();
          showToast('Sincronização concluída.');
        }catch(error){infoModal('Sincronização',friendlyError(error?.message||String(error)));}
      };
      sidebar.querySelector('[data-v088-action="operator"]').onclick=()=>document.getElementById('operatorBtn')?.click();
    }

    sidebar.querySelectorAll('[data-v088-action]').forEach(button=>button.classList.remove('active'));
    sidebar.querySelector(`[data-v088-action="${state.view==='fiscal'?'fiscal':'sale'}"]`)?.classList.add('active');
    const operator=currentOperator();
    const opLabel=sidebar.querySelector('[data-v088-action="operator"] span');
    if(opLabel)opLabel.textContent=operator?.name||'Operador';

    const topbar=shell.querySelector('.topbar');
    if(topbar){
      topbar.classList.add('v088-topbar');
      const topLeft=topbar.querySelector('.top-left');
      if(topLeft&&!topLeft.querySelector('.v088-terminal-copy')){
        const copy=document.createElement('div');
        copy.className='v088-terminal-copy';
        copy.innerHTML='<small>TERMINAL</small><b id="v088TerminalTitle"></b>';
        topLeft.appendChild(copy);
      }
      const terminal=document.getElementById('v088TerminalTitle');
      if(terminal)terminal.textContent=text(state.status?.context?.pos_name||state.status?.context?.pos_code,'PDV');
      const originalLogo=topbar.querySelector('.logo');if(originalLogo)originalLogo.classList.add('v088-original-logo');
      const navSale=document.getElementById('navSale');if(navSale)navSale.classList.add('v088-original-nav');
      const navFiscal=document.getElementById('navFiscal');if(navFiscal)navFiscal.classList.add('v088-original-nav');
      const settings=document.getElementById('settings');if(settings)settings.classList.add('v088-original-settings');
      const sync=document.getElementById('sync');if(sync)sync.classList.add('v088-top-sync');
      const operatorBtn=document.getElementById('operatorBtn');if(operatorBtn)operatorBtn.classList.add('v088-operator-chip');
      const drawerBtn=document.getElementById('drawerBtn');if(drawerBtn)drawerBtn.classList.add('v088-drawer-btn');
    }
  }

  function ensureSaleTabs(){
    if(state.view!=='sale')return;
    const main=document.querySelector('.v47-main');
    if(!main)return;
    main.classList.add('v088-sale-main');
    let tabs=main.querySelector('.v088-sale-tabs');
    if(!tabs){
      tabs=document.createElement('nav');
      tabs.className='v088-sale-tabs';
      tabs.innerHTML=`<button class="active" data-v088-tab="sale">Venda</button><button data-v088-tab="products">Produtos</button><button data-v088-tab="customer">Cliente</button><button data-v088-tab="payment">Pagamento</button>`;
      main.insertBefore(tabs,main.firstChild);
      tabs.querySelector('[data-v088-tab="sale"]').onclick=()=>document.getElementById('search')?.focus();
      tabs.querySelector('[data-v088-tab="products"]').onclick=()=>document.getElementById('search')?.focus();
      tabs.querySelector('[data-v088-tab="customer"]').onclick=()=>document.getElementById('v47ConsumerAction')?.click();
      tabs.querySelector('[data-v088-tab="payment"]').onclick=()=>document.getElementById('paymentsButton')?.click();
    }

    const searchZone=main.querySelector('.v47-search-zone');
    const products=document.getElementById('products');
    if(searchZone&&products&&!searchZone.querySelector('.v088-catalog-head')){
      const head=document.createElement('div');
      head.className='v088-catalog-head';
      head.innerHTML='<div><small>CATÁLOGO</small><h2>Produtos</h2></div><span id="v088CatalogCount"></span>';
      searchZone.insertBefore(head,products);
    }

    const search=document.getElementById('search');
    if(search){
      search.placeholder='Buscar produto por código, nome, referência ou EAN...';
      search.classList.add('v088-search');
    }
    document.getElementById('scaleRead')?.classList.add('v088-utility-button');
    document.getElementById('cash')?.classList.add('v088-utility-button');
    document.querySelector('.v47-items-card')?.classList.add('v088-items-card');
    document.querySelector('.v47-summary')?.classList.add('v088-summary');
    ensureQuickActions();
    paintCatalog();
  }

  function ensureQuickActions(){
    const summary=document.querySelector('.v47-summary');
    if(!summary)return;
    if(!summary.querySelector('.v088-quick-actions')){
      const bar=document.createElement('div');
      bar.className='v088-quick-actions';
      bar.innerHTML=`
        <button data-v088-quick="settings"><i>⚙</i><span>Config. rápida</span></button>
        <button data-v088-quick="discount"><i>%</i><span>Desconto</span></button>
        <button data-v088-quick="surcharge"><i>＋</i><span>Acréscimo</span></button>
        <button data-v088-quick="cashback"><i>↻</i><span>Cashback</span></button>`;
      const financial=summary.querySelector('.v47-financial-card');
      summary.insertBefore(bar,financial||summary.firstChild);
      bar.querySelector('[data-v088-quick="settings"]').onclick=()=>settingsModal();
      bar.querySelector('[data-v088-quick="discount"]').onclick=()=>document.getElementById('v47AdjustmentAction')?.click();
      bar.querySelector('[data-v088-quick="surcharge"]').onclick=()=>document.getElementById('v47AdjustmentAction')?.click();
      bar.querySelector('[data-v088-quick="cashback"]').onclick=()=>{
        let available=false;
        try{available=(v3State().salesOptions?.payment_methods||[]).some(row=>row?.active!==false&&row?.code==='cashback');}catch{}
        if(available&&typeof v3PaymentModal==='function')return v3PaymentModal('cashback');
        infoModal('Cashback','A forma Cashback não está habilitada nas Opções de Vendas deste caixa.');
      };
    }
    const legacy=summary.querySelector('.v47-sale-actions');if(legacy)legacy.classList.add('v088-legacy-actions');
    const paymentMethods=summary.querySelector('.payment-methods');if(paymentMethods)paymentMethods.classList.add('v088-payment-methods');
    const paymentButton=document.getElementById('paymentsButton');if(paymentButton){paymentButton.classList.add('v088-payment-open');paymentButton.innerHTML='Escolher formas de pagamento <kbd>F5</kbd>';}
    const finalize=document.getElementById('finalize');if(finalize){finalize.classList.add('v088-finalize');finalize.innerHTML=`Concluir venda <span>${typeof v3Total==='function'?money(v3Total()):''}</span><kbd>F2</kbd>`;}
  }

  function paintCatalog(){
    if(state.view!=='sale')return;
    const box=document.getElementById('products');
    if(!box)return;
    const rows=Array.isArray(state.products)?state.products:[];
    const signature=`${state.query||''}|${rows.slice(0,80).map(p=>`${p.id}:${p.base_price??p.sale_price??0}:${p.quantity??0}`).join(',')}`;
    if(box.dataset.v088Signature===signature&&box.querySelector('.v088-product-card,.v088-product-empty'))return;
    box.dataset.v088Signature=signature;
    box.classList.remove('v47-results-hidden');
    box.classList.add('v088-product-grid');
    const count=document.getElementById('v088CatalogCount');
    if(count)count.textContent=rows.length?`${rows.length} produto(s)`:'Pesquisa rápida';
    if(!rows.length){
      box.innerHTML='<div class="v088-product-empty"><i>⌕</i><b>Encontre o produto rapidamente</b><span>Leia o código de barras ou pesquise por nome, referência ou EAN.</span></div>';
      return;
    }
    box.innerHTML=rows.slice(0,80).map((product,index)=>{
      const image=productImage(product);
      const price=Number(product.base_price??product.sale_price??0);
      const stock=Number(product.quantity??0);
      const code=text(product.product_code||product.sku,'—');
      return `<button class="v088-product-card" data-v088-product="${index}" type="button">
        <div class="v088-product-media ${image?'':'no-image'}">${image?`<img src="${esc(image)}" alt="" loading="lazy">`:'<span>◆</span>'}<em>${stock>0?`${compactQuantity(stock)} un`:'Sem saldo'}</em></div>
        <div class="v088-product-copy"><strong>${esc(product.name||'Produto')}</strong><small>Cód. ${esc(code)}</small><b>${money(price)}</b><span>Estoque: ${compactQuantity(stock)}</span></div>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-v088-product]').forEach(button=>button.onclick=()=>{
      const product=rows[Number(button.dataset.v088Product)];
      if(product)add(product);
    });
    box.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.parentElement?.classList.add('no-image');img.remove();});
  }

  function gateConfigData(){
    const settings=state.settings||state.status?.settings||{};
    const context=state.status?.context||{};
    let methods=[];
    try{methods=(v3State().salesOptions?.payment_methods||[]).filter(row=>row?.active!==false);}catch{}
    return {
      company:text(context.tenant_name||context.company_name||context.organization_name,'ThorPDV'),
      branch:text(context.branch_name,'Filial'),
      pos:text(context.pos_name||context.pos_code,'PDV'),
      printer:text(settings.printerName||state.status?.printer,'Não configurada'),
      payments:methods.length?`${methods.length} forma(s) ativa(s)`:'Configuração do Gestão',
      online:Boolean(state.status?.online),
      syncing:Boolean(state.status?.syncing),
      version:text(state.status?.appVersion,'—'),
      lastSync:state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado'
    };
  }

  function enhanceOperatorGate(){
    const gate=document.getElementById('thorOperatorGate');
    const card=gate?.querySelector('.operator-gate-card');
    if(!gate||!card)return;
    gate.classList.add('v088-operator-gate');
    if(card.dataset.v088Ready==='1')return;
    card.dataset.v088Ready='1';
    card.classList.add('v088-gate-card');

    const login=document.createElement('section');
    login.className='v088-gate-login';
    [...card.childNodes].forEach(node=>login.appendChild(node));
    const data=gateConfigData();
    const config=document.createElement('section');
    config.className='v088-gate-config';
    config.innerHTML=`
      <div class="v088-gate-config-head"><div><span>⚙</span><div><h2>Configurações do terminal</h2><p>Confira o ambiente antes de realizar o acesso.</p></div></div><button id="v088GateSettings">Abrir configurações</button></div>
      <div class="v088-config-grid">
        <article><i>▦</i><div><small>Empresa / Loja</small><b>${esc(data.company)}</b></div></article>
        <article><i>⌂</i><div><small>Filial</small><b>${esc(data.branch)}</b></div></article>
        <article class="green"><i>▣</i><div><small>Terminal / PDV</small><b>${esc(data.pos)}</b></div></article>
        <article class="green"><i>▤</i><div><small>Modo de operação</small><b>Venda</b></div></article>
        <article><i>▧</i><div><small>Impressora</small><b>${esc(data.printer)}</b></div><em class="${data.printer!=='Não configurada'?'ok':'warn'}">${data.printer!=='Não configurada'?'Configurada':'Pendente'}</em></article>
        <article><i>▱</i><div><small>Pagamentos</small><b>${esc(data.payments)}</b></div></article>
        <article class="green"><i>●</i><div><small>Servidor / Conexão</small><b>${data.online?'Online':'Offline'}</b></div><em class="${data.online?'ok':'warn'}">${data.online?'Conectado':'Sem conexão'}</em></article>
        <article><i>↻</i><div><small>Sincronização</small><b>${data.syncing?'Sincronizando agora':'Automática'}</b></div></article>
        <article><i>⇧</i><div><small>Atualizações</small><b>Versão ${esc(data.version)}</b></div></article>
        <article class="green"><i>◷</i><div><small>Última sincronização</small><b>${esc(data.lastSync)}</b></div></article>
      </div>
      <div class="v088-config-ready ${data.online?'online':'offline'}"><div><i>${data.online?'✓':'!'}</i><span><b>${data.online?'Tudo certo!':'Operação offline disponível'}</b><small>${data.online?'Terminal conectado e pronto para sincronizar.':'O caixa pode operar com os dados locais já sincronizados.'}</small></span></div><button id="v088GateTest">Testar conexão</button></div>`;
    card.append(login,config);

    config.querySelector('#v088GateSettings').onclick=()=>{
      settingsModal();
      setTimeout(()=>document.querySelectorAll('.modal').forEach(modal=>modal.classList.add('v088-login-settings-modal')),0);
    };
    config.querySelector('#v088GateTest').onclick=async event=>{
      const button=event.currentTarget;
      try{
        button.disabled=true;button.textContent='Testando...';
        await window.thor.sync();
        state.status=await window.thor.status();
        button.textContent=state.status?.online?'Conexão OK':'Sem conexão';
        setTimeout(()=>{card.dataset.v088Ready='';enhanceOperatorGate();},250);
      }catch(error){button.textContent='Falha na conexão';}
      finally{setTimeout(()=>{if(button.isConnected){button.disabled=false;button.textContent='Testar conexão';}},1200);}
    };
  }

  function enhancePaymentDrawer(){
    document.querySelectorAll('.modal').forEach(modal=>{
      if(modal.querySelector('.payment-head'))modal.classList.add('v088-payment-drawer-modal');
      if(modal.querySelector('.settings-head'))modal.classList.add('v088-settings-modal');
      if(modal.querySelector('.v47-modal-head'))modal.classList.add('v088-adjustment-modal');
    });
  }

  function enhanceFiscal(){
    if(state.view!=='fiscal')return;
    document.querySelector('.fiscal-workspace')?.classList.add('v088-fiscal-workspace');
  }

  function enhanceAll(){
    ensureSidebar();
    ensureSaleTabs();
    enhanceOperatorGate();
    enhancePaymentDrawer();
    enhanceFiscal();
  }

  if(typeof render==='function'){
    const previousRender=render;
    render=function(){const result=previousRender();later();setTimeout(later,25);return result;};
  }
  if(typeof renderProducts==='function'){
    const previousRenderProducts=renderProducts;
    renderProducts=function(){const result=previousRenderProducts();queueMicrotask(()=>{paintCatalog();later();});return result;};
  }
  if(typeof v3RenderCart==='function'){
    const previousRenderCart=v3RenderCart;
    v3RenderCart=function(){const result=previousRenderCart();queueMicrotask(()=>{ensureQuickActions();later();});return result;};
    renderCart=v3RenderCart;
  }

  const observer=new MutationObserver(later);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  later();
})();

;

/* ---- redesign-v088-hotfix.js ---- */
(function(){
  let scheduled=false;

  function apply(){
    scheduled=false;
    document.querySelector('.v47-work')?.classList.add('v088-work');

    const button=document.getElementById('v088GateTest');
    if(button&&button.dataset.v088Stable!=='1'){
      button.dataset.v088Stable='1';
      button.onclick=async()=>{
        const original='Testar conexão';
        try{
          button.disabled=true;
          button.textContent='Testando...';
          await window.thor.sync();
          state.status=await window.thor.status();
          const online=Boolean(state.status?.online);
          button.textContent=online?'Conexão OK':'Sem conexão';

          const gate=document.getElementById('thorOperatorGate');
          const connection=gate?.querySelector('.v088-config-grid article:nth-child(7)');
          const sync=gate?.querySelector('.v088-config-grid article:nth-child(8)');
          const lastSync=gate?.querySelector('.v088-config-grid article:nth-child(10)');
          const ready=gate?.querySelector('.v088-config-ready');

          if(connection){
            const value=connection.querySelector('b');
            const status=connection.querySelector('em');
            if(value)value.textContent=online?'Online':'Offline';
            if(status){status.textContent=online?'Conectado':'Sem conexão';status.className=online?'ok':'warn';}
          }
          if(sync){const value=sync.querySelector('b');if(value)value.textContent='Automática';}
          if(lastSync){const value=lastSync.querySelector('b');if(value)value.textContent=state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado';}
          if(ready){
            ready.classList.toggle('online',online);
            ready.classList.toggle('offline',!online);
            const icon=ready.querySelector('div>i');
            const title=ready.querySelector('div span b');
            const detail=ready.querySelector('div span small');
            if(icon)icon.textContent=online?'✓':'!';
            if(title)title.textContent=online?'Tudo certo!':'Operação offline disponível';
            if(detail)detail.textContent=online?'Terminal conectado e pronto para sincronizar.':'O caixa pode operar com os dados locais já sincronizados.';
          }
        }catch(error){
          button.textContent='Falha na conexão';
        }finally{
          setTimeout(()=>{
            if(button.isConnected){button.disabled=false;button.textContent=original;}
          },1200);
        }
      };
    }
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(apply);
  }

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();

;

/* ---- redesign-v089.js ---- */
(function(){
  const V='v089';
  let scheduled=false;
  let paymentPatched=false;
  const productImageCache=new Map();
  const resolvedImageCache=new Map();

  const num=(v)=>{const n=Number(v||0);return Number.isFinite(n)?n:0;};
  const digits=(v)=>String(v||'').replace(/\D/g,'');
  const br=(v)=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const qty=(v)=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:3});
  const vstate=()=>{try{return v3State();}catch{return {};}};
  const gross=()=>state.cart.reduce((s,i)=>s+num(i.quantity)*num(i.unitPrice),0);
  const itemDiscount=()=>state.cart.reduce((s,i)=>s+Math.max(num(i.discount),0),0);
  const saleDiscount=()=>Math.max(num(vstate().discount),0);
  const surcharge=()=>Math.max(num(vstate().surcharge),0);
  const total=()=>num(vstate().quote?.total ?? Math.max(gross()-itemDiscount()-saleDiscount()+surcharge(),0));
  const cashback=()=>Array.isArray(vstate().payments)?vstate().payments.filter(p=>String(p.method)==='cashback').reduce((s,p)=>s+num(p.amount),0):0;

  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;try{apply();}catch(e){console.warn('v089_apply_failed',e);}});}

  function context(){
    const c=state.status?.context||{};
    return {
      branch:c.branch_name||'Filial',
      pos:c.pos_name||c.pos_code||'PDV',
      address:c.branch_address||c.address||c.branch_name||'Filial',
      operator:vstate().operator?.name||state.status?.operator?.name||'Vendedor'
    };
  }

  function imageOf(product){return product?.image_url||product?.imageUrl||product?.menu_image_url||product?.menuImageUrl||product?.self_service_image_url||product?.selfServiceImageUrl||product?.thumbnail_url||product?.thumbnailUrl||product?.photo_url||product?.photoUrl||product?.image||product?.photo||'';}
  function rememberImages(products){for(const product of products||[]){const image=imageOf(product);if(image&&product?.id!=null)productImageCache.set(String(product.id),image);}}
  function cartImage(item,product){return imageOf(item)||imageOf(product)||productImageCache.get(String(item?.productId||''))||'';}
  async function resolveProductImage(source){
    const image=String(source||'').trim();if(!image)return '';
    if (/^(data:image\/|blob:|file:)/i.test(image)) return image;
    if(resolvedImageCache.has(image))return resolvedImageCache.get(image);
    const request=(async()=>{try{return await window.thor.productImageData?.(image)||image;}catch{return image;}})();
    resolvedImageCache.set(image,request);
    const resolved=await request;
    if(resolved===image)resolvedImageCache.delete(image);
    return resolved;
  }
  function hydrateCartThumb(thumb,source,attempt=0){
    const image=String(source||'').trim();const key=image||'__empty__';
    if(thumb.dataset.imageKey===key&&thumb.dataset.imageState==='ready')return;
    thumb.dataset.imageKey=key;thumb.dataset.imageState='loading';
    if(!image){thumb.innerHTML='<span>◆</span>';thumb.dataset.imageState='empty';return;}
    if(!thumb.querySelector('img'))thumb.innerHTML='<span>◆</span>';
    resolveProductImage(image).then(resolved=>{
      if(!thumb.isConnected||thumb.dataset.imageKey!==key)return;
      const node=document.createElement('img');node.alt='';node.decoding='async';node.src=resolved||image;
      node.onload=()=>{if(thumb.dataset.imageKey===key)thumb.dataset.imageState='ready';};
      node.onerror=()=>{
        if(thumb.dataset.imageKey!==key)return;
        thumb.innerHTML='<span>◆</span>';thumb.dataset.imageState='error';
        resolvedImageCache.delete(image);
        if(attempt<3)setTimeout(()=>{if(thumb.isConnected&&thumb.dataset.imageKey===key)hydrateCartThumb(thumb,image,attempt+1);},1000*(attempt+1));
      };
      thumb.replaceChildren(node);
    });
  }
  function oldPriceOf(product){
    const current=num(product?.base_price??product?.sale_price);
    const candidates=[product?.original_price,product?.list_price,product?.compare_at_price,product?.regular_price,product?.price_before,product?.old_price].map(num).filter(v=>v>current+.009);
    return candidates.length?Math.max(...candidates):0;
  }

  function ensureHeader(){
    const shell=document.querySelector('.shell');
    const top=document.querySelector('.topbar');
    if(!shell||!top)return;
    document.body.classList.add('thor-v089');shell.classList.add('v089-shell');top.classList.add('v089-topbar');
    if(!top.querySelector('.v089-head')){
      const legacy=document.createElement('div');legacy.className='v089-legacy-top';
      while(top.firstChild)legacy.appendChild(top.firstChild);
      top.appendChild(legacy);
      const head=document.createElement('div');head.className='v089-head';
      head.innerHTML=`<button class="v089-hamb" id="v089Actions" type="button" title="Ações (F2)"><span></span><span></span><span></span></button><div class="v089-head-search"><span>⌕</span><div id="v089SearchSlot"></div></div><div class="v089-head-tools"><button id="v089ScanFocus" type="button" title="Focar leitura/pesquisa">▣</button><button id="v089BrandChip" type="button" title="ThorPDV">T</button><button id="v089Profile" type="button" title="Operador">●</button></div>`;
      top.appendChild(head);
      head.querySelector('#v089Actions').onclick=openActions;
      head.querySelector('#v089ScanFocus').onclick=()=>document.getElementById('search')?.focus();
      head.querySelector('#v089BrandChip').onclick=()=>settingsModal();
      head.querySelector('#v089Profile').onclick=()=>document.getElementById('operatorBtn')?.click();
    }
    const search=document.getElementById('search'),slot=document.getElementById('v089SearchSlot');
    if(search&&slot&&search.parentElement!==slot){search.classList.add('v089-main-search');search.placeholder='Consultar Produto...';slot.appendChild(search);}
  }

  function ensureActionBar(){
    if(state.view!=='sale')return;
    const workspace=document.getElementById('workspace');if(!workspace)return;
    let bar=workspace.querySelector('.v089-actionbar');
    if(!bar){
      bar=document.createElement('div');bar.className='v089-actionbar';
      bar.innerHTML=`<div class="v089-action-left"><button class="v089-actions-pill" id="v089ActionsBar">AÇÕES <small>(F2)</small></button><i></i><span class="v089-sale-label">VENDA</span></div><div class="v089-party"><button id="v089Customer"><span class="v089-party-icon green">◎</span><span><b>Cliente</b><small>Informar</small></span><kbd>F8</kbd></button><button id="v089Seller"><span class="v089-party-icon cyan">#</span><span><b>Vendedor</b><small>Informar</small></span><kbd>F9</kbd></button></div><div class="v089-items-title"><b id="v089ItemsTitle">Itens(0,000)</b><em id="v089Address">⌖ Filial</em></div><div class="v089-quick"><button class="purple" id="v089Settings"><span>⚙</span><b>Config Rápida <small>(F4)</small></b></button><button class="cyan" id="v089Discount"><span>−</span><b>Desconto <small>(F6)</small></b></button><button class="orange" id="v089Surcharge"><span>＋</span><b>Acréscimo <small>(F7)</small></b></button></div>`;
      workspace.insertBefore(bar,workspace.firstChild);
      bar.querySelector('#v089ActionsBar').onclick=openActions;
      bar.querySelector('#v089Customer').onclick=()=>document.getElementById('v47ConsumerAction')?.click();
      bar.querySelector('#v089Seller').onclick=()=>document.getElementById('operatorBtn')?.click();
      bar.querySelector('#v089Settings').onclick=()=>settingsModal();
      bar.querySelector('#v089Discount').onclick=openDiscount;
      bar.querySelector('#v089Surcharge').onclick=openSurcharge;
    }
    updateActionBar();
  }

  function updateActionBar(){
    const c=context();
    const customer=document.getElementById('v089Customer');
    if(customer){
      const v=vstate();const label=customer.querySelector('small');const title=customer.querySelector('b');
      if(v.customerName){title.textContent='Cliente';label.textContent=v.customerName;}
      else if(digits(v.consumerDocument)){title.textContent='Cliente';label.textContent=`CPF/CNPJ •••• ${digits(v.consumerDocument).slice(-4)}`;}
      else{title.textContent='Cliente';label.textContent='Informar';}
    }
    const seller=document.getElementById('v089Seller');if(seller){seller.querySelector('small').textContent=c.operator||'Informar';}
    const count=state.cart.reduce((s,i)=>s+num(i.quantity),0);const itemTitle=document.getElementById('v089ItemsTitle');if(itemTitle)itemTitle.textContent=`Itens(${qty(count)})`;
    const addr=document.getElementById('v089Address');if(addr)addr.textContent=`⌖ ${c.address}`;
  }

  function ensureLayout(){
    if(state.view!=='sale')return;
    const work=document.querySelector('.v47-work');const catalog=work?.querySelector('.v47-main');const items=work?.querySelector('.v47-items-card');const summary=work?.querySelector('.v47-summary');
    if(!work||!catalog||!items||!summary)return;
    work.classList.add('v089-work');catalog.classList.add('v089-catalog');items.classList.add('v089-items-card');summary.classList.add('v089-summary');
    let right=work.querySelector(':scope > .v089-right');
    if(!right){right=document.createElement('section');right.className='v089-right';work.appendChild(right);}
    if(items.parentElement!==right)right.appendChild(items);
    if(summary.parentElement!==right)right.appendChild(summary);

    const searchZone=catalog.querySelector('.v47-search-zone');
    if(searchZone){searchZone.classList.add('v089-product-zone');const searchRow=searchZone.querySelector('.search-row');if(searchRow)searchRow.classList.add('v089-hidden-search-row');
      let crumb=searchZone.querySelector('.v089-breadcrumb');
      if(!crumb){crumb=document.createElement('div');crumb.className='v089-breadcrumb';crumb.innerHTML='<span>Início</span><i>›</i><b>PRODUTOS</b><i>›</i><b>CATÁLOGO</b><em>☁</em>';searchZone.insertBefore(crumb,searchZone.querySelector('#products'));}
    }
    catalog.querySelector('.v088-catalog-head')?.classList.add('v089-hide');
    catalog.querySelector('.v088-sale-tabs')?.classList.add('v089-hide');
    document.querySelector('.v088-sale-tabs')?.classList.add('v089-hide');
    decorateProducts();
    decorateCart();
    ensureSummaryBoard();
  }

  function decorateProducts(){
    const box=document.getElementById('products');if(!box)return;
    box.classList.add('v089-products');
    const rows=Array.isArray(state.products)?state.products:[];
    box.querySelectorAll('.v088-product-card').forEach((card,index)=>{
      card.classList.add('v089-product-card');const p=rows[index];if(!p)return;
      const media=card.querySelector('.v088-product-media');const copy=card.querySelector('.v088-product-copy');if(!media||!copy)return;
      let badges=media.querySelector('.v089-badges');
      const stock=num(p.quantity);const current=num(p.base_price??p.sale_price);const old=oldPriceOf(p);const discountPct=old>current?Math.max(0,Math.round((1-current/old)*100)):0;
      if(!badges){badges=document.createElement('div');badges.className='v089-badges';media.appendChild(badges);}
      badges.innerHTML=`<span class="${stock>0?'stock':'out'}">${stock>0?`${qty(stock)} UN`:'OUT'}</span>${discountPct?`<span class="off">OFF<br>${discountPct}%</span>`:''}`;
      let pricing=copy.querySelector('.v089-pricing');if(!pricing){pricing=document.createElement('div');pricing.className='v089-pricing';copy.appendChild(pricing);}pricing.innerHTML=`${old?`<del>R$ ${br(old)}</del>`:''}<strong>R$ ${br(current)}</strong>`;
      const originalPrice=copy.querySelector(':scope > b');if(originalPrice)originalPrice.classList.add('v089-hide-original-price');
      const originalStock=copy.querySelector(':scope > span');if(originalStock)originalStock.classList.add('v089-hide-original-stock');
    });
  }

  function decorateCart(){
    const card=document.querySelector('.v089-items-card');if(!card)return;
    const head=card.querySelector('.cart-head');if(head){head.classList.add('v089-cart-head');const title=head.querySelector('h2');if(title)title.innerHTML='<span id="v089CartTitle">Itens</span>';const small=head.querySelector('small');if(small)small.textContent='';}
    const cart=document.getElementById('cart');if(!cart)return;cart.classList.add('v089-cart');
    cart.querySelector('.cart-v43-list-head')?.classList.add('v089-hide');
    cart.querySelectorAll('.cart-v43-item').forEach((row,index)=>{
      row.classList.add('v089-cart-item');
      const item=state.cart[index];if(!item)return;
      const product=(state.products||[]).find(p=>String(p.id)===String(item.productId));const image=cartImage(item,product);
      let thumb=row.querySelector('.v089-cart-thumb');
      if(!thumb){thumb=document.createElement('div');thumb.className='v089-cart-thumb';thumb.innerHTML='<span>◆</span>';row.insertBefore(thumb,row.firstChild);}
      hydrateCartThumb(thumb,image);
      const productBox=row.querySelector('.cart-v43-product');if(productBox){const small=productBox.querySelector('small');if(small)small.textContent=`Qtd. ${qty(item.quantity)}   Unit. ${br(item.unitPrice)}   Desc. ${br(item.discount||0)}`;}
    });
  }

  function ensureSummaryBoard(){
    const summary=document.querySelector('.v089-summary');if(!summary)return;
    summary.querySelector('.v47-summary-head')?.classList.add('v089-hide');summary.querySelector('.v47-sale-actions')?.classList.add('v089-hide');summary.querySelector('.v47-financial-card')?.classList.add('v089-hide');summary.querySelector('.v47-payment-card')?.classList.add('v089-hide');summary.querySelector('.v088-quick-actions')?.classList.add('v089-hide');
    let board=summary.querySelector('.v089-summary-board');
    if(!board){board=document.createElement('div');board.className='v089-summary-board';board.innerHTML=`<div class="v089-total-box purple"><span>Total</span><b id="v089Gross">0,00</b></div><div class="v089-total-box green"><span>Líquido</span><b id="v089Net">0,00</b></div><div class="v089-mini green"><span>Cashback</span><b id="v089Cashback">+ 0,00 (% 0,00)</b></div><div class="v089-mini cyan"><span>Desconto</span><b id="v089DiscountValue">- 0,00 (% 0,00)</b></div>`;summary.insertBefore(board,summary.firstChild);}
    const finalize=document.getElementById('finalize');if(finalize){finalize.classList.add('v089-finalize');if(finalize.parentElement!==summary)summary.appendChild(finalize);}
    updateSummary();
  }

  function updateSummary(){
    const g=gross(),disc=itemDiscount()+saleDiscount(),net=total(),cb=cashback();
    const gp=document.getElementById('v089Gross'),np=document.getElementById('v089Net'),cp=document.getElementById('v089Cashback'),dp=document.getElementById('v089DiscountValue');
    if(gp)gp.textContent=br(g);if(np)np.textContent=br(net);if(cp)cp.textContent=`+ ${br(cb)} (% ${g?br(cb/g*100):'0,00'})`;if(dp)dp.textContent=`- ${br(disc)} (% ${g?br(disc/g*100):'0,00'})`;
    const finalize=document.getElementById('finalize');if(finalize)finalize.innerHTML=`▣ &nbsp; Concluir Venda (${br(net)}) <small>(F3)</small>`;
    updateActionBar();
  }

  function openActions(){
    if(document.querySelector('.modal'))return;
    const m=modal(`<div class="v089-menu-head"><div><small>THORPDV</small><h3>Ações da venda</h3></div><button id="v089MenuClose">×</button></div><div class="v089-menu-grid"><button data-act="cash"><i>▤</i><b>Caixa</b><small>Abrir, movimentar ou fechar</small></button><button data-act="fiscal"><i>▥</i><b>Fiscal</b><small>Vendas e NFC-e</small></button><button data-act="sync"><i>↻</i><b>Sincronizar</b><small>Atualizar dados do Gestão</small></button><button data-act="settings"><i>⚙</i><b>Configurações</b><small>Terminal e impressão</small></button><button data-act="drawer"><i>▱</i><b>Gaveta</b><small>Abrir gaveta do caixa</small></button><button data-act="operator"><i>●</i><b>Operador</b><small>Trocar usuário do caixa</small></button></div>`,'wide');
    m.classList.add('v089-actions-modal');m.querySelector('#v089MenuClose').onclick=()=>m.remove();
    const closeRun=(fn)=>()=>{m.remove();setTimeout(fn,20);};
    m.querySelector('[data-act="cash"]').onclick=closeRun(()=>openCashModal());
    m.querySelector('[data-act="fiscal"]').onclick=closeRun(()=>setView('fiscal'));
    m.querySelector('[data-act="settings"]').onclick=closeRun(()=>settingsModal());
    m.querySelector('[data-act="operator"]').onclick=closeRun(()=>document.getElementById('operatorBtn')?.click());
    m.querySelector('[data-act="drawer"]').onclick=closeRun(async()=>{try{await window.thor.openDrawer();showToast('Comando enviado para a gaveta.');}catch(e){infoModal('Gaveta',friendlyError(e?.message));}});
    m.querySelector('[data-act="sync"]').onclick=closeRun(async()=>{try{await window.thor.sync();await refreshStatus();await refreshProducts();await refreshFiscalSales();showToast('Sincronização concluída.');}catch(e){infoModal('Sincronização',friendlyError(e?.message));}});
  }

  function discountAllowed(){try{return typeof p41Allowed==='function'?p41Allowed('discount.apply',true):Boolean(v3Perm('discount.apply',true));}catch{return true;}}
  function overrideAllowed(){try{return typeof p41Allowed==='function'?p41Allowed('discount.override_limit',false):Boolean(v3Perm('discount.override_limit',false));}catch{return false;}}

  function openDiscount(){
    if(!state.cart.length)return infoModal('Desconto','Inclua pelo menos um item antes de aplicar desconto.');
    if(!discountAllowed())return infoModal('Desconto','O perfil deste operador não possui permissão para aplicar desconto.');
    const v=vstate(),base=Math.max(gross()-itemDiscount(),0),current=Math.max(num(v.discount),0),surch=surcharge();
    const m=modal(`<div class="v089-discount-head"><h3>Desconto no subtotal da operação</h3><button id="v089DiscountClose">×</button></div><div class="v089-discount-body"><label>Cupom<div class="v089-coupon"><input id="v089Coupon" placeholder="Cupom de Desconto..."><button id="v089CouponApply">Aplicar</button></div></label><label>SubTotal<input value="${br(base)}" readonly></label><label>Percentual de Desconto<input id="v089DiscountPct" inputmode="decimal" value="${br(base?current/base*100:0)}"></label><label>Valor de Desconto<input id="v089DiscountAmount" inputmode="decimal" value="${br(current)}"></label><label>Total<input id="v089DiscountTotal" value="${br(Math.max(base-current+surch,0))}" readonly></label></div><div class="v089-discount-foot"><button id="v089ApplyDiscount">Aplicar Desconto</button></div>`);
    m.classList.add('v089-discount-modal');const pct=m.querySelector('#v089DiscountPct'),amount=m.querySelector('#v089DiscountAmount'),preview=m.querySelector('#v089DiscountTotal');
    const parse=(x)=>num(String(x||'').replace(/\./g,'').replace(',','.'));
    const syncFromPct=()=>{const p=Math.min(Math.max(parse(pct.value),0),100),a=Math.min(base*p/100,base);amount.value=br(a);preview.value=br(Math.max(base-a+surch,0));};
    const syncFromAmount=()=>{const a=Math.min(Math.max(parse(amount.value),0),base);pct.value=br(base?a/base*100:0);preview.value=br(Math.max(base-a+surch,0));};
    pct.oninput=syncFromPct;amount.oninput=syncFromAmount;m.querySelector('#v089DiscountClose').onclick=()=>m.remove();
    m.querySelector('#v089CouponApply').onclick=()=>infoModal('Cupom','A aplicação automática de cupons ainda não está configurada neste terminal. O desconto manual continua disponível.');
    m.querySelector('#v089ApplyDiscount').onclick=async()=>{const proposed=Math.min(Math.max(parse(amount.value),0),base),percentage=base?proposed/base*100:0,limit=Math.max(num(v.operator?.permissions?.discount?.max_percent),0);try{let auth=null;if(proposed>0&&percentage>limit+.0001&&!overrideAllowed())auth=await v3NeedSupervisor('discount',percentage,`Desconto de ${percentage.toFixed(2)}% acima da alçada de ${limit.toFixed(2)}%`);v.discount=proposed;v.supervisorAuthorization=auth;m.remove();await v3Reprice();updateSummary();showToast(proposed?'Desconto aplicado.':'Desconto removido.');}catch(e){if(e?.message!=='authorization_cancelled')infoModal('Desconto',friendlyError(e?.message));}};
    setTimeout(()=>{pct.focus();pct.select();},30);
  }

  function openSurcharge(){
    if(!state.cart.length)return infoModal('Acréscimo','Inclua pelo menos um item antes de aplicar acréscimo.');
    const v=vstate(),base=Math.max(gross()-itemDiscount()-saleDiscount(),0),current=Math.max(num(v.surcharge),0);
    const m=modal(`<div class="v089-discount-head"><h3>Acréscimo no subtotal da operação</h3><button id="v089SurchargeClose">×</button></div><div class="v089-discount-body"><label>SubTotal<input value="${br(base)}" readonly></label><label>Percentual de Acréscimo<input id="v089SurchargePct" inputmode="decimal" value="${br(base?current/base*100:0)}"></label><label>Valor de Acréscimo<input id="v089SurchargeAmount" inputmode="decimal" value="${br(current)}"></label><label>Total<input id="v089SurchargeTotal" value="${br(base+current)}" readonly></label></div><div class="v089-discount-foot"><button id="v089ApplySurcharge">Aplicar Acréscimo</button></div>`);m.classList.add('v089-discount-modal');
    const pct=m.querySelector('#v089SurchargePct'),amount=m.querySelector('#v089SurchargeAmount'),preview=m.querySelector('#v089SurchargeTotal');const parse=(x)=>num(String(x||'').replace(/\./g,'').replace(',','.'));
    pct.oninput=()=>{const p=Math.max(parse(pct.value),0),a=base*p/100;amount.value=br(a);preview.value=br(base+a);};amount.oninput=()=>{const a=Math.max(parse(amount.value),0);pct.value=br(base?a/base*100:0);preview.value=br(base+a);};m.querySelector('#v089SurchargeClose').onclick=()=>m.remove();m.querySelector('#v089ApplySurcharge').onclick=async()=>{v.surcharge=Math.max(parse(amount.value),0);v.supervisorAuthorization=null;m.remove();await v3Reprice();updateSummary();showToast(v.surcharge?'Acréscimo aplicado.':'Acréscimo removido.');};setTimeout(()=>{pct.focus();pct.select();},30);
  }

  function methodIcon(code){return ({cash:'$',credit_card:'▰',debit_card:'▰',pix:'◆',boleto:'▧',store_credit:'▣',voucher:'▣',cashback:'⌁',installment:'▤',parcelamento:'▤',other:'•••'})[code]||'▰';}

  function patchPayment(){
    if(paymentPatched||typeof v3PaymentModal!=='function')return;paymentPatched=true;
    const old=v3PaymentModal;window.v089OriginalPaymentModal=old;
    v3PaymentModal=function(method){const result=old(method);queueMicrotask(decoratePayment);return result;};
  }

  function decoratePayment(){
    const modals=[...document.querySelectorAll('.modal')];const overlay=modals.reverse().find(m=>m.querySelector('.payment-head'));if(!overlay||overlay.dataset.v089Ready==='1')return;overlay.dataset.v089Ready='1';overlay.classList.add('v089-payment-modal');const card=overlay.querySelector('.modal-card');if(!card)return;card.classList.add('v089-payment-card');
    const head=card.querySelector('.payment-head');if(head){head.innerHTML='<h3>Finalização</h3><button id="v089PayClose">×</button>';head.querySelector('#v089PayClose').onclick=()=>overlay.remove();}
    const top=document.createElement('div');top.className='v089-payment-top';top.innerHTML='<div class="v089-pay-search">Pesquise... <span>⌄</span></div><button>Modelo PDV</button><button>Operação presencial</button>';head?.after(top);
    const entry=card.querySelector('.payment-entry'),list=card.querySelector('#payList'),footer=card.querySelector('.payment-footer');if(!entry||!footer)return;
    const layout=document.createElement('div');layout.className='v089-payment-layout';const left=document.createElement('section');left.className='v089-payment-left';const right=document.createElement('aside');right.className='v089-payment-right';entry.parentElement.insertBefore(layout,entry);layout.append(left,right);left.append(entry);if(list)left.insertBefore(list,entry);
    const grid=entry.querySelector('.payment-method-grid');if(grid){grid.classList.add('v089-pay-methods');grid.querySelectorAll('[data-method]').forEach(b=>{const code=b.dataset.method,label=b.textContent.trim();b.innerHTML=`<i>${methodIcon(code)}</i><span>${esc(label)}</span>`;});}
    const amount=entry.querySelector('#payAmount');const amountField=amount?.closest('.field');if(amountField){amountField.classList.add('v089-pay-amount');amountField.querySelector('label').textContent='';}
    const customer=document.createElement('div');customer.className='v089-payment-customer';const v=vstate();customer.innerHTML=`<label>Cliente</label><div><button id="v089PayCustomer"><span>${esc(v.customerName||'Consultar pessoa...')}</span></button><button id="v089PayAddCustomer">＋</button><button id="v089PaySearchCustomer">⌕</button></div>`;left.append(customer);
    const openCustomer=()=>{overlay.remove();setTimeout(()=>document.getElementById('v47ConsumerAction')?.click(),20);};customer.querySelector('#v089PayCustomer').onclick=openCustomer;customer.querySelector('#v089PayAddCustomer').onclick=openCustomer;customer.querySelector('#v089PaySearchCustomer').onclick=openCustomer;
    const add=entry.querySelector('#addPayment');if(add){add.textContent='Adicionar';add.classList.add('v089-add-payment');}
    const integrated=entry.querySelector('#integratedPay');if(integrated)integrated.classList.add('v089-integrated');
    right.innerHTML=`<div class="v089-pay-kpis"><article class="purple"><small>Total</small><b id="v089PayTotal">${br(total())}</b><i>$</i></article><article class="green"><small>Saldo</small><b id="v089PayBalance">${br(typeof v3Remaining==='function'?v3Remaining():total())}</b><i>＋</i></article></div><div class="v089-pay-lines"><span>Desconto <b class="cyan">${br(itemDiscount()+saleDiscount())}</b></span><span>Cashback <b class="green">${br(cashback())}</b></span><span>Acréscimo <b class="orange">${br(surcharge())}</b></span></div>`;
    right.append(footer);footer.classList.add('v089-payment-footer');
    const originalRefresh=new MutationObserver(()=>{const t=right.querySelector('#v089PayTotal'),bal=right.querySelector('#v089PayBalance');if(t)t.textContent=br(total());if(bal)bal.textContent=br(typeof v3Remaining==='function'?v3Remaining():total());});originalRefresh.observe(entry,{childList:true,subtree:true,characterData:true,attributes:true});
  }

  function rebuildGate(){
    const gate=document.getElementById('thorOperatorGate');
    const card=gate?.querySelector('.v088-gate-card');
    const login=card?.querySelector('.v088-gate-login');
    if(!gate||!card||!login)return;
    gate.classList.add('v089-gate');
    card.classList.add('v089-gate-card','v089-login-only');
    login.classList.add('v089-gate-login');
    card.querySelector('.v088-gate-config')?.remove();
    if(card.dataset.v089Ready==='1')return;
    card.dataset.v089Ready='1';
    login.querySelector('.operator-gate-terminal')?.remove();
    login.querySelector('.operator-gate-foot')?.remove();
    if(!login.querySelector('.v089-thor-hero')){
      const hero=document.createElement('div');
      hero.className='v089-thor-hero';
      hero.setAttribute('aria-hidden','true');
      hero.innerHTML=`<span class="v089-thor-orbit"></span><span class="v089-thor-bolt bolt-a"></span><span class="v089-thor-bolt bolt-b"></span><svg class="v089-thor-hammer" viewBox="0 0 180 180"><defs><linearGradient id="v089HammerMetal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fbff"/><stop offset=".45" stop-color="#b9c6d8"/><stop offset="1" stop-color="#75849b"/></linearGradient><linearGradient id="v089HammerGrip" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6e3bd0"/><stop offset="1" stop-color="#32156f"/></linearGradient><filter id="v089HammerGlow"><feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#5b2bc2" flood-opacity=".38"/></filter></defs><g filter="url(#v089HammerGlow)" transform="rotate(-14 90 90)"><rect x="75" y="72" width="30" height="78" rx="10" fill="url(#v089HammerGrip)"/><path d="M80 82h20M79 96h22M78 110h24M77 124h26" stroke="#b99af0" stroke-width="4" stroke-linecap="round"/><path d="M43 38h94l13 17-13 34H43L30 55z" fill="url(#v089HammerMetal)" stroke="#fff" stroke-width="4"/><path d="M43 38v51M137 38v51" stroke="#8796aa" stroke-width="4"/><path d="M58 51h64" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/><circle cx="90" cy="151" r="8" fill="#25d4f0"/></g></svg><span class="v089-thor-shadow"></span>`;
      login.insertBefore(hero,login.firstChild);
    }
  }

  function apply(){
    patchPayment();
    if(state.status?.enrolled){ensureHeader();if(state.view==='sale'){ensureActionBar();ensureLayout();updateSummary();}else document.body.classList.add('thor-v089');}
    rebuildGate();
    document.querySelectorAll('.modal').forEach(m=>{if(m.querySelector('.payment-head'))decoratePayment();});
  }

  document.addEventListener('keydown',(e)=>{
    if(state.capturingShortcut||document.getElementById('thorOperatorGate')||document.querySelector('.modal'))return;
    const key=String(e.key||'').toUpperCase();if(state.view!=='sale')return;
    if(key==='F2'){e.preventDefault();e.stopImmediatePropagation();openActions();}
    else if(key==='F3'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('finalize')?.click();}
    else if(key==='F4'){e.preventDefault();e.stopImmediatePropagation();settingsModal();}
    else if(key==='F5'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('paymentsButton')?.click();}
    else if(key==='F6'){e.preventDefault();e.stopImmediatePropagation();openDiscount();}
    else if(key==='F7'){e.preventDefault();e.stopImmediatePropagation();openSurcharge();}
  },true);

  const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});schedule();
})();

;

/* ---- redesign-v089-fixes.js ---- */
(function(){
  let queued=false;
  function apply(){
    queued=false;
    const grid=document.querySelector('.v089-actions-modal .v089-menu-grid');
    if(!grid||grid.dataset.v089Extras==='1')return;
    grid.dataset.v089Extras='1';
    const scale=document.createElement('button');
    scale.type='button';scale.dataset.act='scale';scale.innerHTML='<i>⚖</i><b>Balança</b><small>Ler peso do item atual</small>';
    scale.onclick=()=>{const modal=grid.closest('.modal');modal?.remove();setTimeout(()=>document.getElementById('scaleRead')?.click(),20);};
    const clear=document.createElement('button');
    clear.type='button';clear.dataset.act='clear';clear.innerHTML='<i>×</i><b>Limpar venda</b><small>Remover todos os itens do cupom</small>';
    clear.onclick=()=>{const modal=grid.closest('.modal');modal?.remove();setTimeout(()=>document.getElementById('clear')?.click(),20);};
    grid.append(scale,clear);
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();

;

/* ---- redesign-v090.js ---- */
(function(){
  const KEY='thor.pdv.productView.v090';
  let scheduled=false;
  let viewMode='grid';
  try{viewMode=localStorage.getItem(KEY)==='list'?'list':'grid';}catch{}

  const n=(v)=>{const x=Number(v||0);return Number.isFinite(x)?x:0;};
  const br=(v)=>n(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const imageOf=(p)=>p?.image_url||p?.imageUrl||p?.menu_image_url||p?.menuImageUrl||p?.thumbnail_url||p?.thumbnailUrl||'';
  const bucket=(sale)=>{
    const saleStatus=String(sale?.status||'');
    const fiscalStatus=String(sale?.fiscal?.status||'');
    if(saleStatus==='cancelled'||saleStatus==='cancel_pending'||fiscalStatus==='cancelled')return 'cancelled';
    if(fiscalStatus==='authorized'||(!fiscalStatus&&saleStatus==='completed'))return 'authorized';
    if(fiscalStatus==='rejected'||fiscalStatus==='transmission_error')return 'rejected';
    return 'pending';
  };

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;try{apply();}catch(error){console.warn('v090_apply_failed',error);}});
  }

  function apply(){
    const fiscal=Boolean(document.querySelector('.fiscal-workspace'));
    document.body.classList.toggle('thor-v090-fiscal',fiscal);
    document.body.classList.toggle('thor-v090-sale',!fiscal&&state?.view==='sale');
    if(fiscal)enhanceFiscal();
    else if(state?.view==='sale'){
      ensureViewSelector();
      decorateProducts();
      fixCheckoutGeometry();
    }
    enhanceActionsMenu();
    enhancePaymentDrawer();
  }

  function ensureViewSelector(){
    const crumb=document.querySelector('.v089-breadcrumb');
    const products=document.getElementById('products');
    if(!crumb||!products)return;
    let controls=crumb.querySelector('.v090-view-switch');
    if(!controls){
      controls=document.createElement('div');
      controls.className='v090-view-switch';
      controls.innerHTML='<span>Exibição</span><button type="button" data-view="grid" title="Exibir produtos em grade">▦ <b>Grade</b></button><button type="button" data-view="list" title="Exibir produtos em lista">☷ <b>Lista</b></button>';
      const cloud=crumb.querySelector('em');
      crumb.insertBefore(controls,cloud||null);
      controls.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{
        viewMode=button.dataset.view==='list'?'list':'grid';
        try{localStorage.setItem(KEY,viewMode);}catch{}
        updateViewMode();
      });
    }
    updateViewMode();
  }

  function updateViewMode(){
    const products=document.getElementById('products');
    if(!products)return;
    products.classList.toggle('v090-product-list',viewMode==='list');
    products.classList.toggle('v090-product-grid',viewMode!=='list');
    document.querySelectorAll('.v090-view-switch [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===viewMode));
  }

  function decorateProducts(){
    const box=document.getElementById('products');
    if(!box)return;
    const rows=Array.isArray(state?.products)?state.products:[];
    box.querySelectorAll('.v088-product-card').forEach((card,index)=>{
      const product=rows[index];
      if(!product)return;
      const media=card.querySelector('.v088-product-media');
      const copy=card.querySelector('.v088-product-copy');
      if(!media||!copy)return;
      const src=imageOf(product);
      card.classList.toggle('v090-no-photo',!src);
      card.dataset.image=src||'';

      if(src){
        media.classList.remove('no-image');
        media.querySelector('.v090-product-fallback')?.remove();
        media.querySelector(':scope > span')?.remove();
        let img=media.querySelector(':scope > img');
        if(!img){img=document.createElement('img');img.alt='';img.loading='lazy';media.insertBefore(img,media.firstChild);}
        if(img.getAttribute('src')!==src)img.setAttribute('src',src);
        img.onerror=()=>{card.classList.add('v090-no-photo');media.classList.add('no-image');img?.remove();ensureFallback(card,media,product);};
      }else{
        media.classList.add('no-image');
        media.querySelector(':scope > img')?.remove();
        ensureFallback(card,media,product);
      }

      let code=copy.querySelector('.v090-product-code');
      if(!code){code=document.createElement('span');code.className='v090-product-code';copy.insertBefore(code,copy.querySelector('.v089-pricing')||null);}
      code.textContent=`Cód. ${product.product_code||product.sku||'—'} • Estoque ${n(product.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}`;
    });
    updateViewMode();
  }

  function ensureFallback(card,media,product){
    let fallback=media.querySelector('.v090-product-fallback');
    if(!fallback){fallback=document.createElement('div');fallback.className='v090-product-fallback';media.insertBefore(fallback,media.querySelector('.v089-badges')||null);}
    fallback.innerHTML=`<strong>${esc(product.name||'Produto')}</strong><b>R$ ${br(product.base_price??product.sale_price)}</b><small>Sem foto cadastrada</small>`;
  }

  function fixCheckoutGeometry(){
    const right=document.querySelector('.v089-right');
    const summary=document.querySelector('.v089-summary');
    const finalize=document.getElementById('finalize');
    if(right)right.classList.add('v090-right');
    if(summary)summary.classList.add('v090-summary');
    if(finalize)finalize.classList.add('v090-finalize');
  }

  function enhanceActionsMenu(){
    document.querySelectorAll('.v089-actions-modal').forEach(wrap=>{
      if(wrap.dataset.v090Ready==='1')return;
      const grid=wrap.querySelector('.v089-menu-grid');
      if(!grid)return;
      wrap.dataset.v090Ready='1';
      const supply=document.createElement('button');
      supply.dataset.v090Movement='supply';
      supply.innerHTML='<i>＋</i><b>Suprimento</b><small>Entrada de dinheiro no caixa</small>';
      const withdrawal=document.createElement('button');
      withdrawal.dataset.v090Movement='withdrawal';
      withdrawal.innerHTML='<i>−</i><b>Sangria</b><small>Retirada de dinheiro do caixa</small>';
      grid.insertBefore(supply,grid.children[1]||null);
      grid.insertBefore(withdrawal,grid.children[2]||null);
      supply.onclick=()=>{wrap.remove();setTimeout(()=>openMovement('supply'),20);};
      withdrawal.onclick=()=>{wrap.remove();setTimeout(()=>openMovement('withdrawal'),20);};
    });
  }

  function openMovement(type){
    const supply=type==='supply';
    if(!state.status?.cashOpenEventId){
      infoModal(supply?'Suprimento':'Sangria','O caixa precisa estar aberto antes desta movimentação. Abra o caixa e tente novamente.');
      return;
    }
    const title=supply?'Suprimento':'Sangria';
    const m=modal(`<div class="v090-movement-head"><span>${supply?'＋':'−'}</span><div><small>CAIXA</small><h3>${title}</h3><p>${supply?'Registre uma entrada de dinheiro que não seja venda.':'Registre uma retirada de dinheiro do caixa.'}</p></div></div><div class="field"><label>Valor</label><input id="v090MovementValue" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00"></div><div class="field"><label>Observação</label><input id="v090MovementNote" maxlength="160" placeholder="Motivo / referência (opcional)"></div><div id="v090MovementError" class="settings-error"></div><div class="actions"><button class="secondary" id="v090MovementCancel">Cancelar</button><button class="primary ${supply?'':'danger'}" id="v090MovementSave">Registrar ${title}</button></div>`);
    m.classList.add('v090-movement-modal');
    const input=m.querySelector('#v090MovementValue');
    m.querySelector('#v090MovementCancel').onclick=()=>m.remove();
    m.querySelector('#v090MovementSave').onclick=async()=>{
      const amount=n(input.value);
      const button=m.querySelector('#v090MovementSave');
      const error=m.querySelector('#v090MovementError');
      if(amount<=0){error.textContent='Informe um valor maior que zero.';input.focus();return;}
      try{
        button.disabled=true;button.textContent='Registrando...';
        let supervisorAuthorization=null;
        if(type==='withdrawal'&&amount>=500)supervisorAuthorization=await window.requestSupervisorAuthorizationV120('high_withdrawal','Autorizar sangria elevada',amount);
        const reason=m.querySelector('#v090MovementNote').value.trim();
        const operator=(()=>{try{return v3State()?.operator||state?.status?.operator||null}catch{return state?.status?.operator||null}})()||{};
        const result=await window.thor.cashMovement({movementType:type,amount,notes:reason,reason,operatorId:operator.id||null,operatorName:operator.name||operator.full_name||operator.display_name||operator.user_name||operator.email||'',supervisorAuthorization});
        let printError='';
        try{await window.thor.printCashMovement(result?.receipt||{});}catch(error){printError=friendlyError(error?.message||'print_failed');}
        await refreshStatus();
        m.remove();
        showToast(printError?`${title} registrado. Impressão pendente: ${printError}`:`${title} de ${money(amount)} registrado e comprovante impresso.`);
      }catch(err){error.textContent=friendlyError(err?.message||String(err));button.disabled=false;button.textContent=`Registrar ${title}`;}
    };
    setTimeout(()=>input?.focus(),30);
  }

  function fiscalStats(){
    const rows=Array.isArray(state?.fiscalSales)?state.fiscalSales:[];
    const result={total:rows.length,authorized:0,pending:0,rejected:0,cancelled:0,amount:0};
    for(const sale of rows){
      const kind=bucket(sale);result[kind]=(result[kind]||0)+1;
      if(kind==='pending')result.pending+=0;
      if(kind==='rejected')result.pending+=1;
      if(kind==='authorized')result.amount+=n(sale.total);
    }
    return result;
  }

  function enhanceFiscal(){
    const fiscal=document.querySelector('.fiscal-workspace');
    const head=fiscal?.querySelector('.fiscal-head');
    if(!fiscal||!head)return;
    fiscal.classList.add('v090-fiscal');
    head.classList.add('v090-fiscal-head');

    let navigation=fiscal.querySelector('.v090-fiscal-nav');
    if(!navigation){
      navigation=document.createElement('div');navigation.className='v090-fiscal-nav';
      navigation.innerHTML='<button id="v090FiscalBack">← Venda</button><button id="v090FiscalSync">↻ Sincronizar</button><button id="v090FiscalToday">Hoje</button><button id="v090FiscalPending">Pendências</button><button id="v090FiscalLast">Última NFC-e</button><button id="v090FiscalDiagnostic">Diagnóstico</button>';
      head.insertAdjacentElement('afterend',navigation);
      navigation.querySelector('#v090FiscalBack').onclick=()=>setView('sale');
      navigation.querySelector('#v090FiscalSync').onclick=()=>document.getElementById('fiscalRefresh')?.click();
      navigation.querySelector('#v090FiscalToday').onclick=()=>document.getElementById('fiscalToday')?.click();
      navigation.querySelector('#v090FiscalPending').onclick=()=>{
        state.fiscalFilter.status='pending';const select=document.getElementById('fiscalStatusFilter');if(select)select.value='pending';renderFiscalTable();schedule();
      };
      navigation.querySelector('#v090FiscalLast').onclick=()=>{
        const sale=(state.fiscalSales||[]).find(row=>String(row?.fiscal?.status||'')==='authorized');
        if(!sale)return infoModal('Fiscal','Ainda não existe NFC-e autorizada no histórico local deste terminal.');
        Promise.resolve(openSaleDetail(sale)).catch(error=>infoModal('Fiscal',friendlyError(error?.message||String(error))));
      };
      navigation.querySelector('#v090FiscalDiagnostic').onclick=openFiscalDiagnostic;
    }

    let kpis=fiscal.querySelector('.v090-fiscal-kpis');
    if(!kpis){kpis=document.createElement('section');kpis.className='v090-fiscal-kpis';navigation.insertAdjacentElement('afterend',kpis);}
    const s=fiscalStats();
    kpis.innerHTML=`<article><span>Operações</span><b>${s.total}</b><small>histórico local</small></article><article class="ok"><span>Autorizadas</span><b>${s.authorized}</b><small>${money(s.amount)} faturado</small></article><article class="warn"><span>Pendências</span><b>${s.pending}</b><small>processar / conferir</small></article><article class="bad"><span>Rejeitadas</span><b>${s.rejected}</b><small>SEFAZ / transmissão</small></article><article><span>Canceladas</span><b>${s.cancelled}</b><small>venda / NFC-e</small></article>`;

    let notice=fiscal.querySelector('.v090-fiscal-notice');
    if(s.rejected>0){
      if(!notice){notice=document.createElement('div');notice.className='v090-fiscal-notice';kpis.insertAdjacentElement('afterend',notice);}
      notice.innerHTML=`<b>⚠ ${s.rejected} rejeição(ões) precisam de atenção.</b><span>Abra a operação em “Visualizar” para consultar cStat, xMotivo, tentativas e eventos da transmissão.</span>`;
    }else notice?.remove();

    fiscal.querySelector('.fiscal-toolbar')?.classList.add('v090-fiscal-toolbar');
    fiscal.querySelector('.fiscal-filter-chips')?.classList.add('v090-fiscal-chips');
    fiscal.querySelector('.fiscal-table-card')?.classList.add('v090-fiscal-table-card');
  }

  function openFiscalDiagnostic(){
    const readiness=state.status?.context?.fiscal_readiness||{};
    const queue=state.status?.queue||{};
    const values=[
      ['Terminal',state.status?.online?'Online':'Offline',state.status?.online?'ok':'warn'],
      ['Fila de sincronização',`${queue.pending||0} pendente(s)`,queue.rejected?'warn':'ok'],
      ['Eventos rejeitados',String(queue.rejected||0),queue.rejected?'bad':'ok'],
      ['Ambiente fiscal',String(readiness.environment||readiness.ambiente||state.status?.context?.fiscal_environment||'Configurado'),''],
      ['Certificado',readiness.certificate_ready===false?'Pendente':'Configurado',readiness.certificate_ready===false?'bad':'ok'],
      ['Última sincronização',state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado','']
    ];
    const m=modal(`<div class="v090-diagnostic-head"><small>THORFISCAL</small><h3>Diagnóstico fiscal do terminal</h3><p>Resumo operacional para identificar rapidamente problemas de comunicação ou configuração.</p></div><div class="v090-diagnostic-grid">${values.map(([label,value,status])=>`<article class="${status}"><span>${esc(label)}</span><b>${esc(value)}</b></article>`).join('')}</div><div class="actions"><button class="secondary" id="v090DiagSync">Sincronizar agora</button><button class="primary" id="v090DiagClose">Fechar</button></div>`,'wide');
    m.querySelector('#v090DiagClose').onclick=()=>m.remove();
    m.querySelector('#v090DiagSync').onclick=async()=>{m.remove();try{await window.thor.sync();await refreshStatus();await refreshFiscalSales();showToast('Diagnóstico atualizado após sincronização.');}catch(error){infoModal('Sincronização',friendlyError(error?.message||String(error)));}};
  }

  function enhancePaymentDrawer(){
    document.querySelectorAll('.v089-payment-card').forEach(card=>card.classList.add('v090-payment-card'));
    document.querySelectorAll('.v089-payment-footer').forEach(footer=>footer.classList.add('v090-payment-footer'));
  }

  document.addEventListener('keydown',event=>{
    if(document.querySelector('.modal'))return;
    if(state?.view==='fiscal'&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setView('sale');}
  },true);

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();

;

/* ---- redesign-v092.js ---- */
(function(){
  let queued=false;
  function apply(){
    queued=false;
    document.querySelectorAll('.v089-badges .out').forEach(badge=>{
      if(badge.textContent?.trim()!=='SEM ESTOQUE') badge.textContent='SEM ESTOQUE';
      badge.setAttribute('title','Produto sem estoque disponível');
      badge.setAttribute('aria-label','Sem estoque');
    });
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  schedule();
})();

;

/* ---- redesign-v093.js ---- */
(function(){
  let queued=false;
  const num=v=>{const n=Number(v||0);return Number.isFinite(n)?n:0;};
  const br=v=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function apply(){
    queued=false;
    const box=document.getElementById('products');
    if(!box)return;
    const listMode=box.classList.contains('v090-product-list');
    const products=Array.isArray(state?.products)?state.products:[];
    box.querySelectorAll('.v089-product-card').forEach((card,index)=>{
      const product=products[index];
      if(!product)return;
      const noPhoto=card.classList.contains('v090-no-photo') || !String(product.image_url||product.imageUrl||product.menu_image_url||product.menuImageUrl||product.thumbnail_url||product.thumbnailUrl||'').trim();
      card.classList.toggle('v093-grid-no-photo',noPhoto&&!listMode);
      if(!noPhoto)return;
      const media=card.querySelector('.v088-product-media');
      if(!media)return;

      // Remove qualquer placeholder legado (inclusive unidade renderizada em tamanho de ícone).
      [...media.children].forEach(child=>{
        if(child.classList?.contains('v089-badges'))return;
        if(child.classList?.contains('v093-no-photo-content'))return;
        child.remove();
      });

      let content=media.querySelector('.v093-no-photo-content');
      if(!content){content=document.createElement('div');content.className='v093-no-photo-content';media.appendChild(content);}
      const price=num(product.base_price??product.sale_price);
      const unit=String(product.unit||'UN').trim().toUpperCase()||'UN';
      content.innerHTML=`<strong>${html(product.name||'Produto')}</strong><b>R$ ${br(price)}</b><small>${html(unit)}</small>`;
    });
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  schedule();
})();

;

/* ---- redesign-v098.js ---- */
(()=>{
  const svg={
    cash:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M17 14h.01M9.5 12h5"/></svg>',
    pix:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 17 8 12 13 7 8 12 3Z"/><path d="m12 11 5 5-5 5-5-5 5-5Z"/></svg>',
    debit_card:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
    credit_card:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M15 14h3"/></svg>',
    voucher:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    benefit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    beneficio:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1Z"/><path d="M9 8h6M9 12h6"/></svg>',
    store_credit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v10H5z"/><path d="M8 10h8M8 14h4"/></svg>',
    cashback:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a7 7 0 1 1-1 7"/><path d="M4 4v5h5"/><path d="M12 8v8M9.5 10.5c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.5-2.5 1.5-2.5.5-2.5 1.5S10.5 15 12 15s2.5-.5 2.5-1.5"/></svg>',
    boleto:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M8 4v16M12 4v16M15 4v16M19 4v16"/></svg>',
    installment:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    parcelamento:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    term:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    on_account:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12v14H6z"/><path d="M9 9h6M9 13h6"/><circle cx="16.5" cy="16.5" r="3.5"/></svg>',
    other:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>',
    others:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>'
  };
  const fallback=svg.other;
  const processed=new WeakSet();

  function applyCheckoutFix(){
    const overlays=[...document.querySelectorAll('.modal')].filter(m=>m.querySelector('.payment-head'));
    const overlay=overlays.at(-1);
    if(!overlay)return;
    const card=overlay.querySelector('.modal-card');
    if(!card)return;

    overlay.classList.add('v089-payment-modal');
    card.classList.add('v089-payment-card','v090-payment-card');

    if(!processed.has(card)){
      processed.add(card);
      card.querySelectorAll('.v089-pay-methods [data-method]').forEach(button=>{
        const code=String(button.dataset.method||'').trim();
        const icon=button.querySelector('i');
        if(icon)icon.innerHTML=svg[code]||fallback;
      });
    }
  }

  function scheduleFix(){
    requestAnimationFrame(applyCheckoutFix);
    setTimeout(applyCheckoutFix,0);
    setTimeout(applyCheckoutFix,80);
    setTimeout(applyCheckoutFix,220);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      const result=previous.apply(this,args);
      scheduleFix();
      return result;
    };
  }

  window.addEventListener('resize',()=>{
    const modal=document.querySelector('.modal.v089-payment-modal');
    if(modal)requestAnimationFrame(applyCheckoutFix);
  },{passive:true});
})();

;

/* ---- redesign-v099.js ---- */
(()=>{
  let patched=false;

  function decorateCheckout(){
    const overlays=[...document.querySelectorAll('.modal')].filter(m=>m.querySelector('.payment-head'));
    const overlay=overlays.at(-1);
    if(!overlay)return false;
    const card=overlay.querySelector('.modal-card');
    if(!card)return false;

    overlay.classList.add('v099-checkout');
    card.classList.add('v099-checkout-card');

    const top=card.querySelector('.v089-payment-top');
    const customer=card.querySelector('.v089-payment-customer');
    if(top&&customer&&top.dataset.v099Ready!=='1'){
      top.dataset.v099Ready='1';
      top.replaceChildren(customer);
      customer.classList.add('v099-customer-top');
      const label=customer.querySelector(':scope > label');
      if(label)label.textContent='Cliente';
    }

    const right=card.querySelector('.v089-payment-right');
    const kpis=right?.querySelector('.v089-pay-kpis');
    const lines=right?.querySelector('.v089-pay-lines');
    if(right&&kpis&&lines){
      right.classList.add('v099-payment-summary');
      kpis.classList.add('v099-main-kpis');
      lines.classList.add('v099-adjustment-kpis');
      [...lines.querySelectorAll(':scope > span')].forEach(row=>{
        const txt=(row.textContent||'').trim().toLowerCase();
        row.classList.toggle('discount',txt.startsWith('desconto'));
        row.classList.toggle('cashback',txt.startsWith('cashback'));
        row.classList.toggle('surcharge',txt.startsWith('acréscimo')||txt.startsWith('acrescimo'));
      });
    }

    const footer=card.querySelector('.v089-payment-footer,.v090-payment-footer,.payment-footer');
    if(footer){
      footer.classList.add('v099-payment-footer');
      const back=footer.querySelector('#payBack');
      if(back)back.remove();
      const actions=footer.querySelector('.actions');
      if(actions)actions.classList.add('v099-finish-actions');
      const finish=footer.querySelector('#finishCheckout');
      if(finish){
        finish.classList.add('v099-finish-checkout');
        finish.textContent='Concluir Venda';
      }
    }
    return true;
  }

  function schedule(){
    if(patched)return;
    let tries=0;
    const tick=()=>{
      tries++;
      if(decorateCheckout()){patched=true;return;}
      if(tries<8)setTimeout(tick,45);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      patched=false;
      const result=previous.apply(this,args);
      schedule();
      return result;
    };
  }
})();

;

/* ---- redesign-v100.js ---- */
(()=>{
  let currentOverlay=null;

  const shortcutValue=(method)=>{
    try{return String(state?.settings?.shortcuts?.[method]||'').trim().toUpperCase();}catch{return '';}
  };

  const normalize=(e)=>{
    try{if(typeof normalizeKey==='function')return String(normalizeKey(e)||'').toUpperCase();}catch{}
    return String(e?.key||'').toUpperCase();
  };

  function decorateShortcuts(){
    const overlays=[...document.querySelectorAll('.modal')].filter(m=>m.querySelector('.payment-head'));
    const overlay=overlays.at(-1);
    if(!overlay)return false;
    currentOverlay=overlay;
    overlay.classList.add('v100-checkout');

    overlay.querySelectorAll('.v089-pay-methods [data-method]').forEach(button=>{
      const method=String(button.dataset.method||'').trim();
      const shortcut=shortcutValue(method);
      let kbd=button.querySelector('.v100-method-shortcut');
      if(!kbd){
        kbd=document.createElement('kbd');
        kbd.className='v100-method-shortcut';
        button.appendChild(kbd);
      }
      kbd.textContent=shortcut||'';
      kbd.hidden=!shortcut;
      if(shortcut)button.title=`Atalho: ${shortcut}`;
    });
    return true;
  }

  function schedule(){
    let tries=0;
    const tick=()=>{
      tries++;
      if(decorateShortcuts())return;
      if(tries<10)setTimeout(tick,40);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      const result=previous.apply(this,args);
      schedule();
      return result;
    };
  }

  // Captura no window antes do listener legado do document. Assim, dentro do
  // checkout, o atalho troca a forma de pagamento em vez de abrir outro modal.
  window.addEventListener('keydown',(e)=>{
    const overlay=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('.payment-head'));
    if(!overlay)return;
    const key=normalize(e);
    if(!key)return;

    const target=e.target;
    const typing=target&&/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName||'');
    if(typing&&!/^F\d{1,2}$/.test(key))return;

    const buttons=[...overlay.querySelectorAll('.v089-pay-methods [data-method]')];
    const match=buttons.find(button=>shortcutValue(String(button.dataset.method||''))===key);
    if(!match)return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    match.click();
    match.focus({preventScroll:true});
  },true);

  window.addEventListener('resize',()=>{if(currentOverlay?.isConnected)requestAnimationFrame(decorateShortcuts);},{passive:true});
})();

;

/* ---- redesign-v101.js ---- */
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

;

/* ---- term-finalize-v102.js ---- */
(()=>{
  const n=(value)=>{const x=Number(value||0);return Number.isFinite(x)?x:0;};
  const commercial=()=>{const v=v3State();if(!v.commercialV070)v.commercialV070={salesOrderId:null,salesOrderNumber:null,orderPriceLock:false,term:null,preferredPaymentMethod:null};return v.commercialV070;};

  function findCheckout(){
    const overlay=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('.payment-head'));
    if(!overlay)return null;
    const card=overlay.querySelector('.modal-card');
    const finish=card?.querySelector('#finishCheckout');
    if(!card||!finish)return null;
    return {overlay,card,finish};
  }

  function showError(ctx,text){
    let err=ctx.card.querySelector('#payError');
    if(!err){
      err=document.createElement('div');
      err.id='payError';
      err.className='settings-error v102-visible-error';
      ctx.card.querySelector('.payment-entry')?.appendChild(err);
    }
    err.classList.add('v102-visible-error');
    err.hidden=false;
    err.style.setProperty('display','block','important');
    err.style.setProperty('visibility','visible','important');
    err.textContent=text||'';
  }

  function commitPanelIfNeeded(ctx){
    const panel=ctx.card.querySelector('.v101-term-panel:not([hidden])');
    if(!panel)return commercial().term;
    const count=panel.querySelector('#v101TermCount');
    const confirm=panel.querySelector('#v101TermConfirm');
    const selected=Math.trunc(n(count?.value));
    const current=Math.trunc(n(commercial().term?.installments));
    if(selected>0&&confirm&&(!commercial().term||selected!==current||!confirm.disabled)){
      confirm.click();
    }
    return commercial().term;
  }

  function bind(){
    const ctx=findCheckout();
    if(!ctx||ctx.finish.dataset.v102Bound==='1')return false;
    ctx.finish.dataset.v102Bound='1';
    ctx.overlay.classList.add('v102-checkout');

    ctx.finish.addEventListener('click',async(event)=>{
      const remaining=Math.max(n(v3Remaining()),0);
      const panel=ctx.card.querySelector('.v101-term-panel:not([hidden])');
      let term=commercial().term;

      // Checkout à vista continua usando o fluxo legado sem interferência.
      if(!panel&&!term)return;
      if(remaining<=0.01&&!term)return;

      term=commitPanelIfNeeded(ctx);
      if(!term){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'Selecione a quantidade de parcelas e confirme a Venda a Prazo antes de concluir.');
        return;
      }

      const v=v3State();
      if(!v.customerId){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'Venda a Prazo exige um cliente cadastrado no ThorGestão.');
        return;
      }
      if(remaining<=0.01){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showError(ctx,'A venda já está integralmente paga. Remova um pagamento à vista para financiar o saldo.');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showError(ctx,'');

      const originalText=ctx.finish.textContent;
      ctx.finish.disabled=true;
      ctx.finish.textContent='Concluindo Venda a Prazo...';
      try{
        // A partir daqui o wrapper commercial-v070 leva a condição para o agente.
        ctx.overlay.remove();
        await v3CompleteCheckout();
      }catch(error){
        // v3CompleteCheckout normalmente já trata e exibe o erro, mas este fallback
        // impede novamente a sensação de clique sem resposta.
        try{infoModal('Finalização',friendlyError(error?.message));}catch{}
      }finally{
        if(ctx.finish.isConnected){
          ctx.finish.disabled=false;
          ctx.finish.textContent=originalText||'Concluir Venda';
        }
      }
    },true);
    return true;
  }

  function schedule(){
    let tries=0;
    const tick=()=>{
      tries++;
      if(bind())return;
      if(tries<20)setTimeout(tick,50);
    };
    requestAnimationFrame(tick);
  }

  if(typeof window.v3PaymentModal==='function'){
    const previous=window.v3PaymentModal;
    window.v3PaymentModal=function(...args){
      const result=previous.apply(this,args);
      schedule();
      // sales-settlement-v073 tornou o modal assíncrono; também ligamos depois
      // da Promise para eliminar a corrida entre renderização e handlers.
      Promise.resolve(result).then(()=>schedule(),()=>schedule());
      return result;
    };
  }

  const observer=new MutationObserver(()=>{
    const ctx=findCheckout();
    if(ctx&&ctx.finish.dataset.v102Bound!=='1')requestAnimationFrame(bind);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();

;

/* ---- fiscal-safety-v103.js ---- */
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

;

/* ---- weighable-sync-v104.js ---- */
(()=>{
  if(typeof v3Reprice!=='function')return;
  const previousReprice=v3Reprice;
  v3Reprice=async function(){
    const result=await previousReprice();
    const quote=typeof v3State==='function'?v3State().quote:null;
    const rows=Array.isArray(quote?.items)?quote.items:[];
    const adjusted=[];
    for(const row of rows){
      const item=state.cart.find(x=>String(x.productId)===String(row.productId));
      if(!item)continue;
      const before=Number(item.quantity||0),after=Number(row.quantity||0);
      if(!Number.isFinite(after)||after<=0||Math.abs(before-after)<0.000001)continue;
      item.quantity=after;
      adjusted.push({before,after,unit:item.unit||'KG'});
    }
    if(adjusted.length){
      v3RenderCart();
      const first=adjusted[0];
      if(typeof showToast==='function')showToast(`Peso ajustado: ${first.before} g = ${first.after.toFixed(3).replace(/\.000$/,'')} ${first.unit}.`);
    }
    return result;
  };
  repriceCart=v3Reprice;
})();

;

/* ---- reprocess-ux-v104.js ---- */
(()=>{
  if(typeof safePrint!=='function')return;
  const previousSafePrint=safePrint;
  safePrint=async function(key,type){
    const result=await previousSafePrint(key,type);
    if(result!==false||type!=='pre_sale')return result;
    const progress=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('#v103ReprocessTitle'));
    if(!progress)return result;
    setTimeout(()=>{
      if(!progress.isConnected)return;
      const title=progress.querySelector('#v103ReprocessTitle');
      const text=progress.querySelector('#v103ReprocessText');
      if(title)title.textContent='Venda recuperada';
      if(text)text.textContent='A sincronização foi concluída. O comprovante de Pré-venda não foi impresso; você pode imprimi-lo depois nos detalhes da venda.';
    },0);
    return true;
  };
  window.safePrint=safePrint;
})();

;

/* ---- receipt-print-v829.js ---- */
(function installReceiptColumnsSetting(){
  const enhance = async () => {
    const printerSelect = document.getElementById('printerSelect');
    const saveButton = document.getElementById('saveSettings');
    if (!printerSelect || !saveButton || saveButton.dataset.receiptColumnsPatched === '1') return;
    saveButton.dataset.receiptColumnsPatched = '1';

    let current = 44;
    try {
      const settings = await window.thor.settings();
      current = Number(settings?.receiptColumns) === 65 ? 65 : 44;
    } catch {}

    const field = document.createElement('div');
    field.className = 'field';
    field.dataset.receiptColumnsField = '1';
    field.innerHTML = `<label>Largura do cupom térmico</label><select id="receiptColumns"><option value="44" ${current===44?'selected':''}>44 colunas — padrão térmico</option><option value="65" ${current===65?'selected':''}>65 colunas — cupom compacto</option></select><small class="muted">Aplicado à pré-venda/comprovante e ao DANFE NFC-e. Na NFC-e o Thor acrescenta chave de acesso, protocolo e QR Code.</small>`;
    const printerField = printerSelect.closest('.field');
    if (printerField?.parentNode) printerField.parentNode.insertBefore(field, printerField.nextSibling);

    const original = saveButton.onclick;
    saveButton.onclick = async function (event) {
      const columns = Number(document.getElementById('receiptColumns')?.value) === 65 ? 65 : 44;
      try { await window.thor.saveSettings({ receiptColumns: columns }); } catch {}
      if (typeof original === 'function') return original.call(this, event);
    };
  };

  const observer = new MutationObserver(() => { void enhance(); });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  void enhance();
})();

;

/* ---- sale-identity-v830.js ---- */
(()=>{
  const value=(v)=>String(v??'').trim();
  const currentOperator=()=>v3State()?.operator||state.status?.operator||null;
  const sellerRows=()=>Array.isArray(v3State()?.operators)?v3State().operators:[];

  function validSeller(id){return sellerRows().some(row=>value(row.id)===value(id));}
  async function normalizeSeller(forceOperator=false){
    const v=v3State();
    const operator=currentOperator();
    let configured=value(v.saleSellerUserId)||value(state.settings?.saleSellerUserId)||value(state.status?.settings?.saleSellerUserId);
    if(forceOperator||!validSeller(configured))configured=value(operator?.id);
    v.saleSellerUserId=configured;
    if(configured&&value(state.settings?.saleSellerUserId)!==configured){
      state.settings={...(state.settings||{}),saleSellerUserId:configured};
      if(state.status?.settings)state.status.settings={...state.status.settings,saleSellerUserId:configured};
      try{await window.thor.saveSettings({saleSellerUserId:configured});}catch{}
    }
    return configured;
  }

  function ensureStyles(){
    if(document.getElementById('saleIdentityV830Style'))return;
    const style=document.createElement('style');
    style.id='saleIdentityV830Style';
    style.textContent=`
      .sale-identity-v830{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:10px;align-items:end;margin:4px 0 8px}
      .sale-identity-v830 .operator-readonly{min-height:42px;border:1px solid var(--line,#dfe5e2);border-radius:10px;padding:7px 10px;background:rgba(15,23,42,.035);display:flex;flex-direction:column;justify-content:center}
      .sale-identity-v830 small,.sale-identity-v830 label>span{font-size:10px;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
      .sale-identity-v830 strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sale-identity-v830 label{display:flex;flex-direction:column;gap:4px;min-width:0}
      .sale-identity-v830 select{width:100%;min-height:42px}
      @media(max-width:1180px){.sale-identity-v830{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function patchWorkspace(){
    ensureStyles();
    const meta=document.querySelector('.checkout-meta');
    if(!meta||meta.querySelector('.sale-identity-v830'))return;
    const v=v3State();
    const operator=currentOperator();
    const selected=value(v.saleSellerUserId)||value(operator?.id);
    const rows=sellerRows();
    const holder=document.createElement('div');
    holder.className='sale-identity-v830';
    holder.innerHTML=`<div class="operator-readonly"><small>Operador da venda</small><strong>${esc(operator?.name||'Não identificado')}</strong></div><label><span>Vendedor da venda</span><select id="saleSellerV830">${rows.map(row=>`<option value="${esc(row.id)}" ${value(row.id)===selected?'selected':''}>${esc(row.name)}${row.profile_name?` — ${esc(row.profile_name)}`:''}</option>`).join('')}</select></label>`;
    const firstAdjustment=meta.querySelector('.adjustment-grid');
    meta.insertBefore(holder,firstAdjustment||null);
    const select=holder.querySelector('#saleSellerV830');
    if(select){
      if(!select.value&&operator?.id)select.value=value(operator.id);
      select.onchange=async()=>{
        v.saleSellerUserId=value(select.value)||value(operator?.id);
        state.settings={...(state.settings||{}),saleSellerUserId:v.saleSellerUserId};
        if(state.status?.settings)state.status.settings={...state.status.settings,saleSellerUserId:v.saleSellerUserId};
        try{await window.thor.saveSettings({saleSellerUserId:v.saleSellerUserId});showToast(`Vendedor: ${rows.find(row=>value(row.id)===v.saleSellerUserId)?.name||'selecionado'}.`);}catch(e){infoModal('Vendedor',friendlyError(e?.message));}
      };
    }
  }

  if(typeof v3Hydrate==='function'){
    const previousHydrate=v3Hydrate;
    v3Hydrate=async function(){
      const previousOperator=value(v3State()?.operator?.id);
      const result=await previousHydrate();
      const operatorChanged=Boolean(previousOperator&&previousOperator!==value(currentOperator()?.id));
      await normalizeSeller(operatorChanged);
      return result;
    };
  }

  if(typeof renderSaleWorkspace==='function'){
    const previousRender=renderSaleWorkspace;
    renderSaleWorkspace=function(){
      const result=previousRender.apply(this,arguments);
      queueMicrotask(()=>{void normalizeSeller(false).then(patchWorkspace);});
      setTimeout(patchWorkspace,20);
      return result;
    };
  }

  const oldFriendly=typeof friendlyError==='function'?friendlyError:null;
  if(oldFriendly){
    friendlyError=function(code){
      const map={
        sale_number_pending_sync:'A venda foi concluída, mas o número sequencial ainda não chegou do servidor. Sincronize o caixa e reimprima; o Thor não imprimirá UUID no lugar do número da venda.',
        sale_sync_rejected:'A venda não foi aceita na sincronização. Verifique a pendência antes de imprimir o comprovante.',
        invalid_seller:'O vendedor selecionado não está ativo ou não pertence a este PDV/filial.'
      };
      return map[code]||oldFriendly(code);
    };
  }

  const observer=new MutationObserver(()=>{if(state?.view==='sale')patchWorkspace();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(()=>{void normalizeSeller(false).then(patchWorkspace);},100);
})();

;

/* ---- fiscal-cancel-ux-v832.js ---- */
(()=>{
  const CANCELLED_SALE_STATUSES=new Set(['cancelled','cancel_pending']);
  const rawRequestNfce=typeof requestNfceAndMaybePrint==='function'?requestNfceAndMaybePrint:null;
  const rawOpenSaleDetail=typeof openSaleDetail==='function'?openSaleDetail:null;
  const rawPaintCancelProgress=typeof paintCancelProgress==='function'?paintCancelProgress:null;

  function saleIsCancelled(sale){
    const saleStatus=String(sale?.status||'').toLowerCase();
    const fiscalStatus=String(sale?.fiscal?.status||'').toLowerCase();
    return CANCELLED_SALE_STATUSES.has(saleStatus)||fiscalStatus==='cancelled';
  }

  function fiscalIsCancelled(sale){return String(sale?.fiscal?.status||'').toLowerCase()==='cancelled';}

  function cancelledSaleMessage(sale){
    const number=sale?.number?` #${sale.number}`:'';
    return `A venda${number} está cancelada. Não é permitido solicitar uma nova NFC-e para uma operação cancelada.`;
  }

  function showNfceBlocked(sale){
    const message=cancelledSaleMessage(sale);
    if(typeof infoModal==='function')infoModal('NFC-e bloqueada',message);
    else if(typeof showToast==='function')showToast(message);
    return {ok:false,blocked:true,error:'sale_cancelled'};
  }

  async function resolveSale(keyOrSale){
    if(keyOrSale&&typeof keyOrSale==='object')return keyOrSale;
    const key=String(keyOrSale||'');
    if(!key||!window.thor?.fiscalSale)return null;
    try{return await window.thor.fiscalSale(key);}catch{return null;}
  }

  // Segunda barreira de segurança na UI. O agente local também recusa a emissão
  // quando a venda está cancelled/cancel_pending, mas esta validação evita até
  // mesmo abrir confirmação/progresso de emissão para uma operação já cancelada.
  if(rawRequestNfce){
    const guardedRequest=async function(key,options={}){
      const detail=await resolveSale(key);
      if(detail&&saleIsCancelled(detail))return showNfceBlocked(detail);
      return rawRequestNfce(key,options);
    };
    requestNfceAndMaybePrint=guardedRequest;
    window.requestNfceAndMaybePrint=guardedRequest;
  }

  function latestSaleModal(){
    return [...document.querySelectorAll('.modal')].reverse().find(node=>node.querySelector('.sale-actions'))||null;
  }

  function decorateCancelledSaleModal(detail){
    if(!detail||!saleIsCancelled(detail))return;
    const overlay=latestSaleModal();
    if(!overlay)return;
    const card=overlay.querySelector('.modal-card')||overlay;
    const fiscalCancelled=fiscalIsCancelled(detail);
    const nfceButton=overlay.querySelector('#nfceSale');

    // Se a NFC-e foi efetivamente cancelada, o botão existente continua sendo
    // usado somente para consultar/reimprimir o DANFE cancelado. Em venda
    // cancelada sem documento fiscal, nenhuma nova solicitação é permitida.
    if(nfceButton&&!fiscalCancelled){
      nfceButton.disabled=true;
      nfceButton.textContent='NFC-e bloqueada';
      nfceButton.title='Venda cancelada — não é possível solicitar NFC-e';
      nfceButton.classList.add('nfce-cancelled-lock');
      nfceButton.onclick=null;
    }

    if(!overlay.querySelector('.sale-cancelled-ux-banner')&&!fiscalCancelled){
      const head=overlay.querySelector('.sale-detail-head');
      const banner=document.createElement('div');
      banner.className='sale-locked-banner sale-cancelled-ux-banner';
      banner.innerHTML='<b>Venda cancelada</b><span>Esta operação está encerrada. A solicitação de uma nova NFC-e permanece bloqueada.</span>';
      if(head?.parentNode)head.insertAdjacentElement('afterend',banner);else card.prepend(banner);
    }
  }

  if(rawOpenSaleDetail){
    const enhancedOpenSaleDetail=async function(sale){
      const result=await rawOpenSaleDetail(sale);
      let detail=sale;
      try{
        const key=typeof saleKey==='function'?saleKey(sale):String(sale?.id||sale?.client_event_id||sale?.local_key||'');
        if(key)detail=await window.thor.fiscalSale(key);
      }catch{}
      decorateCancelledSaleModal(detail);
      return result;
    };
    openSaleDetail=enhancedOpenSaleDetail;
    window.openSaleDetail=enhancedOpenSaleDetail;
  }

  function cancellationCopy(phase,fiscalCancellation){
    if(phase==='done')return {
      title:'Cancelamento realizado com sucesso',
      subtitle:fiscalCancellation?'A NFC-e foi cancelada e a venda foi encerrada com sucesso.':'A venda foi cancelada e a operação foi encerrada com sucesso.'
    };
    if(phase==='error')return {title:'Não foi possível concluir o cancelamento',subtitle:'Confira a mensagem abaixo antes de tentar novamente.'};
    const detail={
      validating:'Validando a operação e as regras de cancelamento.',
      building:'Preparando o evento de cancelamento fiscal.',
      signing:'Assinando o evento com o certificado digital.',
      sending:'Enviando o cancelamento para a SEFAZ.',
      accepted:'Cancelamento aceito pela SEFAZ. Finalizando a venda.',
      reversing:'Estornando estoque e financeiro da venda.',
      syncing:'Sincronizando o cancelamento com o ThorGestão.'
    }[phase]||'Finalizando a operação.';
    return {title:'Processando cancelamento, aguarde',subtitle:detail};
  }

  if(rawPaintCancelProgress){
    const enhancedPaintCancelProgress=function(m,sale,options={}){
      const result=rawPaintCancelProgress(m,sale,options);
      if(!m?.isConnected)return result;
      const phase=String(options?.phase||'validating');
      const fiscalCancellation=Boolean(options?.fiscalCancellation);
      const copy=cancellationCopy(phase,fiscalCancellation);
      const head=m.querySelector('.cancel-progress-head');
      const title=head?.querySelector('h3');
      const subtitle=head?.querySelector('p');
      const body=m.querySelector('#cancelProgressBody');
      if(title)title.textContent=copy.title;
      if(subtitle)subtitle.textContent=copy.subtitle;
      if(body){
        body.setAttribute('role','status');
        body.setAttribute('aria-live','polite');
        body.classList.toggle('cancel-ux-processing',!['done','error'].includes(phase));
        body.classList.toggle('cancel-ux-success',phase==='done');
        body.classList.toggle('cancel-ux-error',phase==='error');
      }
      if(phase==='done'&&m.dataset.cancelUxSuccess!=='1'){
        m.dataset.cancelUxSuccess='1';
        if(typeof showToast==='function')showToast('Cancelamento realizado com sucesso.');
      }
      return result;
    };
    paintCancelProgress=enhancedPaintCancelProgress;
    window.paintCancelProgress=enhancedPaintCancelProgress;
  }
})();

;

/* ---- return-credit-v105.js ---- */
(function () {
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const n = (value) => Number(value || 0);
  const allowsFraction = (item) => Boolean(item?.is_weighable || item?.fractioned || item?.label_scale);
  const remainingFor = (item) => Math.max(n(item?.quantity) - n(item?.returned_quantity), 0);
  const qtyLabel = (value) => n(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  v3PaymentLabels.store_credit_voucher = 'Vale Crédito';

  function returnValue(items, selected) {
    return selected.reduce((sum, row) => {
      const original = items[row.index];
      const qty = n(row.quantity);
      const originalQty = n(original?.quantity);
      const total = n(original?.total ?? (originalQty * n(original?.unit_price)));
      const unitNet = originalQty > 0 ? total / originalQty : 0;
      return sum + qty * unitNet;
    }, 0);
  }

  function customerCard(customer, automatic = false) {
    return `<div class="v105-beneficiary selected"><span>${automatic ? 'CLIENTE IDENTIFICADO NA VENDA' : 'CLIENTE SELECIONADO'}</span><b>${esc(customer?.name || 'Cliente')}</b><small>${esc(customer?.document || '')}${customer?.store_credit_balance != null ? ` • Crédito atual ${money(customer.store_credit_balance)}` : ''}</small></div>`;
  }

  function returnItemRow(item, index) {
    const remaining = remainingFor(item);
    const fractional = allowsFraction(item);
    const unavailable = remaining <= 0.000001;
    const editableQuantity = fractional || remaining > 1.000001;
    const initialQuantity = fractional ? Math.min(1, remaining) : 1;
    const name = item.name || item.description || item.sku || 'Item';
    const unit = item.unit || (fractional ? 'kg' : 'un');

    return `<div class="v105-return-line ${unavailable ? 'unavailable' : ''}" data-return-line="${index}">
      <label class="v105-return-choice">
        <input type="checkbox" data-return-select="${index}" ${unavailable ? 'disabled' : ''}>
        <span class="v105-return-check">✓</span>
        <span class="v105-return-product">
          <b>${esc(name)}</b>
          <small>Vendido: ${qtyLabel(item.quantity)} • Já devolvido: ${qtyLabel(item.returned_quantity)} • Disponível: ${qtyLabel(remaining)} ${esc(unit)}</small>
        </span>
        <em>${unavailable ? 'Já devolvido' : 'Selecionar'}</em>
      </label>
      ${unavailable ? '' : editableQuantity ? `
        <div class="v105-return-qty" data-return-qty-panel="${index}" hidden>
          <label><span>Quantidade a devolver</span><input type="number" min="${fractional ? '0.001' : '1'}" max="${remaining}" step="${fractional ? '0.001' : '1'}" value="${initialQuantity}" data-return-qty="${index}"></label>
          <small>Máximo disponível: ${qtyLabel(remaining)} ${esc(unit)}</small>
        </div>` : `
        <div class="v105-return-qty v105-return-fixed" data-return-qty-panel="${index}" hidden>
          <span>Quantidade a devolver</span><b>1</b><small>Única unidade disponível</small>
        </div>`}
    </div>`;
  }

  returnSaleModal = function (sale) {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const automaticCustomer = sale.customer_id ? { id:sale.customer_id, name:sale.customer_name || sale.customer || 'Cliente da venda', document:sale.customer_document || '', store_credit_balance:sale.customer_store_credit_balance } : null;
    let selectedCustomer = automaticCustomer;
    let guest = null;
    let searchTimer = null;

    const m = modal(`<div class="v105-return-head"><div><small>DEVOLUÇÃO</small><h3>Venda ${sale.number ? `#${esc(sale.number)}` : ''}</h3><p>Selecione primeiro o produto que será devolvido. A quantidade só será solicitada quando necessário.</p></div><div class="v105-credit-only"><span>RESTITUIÇÃO</span><b>Crédito em loja</b><small>Não movimenta dinheiro do caixa</small></div></div>
      <div class="return-items v105-return-items">${items.map(returnItemRow).join('')}</div>
      <div class="v105-return-total"><span>Crédito estimado</span><b id="v105ReturnTotal">${money(0)}</b></div>
      <section class="v105-beneficiary-section"><div class="v105-section-title"><b>Quem receberá o crédito?</b><small>${automaticCustomer ? 'O cliente já foi identificado na venda original.' : 'Localize o cliente antes de concluir a devolução.'}</small></div>
        <div id="v105Beneficiary">${automaticCustomer ? customerCard(automaticCustomer,true) : `<div class="v105-customer-search"><div class="v105-search-line"><input id="v105CustomerQuery" placeholder="Digite CPF ou nome do cliente..." autocomplete="off"><button type="button" id="v105SearchCustomer">Buscar</button></div><div id="v105CustomerResults" class="v105-customer-results"><small>Digite o CPF ou o nome para localizar o cadastro.</small></div></div>`}</div>
      </section>
      <div class="v105-credit-info"><b>Crédito em loja</b><span>Cliente cadastrado: o valor entra diretamente no saldo do cadastro. Pessoa sem cadastro: o ThorPDV emite um Vale Crédito numerado e imprime em 44 colunas.</span></div>
      <div class="field"><label>Motivo</label><textarea id="returnReason" rows="3" placeholder="Motivo da devolução..."></textarea></div>
      <div id="v105ReturnError" class="settings-error"></div>
      <div class="actions"><button class="secondary" id="back">Voltar</button><button class="primary" id="confirmReturn">Gerar Crédito em loja</button></div>`, 'wide v105-return-modal');

    const totalEl = m.querySelector('#v105ReturnTotal');
    const errorEl = m.querySelector('#v105ReturnError');

    const selectedRows = () => [...m.querySelectorAll('[data-return-select]:checked')].map((check) => {
      const index = Number(check.dataset.returnSelect);
      const original = items[index] || {};
      const remaining = remainingFor(original);
      const editableQuantity = allowsFraction(original) || remaining > 1.000001;
      const quantityInput = m.querySelector(`[data-return-qty="${index}"]`);
      return { index, quantity: editableQuantity ? n(quantityInput?.value) : Math.min(1, remaining) };
    }).filter((row) => row.quantity > 0);

    const validateRows = (rows) => {
      for (const row of rows) {
        const original = items[row.index] || {};
        const name = original.name || original.description || original.sku || 'produto';
        const remaining = remainingFor(original);
        const quantity = n(row.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return { index:row.index, message:`Informe uma quantidade válida para ${name}.` };
        if (quantity > remaining + 0.0001) return { index:row.index, message:`A quantidade informada para ${name} é maior que a quantidade disponível para devolução (${qtyLabel(remaining)}).` };
        if (!allowsFraction(original) && Math.abs(quantity - Math.round(quantity)) > 0.000001) return { index:row.index, message:`${name} aceita somente quantidade inteira.` };
      }
      return null;
    };

    const refreshTotal = () => {
      const rows = selectedRows();
      const validation = validateRows(rows);
      totalEl.textContent = money(validation ? 0 : returnValue(items, rows));
      if (!validation && errorEl.dataset.returnValidation === 'true') {
        errorEl.textContent = '';
        delete errorEl.dataset.returnValidation;
      }
    };

    m.querySelectorAll('[data-return-select]').forEach((check) => {
      check.addEventListener('change', () => {
        const index = Number(check.dataset.returnSelect);
        const line = m.querySelector(`[data-return-line="${index}"]`);
        const panel = m.querySelector(`[data-return-qty-panel="${index}"]`);
        line?.classList.toggle('selected', check.checked);
        if (panel) panel.hidden = !check.checked;
        if (check.checked) setTimeout(() => m.querySelector(`[data-return-qty="${index}"]`)?.focus(), 20);
        refreshTotal();
      });
    });

    m.querySelectorAll('[data-return-qty]').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.returnQty);
        const original = items[index] || {};
        const remaining = remainingFor(original);
        const quantity = n(input.value);
        if (quantity > remaining + 0.0001) {
          errorEl.textContent = `Quantidade máxima disponível para ${original.name || original.description || 'este produto'}: ${qtyLabel(remaining)}.`;
          errorEl.dataset.returnValidation = 'true';
        } else if (!allowsFraction(original) && quantity > 0 && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
          errorEl.textContent = 'Produto unitário aceita somente quantidade inteira.';
          errorEl.dataset.returnValidation = 'true';
        } else if (errorEl.dataset.returnValidation === 'true') {
          errorEl.textContent = '';
          delete errorEl.dataset.returnValidation;
        }
        refreshTotal();
      });
    });

    m.querySelector('#back').onclick = () => m.remove();

    async function searchCustomers() {
      const input = m.querySelector('#v105CustomerQuery');
      const box = m.querySelector('#v105CustomerResults');
      const query = String(input?.value || '').trim();
      selectedCustomer = null; guest = null;
      if (query.length < 2) { box.innerHTML = '<small>Digite pelo menos 2 caracteres.</small>'; return; }
      box.innerHTML = '<small>Buscando cliente...</small>';
      try {
        const rows = await window.thor.customers(query);
        const queryDigits = digits(query);
        const exact = queryDigits.length >= 11 ? (rows || []).find(row => digits(row.document) === queryDigits) : null;
        if (exact) {
          selectedCustomer = exact;
          box.innerHTML = customerCard(exact,false) + '<button type="button" class="v105-change-customer" id="v105ChangeCustomer">Trocar cliente</button>';
          box.querySelector('#v105ChangeCustomer').onclick = () => { selectedCustomer=null; input.value=''; input.focus(); box.innerHTML='<small>Digite o CPF ou o nome para localizar o cadastro.</small>'; };
          return;
        }
        box.innerHTML = (rows || []).length ? `<div class="v105-result-list">${rows.map((row,index)=>`<button type="button" data-v105-customer="${index}"><b>${esc(row.name||'Cliente')}</b><small>${esc(row.document||'Sem CPF/CNPJ')} • Crédito ${money(row.store_credit_balance||0)}</small></button>`).join('')}</div><button type="button" class="v105-guest-button" id="v105Guest">Nenhum destes — emitir Vale Crédito para pessoa sem cadastro</button>` : `<div class="v105-no-customer"><b>Nenhum cadastro encontrado.</b><small>Você pode emitir um Vale Crédito para esta pessoa.</small></div><button type="button" class="v105-guest-button" id="v105Guest">Pessoa sem cadastro — emitir Vale Crédito</button>`;
        box.querySelectorAll('[data-v105-customer]').forEach(button => button.onclick = () => {
          const customer = rows[Number(button.dataset.v105Customer)]; selectedCustomer=customer; guest=null;
          box.innerHTML = customerCard(customer,false) + '<button type="button" class="v105-change-customer" id="v105ChangeCustomer">Trocar cliente</button>';
          box.querySelector('#v105ChangeCustomer').onclick = () => { selectedCustomer=null; box.innerHTML='<small>Faça uma nova busca acima.</small>'; input.focus(); };
        });
        const guestButton = box.querySelector('#v105Guest');
        if (guestButton) guestButton.onclick = () => {
          const raw = String(input.value || '').trim(); const doc = digits(raw);
          guest = { name:doc.length>=11 ? '' : raw, document:doc.length>=11 ? doc : '' }; selectedCustomer=null;
          box.innerHTML = `<div class="v105-beneficiary voucher"><span>PESSOA SEM CADASTRO</span><b>Será emitido um Vale Crédito</b><small>${esc(guest.name || guest.document)} • numeração gerada automaticamente</small></div><button type="button" class="v105-change-customer" id="v105ChangeCustomer">Voltar à busca</button>`;
          box.querySelector('#v105ChangeCustomer').onclick = () => { guest=null; box.innerHTML='<small>Faça uma nova busca acima.</small>'; input.focus(); };
        };
      } catch (error) { box.innerHTML = `<small class="error">${esc(friendlyError(error.message))}</small>`; }
    }

    const query = m.querySelector('#v105CustomerQuery');
    if (query) {
      query.oninput = () => { clearTimeout(searchTimer); searchTimer=setTimeout(searchCustomers,300); };
      query.onkeydown = event => { if(event.key==='Enter'){event.preventDefault();searchCustomers();} };
      m.querySelector('#v105SearchCustomer').onclick = searchCustomers;
      setTimeout(()=>query.focus(),50);
    }

    m.querySelector('#confirmReturn').onclick = async () => {
      errorEl.textContent='';
      delete errorEl.dataset.returnValidation;
      const rows = selectedRows();
      if (!rows.length) { errorEl.textContent='Selecione ao menos um produto para devolver.'; return; }
      const validation = validateRows(rows);
      if (validation) {
        errorEl.textContent = validation.message;
        errorEl.dataset.returnValidation = 'true';
        m.querySelector(`[data-return-qty="${validation.index}"]`)?.focus();
        return;
      }
      if (!automaticCustomer && !selectedCustomer && !guest) { errorEl.textContent='Localize um cliente ou escolha emitir Vale Crédito para pessoa sem cadastro.'; return; }
      const selected = rows.map(row=>{const original=items[row.index];return {sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,line_index:row.index,quantity:row.quantity};});
      const button = m.querySelector('#confirmReturn'); button.disabled=true; button.textContent='Processando devolução...';
      try {
        const result = await window.thor.returnSale({
          saleKey:saleKey(sale),items:selected,refundMethod:'store_credit',reason:m.querySelector('#returnReason').value.trim(),
          returnCustomerId:selectedCustomer?.id || automaticCustomer?.id || null,
          guestName:guest?.name || '',guestDocument:guest?.document || ''
        });
        m.remove();
        const returnReceipt = result.voucher || result.returnReceipt || null;
        if (returnReceipt) {
          try { await window.thor.printStoreCreditVoucher(returnReceipt); }
          catch (printError) { infoModal('Comprovante de devolução', `A devolução foi concluída, mas não foi possível imprimir o comprovante em 44 colunas: ${friendlyError(printError.message)}.`); }
        }
        try { await window.thor.sync(); } catch {}
        await refreshProducts(); await refreshFiscalSales();
        if (result.voucher) showToast(`Vale Crédito ${result.voucher.voucher_number} emitido: ${money(result.voucher.original_amount)}.`);
        else showToast(`Crédito de ${money(result.estimatedTotal)} lançado para ${result.storeCreditCustomerName || selectedCustomer?.name || automaticCustomer?.name || 'cliente'}.`);
      } catch (error) { button.disabled=false; button.textContent='Gerar Crédito em loja'; infoModal('Devolução',friendlyError(error.message)); }
    };
    return m;
  };

  function voucherPaymentModal() {
    if (!state.cart.length) return;
    const m = modal(`<div class="v105-voucher-pay-head"><div><small>PAGAMENTO</small><h3>Vale Crédito</h3></div><strong>${money(v3Remaining())}</strong></div>
      <div class="field"><label>Número do Vale Crédito</label><div class="v105-search-line"><input id="v105VoucherNumber" placeholder="Ex.: VC260816..." autocomplete="off"><button type="button" id="v105VoucherSearch">Consultar</button></div></div>
      <div id="v105VoucherInfo" class="v105-voucher-info"><small>Informe o número impresso no vale.</small></div>
      <div class="field"><label>Valor a utilizar</label><input id="v105VoucherAmount" type="number" min="0.01" step="0.01" value="0.00" disabled></div>
      <div id="v105VoucherError" class="settings-error"></div><div class="actions"><button class="secondary" id="v105VoucherBack">Voltar</button><button class="primary" id="v105VoucherAdd" disabled>Usar Vale Crédito</button></div>`, 'v105-voucher-pay');
    let voucher = null;
    const number = m.querySelector('#v105VoucherNumber'), amount=m.querySelector('#v105VoucherAmount'), info=m.querySelector('#v105VoucherInfo'), error=m.querySelector('#v105VoucherError'), add=m.querySelector('#v105VoucherAdd');
    m.querySelector('#v105VoucherBack').onclick=()=>m.remove();
    const lookup = async () => {
      error.textContent=''; voucher=null; add.disabled=true; amount.disabled=true; info.innerHTML='<small>Consultando saldo...</small>';
      try { try { await window.thor.sync(); } catch {} voucher=await window.thor.storeCreditVoucher(number.value); const remaining=n(voucher.remaining); if(voucher.status!=='active'||remaining<=0)throw new Error('store_credit_voucher_not_active'); const applied=Math.min(v3Remaining(),remaining); amount.value=applied.toFixed(2);amount.max=remaining.toFixed(2);amount.disabled=false;add.disabled=false;info.innerHTML=`<span><small>VALE ${esc(voucher.voucher_number)}</small><b>Saldo ${money(remaining)}</b><em>${voucher.guest_name?esc(voucher.guest_name):esc(voucher.guest_document||'')}</em></span>`; }
      catch (e) { info.innerHTML='<small>Vale não localizado ou sem saldo.</small>';error.textContent=friendlyError(e.message); }
    };
    m.querySelector('#v105VoucherSearch').onclick=lookup; number.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();lookup();}};
    add.onclick=()=>{if(!voucher)return;const value=n(amount.value);const remaining=n(voucher.remaining);if(value<=0)return error.textContent='Informe um valor.';if(value>remaining+0.001)return error.textContent=`Saldo do vale: ${money(remaining)}.`;if(value>v3Remaining()+0.001)return error.textContent=`Valor restante da venda: ${money(v3Remaining())}.`;v3State().payments.push({method:'store_credit_voucher',amount:value,metadata:{voucher_number:voucher.voucher_number}});m.remove();v3RenderCart();showToast(`Vale ${voucher.voucher_number}: ${money(value)} aplicado.`);};
    setTimeout(()=>number.focus(),50);
  }

  const previousPaymentModal = v3PaymentModal;
  v3PaymentModal = function (initialMethod='cash') {
    if (initialMethod === 'store_credit_voucher') return voucherPaymentModal();
    const result = previousPaymentModal(initialMethod);
    queueMicrotask(()=>document.querySelectorAll('.modal [data-method="store_credit_voucher"]').forEach(button=>button.remove()));
    return result;
  };

  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      return_only_store_credit_allowed:'Devoluções do ThorPDV são restituídas somente como Crédito em loja.',
      return_customer_identification_required:'Identifique o cliente por CPF/nome ou escolha emitir Vale Crédito.',
      return_customer_not_found:'O cliente selecionado não está disponível no cadastro deste caixa.',
      return_quantity_exceeds_remaining:'A quantidade informada é maior que a quantidade disponível para devolução.',
      return_item_ambiguous:'Não foi possível identificar com segurança o item da venda. Sincronize a venda e tente novamente.',
      fractional_quantity_not_allowed:'Este produto aceita somente quantidade inteira.',
      store_credit_voucher_number_required:'Informe o número do Vale Crédito.',
      store_credit_voucher_not_found:'Vale Crédito não localizado.',
      store_credit_voucher_not_active:'Este Vale Crédito não possui saldo disponível.',
      insufficient_store_credit_voucher:'O valor informado é maior que o saldo disponível no Vale Crédito.',
      thermal_printer_required:'Configure uma impressora térmica para imprimir o Vale Crédito.',
    };
    return messages[String(code||'')] || previousFriendlyError(code);
  };

  queueMicrotask(()=>{ try { if(state?.view==='sale') renderSaleWorkspace(); } catch {} });
})();

;

/* ---- return-quantity-guard-v106.js ---- */
(function () {
  const previousReturnSaleModal = returnSaleModal;
  const number = (value) => Number(value || 0);
  const allowsFraction = (item) => Boolean(item?.is_weighable || item?.fractioned || item?.label_scale);

  returnSaleModal = function (sale) {
    const modalElement = previousReturnSaleModal(sale);
    const items = Array.isArray(sale?.items) ? sale.items : [];
    const errorElement = modalElement?.querySelector('#v105ReturnError');
    const confirmButton = modalElement?.querySelector('#confirmReturn');
    const inputs = [...(modalElement?.querySelectorAll('[data-return-qty]') || [])];

    const validateInput = (input) => {
      const index = Number(input.dataset.returnQty);
      const item = items[index] || {};
      const quantity = number(input.value);
      const remaining = Math.max(number(item.quantity) - number(item.returned_quantity), 0);
      const selected = modalElement?.querySelector(`[data-return-select="${index}"]`)?.checked;

      if (!selected) {
        input.setCustomValidity('');
        return true;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        input.setCustomValidity('Informe uma quantidade maior que zero.');
        return false;
      }
      if (quantity > remaining + 0.0001) {
        input.setCustomValidity(`Quantidade máxima disponível: ${remaining}.`);
        return false;
      }
      if (!allowsFraction(item) && Math.abs(quantity - Math.round(quantity)) > 0.000001) {
        input.setCustomValidity('Produto unitário aceita somente quantidade inteira.');
        return false;
      }
      input.setCustomValidity('');
      return true;
    };

    inputs.forEach((input) => {
      const index = Number(input.dataset.returnQty);
      const item = items[index] || {};
      const fractional = allowsFraction(item);
      const remaining = Math.max(number(item.quantity) - number(item.returned_quantity), 0);

      input.step = fractional ? '0.001' : '1';
      input.min = fractional ? '0.001' : '1';
      input.max = String(fractional ? remaining : Math.max(Math.floor(remaining + 0.000001), 0));
      input.inputMode = fractional ? 'decimal' : 'numeric';
      input.title = fractional ? 'Produto fracionado: permite casas decimais.' : 'Produto unitário: informe somente quantidades inteiras.';
      input.addEventListener('input', () => validateInput(input));
    });

    if (confirmButton) {
      confirmButton.addEventListener('click', (event) => {
        const invalid = inputs.find((input) => !validateInput(input));
        if (!invalid) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (errorElement) errorElement.textContent = invalid.validationMessage || 'Revise a quantidade informada para devolução.';
        invalid.focus();
        invalid.reportValidity?.();
      }, true);
    }

    return modalElement;
  };
})();

;

/* ---- store-credit-payment-v106.js ---- */
(function () {
  if (window.__storeCreditPaymentV106) return;
  window.__storeCreditPaymentV106 = true;

  const number = (value) => Number(value || 0);

  // Vale Crédito é uma forma de pagamento oficial do ThorPDV. O lançamento
  // nunca é manual: ao escolher esta forma abrimos a consulta do vale e
  // validamos o saldo antes de adicionar o pagamento à venda.
  if (typeof v3PaymentLabels === 'object' && v3PaymentLabels) {
    v3PaymentLabels.store_credit_voucher = 'Vale Crédito';
  }

  const voucherAppliedInSale = (voucherNumber) => v3State().payments
    .filter((payment) => payment?.method === 'store_credit_voucher' && String(payment?.metadata?.voucher_number || '').toUpperCase() === String(voucherNumber || '').toUpperCase())
    .reduce((sum, payment) => sum + number(payment.amount), 0);

  const remainingForSale = (voucher) => Math.max(number(voucher?.remaining) - voucherAppliedInSale(voucher?.voucher_number), 0);
  const formatDate = (value) => {
    try { return new Date(value).toLocaleString('pt-BR'); }
    catch { return ''; }
  };

  function voucherPaymentModalV106() {
    if (!state.cart.length) return;

    const m = modal(`<div class="v105-voucher-pay-head"><div><small>PAGAMENTO</small><h3>Vale Crédito</h3><p>Informe o número do vale ou localize um vale ativo com saldo.</p></div><strong>${money(v3Remaining())}</strong></div>
      <div class="field"><label>Número, cliente, documento ou venda</label><div class="v105-search-line"><input id="v106VoucherQuery" placeholder="Ex.: VC260816... / CPF / nome" autocomplete="off"><button type="button" id="v106VoucherLookup">Consultar número</button></div></div>
      <div class="v106-voucher-search-actions"><button type="button" class="secondary" id="v106VoucherSearch">Buscar vales disponíveis</button><small>Serão exibidos somente vales ativos e com saldo.</small></div>
      <div id="v106VoucherResults" class="v106-voucher-results"><small>Digite o número do vale para consulta direta ou clique em “Buscar vales disponíveis”.</small></div>
      <div id="v106VoucherSelected" class="v105-voucher-info"><small>Nenhum vale selecionado.</small></div>
      <div class="field"><label>Valor a utilizar</label><input id="v106VoucherAmount" type="number" min="0.01" step="0.01" value="0.00" disabled></div>
      <div id="v106VoucherError" class="settings-error"></div>
      <div class="actions"><button class="secondary" id="v106VoucherBack">Voltar</button><button class="primary" id="v106VoucherAdd" disabled>Usar Vale Crédito</button></div>`, 'wide v105-voucher-pay v106-voucher-pay');

    let voucher = null;
    const query = m.querySelector('#v106VoucherQuery');
    const results = m.querySelector('#v106VoucherResults');
    const selectedBox = m.querySelector('#v106VoucherSelected');
    const amount = m.querySelector('#v106VoucherAmount');
    const error = m.querySelector('#v106VoucherError');
    const add = m.querySelector('#v106VoucherAdd');

    const clearSelection = () => {
      voucher = null;
      amount.value = '0.00';
      amount.disabled = true;
      add.disabled = true;
      selectedBox.innerHTML = '<small>Nenhum vale selecionado.</small>';
    };

    const chooseVoucher = (row) => {
      const available = remainingForSale(row);
      if (String(row?.status || '') !== 'active' || available <= 0.0001) {
        clearSelection();
        error.textContent = 'Este Vale Crédito não possui saldo disponível para esta venda.';
        return;
      }
      voucher = row;
      const applied = Math.min(v3Remaining(), available);
      amount.value = applied.toFixed(2);
      amount.max = available.toFixed(2);
      amount.disabled = false;
      add.disabled = applied <= 0;
      error.textContent = '';
      const already = voucherAppliedInSale(row.voucher_number);
      selectedBox.innerHTML = `<span><small>VALE SELECIONADO</small><b>${esc(row.voucher_number)}</b><em>Saldo disponível: ${money(available)}${already > 0 ? ` • Já usado nesta venda: ${money(already)}` : ''}</em><em>${esc(row.guest_name || row.guest_document || 'Pessoa sem cadastro')}${row.sale_number ? ` • Origem: venda ${esc(row.sale_number)}` : ''}</em><em>${row.issued_at ? `Emitido em ${esc(formatDate(row.issued_at))}` : ''}</em></span>`;
    };

    const renderResults = (rows) => {
      const active = (Array.isArray(rows) ? rows : []).filter((row) => String(row.status || '') === 'active' && remainingForSale(row) > 0.0001);
      if (!active.length) {
        results.innerHTML = '<div class="v106-voucher-empty"><b>Nenhum Vale Crédito disponível.</b><small>Não há vales ativos com saldo para os critérios informados.</small></div>';
        return;
      }
      results.innerHTML = `<div class="v106-voucher-list">${active.map((row, index) => {
        const available = remainingForSale(row);
        const beneficiary = row.guest_name || row.guest_document || 'Pessoa sem cadastro';
        return `<button type="button" data-v106-voucher="${index}"><span><b>${esc(row.voucher_number)}</b><small>${esc(beneficiary)}${row.sale_number ? ` • Venda ${esc(row.sale_number)}` : ''}</small><small>${row.issued_at ? `Emitido em ${esc(formatDate(row.issued_at))}` : ''}</small></span><strong>${money(available)}</strong></button>`;
      }).join('')}</div>`;
      results.querySelectorAll('[data-v106-voucher]').forEach((button) => {
        button.onclick = () => chooseVoucher(active[Number(button.dataset.v106Voucher)]);
      });
    };

    const bestEffortSync = async () => {
      try { await window.thor.sync(); } catch {}
    };

    const lookupExact = async () => {
      error.textContent = '';
      const value = String(query.value || '').trim();
      if (!value) { error.textContent = 'Informe o número do Vale Crédito.'; query.focus(); return; }
      clearSelection();
      results.innerHTML = '<small>Consultando vale...</small>';
      try {
        await bestEffortSync();
        const row = await window.thor.storeCreditVoucher(value);
        renderResults([row]);
        chooseVoucher(row);
      } catch (e) {
        results.innerHTML = '<small>Vale não localizado ou sem saldo.</small>';
        error.textContent = friendlyError(e.message);
      }
    };

    const searchAvailable = async () => {
      error.textContent = '';
      clearSelection();
      results.innerHTML = '<small>Buscando vales disponíveis...</small>';
      try {
        await bestEffortSync();
        const rows = await window.thor.storeCreditVouchers(String(query.value || '').trim(), 50);
        renderResults(rows);
      } catch (e) {
        results.innerHTML = '<small>Não foi possível consultar os vales.</small>';
        error.textContent = friendlyError(e.message);
      }
    };

    m.querySelector('#v106VoucherBack').onclick = () => m.remove();
    m.querySelector('#v106VoucherLookup').onclick = lookupExact;
    m.querySelector('#v106VoucherSearch').onclick = searchAvailable;
    query.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); lookupExact(); } };

    add.onclick = () => {
      if (!voucher) return;
      const value = number(amount.value);
      const available = remainingForSale(voucher);
      const remainingSale = v3Remaining();
      if (value <= 0) return error.textContent = 'Informe um valor.';
      if (value > available + 0.001) return error.textContent = `Saldo disponível do vale: ${money(available)}.`;
      if (value > remainingSale + 0.001) return error.textContent = `Valor restante da venda: ${money(remainingSale)}.`;
      v3State().payments.push({
        method: 'store_credit_voucher',
        amount: value,
        metadata: { voucher_number: String(voucher.voucher_number || '').toUpperCase() },
      });
      m.remove();
      v3RenderCart();
      showToast(`Vale ${voucher.voucher_number}: ${money(value)} aplicado.`);
    };

    setTimeout(() => query.focus(), 50);
    return m;
  }

  const previousPaymentModalV106 = v3PaymentModal;
  v3PaymentModal = function (initialMethod = 'cash') {
    if (initialMethod === 'store_credit_voucher') return voucherPaymentModalV106();

    const paymentModal = previousPaymentModalV106(initialMethod);
    queueMicrotask(() => {
      if (!paymentModal?.isConnected) return;
      const grid = paymentModal.querySelector('.payment-method-grid');
      if (!grid) return;

      // Como a forma já faz parte do catálogo visual, reaproveitamos o botão
      // criado pelo checkout e substituímos somente sua ação. Assim não existe
      // pagamento manual sem identificação do vale nem botão duplicado.
      let button = grid.querySelector('[data-method="store_credit_voucher"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.method = 'store_credit_voucher';
        grid.appendChild(button);
      }
      button.dataset.v106StoreCredit = '1';
      button.textContent = 'Vale Crédito';
      button.onclick = () => {
        paymentModal.remove();
        voucherPaymentModalV106();
      };
    });
    return paymentModal;
  };

  // Caso a tela de venda já tenha sido renderizada antes deste complemento
  // terminar de carregar, insere a forma de pagamento sem exigir reinício.
  const ensureQuickPaymentButton = () => {
    const grid = document.querySelector('.payment-methods');
    if (!grid || grid.querySelector('[data-v3-pay="store_credit_voucher"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pay';
    button.dataset.v3Pay = 'store_credit_voucher';
    button.innerHTML = '<span>Vale Crédito</span><kbd></kbd>';
    button.onclick = () => v3PaymentModal('store_credit_voucher');
    grid.appendChild(button);
  };

  queueMicrotask(ensureQuickPaymentButton);
  setTimeout(ensureQuickPaymentButton, 120);
})();
;

/* ---- store-credit-finalizer-v111.js ---- */
(function () {
  if (window.__storeCreditFinalizerV111) return;
  window.__storeCreditFinalizerV111 = true;

  const METHOD = 'store_credit_voucher';
  let scheduled = false;

  if (typeof v3PaymentLabels === 'object' && v3PaymentLabels) {
    v3PaymentLabels[METHOD] = 'Vale Crédito';
  }

  function findFinalizationModal() {
    return [...document.querySelectorAll('.modal')].reverse().find((node) =>
      node.querySelector('.payment-head') &&
      node.querySelector('.payment-entry') &&
      node.querySelector('#finishCheckout')
    ) || null;
  }

  function decorateButton(button, grid) {
    const mode = grid.classList.contains('v089-pay-methods') ? 'v089' : 'plain';
    button.style.display = '';
    button.hidden = false;
    button.type = 'button';
    button.dataset.method = METHOD;
    button.dataset.v111StoreCreditFinalizer = '1';

    if (button.dataset.v111Visual !== mode) {
      button.dataset.v111Visual = mode;
      if (mode === 'v089') button.innerHTML = '<i>▣</i><span>Vale Crédito</span>';
      else button.textContent = 'Vale Crédito';
    }
  }

  function patchFinalizationModal() {
    const paymentModal = findFinalizationModal();
    if (!paymentModal) return false;

    const grid = paymentModal.querySelector('.v089-pay-methods, .payment-method-grid');
    if (!grid) return false;

    let button = grid.querySelector(`[data-method="${METHOD}"]`);
    if (!button) {
      button = document.createElement('button');
      grid.appendChild(button);
    }

    decorateButton(button, grid);

    if (button.dataset.v111Bound !== '1') {
      button.dataset.v111Bound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        paymentModal.remove();
        setTimeout(() => {
          try {
            v3PaymentModal(METHOD);
          } catch (error) {
            try {
              infoModal('Vale Crédito', friendlyError(error?.message || 'store_credit_voucher_not_available'));
            } catch {}
          }
        }, 0);
      }, true);
    }

    return true;
  }

  function schedulePatch() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { patchFinalizationModal(); } catch (error) { console.warn('store_credit_finalizer_patch_failed', error); }
    });
  }

  // A tela de Finalização é montada por camadas assíncronas e depois decorada
  // pelo redesign. Observamos somente inclusão/remoção de nós e o patch é
  // idempotente, evitando depender da ordem dos wrappers de v3PaymentModal.
  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  queueMicrotask(schedulePatch);
  setTimeout(schedulePatch, 80);
})();

;

/* ---- return-voucher-fix-v107.js ---- */
(function () {
  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      store_credit_requires_customer: 'Para uma devolução sem cliente cadastrado, escolha emitir um Vale Crédito. O valor será vinculado ao número do vale, não a um cadastro de cliente.',
      return_customer_identification_required: 'Informe o nome ou CPF da pessoa e escolha emitir Vale Crédito para pessoa sem cadastro.',
      store_credit_voucher_number_required: 'Não foi possível gerar a numeração do Vale Crédito. Tente concluir a devolução novamente.',
      printer_not_configured: 'Vale Crédito gerado, mas nenhuma impressora térmica está configurada para a impressão em 44 colunas.',
      thermal_printer_required: 'O Vale Crédito deve ser impresso em uma impressora térmica configurada no ThorPDV.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();

;

/* ---- cash-return-summary-v109.js ---- */
(function () {
  if (window.__cashReturnSummaryV109) return;
  window.__cashReturnSummaryV109 = true;
  if (typeof cashDailyCloseModal !== 'function') return;

  const previousCashDailyCloseModal = cashDailyCloseModal;
  cashDailyCloseModal = function (preview, options = {}) {
    const modalWrap = previousCashDailyCloseModal(preview, options);
    try {
      const count = Number(preview?.returns_count || 0);
      const total = Number(preview?.returns_total || 0);
      if (count <= 0 || !modalWrap?.querySelector) return modalWrap;

      const grid = modalWrap.querySelector('.cash-summary-grid');
      if (!grid || grid.querySelector('[data-cash-return-summary-v109]')) return modalWrap;

      const card = document.createElement('article');
      card.dataset.cashReturnSummaryV109 = '1';
      card.innerHTML = `<span>Devoluções</span><strong>${cashDailyMoney(total)}</strong><small>${count} operação(ões) · crédito/vale · não altera dinheiro físico</small>`;
      const saleCard = grid.children[1] || null;
      if (saleCard?.nextSibling) grid.insertBefore(card, saleCard.nextSibling);
      else grid.appendChild(card);

      const outstanding = Number(preview?.return_voucher_outstanding || 0);
      if (outstanding > 0.009) {
        const note = document.createElement('div');
        note.className = 'cash-return-credit-note';
        note.innerHTML = `<b>Vales Crédito em aberto: ${cashDailyMoney(outstanding)}</b><span>Esse saldo é crédito do cliente/portador e não compõe o numerário esperado da gaveta.</span>`;
        grid.insertAdjacentElement('afterend', note);
      }
    } catch (error) {
      console.warn('[cash-return-summary-v109]', error);
    }
    return modalWrap;
  };
})();

;

/* ---- receivable-cash-summary-v115.js ---- */
(function(){
  if(window.__receivableCashSummaryV115)return;
  window.__receivableCashSummaryV115=true;
  if(typeof cashDailyCloseModal!=='function')return;

  const previous=cashDailyCloseModal;
  cashDailyCloseModal=function(preview,options={}){
    const wrap=previous(preview,options);
    try{
      if(!wrap?.querySelector)return wrap;
      const total=Number(preview?.receivable_received_total||0);
      const cash=Number(preview?.receivable_received_cash||0);
      const count=Number(preview?.receivable_receipt_count||0);
      if(total<=0.009)return wrap;
      const grid=wrap.querySelector('.cash-summary-grid');
      if(!grid)return wrap;

      let card=[...grid.querySelectorAll('article')].find(article=>String(article.querySelector('span')?.textContent||'').trim()==='Recebimentos');
      if(!card){
        card=document.createElement('article');
        const sales=[...grid.querySelectorAll('article')].find(article=>String(article.querySelector('span')?.textContent||'').trim()==='Vendas');
        if(sales?.nextSibling)grid.insertBefore(card,sales.nextSibling);else grid.appendChild(card);
      }
      card.dataset.receivableSummaryV115='1';
      card.innerHTML=`<span>Recebimentos</span><strong>${cashDailyMoney(total)}</strong><small>${Math.trunc(count)} recebimento(s) de crediário${cash>0.009?` • ${cashDailyMoney(cash)} em dinheiro`:''}</small>`;

      const nonCash=Math.max(total-cash,0);
      if(nonCash>0.009&&!wrap.querySelector('[data-receivable-cash-note-v115]')){
        const note=document.createElement('div');
        note.dataset.receivableCashNoteV115='1';
        note.className='cash-return-credit-note';
        note.innerHTML=`<b>Recebimentos não monetários na gaveta: ${cashDailyMoney(nonCash)}</b><span>PIX, cartões e outras formas ficam registrados no fechamento, mas somente ${cashDailyMoney(cash)} recebido em dinheiro compõe o numerário físico.</span>`;
        grid.insertAdjacentElement('afterend',note);
      }
    }catch(error){console.warn('[receivable-cash-summary-v115]',error);}
    return wrap;
  };
})();

;

/* ---- receivable-v115-pre.js ---- */
window.__thorFriendlyBeforeReceivableV115 = typeof friendlyError === 'function' ? friendlyError : null;

;

/* ---- receivable-v115.js ---- */
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
      <div class="v115-auto-payment"><div><small>PAGAMENTO AUTOMÁTICO</small><b>Quanto o cliente quer pagar?</b><span>Distribuímos primeiro nas parcelas mais antigas e deixamos somente a última alcançada como parcial.</span></div><label><span>Valor disponível</span><div><em>R$</em><input id="v115AutoAmount" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"></div></label><button type="button" class="primary" id="v115AutoApply">Distribuir valor</button></div>
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
    const autoAmount=body.querySelector('#v115AutoAmount');
    const parseAutoAmount=(value)=>{
      const clean=String(value||'').trim().replace(/\s/g,'');
      if(!clean)return 0;
      const normalized=clean.includes(',')?clean.replace(/\./g,'').replace(',','.'):clean;
      return n(normalized);
    };
    const applyAutomaticPayment=()=>{
      const requestedCents=Math.round(parseAutoAmount(autoAmount.value)*100);
      const openCents=entries.reduce((sum,row)=>sum+Math.round(n(row.remaining)*100),0);
      if(requestedCents<=0){infoModal('Valor do recebimento','Informe um valor maior que zero para distribuir entre as parcelas.');autoAmount.focus();return;}
      if(requestedCents>openCents){infoModal('Valor acima do saldo',`O cliente possui ${brMoney(openCents/100)} em aberto. Informe um valor igual ou menor que esse saldo.`);autoAmount.focus();return;}
      let availableCents=requestedCents;
      const order=entries.map((row,index)=>({row,index})).sort((a,b)=>{
        const dateA=String(a.row.due_date||'9999-12-31');
        const dateB=String(b.row.due_date||'9999-12-31');
        return dateA.localeCompare(dateB)||(n(a.row.installment)-n(b.row.installment))||(a.index-b.index);
      });
      checks.forEach((check,index)=>{check.checked=false;amounts[index].value=Number(entries[index].remaining).toFixed(2);});
      order.forEach(({row,index})=>{
        if(availableCents<=0)return;
        const balanceCents=Math.round(n(row.remaining)*100);
        const appliedCents=Math.min(availableCents,balanceCents);
        if(appliedCents>0){checks[index].checked=true;amounts[index].value=(appliedCents/100).toFixed(2);availableCents-=appliedCents;}
      });
      autoAmount.value=(requestedCents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const summary=recalc();
      const partial=checks.some((check,index)=>check.checked&&Math.round(n(amounts[index].value)*100)<Math.round(n(entries[index].remaining)*100));
      body.querySelector('#v115AfterHint').textContent=`${summary.count} parcela(s) • mais antigas primeiro${partial?' • última com baixa parcial':''}`;
    };
    body.querySelector('#v115AutoApply').onclick=applyAutomaticPayment;
    autoAmount.onkeydown=(event)=>{if(event.key==='Enter'){event.preventDefault();applyAutomaticPayment();}};
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

;

/* ---- receivable-v115-post.js ---- */
if (typeof window.__thorFriendlyBeforeReceivableV115 === 'function') friendlyError = window.__thorFriendlyBeforeReceivableV115;

;

/* ---- operations-center-v120.js ---- */
(function(){
  const TYPE_LABEL={sale:'Venda',receivable:'Recebimento de crediário',cash_supply:'Suprimento',cash_withdrawal:'Sangria',sale_cancel:'Cancelamento',sale_return:'Devolução',cash_open:'Abertura de caixa',cash_close:'Fechamento de caixa'};
  const date=v=>{try{return new Date(v).toLocaleString('pt-BR')}catch{return v||'—'}};
  const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let activeDraftId=null;
  const PAGE_SIZE=20;
  const paginate=(rows,page)=>{const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));const current=Math.min(Math.max(1,page),totalPages);return{items:rows.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE),current,totalPages,total:rows.length};};
  const pagerHtml=p=>p.totalPages>1?`<nav class="oc120-pagination" aria-label="Paginação"><button data-page="${p.current-1}" ${p.current===1?'disabled':''}>‹ Anterior</button><span>Página <b>${p.current}</b> de <b>${p.totalPages}</b> • ${p.total} registros</span><button data-page="${p.current+1}" ${p.current===p.totalPages?'disabled':''}>Próxima ›</button></nav>`:`<div class="oc120-page-count">${p.total} registro(s) • máximo de ${PAGE_SIZE} por página</div>`;

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
    m.classList.add('oc120-modal');let tab=initial,timer,page=1;
    const body=m.querySelector('#oc120Body'),search=m.querySelector('#oc120Search'),type=m.querySelector('#oc120Type');
    const selectTab=next=>{tab=next;page=1;m.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));type.style.display=tab==='documents'?'':'none';load();};
    async function load(){
      body.innerHTML='<div class="oc120-loading">Carregando...</div>';
      try{
        const pending=await window.thor.pendingOperations();m.querySelector('#oc120PendingBadge').textContent=pending.length;
        if(tab==='documents'){
          const rows=await window.thor.operationHistory({query:search.value,type:type.value,limit:250});
          const pg=paginate(rows,page);page=pg.current;
          body.innerHTML=rows.length?`<div class="oc120-list">${pg.items.map(d=>`<article><span class="oc120-icon">${({sale:'▤',receivable:'$',cash_supply:'+',cash_withdrawal:'−',sale_cancel:'×',sale_return:'↩',cash_open:'◉',cash_close:'●'})[d.type]||'•'}</span><div><small>${safe(TYPE_LABEL[d.type]||d.type)} ${d.sensitive?'<b>SENSÍVEL</b>':''}</small><strong>${safe(d.reference||'Sem referência')}</strong><em>${date(d.created_at)} • ${summaryOf(d)}</em></div><button data-reprint="${d.id}" data-sensitive="${d.sensitive?'1':'0'}">Imprimir 2ª via</button></article>`).join('')}</div>${pagerHtml(pg)}`:'<div class="oc120-empty">Nenhum documento encontrado.</div>';
          body.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);load();});
          body.querySelectorAll('[data-reprint]').forEach(button=>button.onclick=async()=>{try{let authorization=null,reason='Reimpressão operacional';if(button.dataset.sensitive==='1')authorization=await supervisorAuthorization('sensitive_reprint','Reimpressão sensível');button.disabled=true;button.textContent='Imprimindo...';await window.thor.reprintOperation({documentId:button.dataset.reprint,supervisorAuthorization:authorization,reason:authorization?.reason||reason});button.textContent='2ª via impressa';showToast('Comprovante reimpresso e auditado como 2ª via.');}catch(e){if(e.message!=='authorization_cancelled')infoModal('Reimpressão',friendlyError(e?.message||String(e)));button.disabled=false;button.textContent='Imprimir 2ª via';}});
        }else if(tab==='pending'){
          const pg=paginate(pending,page);page=pg.current;
          body.innerHTML=pending.length?`<div class="oc120-list pending">${pg.items.map(e=>`<article class="${e.state}"><span class="oc120-icon">${e.state==='rejected'?'!':'↻'}</span><div><small>${e.state==='rejected'?'REJEITADA':'PENDENTE'} • tentativa ${e.attempts||0}</small><strong>${safe(e.type)}</strong><em>${date(e.created_at)}${e.last_error?' • '+safe(friendlyError(e.last_error)):''}</em></div><button data-retry="${e.id}">${e.state==='rejected'?'Corrigir / reenviar':'Tentar agora'}</button></article>`).join('')}</div>${pagerHtml(pg)}<div class="oc120-queue-actions"><button class="secondary" id="oc120OpenFiscal">Abrir painel fiscal</button><button class="primary" id="oc120RetryAll">Retentar todas</button></div>`:'<div class="oc120-empty ok">✓ Não existem operações pendentes.</div>';
          body.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);load();});
          body.querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{try{b.disabled=true;b.textContent='Reenviando...';await window.thor.retryOperation(b.dataset.retry);showToast('Operação reenviada.');await load();}catch(e){infoModal('Contingência',friendlyError(e?.message||String(e)));b.disabled=false;}});
          body.querySelector('#oc120RetryAll')?.addEventListener('click',async()=>{try{await window.thor.retryPendingOperations();await refreshStatus();showToast('Retentativa automática executada.');await load();}catch(e){infoModal('Contingência',friendlyError(e?.message||String(e)));}});
          body.querySelector('#oc120OpenFiscal')?.addEventListener('click',()=>{m.remove();setView('fiscal');});
        }else{
          const rows=await window.thor.draftSales(search.value);
          const pg=paginate(rows,page);page=pg.current;
          body.innerHTML=rows.length?`<div class="oc120-list drafts">${pg.items.map(d=>`<article><span class="oc120-icon">◫</span><div><small>PRÉ-VENDA • ${safe(d.operator_name||'Operador')}</small><strong>${safe(d.number)}${d.customer_name?' • '+safe(d.customer_name):''}</strong><em>${date(d.updated_at)} • ${d.payload?.items?.length||0} item(ns)</em></div><button data-load-draft="${d.id}">Retomar</button><button class="danger-link" data-delete-draft="${d.id}">Cancelar</button></article>`).join('')}</div>${pagerHtml(pg)}`:'<div class="oc120-empty">Nenhuma pré-venda em aberto.</div>';
          body.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);load();});
          body.querySelectorAll('[data-load-draft]').forEach(b=>b.onclick=async()=>{try{if(state.cart.length&&!confirm('A venda atual será substituída pela pré-venda. Continuar?'))return;const d=await window.thor.loadDraftSale(b.dataset.loadDraft),p=d.payload||{},v=v3State();state.cart=p.items||[];v.customerId=p.customerId||null;v.customerName=p.customerName||'';v.consumerDocument=p.consumerDocument||'';v.discount=Number(p.discount||0);v.surcharge=Number(p.surcharge||0);v.payments=[];activeDraftId=d.id;m.remove();renderSaleWorkspace();queueMicrotask(()=>{v3RenderCart();showToast(`Pré-venda ${d.number} carregada. Conclua normalmente para convertê-la em venda.`);});}catch(e){infoModal('Pré-venda',friendlyError(e?.message||String(e)));}});
          body.querySelectorAll('[data-delete-draft]').forEach(b=>b.onclick=async()=>{if(!confirm('Cancelar esta pré-venda?'))return;await window.thor.deleteDraftSale(b.dataset.deleteDraft);await load();});
        }
      }catch(e){body.innerHTML=`<div class="oc120-empty error">${safe(friendlyError(e?.message||String(e)))}</div>`;}
    }
    search.oninput=()=>{page=1;clearTimeout(timer);timer=setTimeout(load,180)};type.onchange=()=>{page=1;load();};m.querySelector('#oc120Refresh').onclick=load;m.querySelector('#oc120Close').onclick=()=>m.remove();m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));selectTab(initial);
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
;

/* ---- seller-v125.js ---- */
(function () {
  function sellerState() {
    const value = v3State();
    if (!Object.prototype.hasOwnProperty.call(value, 'sellerInitialized')) value.sellerInitialized = false;
    if (!value.sellerInitialized && value.operator) {
      value.seller = value.operator;
      value.sellerInitialized = true;
    }
    return value;
  }
  function candidates() {
    const value = sellerState();
    return (value.operators || []).filter((user) => user && user.id && user.active !== false);
  }
  function refreshSellerLabel() {
    const value = sellerState();
    const button = document.getElementById('v089Seller');
    if (!button) return;
    const label = button.querySelector('small');
    if (label) label.textContent = value.seller?.name || 'Informar';
    button.title = value.seller?.name
      ? `Vendedor da venda: ${value.seller.name}. Operador do caixa: ${value.operator?.name || 'não identificado'}`
      : 'Informar vendedor desta venda';
  }
  function openSellerSelector() {
    const value = sellerState();
    const rows = candidates();
    const content = rows.length
      ? `<label class="field"><span>Vendedor desta venda</span><select id="v125SellerSelect"><option value="">Sem vendedor informado</option>${rows.map((user) => `<option value="${esc(user.id)}" ${String(value.seller?.id || '') === String(user.id) ? 'selected' : ''}>${esc(user.name || user.email || 'Usuário')}</option>`).join('')}</select></label>
         <div class="v105-beneficiary"><span>OPERADOR DO CAIXA</span><b>${esc(value.operator?.name || 'Não identificado')}</b><small>O operador permanece autenticado; somente o vendedor da venda será alterado.</small></div>`
      : '<p class="muted">Nenhum usuário foi sincronizado para seleção como vendedor.</p>';
    const box = modal(`<div class="v090-movement-head"><div><small>IDENTIFICAÇÃO COMERCIAL</small><h3>Informar vendedor</h3><p>O vendedor pode ser diferente do operador responsável pelo caixa.</p></div><span>#</span></div>
      ${content}<div class="actions"><button class="secondary" id="v125SellerCancel">Cancelar</button>${rows.length ? '<button class="primary" id="v125SellerConfirm">Confirmar vendedor</button>' : ''}</div>`, 'v125-seller-modal');
    box.querySelector('#v125SellerCancel').onclick = () => box.remove();
    box.querySelector('#v125SellerConfirm')?.addEventListener('click', () => {
      const id = box.querySelector('#v125SellerSelect').value;
      value.seller = rows.find((user) => String(user.id) === String(id)) || null;
      value.sellerInitialized = true;
      box.remove();
      refreshSellerLabel();
      showToast(value.seller ? `Vendedor ${value.seller.name} selecionado.` : 'Venda sem vendedor informado.');
    });
  }
  function decorate() {
    const button = document.getElementById('v089Seller');
    if (!button || button.dataset.v125Seller === '1') return;
    button.dataset.v125Seller = '1';
    button.onclick = openSellerSelector;
    refreshSellerLabel();
  }
  window.openSellerSelectorV125 = openSellerSelector;
  new MutationObserver(decorate).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#operatorBtn')) setTimeout(() => { sellerState(); refreshSellerLabel(); }, 100);
  });
  decorate();
})();

;