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
  }

  headers(){
    const token=this.tokenProvider();
    return { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) };
  }

  async request(path,body){
    const controller=new AbortController();
    const timeoutMs=path==='/api/pdv/push'?45000:15000;
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(`${this.apiBase}${path}`,{
        method:'POST',headers:this.headers(),body:JSON.stringify(body||{}),signal:controller.signal,
      });
      const data=await response.json().catch(()=>({ok:false,error:`http_${response.status}`}));
      if(!response.ok||!data.ok) throw new Error(data.error||`http_${response.status}`);
      return data;
    }catch(error){
      if(error?.name==='AbortError') throw new Error('sync_timeout');
      throw error;
    }finally{ clearTimeout(timeout); }
  }

  start(){
    if(this.timer) return;
    this.timer=setInterval(()=>this.run(false).catch(()=>{}),this.intervalMs);
    this.run(false).catch(()=>{});
  }

  stop(){
    if(this.timer) clearInterval(this.timer);
    this.timer=null;
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
    for(const r of push?.results||[]){
      if(r.status==='processed') this.store.markProcessed(r.id,r.result);
      else this.store.markRejected(r.id,r.error);
    }
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

      // Only after all operations that truly happened on previous dates are on
      // the server do we freeze those sessions as pending_close.
      await this.request('/api/pdv/cash/rollover',{});

      // Current-day events can now safely open/use today's independent cash.
      const pending=this.store.pending(100);
      const current=pending.filter((event)=>{
        const date=syncEventBusinessDate(event);
        return !date||date>=today;
      });
      await this.pushEvents(current);

      // Covers a fully-offline historical cash_open that was first uploaded in
      // this run; if it was old, it is frozen only after its historical events.
      await this.request('/api/pdv/cash/rollover',{});

      const pull=await this.request('/api/pdv/pull',{since:this.store.get('cursor')||null});
      this.store.applyPull(pull);
      this.store.set('last_pull_at',new Date().toISOString());
      if(Array.isArray(pull.staff_users)) this.store.set('staff_users',JSON.stringify(pull.staff_users));
      if(Array.isArray(pull.payment_integrations)) this.store.set('payment_integrations',JSON.stringify(pull.payment_integrations));

      await this.request('/api/pdv/heartbeat',{
        appVersion:this.appVersion,
        capabilities:{offline:true,printing:true,serial:true,fiscalMenu:true,returns:true,pdf:true,configurableShortcuts:true,operators:true,multiPayment:true,cashDrawer:true,scale:true,tefBridge:true,stockConsistency:true,syncBackoff:true,autoSyncFiveMinutes:true,syncAfterOperatorLogin:true,operatorSyncProgress:true,searchOnlySaleCatalog:true,fullProductCatalogScreen:true,dailyCashSessions:true,dynamicCashPaymentMethods:true,overdueCashClosing:true,historicalQueueBeforeRollover:true},
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
