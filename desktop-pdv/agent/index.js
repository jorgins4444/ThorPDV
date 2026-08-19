const os = require('os');
const crypto = require('crypto');
const { Store } = require('./store');
const { SyncEngine } = require('./sync');
const hardware = require('./hardware');

const { version: APP_VERSION } = require('../package.json');

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

class ThorAgent {
  constructor({dataDir,apiBase,codec}){ this.store=new Store(dataDir); this.apiBase=apiBase; this.codec=codec; this.state={online:false,syncing:false}; this.sync=new SyncEngine({store:this.store,apiBase,tokenProvider:()=>this.deviceToken(),onState:(s)=>Object.assign(this.state,s),appVersion:APP_VERSION}); }
  deviceToken(){ return this.codec.decrypt(this.store.get('device_token')); }
  async start(){ if(this.deviceToken()) this.sync.start(); }
  async stop(){ this.sync.stop(); this.store.close(); }
  async status(){ const settings=this.store.settings(); return { enrolled:Boolean(this.deviceToken()), online:this.state.online, syncing:this.state.syncing, context:JSON.parse(this.store.get('context','{}')||'{}'), queue:this.store.queueStats(), lastSyncAt:this.store.get('last_sync_at')||null, lastError:this.store.get('last_sync_error')||null, cashOpenEventId:this.store.get('cash_open_event_id')||null, printer:settings.printerName||null, settings, appVersion:APP_VERSION, apiBase:this.apiBase }; }
  async enroll({code,name}){ const body={code,machineId:hardware.machineId(),name:name||`ThorPDV - ${os.hostname()}`,hostname:os.hostname(),appVersion:APP_VERSION,capabilities:{offline:true,printing:process.platform==='win32',serial:process.platform==='win32',fiscalMenu:true,returns:true,pdf:true}}; const response=await fetch(`${this.apiBase}/api/pdv/enroll`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); const data=await response.json(); if(!response.ok||!data.ok) throw new Error(data.error||'enrollment_failed'); this.store.set('device_token',this.codec.encrypt(data.device_token)); this.store.set('device_id',data.device_id); this.sync.start(); await this.sync.run(); return this.status(); }
  async syncNow(){ return this.sync.run(); }
  searchProducts(q){ return this.store.searchProducts(q); }
  searchCustomers(q){ return this.store.searchCustomers(q); }

  resolvePrice(product,qty){ let price=Number(product.base_price||product.sale_price||0); for(const promo of this.store.promotions()){ const r=promo.rules||{}; const min=Number(r.min_qty||1); if(qty<min) continue; if(r.product_id && r.product_id!==product.id) continue; if(r.group_id && r.group_id!==product.group_id) continue; const discount=Number(r.discount_value||0); const candidate=r.discount_type==='fixed'?Math.max(price-discount,0):Math.max(price*(1-discount/100),0); price=Math.min(price,candidate); } return Math.round(price*100)/100; }
  quoteSale(items=[],discount=0){
    if(!Array.isArray(items)||!items.length) return {items:[],subtotal:0,discount:0,total:0};
    let subtotal=0; const resolved=[];
    for(const item of items){
      const p=this.store.product(item.productId); if(!p||!p.active) throw new Error('product_not_found');
      const qty=Number(item.quantity||0); if(qty<=0) throw new Error('invalid_quantity');
      const price=this.resolvePrice(p,qty); const itemDiscount=Math.max(Number(item.discount||0),0); const line=Math.max(qty*price-itemDiscount,0);
      subtotal+=line; resolved.push({productId:p.id,name:p.name,sku:p.sku,unit:p.unit,quantity:qty,unitPrice:price,discount:itemDiscount,total:line,stock:Number(p.quantity||0)});
    }
    const saleDiscount=Math.min(Math.max(Number(discount||0),0),subtotal); return {items:resolved,subtotal,discount:saleDiscount,total:Math.max(subtotal-saleDiscount,0)};
  }
  event(type,payload){ const e={id:crypto.randomUUID(),type,payload:{...payload,occurred_at:new Date().toISOString()}}; this.store.enqueue(e); setTimeout(()=>this.sync.run().catch(()=>{}),600); return e; }
  async openCash({openingAmount=0,notes=''}){ if(this.store.get('cash_open_event_id')) throw new Error('cash_already_open'); const e=this.event('cash_open',{opening_amount:Number(openingAmount)||0,notes}); this.store.set('cash_open_event_id',e.id); return {ok:true,eventId:e.id}; }
  async cashMovement({movementType,amount,notes=''}){ if(!this.store.get('cash_open_event_id')) throw new Error('cash_not_open'); return {ok:true,eventId:this.event('cash_movement',{movement_type:movementType,amount:Number(amount)||0,notes}).id}; }
  async closeCash({closingAmount=0,notes=''}){ if(!this.store.get('cash_open_event_id')) throw new Error('cash_not_open'); const e=this.event('cash_close',{closing_amount:Number(closingAmount)||0,notes}); this.store.set('cash_open_event_id',''); return {ok:true,eventId:e.id}; }
  async finalizeSale({items,customerId=null,payments=[],discount=0,notes=''}){
    const performanceStarted=Date.now();
    const cashOpenEventId=this.store.get('cash_open_event_id'); if(!cashOpenEventId) throw new Error('cash_not_open');
    const quote=this.quoteSale(items,discount); if(!quote.items.length) throw new Error('empty_cart');
    const normalizedPayments=(payments||[]).map(p=>({method:p.method,amount:Number(p.amount||0),provider:p.provider||null,external_id:p.externalId||null,txid:p.txid||null,metadata:p.metadata||{}})); const paid=normalizedPayments.reduce((s,p)=>s+p.amount,0); if(paid>quote.total+0.01) throw new Error('payment_exceeds_total');
    const payload={cash_open_event_id:cashOpenEventId,customer_id:customerId||null,items:quote.items.map(i=>({product_id:i.productId,quantity:i.quantity,unit_price:i.unitPrice,discount:i.discount})),payments:normalizedPayments,discount:quote.discount,notes}; const event=this.event('sale_completed',payload);
    for(const i of quote.items) this.store.adjustInventory(i.productId,-i.quantity);
    const receipt={eventId:event.id,items:quote.items.map(i=>({product_id:i.productId,quantity:i.quantity,returned_quantity:0,unit_price:i.unitPrice,discount:i.discount,name:i.name,sku:i.sku,unit:i.unit,total:i.total})),subtotal:quote.subtotal,discount:quote.discount,total:quote.total,payments:normalizedPayments,customerId,createdAt:new Date().toISOString(),context:JSON.parse(this.store.get('context','{}')||'{}'),local_status:'pending_sync',returned_total:0}; this.store.saveReceipt(event.id,quote.total,receipt);
    this.store.metric('sale.finalize_local',Date.now()-performanceStarted,{items:quote.items.length,payments:normalizedPayments.length,total:quote.total});
    return {ok:true,eventId:event.id,subtotal:quote.subtotal,total:quote.total,paid,receipt};
  }

