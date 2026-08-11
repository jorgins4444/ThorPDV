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
    let settled=false,cancelError=null;
    const task=window.thor.cancelSale({saleKey:saleKey(sale),reason}).then(()=>{settled=true;}).catch(e=>{cancelError=e;settled=true;});
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
    paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'done',syncPending});
    showToast(fiscalCancellation?'NFC-e cancelada e venda estornada.':'Venda cancelada.');
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
