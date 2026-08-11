from pathlib import Path
import json, re

# Agent guards
p=Path('desktop-pdv/agent/index.js'); s=p.read_text()
s=s.replace("if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending') throw new Error('sale_cancelled');", "if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending'||sale.fiscal?.status==='cancelled') throw new Error('sale_cancelled');", 1)
s=s.replace("const sale=this.fiscalSale(saleKey);\n    if(sale.fiscal?.status==='authorized')", "const sale=this.fiscalSale(saleKey);\n    if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending'||sale.fiscal?.status==='cancelled') throw new Error('sale_cancelled');\n    if(sale.fiscal?.status==='authorized')", 1)
s=s.replace("if(!sale) throw new Error('receipt_not_found');\n    if(type==='nfce'){", "if(!sale) throw new Error('receipt_not_found');\n    if(type!=='nfce'&&sale.fiscal?.status==='cancelled') throw new Error('pre_sale_unavailable_cancelled_nfce');\n    if(type==='nfce'){", 1)
p.write_text(s)

# Main process: WhatsApp share helper
p=Path('desktop-pdv/main.js'); s=p.read_text()
s=s.replace("const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');", "const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require('electron');", 1)
marker="async function printRemotePdf(doc, printerName) {"
helper=r'''function normalizeWhatsappPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) throw new Error('whatsapp_phone_invalid');
  return digits;
}

function uniqueDownloadPath(filename) {
  const safe = String(filename || `ThorPDV-${Date.now()}.pdf`).replace(/[<>:"/\\|?*]+/g, '-');
  const first = path.join(app.getPath('downloads'), safe);
  if (!fs.existsSync(first)) return first;
  const ext = path.extname(safe) || '.pdf';
  const base = path.basename(safe, ext);
  return path.join(app.getPath('downloads'), `${base}-${Date.now()}${ext}`);
}

async function shareSaleWhatsapp(saleKey, type = 'pre_sale', phone = '') {
  if (!['pre_sale', 'nfce'].includes(type)) throw new Error('whatsapp_document_invalid');
  const normalizedPhone = normalizeWhatsappPhone(phone);
  const doc = agent.documentData(saleKey, type);
  const win = await loadPrintable(doc);
  try {
    const buffer = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const filePath = uniqueDownloadPath(doc.filename || `ThorPDV-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, buffer);
    const sale = doc.sale || {};
    const label = type === 'nfce' ? 'NFC-e' : 'pré-venda';
    const number = sale.fiscal?.number || sale.number || '';
    const text = `Olá! Segue ${label}${number ? ` da venda ${number}` : ''} emitida pelo ThorPDV. O PDF ${path.basename(filePath)} está pronto para anexar.`;
    const url = `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(text)}`;
    await shell.openExternal(url);
    setTimeout(() => { try { shell.showItemInFolder(filePath); } catch {} }, 700);
    return { ok: true, phone: normalizedPhone, filePath, filename: path.basename(filePath), requiresManualAttach: true };
  } finally { win.destroy(); }
}

'''
if helper not in s:
    s=s.replace(marker, helper+marker, 1)
s=s.replace("handle('thor:print-sale', (saleKey, type, reprint) => printSale(saleKey, type, reprint));", "handle('thor:print-sale', (saleKey, type, reprint) => printSale(saleKey, type, reprint));\n  handle('thor:share-sale-whatsapp', (saleKey, type, phone) => shareSaleWhatsapp(saleKey, type, phone));", 1)
p.write_text(s)

# Preload bridge
p=Path('desktop-pdv/preload.js'); s=p.read_text()
s=s.replace("printSale: (saleKey, type = 'pre_sale', reprint = false) => ipcRenderer.invoke('thor:print-sale', saleKey, type, reprint),", "printSale: (saleKey, type = 'pre_sale', reprint = false) => ipcRenderer.invoke('thor:print-sale', saleKey, type, reprint),\n  shareSaleWhatsapp: (saleKey, type = 'pre_sale', phone = '') => ipcRenderer.invoke('thor:share-sale-whatsapp', saleKey, type, phone),", 1)
p.write_text(s)