  fiscalSales(query=''){ return this.store.fiscalSales(query); }
  fiscalSale(key){ const sale=this.store.fiscalSale(key); if(!sale) throw new Error('sale_not_found'); const items=(sale.items||[]).map(i=>{const product=i.product_id?this.store.product(String(i.product_id)):null;return {...i,name:i.name||i.description||product?.name||'',description:i.description||i.name||product?.name||'',sku:i.sku||product?.sku||product?.code||'',unit:i.unit||product?.unit||''};}); return {...sale,items}; }

  async cancelSale({saleKey,saleClientEventId=null,saleId=null,reason=''}){
    const sale=saleKey?this.fiscalSale(saleKey):null;
    const targetSaleId=saleId||sale?.id||null;
    const targetEvent=saleClientEventId||sale?.client_event_id||null;
    if(sale){
      if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending') throw new Error('sale_already_cancelled');
      if(Number(sale.returned_total||0)>0) throw new Error('sale_has_returns');
      if(sale.fiscal?.status==='authorized') throw new Error('authorized_fiscal_document_requires_fiscal_cancellation');
      for(const i of sale.items||[]) if(i.product_id) this.store.adjustInventory(String(i.product_id),Number(i.quantity||0));
      this.store.patchLocalSale(sale,{status:'cancel_pending',local_status:'cancel_pending'});
    }
    const e=this.event('sale_cancel',{sale_client_event_id:targetEvent,sale_id:targetSaleId,reason});
    return {ok:true,eventId:e.id};
  }

  async returnSale({saleKey,items,refundMethod='cash',reason=''}){
    const sale=this.fiscalSale(saleKey);
    if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending'||sale.fiscal?.status==='cancelled') throw new Error('sale_cancelled');
    if(refundMethod==='cash'&&!this.store.get('cash_open_event_id')) throw new Error('cash_required_for_cash_refund');
    if(!Array.isArray(items)||!items.length) throw new Error('return_without_items');
    const normalized=[];
    const increments=new Map();
    let localValue=0;
    for(const item of items){
      const original=(sale.items||[]).find(i=>String(i.sale_item_id||i.product_id)===String(item.sale_item_id||item.product_id));
      if(!original) throw new Error('sale_item_not_found');
      const qty=Number(item.quantity||0); if(qty<=0) throw new Error('invalid_return_quantity');
      const remaining=Math.max(Number(original.quantity||0)-Number(original.returned_quantity||0),0); if(qty>remaining+0.0001) throw new Error('return_quantity_exceeds_remaining');
      const unitNet=Number(original.quantity||0)>0?Number(original.total??(Number(original.quantity||0)*Number(original.unit_price||0)))/Number(original.quantity||1):0;
      localValue+=qty*unitNet;
      const itemKey=String(original.sale_item_id||original.product_id); increments.set(itemKey,(increments.get(itemKey)||0)+qty);
      normalized.push({sale_item_id:original.sale_item_id||null,product_id:original.product_id||null,quantity:qty});
      if(original.product_id) this.store.adjustInventory(String(original.product_id),qty);
    }
    const patchedItems=(sale.items||[]).map(original=>{const itemKey=String(original.sale_item_id||original.product_id);return {...original,returned_quantity:Number(original.returned_quantity||0)+(increments.get(itemKey)||0)};});
    this.store.patchLocalSale(sale,{returned_total:Number(sale.returned_total||0)+Math.round(localValue*100)/100,local_status:'return_pending',items:patchedItems});
    const e=this.event('sale_return',{sale_id:sale.id||null,sale_client_event_id:sale.client_event_id||null,items:normalized,refund_method:refundMethod,reason});
    return {ok:true,eventId:e.id,estimatedTotal:Math.round(localValue*100)/100};
  }

