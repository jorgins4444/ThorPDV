const { SyncEngine } = require('./sync');

const BLOCK_CODES=new Set(['license_blocked','license_inactive','license_expired','license_not_found','pdv_module_disabled','device_blocked']);
const RECONNECT_CODES=new Set(['invalid_device','invalid_device_token','device_credential_revoked','device_reconnect_required']);
const LICENSE_MESSAGE='Licença de uso bloqueada, por favor entrar em contato com o Administrador do Sistema';
const RECONNECT_MESSAGE='A conexão deste terminal foi refeita no ThorGestão. Informe o novo código de ativação para reconectar.';

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
function invalidatePairing(store,sync,code='invalid_device'){
  try{sync?.stop?.();}catch{}
  store.set('pairing_invalidated','true');
  store.set('pairing_invalidated_code',code);
  store.set('pairing_invalidated_at',new Date().toISOString());
  store.set('device_token','');
  store.set('device_id','');
  store.set('cursor','');
  store.set('current_operator_id','');
  store.set('last_sync_error',code);
}
function clearPairingInvalidated(store){
  store.set('pairing_invalidated','false');
  store.set('pairing_invalidated_code','');
  store.set('pairing_invalidated_at','');
}
function pairingInvalidated(store){return store.get('pairing_invalidated','false')==='true'}

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
      }else if(RECONNECT_CODES.has(code)){
        invalidatePairing(this.store,this,code);
        this.onState?.({online:true,syncing:false,pairingInvalidated:true,error:code});
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
  const originalEnroll=ThorAgent.prototype.enroll;
  const originalEvent=ThorAgent.prototype.event;

  ThorAgent.prototype._licenseGuardStatus=function(){
    return {
      blocked:isBlocked(this.store),
      code:this.store.get('license_block_code')||null,
      reason:this.store.get('license_block_reason')||null,
      blockedAt:this.store.get('license_blocked_at')||null,
      message:isBlocked(this.store)?LICENSE_MESSAGE:null,
      pairingInvalidated:pairingInvalidated(this.store),
      pairingInvalidatedCode:this.store.get('pairing_invalidated_code')||null,
      pairingInvalidatedAt:this.store.get('pairing_invalidated_at')||null,
    };
  };

  ThorAgent.prototype.checkLicenseOnline=function(options={}){
    const force=Boolean(options.force);
    const timeoutMs=Math.max(1200,Math.min(Number(options.timeoutMs||2800),6000));
    const token=this.deviceToken?.();
    if(!token)return Promise.resolve({ok:false,error:'not_enrolled',reconnectRequired:pairingInvalidated(this.store)});

    const now=Date.now();
    if(!force&&this._licenseGuardLastResult&&now-Number(this._licenseGuardLastAt||0)<5000){
      return Promise.resolve(this._licenseGuardLastResult);
    }
    if(this._licenseGuardPromise)return this._licenseGuardPromise;

    this._licenseGuardPromise=(async()=>{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetch(`${String(this.apiBase||'').replace(/\/$/,'')}/api/pdv/license/status`,{
          method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:'{}',signal:controller.signal,
        });
        const data=await response.json().catch(()=>({ok:false,error:`http_${response.status}`}));
        if(response.ok&&data.ok){
          clearBlocked(this.store);
          clearPairingInvalidated(this.store);
          this.state.licenseBlocked=false;
          this.state.licenseBlockCode=null;
          this.state.pairingInvalidated=false;
          return {ok:true,status:data.status||null};
        }
        const code=text(data.error||`http_${response.status}`);
        if(RECONNECT_CODES.has(code)){
          invalidatePairing(this.store,this.sync,code);
          this.state.pairingInvalidated=true;
          this.state.online=true;
          return {ok:false,reconnectRequired:true,error:code};
        }
        if(BLOCK_CODES.has(code)){
          setBlocked(this.store,code,text(data.blocked_reason));
          this.state.licenseBlocked=true;
          this.state.licenseBlockCode=code;
          this.state.online=true;
          return {ok:false,blocked:true,error:code,reason:text(data.blocked_reason)||null};
        }
        return {ok:false,error:code,serverRejected:true};
      }catch(error){
        const code=error?.name==='AbortError'?'license_check_timeout':text(error?.message)||'network_unavailable';
        return {ok:false,offline:true,error:code};
      }finally{clearTimeout(timeout)}
    })().then((result)=>{
      this._licenseGuardLastResult=result;
      this._licenseGuardLastAt=Date.now();
      return result;
    }).finally(()=>{
      this._licenseGuardPromise=null;
    });

    return this._licenseGuardPromise;
  };

  ThorAgent.prototype._applyLicenseDecision=function(result={}){
    if(result.reconnectRequired){
      invalidatePairing(this.store,this.sync,result.error||'device_reconnect_required');
      this.state.pairingInvalidated=true;
      this.logoutOperator?.();
      return;
    }
    if(result.blocked){
      setBlocked(this.store,result.error||'license_blocked',text(result.reason));
      this.state.licenseBlocked=true;
      this.state.licenseBlockCode=result.error||'license_blocked';
      this.logoutOperator?.();
    }
  };

  ThorAgent.prototype.start=async function(...args){
    const result=await originalStart.apply(this,args);
    if(this.deviceToken?.()){
      clearInterval(this._licenseGuardTimerV107);
      const tick=()=>this.checkLicenseOnline({force:true,timeoutMs:2500}).then((decision)=>this._applyLicenseDecision(decision)).catch(()=>{});
      this._licenseGuardTimerV107=setInterval(tick,10000);
      setTimeout(tick,350);
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
    return {...result,
      licenseBlocked:license.blocked,licenseBlockCode:license.code,licenseBlockReason:license.reason,licenseBlockedAt:license.blockedAt,licenseMessage:license.message,
      pairingInvalidated:license.pairingInvalidated,pairingInvalidatedCode:license.pairingInvalidatedCode,pairingInvalidatedAt:license.pairingInvalidatedAt,
      pairingMessage:license.pairingInvalidated?RECONNECT_MESSAGE:null,
    };
  };

  ThorAgent.prototype.enroll=async function(payload={}){
    const result=await originalEnroll.call(this,payload);
    clearPairingInvalidated(this.store);
    clearBlocked(this.store);
    this._licenseGuardLastResult=null;
    this._licenseGuardLastAt=0;
    clearInterval(this._licenseGuardTimerV107);
    const tick=()=>this.checkLicenseOnline({force:true,timeoutMs:2500}).then((decision)=>this._applyLicenseDecision(decision)).catch(()=>{});
    this._licenseGuardTimerV107=setInterval(tick,10000);
    setTimeout(tick,350);
    return {...result,licenseValidation:'background'};
  };

  ThorAgent.prototype.loginOperator=async function(payload={}){
    // A versão 0.8.35 tinha um único caminho de login. O travamento surgiu quando
    // a validação de licença/sync passou a ser aguardada antes de liberar a UI.
    // Aqui o login volta a ser estritamente local: PIN e perfil primeiro, rede depois.
    if(pairingInvalidated(this.store))throw new Error('pairing_reconnect_required');
    if(isBlocked(this.store))throw new Error('license_blocked');

    const cached=this._licenseGuardLastResult||null;
    if(cached?.reconnectRequired)throw new Error('pairing_reconnect_required');
    if(cached?.blocked)throw new Error('license_blocked');

    const result=await originalLogin.call(this,payload);

    // Confirma a licença imediatamente em segundo plano. Se o ThorControl responder
    // bloqueado/reconexão, a sessão local é encerrada e o renderer mostra o bloqueio.
    void this.checkLicenseOnline({force:true,timeoutMs:2500})
      .then((decision)=>this._applyLicenseDecision(decision))
      .catch(()=>{});

    return result;
  };

  ThorAgent.prototype.event=function(type,payload){
    if(pairingInvalidated(this.store))throw new Error('pairing_reconnect_required');
    if(isBlocked(this.store))throw new Error('license_blocked');
    return originalEvent.call(this,type,payload);
  };
}

module.exports={installLicenseGuardV107,LICENSE_MESSAGE,RECONNECT_MESSAGE};