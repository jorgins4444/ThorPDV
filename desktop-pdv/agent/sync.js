const crypto = require('crypto');
const path = require('path');
const { Worker } = require('worker_threads');
const CASH_SYNC_TIME_ZONE='America/Fortaleza';

function syncBusinessDate(value=Date.now()){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:CASH_SYNC_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=(type)=>parts.find((x)=>x.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function syncEventBusinessDate(event){
  const payload=event?.payload||{};
  const explicit=String(payload.business_date||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return syncBusinessDate(payload.occurred_at||Date.now());
}

class SyncEngine {
  constructor({ store, apiBase, tokenProvider, onState, appVersion='0.3.0' }) {
    this.store=store;
    this.apiBase=apiBase.replace(/\/$/,'');
    this.tokenProvider=tokenProvider;
    this.onState=onState||(()=>{});
    this.appVersion=appVersion;
    this.timer=null;
    this.running=false;
    this.failures=0;
    this.backoffUntil=0;
    this.intervalMs=5*60*1000;
    this.requestWorker=null;
    this.requestPending=new Map();
    this.stopping=false;
  }

  rejectWorkerPending(worker,error){
    for(const [id,pending] of this.requestPending.entries()){
      if(pending.worker!==worker) continue;
      this.requestPending.delete(id);
      pending.reject(error);
    }
  }

  ensureRequestWorker(){
    if(this.requestWorker)return this.requestWorker;
    const worker=new Worker(path.join(__dirname,'sync-request-worker.js'));
    worker.on('message',(row)=>{
      const pending=this.requestPending.get(String(row.id));if(!pending||pending.worker!==worker)return;
      this.requestPending.delete(String(row.id));
      this.store.metric('sync.http',row.durationMs||0,{path:pending.path,ok:row.ok,status:row.status||0});
      if(row.ok)pending.resolve(row.data);else pending.reject(new Error(row.error||row.data?.error||`http_${row.status||0}`));
    });
    worker.on('error',(error)=>{
      this.rejectWorkerPending(worker,error instanceof Error?error:new Error(String(error||'sync_worker_error')));
      if(this.requestWorker===worker)this.requestWorker=null;
    });
    worker.on('exit',(code)=>{
      const error=new Error(this.stopping?'sync_stopped':`sync_worker_exit_${Number(code)||0}`);
      this.rejectWorkerPending(worker,error);
      if(this.requestWorker===worker)this.requestWorker=null;
    });
    this.requestWorker=worker;return worker;
  }

  headers(){
    const token=this.tokenProvider();
    return { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) };
  }

  async control(type,payload={}){
    const id=crypto.randomUUID();
    const response=await this.request('/api/pdv/push',{events:[{id,type,payload}]});
    const row=(response.results||[]).find((item)=>String(item.id)===String(id))||(response.results||[])[0];
    if(!row) throw new Error('cash_command_empty_response');
    if(row.status!=='processed') throw new Error(row.error||row.result?.error||'cash_command_failed');
    if(row.result?.ok===false) throw new Error(row.result.error||'cash_command_failed');
    return row.result||{};
  }

  async request(pathname,body){
    const timeoutMs=pathname==='/api/pdv/push'?45000:15000;
    const id=crypto.randomUUID();
    const worker=this.ensureRequestWorker();
    return new Promise((resolve,reject)=>{
      this.requestPending.set(id,{resolve,reject,path:pathname,worker});
      try{
        worker.postMessage({id,url:`${this.apiBase}${pathname}`,headers:this.headers(),body,timeoutMs});
      }catch(error){
        this.requestPending.delete(id);
        if(this.requestWorker===worker)this.requestWorker=null;
        reject(error instanceof Error?error:new Error(String(error||'sync_worker_post_failed')));
      }
    });
  }

  start(){
    if(this.timer) return;
    this.stopping=false;
    // v0.8.27+: one authoritative pull repairs legacy local inventory drift.
    if(this.store.get('stock_authoritative_pull_v105')!=='1'){
      this.store.set('cursor','');
      this.store.set('stock_authoritative_pull_v105','1');
    }
    this.timer=setInterval(()=>this.run(false).catch(()=>{}),this.intervalMs);
    this.run(false).catch(()=>{});
  }

  stop(){
    this.stopping=true;
    if(this.timer) clearInterval(this.timer);
    this.timer=null;
    const worker=this.requestWorker;
    if(worker)this.rejectWorkerPending(worker,new Error('sync_stopped'));
    try{worker?.terminate();}catch{}
    if(this.requestWorker===worker)this.requestWorker=null;
  }

  nextBackoff(){
    return Math.min(60000,5000*Math.pow(2,Math.max(this.failures-1,0)));
  }

  async waitForIdle(maxWaitMs=20000){
    const started=Date.now();
    while(this.running && Date.now()-started<maxWaitMs){
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return !this.running;
  }

  applyPushResults(push){
    let rejectedSale=false;
    for(const r of push?.results||[]){
      if(r.status==='processed'){
        this.store.markProcessed(r.id,r.result);
      }else{
        const local=this.store.db.prepare('select type from queue where id=?').get(r.id);
        if(local?.type==='sale_completed') rejectedSale=true;
        this.store.markRejected(r.id,r.error||r.result?.error);
      }
    }
    // A rejected sale was already reserved/debited in the offline cache. Force
    // the next pull in this same run to overwrite inventory with server truth.
    if(rejectedSale) this.store.set('cursor','');
    this.store.set('last_push_at',new Date().toISOString());
  }

  async pushEvents(events){
    if(!events?.length) return null;
    const push=await this.request('/api/pdv/push',{events:events.map(({id,type,payload})=>({id,type,payload}))});
    this.applyPushResults(push);
    return push;
  }

  async flushPreviousBusinessDays(today){
    // Events are persisted in creation order. We drain prior-day events before
    // rollover so sales/movements genuinely performed yesterday can still reach
    // yesterday's open session even if the terminal stayed offline overnight.
    // Rollover only happens after the historical queue has been drained.
    let batches=0;
    while(batches<20){
      const pending=this.store.pending(100);
      const historical=pending.filter((event)=>{
        const date=syncEventBusinessDate(event);
        return Boolean(date&&date<today);
      });
      if(!historical.length) return {drained:true,batches};
      await this.pushEvents(historical);
      batches+=1;
      if(historical.length<100){
        const remaining=this.store.pending(100).some((event)=>{
          const date=syncEventBusinessDate(event);
          return Boolean(date&&date<today);
        });
        if(!remaining) return {drained:true,batches};
      }
    }
    return {drained:false,batches};
  }

  async run(force=false){
    if(!this.tokenProvider()) return {ok:false,error:'not_enrolled'};
    if(this.running){
      if(!force) return {ok:false,error:'sync_in_progress'};
      const idle=await this.waitForIdle();
      if(!idle) return {ok:false,error:'sync_busy'};
    }
    if(!force&&this.backoffUntil>Date.now()) return {ok:false,error:'sync_backoff',retryAt:new Date(this.backoffUntil).toISOString()};

    this.running=true;
    this.onState({syncing:true});
    try{
      const today=syncBusinessDate();
      const historical=await this.flushPreviousBusinessDays(today);
      if(!historical.drained) throw new Error('historical_sync_queue_too_large');

      await this.control('cash_rollover',{});

      const pending=this.store.pending(100);
      const current=pending.filter((event)=>{
        const date=syncEventBusinessDate(event);
        return !date||date>=today;
      });
      await this.pushEvents(current);

      await this.control('cash_rollover',{});

      const pull=await this.request('/api/pdv/pull',{since:this.store.get('cursor')||null});
      const applyStarted=Date.now();
      this.store.applyPull(pull);
      this.store.metric('sync.apply_local',Date.now()-applyStarted,{products:(pull.products||[]).length,inventory:(pull.inventory||[]).length});
      this.store.set('last_pull_at',new Date().toISOString());
      if(Array.isArray(pull.staff_users)) this.store.set('staff_users',JSON.stringify(pull.staff_users));
      if(Array.isArray(pull.payment_integrations)) this.store.set('payment_integrations',JSON.stringify(pull.payment_integrations));

      await this.request('/api/pdv/heartbeat',{
        appVersion:this.appVersion,
        capabilities:{offline:true,printing:true,serial:true,fiscalMenu:true,returns:true,pdf:true,configurableShortcuts:true,operators:true,multiPayment:true,cashDrawer:true,scale:true,tefBridge:true,stockConsistency:true,syncBackoff:true,autoSyncFiveMinutes:true,syncAfterOperatorLogin:true,operatorSyncProgress:true,searchOnlySaleCatalog:true,fullProductCatalogScreen:true,dailyCashSessions:true,dynamicCashPaymentMethods:true,overdueCashClosing:true,historicalQueueBeforeRollover:true,authoritativeStockAfterReject:true},
        metrics:{
          queue:this.store.queueStats(),
          operatorId:this.store.get('current_operator_id')||null,
          lastPushAt:this.store.get('last_push_at')||null,
          lastPullAt:this.store.get('last_pull_at')||null,
        },
      });
      this.store.set('last_heartbeat_at',new Date().toISOString());

      this.failures=0;
      this.backoffUntil=0;
      this.store.set('last_sync_at',new Date().toISOString());
      this.store.set('last_sync_error','');
      this.onState({online:true,syncing:false,lastSyncAt:this.store.get('last_sync_at'),failures:0});
      return {ok:true,pull};
    }catch(error){
      this.failures+=1;
      const delay=this.nextBackoff();
      this.backoffUntil=Date.now()+delay;
      this.store.set('last_sync_error',error.message);
      this.store.set('last_sync_backoff_ms',delay);
      for(const p of this.store.pending(100)) this.store.markRetry(p.id,error.message);
      this.onState({online:false,syncing:false,error:error.message,failures:this.failures,backoffUntil:new Date(this.backoffUntil).toISOString()});
      return {ok:false,error:error.message,retryInMs:delay};
    }finally{
      this.running=false;
    }
  }
}

module.exports={SyncEngine,syncBusinessDate,syncEventBusinessDate};
