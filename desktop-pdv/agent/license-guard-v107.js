const { SyncEngine } = require('./sync');

const BLOCK_CODES=new Set(['license_blocked','license_inactive','license_expired','license_not_found','pdv_module_disabled','device_blocked']);
const LICENSE_MESSAGE='Licença de uso bloqueada, por favor entrar em contato com o Administrador do Sistema';

function text(value){return String(value??'').trim()}
function setBlocked(store,code='license_blocked',reason=''){
  store.set('license_blocked','true');
  store.set('license_block_code',code);
  store.set('license_block_reason',reason||'');
  store.set('license_blocked_at',new Date().toISOString());
  store.set('current_operator_id','');
}
function clearBlocked(store){
  store.set('license_blocked','false');
  store.set('license_block_code','');
  store.set('license_block_reason','');
  store.set('license_blocked_at','');
}
function isBlocked(store){return store.get('license_blocked','false')==='true'}

function installLicenseGuardV107(ThorAgent){
  if(!SyncEngine.prototype.__licenseGuardV107){
    SyncEngine.prototype.__licenseGuardV107=true;
    const originalRun=SyncEngine.prototype.run;
    SyncEngine.prototype.run=async function(...args){
      const result=await originalRun.apply(this,args);
      const code=text(result?.error);
      if(result?.ok){
        if(isBlocked(this.store))clearBlocked(this.store);
        this.onState?.({licenseBlocked:false,licenseBlockCode:null});
      }else if(BLOCK_CODES.has(code)){
        setBlocked(this.store,code);
        this.onState?.({online:true,syncing:false,licenseBlocked:true,licenseBlockCode:code,error:code});
      }
      return result;
    };
  }

  const originalStart=ThorAgent.prototype.start;
  const originalStop=ThorAgent.prototype.stop;
  const originalStatus=ThorAgent.prototype.status;
  const originalLogin=ThorAgent.prototype.loginOperator;
  const originalEvent=ThorAgent.prototype.event;

  ThorAgent.prototype._licenseGuardStatus=function(){
    return {
      blocked:isBlocked(this.store),
      code:this.store.get('license_block_code')||null,
      reason:this.store.get('license_block_reason')||null,
      blockedAt:this.store.get('license_blocked_at')||null,
      message:isBlocked(this.store)?LICENSE_MESSAGE:null,
    };
  };

  ThorAgent.prototype.checkLicenseOnline=async function(){
    const token=this.deviceToken?.();
    if(!token)return {ok:false,error:'not_enrolled'};
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6000);
    try{
      const response=await fetch(`${String(this.apiBase||'').replace(/\/$/,'')}/api/pdv/license/status`,{
        method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:'{}',signal:controller.signal,
      });
      const data=await response.json().catch(()=>({ok:false,error:`http_${response.status}`}));
      if(response.ok&&data.ok){
        clearBlocked(this.store);
        this.state.licenseBlocked=false;
        this.state.licenseBlockCode=null;
        return {ok:true,status:data.status||null};
      }
      const code=text(data.error||`http_${response.status}`);
      if(BLOCK_CODES.has(code)){
        setBlocked(this.store,code,text(data.blocked_reason));
        this.state.licenseBlocked=true;
        this.state.licenseBlockCode=code;
        this.state.online=true;
        return {ok:false,blocked:true,error:code,reason:text(data.blocked_reason)||null};
      }
      return {ok:false,error:code,serverRejected:true};
    }catch(error){
      const code=error?.name==='AbortError'?'sync_timeout':text(error?.message)||'network_unavailable';
      return {ok:false,offline:true,error:code};
    }finally{clearTimeout(timeout)}
  };

  ThorAgent.prototype.start=async function(...args){
    const result=await originalStart.apply(this,args);
    if(this.deviceToken?.()){
      clearInterval(this._licenseGuardTimerV107);
      const tick=()=>this.checkLicenseOnline().catch(()=>{});
      this._licenseGuardTimerV107=setInterval(tick,10000);
      setTimeout(tick,250);
    }
    return result;
  };

  ThorAgent.prototype.stop=async function(...args){
    clearInterval(this._licenseGuardTimerV107);
    this._licenseGuardTimerV107=null;
    return originalStop.apply(this,args);
  };

  ThorAgent.prototype.status=async function(...args){
    const result=await originalStatus.apply(this,args);
    const license=this._licenseGuardStatus();
    return {...result,licenseBlocked:license.blocked,licenseBlockCode:license.code,licenseBlockReason:license.reason,licenseBlockedAt:license.blockedAt,licenseMessage:license.message};
  };

  ThorAgent.prototype.loginOperator=async function(payload={}){
    const wasBlocked=isBlocked(this.store);
    const license=await this.checkLicenseOnline();
    if(license.blocked||wasBlocked&&license.offline){
      this.logoutOperator?.();
      throw new Error('license_blocked');
    }
    const result=await originalLogin.call(this,payload);
    const syncError=text(result?.sync?.error);
    if(BLOCK_CODES.has(syncError)||isBlocked(this.store)){
      setBlocked(this.store,syncError||this.store.get('license_block_code')||'license_blocked');
      this.logoutOperator?.();
      throw new Error('license_blocked');
    }
    return result;
  };

  ThorAgent.prototype.event=function(type,payload){
    if(isBlocked(this.store))throw new Error('license_blocked');
    return originalEvent.call(this,type,payload);
  };
}

module.exports={installLicenseGuardV107,LICENSE_MESSAGE};
