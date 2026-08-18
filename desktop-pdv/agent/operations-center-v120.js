const crypto = require('crypto');
const hardware = require('./hardware');

const WIDTH = 44;
const SEP = '-'.repeat(WIDTH);
const text = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
const money = (v) => num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const json = (v,fallback={}) => { try{return JSON.parse(v||'');}catch{return fallback;} };
const center = (v) => { const s=text(v).slice(0,WIDTH); return ' '.repeat(Math.max(0,Math.floor((WIDTH-s.length)/2)))+s; };
const pair = (a,b) => { const l=text(a),r=text(b); return (l+' '.repeat(Math.max(1,WIDTH-l.length-r.length))+r).slice(0,WIDTH); };
function wrap(v,prefix=''){const words=text(v).split(' ').filter(Boolean),out=[];let line=prefix;for(const word of words){const next=line+(line===prefix?'':' ')+word;if(next.length>WIDTH){if(line.trim())out.push(line);line=' '.repeat(prefix.length)+word;}else line=next;}if(line.trim())out.push(line);return out;}
function hasPermission(user,path,fallback=false){let value=user?.permissions;for(const key of String(path).split('.'))value=value&&typeof value==='object'?value[key]:undefined;return value==null?fallback:Boolean(value);}
function contextOf(agent){return json(agent.store.get('context','{}'),{});}
function companyLines(agent){const c=contextOf(agent),company=c.company_trade_name||c.company_name||c.tenant_name||'THORPDV',branch=c.branch_name||c.store_name||'';return [center(company),...(branch?[center(branch)]:[])];}
function operationTitle(type){return ({sale:'VENDA',receivable:'RECEBIMENTO DE CREDIARIO',cash_supply:'SUPRIMENTO',cash_withdrawal:'SANGRIA',sale_cancel:'CANCELAMENTO DE VENDA',sale_return:'DEVOLUCAO',cash_open:'ABERTURA DE CAIXA',cash_close:'FECHAMENTO DE CAIXA'})[type]||text(type).toUpperCase();}
function genericReceipt(agent,doc,secondCopy=true){
  const p=doc.payload||{},lines=[...companyLines(agent),SEP,center(secondCopy?'*** COMPROVANTE - 2a VIA ***':'*** COMPROVANTE ***'),center(operationTitle(doc.type)),SEP];
  if(doc.reference)lines.push(pair('Referencia:',doc.reference));
  lines.push(pair('Data:',new Date(doc.created_at||Date.now()).toLocaleString('pt-BR')));
  if(p.operator?.name||p.operator_name)lines.push(...wrap(p.operator?.name||p.operator_name,'Operador: '));
  if(p.supervisor?.name||p.supervisor_name)lines.push(...wrap(p.supervisor?.name||p.supervisor_name,'Supervisor: '));
  if(p.customer_name)lines.push(...wrap(p.customer_name,'Cliente: '));
  if(p.amount!=null)lines.push(pair('Valor:','R$ '+money(p.amount)));
  if(p.total!=null)lines.push(pair('Total:','R$ '+money(p.total)));
  if(p.opening_amount!=null)lines.push(pair('Fundo inicial:','R$ '+money(p.opening_amount)));
  if(p.closing_amount!=null)lines.push(pair('Valor contado:','R$ '+money(p.closing_amount)));
  if(p.difference!=null)lines.push(pair('Diferenca:','R$ '+money(p.difference)));
  if(Array.isArray(p.items)&&p.items.length){lines.push(SEP,'ITENS');for(const item of p.items){lines.push(...wrap(item.name||item.description||item.sku||'Item'));lines.push(pair((num(item.quantity)||1)+' x '+money(item.unit_price??item.unitPrice),money(item.total??num(item.quantity)*num(item.unit_price??item.unitPrice))));}}
  if(Array.isArray(p.payments)&&p.payments.length){lines.push(SEP,'PAGAMENTOS');for(const pay of p.payments)lines.push(pair(text(pay.name||pay.method).replace(/_/g,' '),'R$ '+money(pay.amount)));}
  if(p.reason||p.notes)lines.push(SEP,...wrap(p.reason||p.notes,'Motivo: '));
  lines.push(SEP,center(secondCopy?'REIMPRESSAO AUDITADA - 2a VIA':'DOCUMENTO OPERACIONAL'),'', '');
  return lines.join('\n');
}
function installOperationsCenterV120(ThorAgent){
  const proto=ThorAgent.prototype;
  const migrate=function(){
    this.store.db.exec(`
      create table if not exists operation_documents(
        id text primary key,type text not null,reference text,source_event_id text,payload text not null,
        sensitive integer not null default 0,created_at text not null,updated_at text not null
      );
      create index if not exists idx_operation_documents_date on operation_documents(created_at desc);
      create index if not exists idx_operation_documents_type on operation_documents(type,created_at desc);
      create unique index if not exists idx_operation_documents_event_type on operation_documents(source_event_id,type) where source_event_id is not null and source_event_id<>'';
      create table if not exists supervisor_audit(
        id text primary key,action text not null,operator_id text,operator_name text,supervisor_id text not null,
        supervisor_name text not null,reason text,requested_value real not null default 0,metadata text not null default '{}',created_at text not null
      );
      create index if not exists idx_supervisor_audit_date on supervisor_audit(created_at desc);
      create table if not exists draft_sales(
        id text primary key,number text not null,status text not null default 'open',customer_id text,customer_name text,
        operator_id text,operator_name text,payload text not null,created_at text not null,updated_at text not null
      );
      create index if not exists idx_draft_sales_status on draft_sales(status,updated_at desc);
    `);
    const cols=new Set(this.store.db.prepare('pragma table_info(queue)').all().map(r=>r.name));
    if(!cols.has('next_attempt_at'))this.store.db.exec('alter table queue add column next_attempt_at text');
    if(!cols.has('dedupe_key'))this.store.db.exec('alter table queue add column dedupe_key text');
    this.store.db.exec("create unique index if not exists idx_queue_dedupe on queue(dedupe_key) where dedupe_key is not null and dedupe_key<>''");
  };
  proto._ensureOperationsV120=function(){if(this._operationsV120Ready)return;this._operationsV120Ready=true;migrate.call(this);};
  const originalStart=proto.start;
  proto.start=async function(...args){this._ensureOperationsV120();const r=await originalStart.apply(this,args);this.retryPendingOperations().catch(()=>{});return r;};
  proto.saveOperationDocument=function(type,reference,sourceEventId,payload={},sensitive=false){
    this._ensureOperationsV120();const now=new Date().toISOString(),id=crypto.randomUUID();
    this.store.db.prepare(`insert into operation_documents(id,type,reference,source_event_id,payload,sensitive,created_at,updated_at)
      values(?,?,?,?,?,?,?,?) on conflict(source_event_id,type) do update set reference=excluded.reference,payload=excluded.payload,sensitive=excluded.sensitive,updated_at=excluded.updated_at`)
      .run(id,text(type),text(reference),sourceEventId?text(sourceEventId):null,JSON.stringify(payload||{}),sensitive?1:0,now,now);
    return id;
  };
  proto.operationHistory=function({query='',type='all',limit=200}={}){
    this._ensureOperationsV120();const q='%'+text(query).toLowerCase()+'%',max=Math.min(Math.max(Number(limit)||200,1),500);
    return this.store.db.prepare(`select id,type,reference,source_event_id,payload,sensitive,created_at
      from operation_documents where (?='all' or type=?) and (?='%%' or lower(coalesce(reference,'')||' '||payload) like ?)
      order by datetime(created_at) desc limit ?`).all(type,type,q,q,max).map(r=>({...r,payload:json(r.payload,{}),sensitive:Boolean(r.sensitive)}));
  };
  proto._recordSupervisorAudit=function(auth,action,reason='',requestedValue=0,metadata={}){
    const op=this.currentOperator?.()||{};const now=new Date().toISOString();
    this.store.db.prepare('insert into supervisor_audit(id,action,operator_id,operator_name,supervisor_id,supervisor_name,reason,requested_value,metadata,created_at) values(?,?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(),text(action),text(op.id),text(op.name),text(auth.supervisor_user_id),text(auth.supervisor_name),text(reason||auth.reason),num(requestedValue||auth.requested_value),JSON.stringify(metadata||{}),now);
  };
  proto.authorizeSensitiveAction=function(payload={}){
    const result=this.authorizeSupervisor(payload),auth=result.authorization;
    if(text(payload.reason).length<5)throw new Error('supervisor_reason_required');
    this._recordSupervisorAudit(auth,payload.action,payload.reason,payload.requestedValue,payload.metadata);
    return result;
  };
  proto._validAuthorization=function(auth,action){
    if(!auth?.supervisor_user_id)return false;
    const age=Date.now()-Date.parse(auth.authorized_at||0);if(!Number.isFinite(age)||age>10*60*1000)return false;
    if(action&&text(auth.action)!==text(action))return false;
    const sup=this._staffUsersWithHash?.().find(u=>String(u.id)===String(auth.supervisor_user_id));
    return Boolean(sup&&hasPermission(sup,'supervisor.authorize',false));
  };
  proto.reprintOperation=async function({documentId,supervisorAuthorization=null,reason=''}={}){
    this._ensureOperationsV120();const row=this.store.db.prepare('select * from operation_documents where id=?').get(text(documentId));if(!row)throw new Error('operation_document_not_found');
    const doc={...row,payload:json(row.payload,{})};const operator=this.currentOperator?.();if(!operator)throw new Error('operator_required');
    const permitted=hasPermission(operator,'print.reprint',false);
    if((doc.sensitive||!permitted)&&!this._validAuthorization(supervisorAuthorization,'sensitive_reprint'))throw new Error('supervisor_authorization_required');
    if(supervisorAuthorization)this._recordSupervisorAudit(supervisorAuthorization,'sensitive_reprint',reason,0,{document_id:doc.id,type:doc.type,reference:doc.reference});
    let receipt;
    if(doc.type==='sale'&&doc.source_event_id){try{receipt=this.documentData('local:'+doc.source_event_id,'pre_sale').text;}catch{}}
    if(!receipt)receipt=genericReceipt(this,doc,true);
    const target=this.store.settings().printerName;if(target==='__PDF__')throw new Error('pdf_requires_ui');
    await hardware.printText(target,receipt);
    this.event('document_reprinted',{document_id:doc.id,document_type:doc.type,reference:doc.reference,reason:text(reason),operator_user_id:operator.id,supervisor_authorization:supervisorAuthorization||null,copy_label:'2a via'});
    return {ok:true,label:'2ª via',document:{id:doc.id,type:doc.type,reference:doc.reference}};
  };
  proto.pendingOperations=function(){
    this._ensureOperationsV120();return this.store.db.prepare(`select id,type,state,attempts,last_error,created_at,updated_at,next_attempt_at,payload from queue
      where state in ('pending','rejected') order by case state when 'rejected' then 0 else 1 end,datetime(created_at) limit 300`).all().map(r=>({...r,payload:json(r.payload,{})}));
  };
  proto.retryOperation=async function(eventId){
    this._ensureOperationsV120();const row=this.store.db.prepare('select id from queue where id=?').get(text(eventId));if(!row)throw new Error('queue_event_not_found');
    this.store.db.prepare("update queue set state='pending',last_error=null,next_attempt_at=null,updated_at=? where id=?").run(new Date().toISOString(),row.id);
    const result=await this.sync.run(true);return {ok:Boolean(result?.ok),sync:result,pending:this.pendingOperations()};
  };
  proto.retryPendingOperations=async function(){
    this._ensureOperationsV120();const now=new Date().toISOString();
    this.store.db.prepare("update queue set state='pending',next_attempt_at=null,updated_at=? where state='rejected' and attempts<8 and (next_attempt_at is null or next_attempt_at<=?)").run(now,now);
    return this.sync.run();
  };
  proto.saveDraftSale=function(payload={}){
    this._ensureOperationsV120();const op=this.currentOperator?.();if(!op)throw new Error('operator_required');
    if(!Array.isArray(payload.items)||!payload.items.length)throw new Error('empty_cart');
    const now=new Date().toISOString(),id=text(payload.id)||crypto.randomUUID();
    const existing=this.store.db.prepare('select number,created_at from draft_sales where id=?').get(id);
    const seq=Number(this.store.get('draft_sale_sequence','0'))+1;if(!existing)this.store.set('draft_sale_sequence',String(seq));
    const number=existing?.number||('PV-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(seq).padStart(4,'0'));
    this.store.db.prepare(`insert into draft_sales(id,number,status,customer_id,customer_name,operator_id,operator_name,payload,created_at,updated_at)
      values(?,?,'open',?,?,?,?,?,?,?) on conflict(id) do update set customer_id=excluded.customer_id,customer_name=excluded.customer_name,
      operator_id=excluded.operator_id,operator_name=excluded.operator_name,payload=excluded.payload,status='open',updated_at=excluded.updated_at`)
      .run(id,number,text(payload.customerId),text(payload.customerName),text(op.id),text(op.name),JSON.stringify(payload),existing?.created_at||now,now);
    return {ok:true,id,number};
  };
  proto.draftSales=function(query=''){
    this._ensureOperationsV120();const q='%'+text(query).toLowerCase()+'%';return this.store.db.prepare(`select * from draft_sales where status='open' and (?='%%' or lower(number||' '||coalesce(customer_name,'')||' '||coalesce(operator_name,'')) like ?) order by datetime(updated_at) desc limit 200`).all(q,q).map(r=>({...r,payload:json(r.payload,{})}));
  };
  proto.loadDraftSale=function(id){this._ensureOperationsV120();const r=this.store.db.prepare("select * from draft_sales where id=? and status='open'").get(text(id));if(!r)throw new Error('draft_sale_not_found');return {...r,payload:json(r.payload,{})};};
  proto.completeDraftSale=function(id,eventId=''){this._ensureOperationsV120();this.store.db.prepare("update draft_sales set status='converted',updated_at=?,payload=json_set(payload,'$.convertedEventId',?) where id=?").run(new Date().toISOString(),text(eventId),text(id));return {ok:true};};
  proto.deleteDraftSale=function(id){this._ensureOperationsV120();this.store.db.prepare("update draft_sales set status='cancelled',updated_at=? where id=?").run(new Date().toISOString(),text(id));return {ok:true};};

  function wrapMethod(name,handler){const original=proto[name];if(typeof original!=='function')return;proto[name]=async function(...args){const result=await original.apply(this,args);try{await handler.call(this,result,args[0]||{});}catch(error){console.warn('operations_v120_capture_failed',name,error?.message);}return result;};}
  wrapMethod('finalizeSale',function(result,input){const r=result.receipt||{};this.saveOperationDocument('sale',result.eventId,result.eventId,{...r,total:result.total,operator_name:r.operator?.name},false);});
  wrapMethod('openCash',function(result,input){const op=this.currentOperator?.()||{};this.saveOperationDocument('cash_open',result.eventId,result.eventId,{opening_amount:num(input.openingAmount),notes:text(input.notes),operator_name:op.name},true);});
  wrapMethod('cashMovement',function(result,input){const receipt=result.receipt||{},kind=text(input.movementType)==='withdrawal'?'cash_withdrawal':'cash_supply';this.saveOperationDocument(kind,result.eventId,result.eventId,{...receipt,amount:num(input.amount),notes:text(input.notes),operator_name:receipt.operator?.name||this.currentOperator?.()?.name,supervisor_name:receipt.supervisor?.name},true);});
  wrapMethod('closeCash',function(result,input){const s=result.summary||{};this.saveOperationDocument('cash_close',result.eventId,result.eventId,{...s,closing_amount:num(input.closingAmount),operator_name:s.operator?.name||this.currentOperator?.()?.name},true);});
  wrapMethod('cancelSale',function(result,input){const r=result.receipt||result||{};this.saveOperationDocument('sale_cancel',r.sale_number||input.saleKey,result.eventId||r.event_id,{...r,reason:input.reason,operator_name:r.operator?.name||this.currentOperator?.()?.name},true);});
  wrapMethod('returnSale',function(result,input){this.saveOperationDocument('sale_return',input.saleKey||input.saleId,result.eventId,{...result,reason:input.reason,items:input.items,operator_name:this.currentOperator?.()?.name},true);});
  wrapMethod('receiveReceivables',function(result,input){const r=result.receipt||result||{};this.saveOperationDocument('receivable',r.receipt_number||result.eventId,result.eventId||r.event_id,{...r,total:r.total_received||r.total||input.amount,customer_name:r.customer_name,operator_name:r.operator_name||this.currentOperator?.()?.name},true);});

  const originalFinalize=proto.finalizeSale;
  proto.finalizeSale=async function(input={}){
    const requestKey=text(input.clientRequestId||input.client_request_id);
    if(requestKey){this._ensureOperationsV120();const existing=this.store.db.prepare("select id,payload from queue where dedupe_key=? and type='sale_completed'").get(requestKey);if(existing){const receipt=this.store.receiptByEvent(existing.id);return {ok:true,eventId:existing.id,total:receipt?.total||0,receipt:receipt?.payload||{},duplicatePrevented:true};}}
    this._enforceStockAtFinalize=true;
    this._supervisorNegativeStock=this._validAuthorization(input.supervisorAuthorization,'negative_stock');
    try{const result=await originalFinalize.call(this,input);if(requestKey)this.store.db.prepare('update queue set dedupe_key=? where id=?').run(requestKey,result.eventId);return result;}finally{this._supervisorNegativeStock=false;this._enforceStockAtFinalize=false;}
  };
  const originalCancelSale=proto.cancelSale;
  proto.cancelSale=async function(input={}){
    if(!this._validAuthorization(input.supervisorAuthorization,'cancel_sale'))throw new Error('supervisor_authorization_required');
    return originalCancelSale.call(this,input);
  };
  const originalCashMovement=proto.cashMovement;
  proto.cashMovement=async function(input={}){
    const threshold=Math.max(num(this.store.get('cash_withdrawal_supervisor_threshold','500')),0);
    if(text(input.movementType)==='withdrawal'&&num(input.amount)>=threshold&&!this._validAuthorization(input.supervisorAuthorization,'high_withdrawal'))throw new Error('supervisor_authorization_required');
    return originalCashMovement.call(this,input);
  };
  const originalCloseHistorical=proto.closeHistoricalCash;
  if(typeof originalCloseHistorical==='function')proto.closeHistoricalCash=async function(input={}){if(!this._validAuthorization(input.supervisorAuthorization,'reopen_cash'))throw new Error('supervisor_authorization_required');this._recordSupervisorAudit(input.supervisorAuthorization,'reopen_cash',input.notes,0,{cash_open_event_id:input.cashOpenEventId});return originalCloseHistorical.call(this,input);};
}
module.exports={installOperationsCenterV120};
