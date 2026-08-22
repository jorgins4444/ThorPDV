(()=>{
  'use strict';
  const SYNC_INTERVAL_MS=5*60*1000;
  let syncState={lastSyncAt:null,online:false,syncing:false,lastError:null};

  function formatClock(value){
    if(!value)return '--:--:--';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '--:--:--';
    return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function countdown(){
    if(syncState.syncing)return 'agora';
    if(!syncState.lastSyncAt)return '--:--';
    const base=Date.parse(syncState.lastSyncAt);
    if(!Number.isFinite(base))return '--:--';
    const remaining=Math.max(0,base+SYNC_INTERVAL_MS-Date.now());
    const total=Math.ceil(remaining/1000);
    const min=Math.floor(total/60);
    const sec=total%60;
    return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function statusLabel(){
    if(syncState.syncing)return 'Sincronizando...';
    if(syncState.lastError&&!syncState.online)return 'Falha na sincronização';
    if(syncState.online)return 'Online';
    return 'Offline';
  }

  function render(){
    const footer=document.getElementById('footerSync');
    if(!footer)return;
    footer.textContent=`${statusLabel()} • Última sincronização: ${formatClock(syncState.lastSyncAt)} • Próxima: ${countdown()}`;
    footer.title=syncState.lastError?`Último erro: ${syncState.lastError}`:'Sincronização automática a cada 5 minutos';
    footer.style.whiteSpace='nowrap';
  }

  async function refresh(){
    try{
      const s=await window.thor?.status?.();
      if(s){
        syncState={
          lastSyncAt:s.lastSyncAt||null,
          online:Boolean(s.online),
          syncing:Boolean(s.syncing),
          lastError:s.lastError||null
        };
      }
    }catch{}
    render();
  }

  setInterval(render,1000);
  setInterval(refresh,3000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});
  else refresh();
})();