# Renderer: richer detail, state locks and WhatsApp UX
p=Path('desktop-pdv/renderer/app.js'); s=p.read_text()
old="sale_item_not_found:'Item da venda não encontrado.'}[code]||code||'Erro inesperado');}"
new="sale_item_not_found:'Item da venda não encontrado.',pre_sale_unavailable_cancelled_nfce:'A pré-venda fica indisponível depois que a NFC-e é cancelada.',whatsapp_phone_invalid:'Informe um telefone válido com DDD. Ex.: 86999999999.',whatsapp_document_invalid:'Documento inválido para envio pelo WhatsApp.'}[code]||code||'Erro inesperado');}"
s=s.replace(old,new,1)
pattern=re.compile(r"async function openSaleDetail\(sale\)\{[\s\S]*?\n\}\n\nfunction cancelProgressSteps",re.M)
replacement=r'''function saleItemCode(i){return String(i.sku||i.code||i.internal_code||i.product_code||i.product_id||'—');}
function saleDiscountTotals(detail,items){
  const gross=items.reduce((sum,i)=>sum+Number(i.quantity||0)*Number(i.unit_price||i.unitPrice||0),0);
  const itemDiscount=items.reduce((sum,i)=>sum+Number(i.discount||0),0);
  const saleDiscount=Number(detail.discount||detail.sale_discount||0);
  return {gross,itemDiscount,saleDiscount,totalDiscount:itemDiscount+saleDiscount};
}
function whatsappSaleModal(sale,type){
  const key=saleKey(sale),fiscalCancelled=String(sale?.fiscal?.status||'')==='cancelled';
  if(type==='pre_sale'&&fiscalCancelled){infoModal('Pré-venda indisponível',friendlyError('pre_sale_unavailable_cancelled_nfce'));return;}
  if(type==='nfce'&&!['authorized','cancelled'].includes(String(sale?.fiscal?.status||''))){infoModal('NFC-e',friendlyError('nfce_not_authorized'));return;}
  const label=type==='nfce'?'NFC-e':'pré-venda';
  const preset=String(sale.customer_phone||sale.phone||sale.customer?.phone||'').replace(/\D/g,'');
  const m=modal(`<h3>Enviar ${esc(label)} pelo WhatsApp</h3><p class="muted">O THOR gera o PDF, abre a conversa no WhatsApp Web e deixa o arquivo selecionado no Explorador para anexação.</p><div class="field"><label>WhatsApp do cliente</label><input id="waPhone" inputmode="tel" autocomplete="tel" value="${esc(preset)}" placeholder="86999999999"></div><div class="whatsapp-share-note"><b>Documento</b><span>${esc(label)} ${sale.number?`da venda #${esc(sale.number)}`:''}</span></div><div class="actions"><button class="secondary" id="waBack">Voltar</button><button class="primary whatsapp-button" id="waSend">Abrir WhatsApp</button></div>`);
  m.querySelector('#waBack').onclick=()=>m.remove();
  m.querySelector('#waSend').onclick=async()=>{const button=m.querySelector('#waSend');try{const phone=m.querySelector('#waPhone').value.trim();button.disabled=true;button.textContent='Gerando PDF...';const r=await window.thor.shareSaleWhatsapp(key,type,phone);m.remove();showToast(`WhatsApp aberto • ${r.filename} pronto em Downloads.`);setTimeout(()=>infoModal('Arquivo pronto',`O PDF ${r.filename} foi gerado e selecionado no Explorador. Arraste-o para a conversa do WhatsApp Web ou use o clipe para anexar.`),450);}catch(e){button.disabled=false;button.textContent='Abrir WhatsApp';infoModal('WhatsApp',friendlyError(String(e.message||e)));}};
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

function cancelProgressSteps'''
s,count=pattern.subn(lambda _m:replacement,s,count=1)
if count!=1: raise SystemExit('openSaleDetail block not found')
p.write_text(s)

# Renderer styles
p=Path('desktop-pdv/renderer/styles.css'); s=p.read_text()
css=r'''

/* sale detail + WhatsApp v079 */
.sale-locked-banner{display:grid;gap:4px;margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff0f1;color:#9d2833;border:1px solid #f1c4c8}.sale-locked-banner span{font-size:12px;line-height:1.45}.sale-totals-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:14px 0}.sale-totals-grid>div{display:grid;gap:4px;padding:11px 12px;border:1px solid #e5e9e6;border-radius:11px;background:#fafbfa}.sale-totals-grid small,.sale-item-numbers small{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#7a847e}.sale-totals-grid strong{font-size:15px}.sale-discount-highlight{display:flex;justify-content:space-between;align-items:center;padding:10px 13px;border-radius:11px;background:#fff8e7;color:#875814;margin-bottom:14px}.detail-items.detailed>div{display:block}.sale-item-detailed{padding:12px!important}.sale-item-main{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.sale-item-main small{font-family:Consolas,monospace;color:#6d7771}.sale-item-numbers{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.sale-item-numbers span{display:grid;gap:2px;padding:7px 8px;border-radius:8px;background:#f8faf9}.sale-item-numbers b{font-size:12px}.discount-value{color:#a76912}.whatsapp-button{border-color:#b9dfc8!important;background:#f0faf4!important;color:#176d41!important}.whatsapp-share-note{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding:11px 13px;border:1px solid #e1e6e3;border-radius:11px;background:#f8faf9}.sale-actions button:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.35)}@media(max-width:900px){.sale-totals-grid{grid-template-columns:1fr 1fr}.sale-item-numbers{grid-template-columns:1fr 1fr}}@media(max-width:520px){.sale-totals-grid,.sale-item-numbers{grid-template-columns:1fr}}
'''
if '/* sale detail + WhatsApp v079 */' not in s: s+=css
p.write_text(s)

# Desktop version
p=Path('desktop-pdv/package.json'); data=json.loads(p.read_text()); data['version']='0.7.9'; p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
