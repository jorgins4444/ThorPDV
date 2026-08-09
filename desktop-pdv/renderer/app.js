const app=document.getElementById('app');
const paymentLabels={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher'};
const reservedShortcuts=new Set(['F2','F3','F4','F6','F12','ENTER','ESCAPE']);
let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',capturingShortcut:false};

const money=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dt=(v)=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const saleKey=(sale)=>String(sale.id||sale.local_key||sale.client_event_id||sale.number||'');

async function boot(){
  state.status=await window.thor.status();
  state.settings=state.status.settings||await window.thor.settings();
  render();
  if(state.status.enrolled){await refreshProducts('');await refreshFiscalSales('');setInterval(refreshStatus,3000);}
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
  try{
    const requested=await window.thor.requestNfce({saleKey:key});
    if(!requested.alreadyAuthorized){await window.thor.sync();await refreshFiscalSales();}
    const sale=await window.thor.fiscalSale(key);
    if(sale.fiscal?.status==='authorized')return safePrint(key,'nfce');
    infoModal('NFC-e solicitada',`A solicitação fiscal foi registrada. Status atual: ${sale.fiscal?.status||'aguardando sincronização'}. A impressão da NFC-e só será liberada quando houver autorização fiscal real.${state.status?.context?.fiscal_provider?'':' Configure um provedor fiscal no Gestão para transmitir à SEFAZ.'}`);
  }catch(e){infoModal('NFC-e',friendlyError(e.message));}
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
  const items=detail.items||[],payments=detail.payments||[];
  const m=modal(`<div class="sale-detail-head"><div><small>VENDA ${detail.number?`#${esc(detail.number)}`:'LOCAL'}</small><h3>${money(detail.total)}</h3><p>${dt(detail.completed_at||detail.created_at)} • ${esc(detail.customer_name||'Consumidor')}</p></div>${fiscalBadge(detail.fiscal)}</div><div class="sale-detail-grid"><section><h4>Itens</h4><div class="detail-items">${items.map(i=>`<div><span><b>${Number(i.quantity||0)}×</b> ${esc(i.name||i.description||i.sku||'Item')}</span><strong>${money(i.total??(Number(i.quantity||0)*Number(i.unit_price||0)-Number(i.discount||0)))}</strong></div>`).join('')||'<p>Nenhum item disponível.</p>'}</div></section><section><h4>Pagamento</h4><div class="detail-items">${payments.map(p=>`<div><span>${esc(paymentLabels[p.method]||p.method||'Forma')}</span><strong>${money(p.amount)}</strong></div>`).join('')||'<p>Sem pagamento sincronizado.</p>'}</div><h4>Fiscal</h4><div class="fiscal-meta"><span>Status: <b>${esc(detail.fiscal?.status||'Não solicitado')}</b></span><span>Chave: <b>${esc(detail.fiscal?.access_key||'—')}</b></span><span>Protocolo: <b>${esc(detail.fiscal?.protocol||'—')}</b></span></div></section></div><div class="sale-actions"><button class="secondary" id="reprintSale">Pré-venda</button><button class="secondary" id="nfceSale">${detail.fiscal?.status==='authorized'?'Imprimir NFC-e':'Solicitar NFC-e'}</button><button class="secondary warning-button" id="returnSale">Devolver</button><button class="danger primary" id="cancelSale">Cancelar venda</button></div>`,'wide');
  m.querySelector('#reprintSale').onclick=()=>safePrint(key,'pre_sale');
  m.querySelector('#nfceSale').onclick=()=>requestNfceAndMaybePrint(key);
  m.querySelector('#returnSale').onclick=()=>{m.remove();returnSaleModal(detail);};
  m.querySelector('#cancelSale').onclick=()=>{m.remove();cancelSaleModal(detail);};
}

function cancelSaleModal(sale){
  const m=modal(`<h3>Cancelar venda ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">O cancelamento estorna o estoque e o financeiro. Se houver NFC-e autorizada, o cancelamento fiscal deve ser autorizado antes.</p><div class="field"><label>Motivo do cancelamento</label><textarea id="cancelReason" rows="3" placeholder="Informe o motivo..."></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="danger primary" id="confirmCancel">Confirmar cancelamento</button></div>`);
  m.querySelector('#back').onclick=()=>m.remove();
  m.querySelector('#confirmCancel').onclick=async()=>{try{const reason=m.querySelector('#cancelReason').value.trim();if(!reason)return alert('Informe o motivo.');await window.thor.cancelSale({saleKey:saleKey(sale),reason});m.remove();await window.thor.sync();await refreshProducts();await refreshFiscalSales();showToast('Cancelamento enviado para o Gestão.');}catch(e){infoModal('Cancelamento',friendlyError(e.message));}};
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

function fiscalBadge(fiscal){if(!fiscal)return '<span class="fiscal-status none">Não solicitada</span>';const status=String(fiscal.status||'');return `<span class="fiscal-status fiscal-${esc(status)}">${esc({requested:'Solicitada',draft:'Rascunho',processing:'Processando',authorized:'Autorizada',rejected:'Rejeitada',cancelled:'Cancelada',contingency:'Contingência'}[status]||status)}</span>`;}
function saleStatusLabel(status){return ({completed:'Concluída',cancelled:'Cancelada',pending_sync:'Pendente sync',cancel_pending:'Cancelando',return_pending:'Devolução pendente'}[status]||String(status||'Pendente'));}
function friendlyError(code){return ({printer_not_configured:'Nenhuma impressora foi configurada.',nfce_not_authorized:'A NFC-e ainda não foi autorizada.',nfce_pdf_unavailable:'A NFC-e está autorizada, mas o PDF/DANFE ainda não está disponível.',nfce_pdf_url_unavailable:'O caminho do PDF da NFC-e ainda não pode ser aberto pelo terminal.',authorized_fiscal_document_requires_fiscal_cancellation:'Esta venda possui documento fiscal autorizado. É necessário cancelar primeiro a NFC-e junto à SEFAZ/provedor fiscal.',sale_has_returns:'A venda possui devolução registrada e não pode ser cancelada integralmente.',sale_already_cancelled:'A venda já está cancelada.',sale_cancelled:'A venda está cancelada.',cash_required_for_cash_refund:'Para devolver em dinheiro é necessário haver um caixa aberto.',return_quantity_exceeds_remaining:'A quantidade informada supera o saldo disponível para devolução.',sale_not_found:'Venda não encontrada.',sale_item_not_found:'Item da venda não encontrado.'}[code]||code||'Erro inesperado');}

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