  async requestNfce({saleKey}){
    const sale=this.fiscalSale(saleKey);
    if(String(sale.status)==='cancelled'||String(sale.status)==='cancel_pending'||sale.fiscal?.status==='cancelled') throw new Error('sale_cancelled');
    if(sale.fiscal?.status==='authorized') return {ok:true,alreadyAuthorized:true,fiscal:sale.fiscal};
    const e=this.event('fiscal_nfce_request',{sale_id:sale.id||null,sale_client_event_id:sale.client_event_id||null});
    this.store.patchLocalSale(sale,{fiscal:{...(sale.fiscal||{}),status:'requested'}});
    return {ok:true,eventId:e.id,queued:true};
  }

  async listPrinters(){ return hardware.listPrinters(); }
  async listSerialPorts(){ return hardware.listSerialPorts(); }
  settings(){ return this.store.settings(); }
  saveSettings(input){ return this.store.saveSettings(input); }
  setPrinter(name){ return this.store.saveSettings({printerName:name||''}); }

  documentData(saleKey,type='pre_sale'){
    let sale=saleKey?this.store.fiscalSale(saleKey):null;
    if(!sale){ const r=this.store.lastReceipt(); if(r){ sale={id:r.server_sale_id||null,client_event_id:r.event_id,number:r.server_number||null,status:'completed',total:r.total,items:r.payload.items||[],payments:r.payload.payments||[],completed_at:r.payload.createdAt||r.created_at,created_at:r.created_at,context:r.payload.context||{},fiscal:r.payload.fiscal||null}; } }
    if(!sale) throw new Error('receipt_not_found');
    if(type!=='nfce'&&sale.fiscal?.status==='cancelled') throw new Error('pre_sale_unavailable_cancelled_nfce');
    if(type==='nfce'){
      if(!['authorized','cancelled'].includes(String(sale.fiscal?.status||''))) throw new Error('nfce_not_authorized');
      if(!sale.fiscal?.pdf_path) throw new Error('nfce_pdf_unavailable');
      return {kind:'remote_pdf',url:String(sale.fiscal.pdf_path),title:`NFC-e ${sale.fiscal.number||sale.number||''}`,filename:`NFCe-${sale.fiscal.number||sale.number||Date.now()}.pdf`,sale};
    }
    const context=sale.context||JSON.parse(this.store.get('context','{}')||'{}');
    const lines=[];
    lines.push('THORPDV'); lines.push(context.company_name||''); lines.push(context.branch_name||'');
    lines.push('COMPROVANTE / PRE-VENDA - NAO FISCAL');
    lines.push('------------------------------------------');
    lines.push(`Venda: ${sale.number||sale.client_event_id||''}`);
    for(const i of sale.items||[]){ const qty=Number(i.quantity||0),price=Number(i.unit_price||i.unitPrice||0),discount=Number(i.discount||0); lines.push(`${qty} x ${i.name||i.description||i.sku||'ITEM'}`); lines.push(`  ${price.toFixed(2)} = ${(qty*price-discount).toFixed(2)}`); }
    lines.push('------------------------------------------');
    lines.push(`TOTAL: R$ ${Number(sale.total||0).toFixed(2)}`);
    const payments=(sale.payments||[]).map(p=>`${p.method}: R$ ${Number(p.amount||0).toFixed(2)}`); if(payments.length){lines.push('PAGAMENTO');lines.push(...payments);}
    lines.push(`Data: ${new Date(sale.completed_at||sale.created_at||Date.now()).toLocaleString('pt-BR')}`);
    lines.push('DOCUMENTO NAO FISCAL'); lines.push('\n\n');
    const text=lines.join('\n');
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Consolas,monospace;padding:24px;color:#111}pre{white-space:pre-wrap;font-size:12px;line-height:1.45}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
    return {kind:'text',text,html,title:`Comprovante venda ${sale.number||''}`,filename:`ThorPDV-Venda-${sale.number||Date.now()}.pdf`,sale};
  }

  async printDocument(saleKey,type='pre_sale'){
    const doc=this.documentData(saleKey,type);
    if(doc.kind==='remote_pdf') throw new Error('remote_pdf_requires_ui');
    const target=this.store.settings().printerName;
    if(target==='__PDF__') throw new Error('pdf_requires_ui');
    await hardware.printText(target,doc.text); return {ok:true,target};
  }
  async printLastReceipt(){ return this.printDocument(null,'pre_sale'); }
}
module.exports={ThorAgent,APP_VERSION};
