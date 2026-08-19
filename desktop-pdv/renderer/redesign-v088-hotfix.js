(function(){
  let scheduled=false;

  function apply(){
    scheduled=false;
    document.querySelector('.v47-work')?.classList.add('v088-work');

    const button=document.getElementById('v088GateTest');
    if(button&&button.dataset.v088Stable!=='1'){
      button.dataset.v088Stable='1';
      button.onclick=async()=>{
        const original='Testar conexão';
        try{
          button.disabled=true;
          button.textContent='Testando...';
          await window.thor.sync();
          state.status=await window.thor.status();
          const online=Boolean(state.status?.online);
          button.textContent=online?'Conexão OK':'Sem conexão';

          const gate=document.getElementById('thorOperatorGate');
          const connection=gate?.querySelector('.v088-config-grid article:nth-child(7)');
          const sync=gate?.querySelector('.v088-config-grid article:nth-child(8)');
          const lastSync=gate?.querySelector('.v088-config-grid article:nth-child(10)');
          const ready=gate?.querySelector('.v088-config-ready');

          if(connection){
            const value=connection.querySelector('b');
            const status=connection.querySelector('em');
            if(value)value.textContent=online?'Online':'Offline';
            if(status){status.textContent=online?'Conectado':'Sem conexão';status.className=online?'ok':'warn';}
          }
          if(sync){const value=sync.querySelector('b');if(value)value.textContent='Automática';}
          if(lastSync){const value=lastSync.querySelector('b');if(value)value.textContent=state.status?.lastSyncAt?new Date(state.status.lastSyncAt).toLocaleString('pt-BR'):'Ainda não sincronizado';}
          if(ready){
            ready.classList.toggle('online',online);
            ready.classList.toggle('offline',!online);
            const icon=ready.querySelector('div>i');
            const title=ready.querySelector('div span b');
            const detail=ready.querySelector('div span small');
            if(icon)icon.textContent=online?'✓':'!';
            if(title)title.textContent=online?'Tudo certo!':'Operação offline disponível';
            if(detail)detail.textContent=online?'Terminal conectado e pronto para sincronizar.':'O caixa pode operar com os dados locais já sincronizados.';
          }
        }catch(error){
          button.textContent='Falha na conexão';
        }finally{
          setTimeout(()=>{
            if(button.isConnected){button.disabled=false;button.textContent=original;}
          },1200);
        }
      };
    }
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(apply);
  }

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();
