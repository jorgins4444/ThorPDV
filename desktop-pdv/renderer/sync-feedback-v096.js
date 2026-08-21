(()=>{
  'use strict';
  const SYNC_INTERVAL_MS=5*60*1000;
  let state={lastSyncAt:null,online:false,syncing:false,lastError:null};

  function searchInput(){
    return [...document.querySelectorAll('input')].find((input)=>{
      const p=String(input.getAttribute('placeholder')||'').toLocaleLowerCase('pt-BR');
      return p.includes('buscar produto') || (p.includes('produto')&&(p.includes('ean')||p.includes('código')||p.includes('codigo')));
    })||null;
  }

  function installStyle(){
    if(document.getElementById('thorSyncFeedbackStyle'))return;
    const style=document.createElement('style');
    style.id='thorSyncFeedbackStyle';
    style.textContent=`
      .thor-sync-hidden-icon{display:none!important}
      #thorSyncFeedback{height:44px;min-width:280px;max-width:330px;display:flex;align-items:center;gap:10px;padding:5px 12px;border-radius:13px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24);color:#fff;box-sizing:border-box;flex:0 0 auto;margin-left:10px;margin-right:10px;font-family:inherit;line-height:1.15}
      #thorSyncFeedback .thor-sync-dot{width:9px;height:9px;border-radius:50%;background:#aeb7c2;box-shadow:0 0 0 4px rgba(255,255,255,.10);flex:0 0 auto}
      #thorSyncFeedback.online .thor-sync-dot{background:#2ee48b}#thorSyncFeedback.syncing .thor-sync-dot{background:#ffd25a;animation:thorSyncPulse 1s infinite}#thorSyncFeedback.error .thor-sync-dot{background:#ff7e89}
      #thorSyncFeedback .thor-sync-main{min-width:0;flex:1}.thor-sync-status{font-size:11px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.thor-sync-times{display:flex;gap:14px;margin-top:3px;font-size:10px;color:rgba(255,255,255,.86);white-space:nowrap}.thor-sync-times b{color:#fff;font-size:10px}
      @keyframes thorSyncPulse{50%{opacity:.35}}
      @media(max-width:1180px){#thorSyncFeedback{min-width:225px}.thor-sync-times{gap:8px;font-size:9px}}
    `;
    document.head.appendChild(style);
  }

  function findTopBar(input){
    if(!input)return null;
    let node=input.parentElement;
    for(let i=0;node&&i<7;i++,node=node.parentElement){
      const r=node.getBoundingClientRect();
      if(r.width>window.innerWidth*.78 && r.height>=42 && r.height<=100 && r.top<100)return node;
    }
    return input.parentElement?.parentElement||null;
  }

  function cleanHeader(topBar,input){
    if(!topBar||!input)return;
    const inputRect=input.getBoundingClientRect();
    const controls=[...topBar.querySelectorAll('button,a,[role="button"]')];
    for(const el of controls){
      if(el.id==='thorConsultaGeralBtn'||el.closest('#thorSyncFeedback'))continue;
      const r=el.getBoundingClientRect();
      if(r.width>0&&r.height>0&&r.width<=66&&r.height<=66&&r.left>inputRect.right+5){
        el.classList.add('thor-sync-hidden-icon');
      }
    }
  }

  function ensureFeedback(){
    installStyle();
    const input=searchInput(); if(!input)return;
    const topBar=findTopBar(input); if(!topBar)return;
    cleanHeader(topBar,input);
    let box=document.getElementById('thorSyncFeedback');
    if(box&&box.parentElement===topBar)return;
    box?.remove();
    box=document.createElement('div');
    box.id='thorSyncFeedback';
    box.innerHTML=`<span class="thor-sync-dot"></span><div class="thor-sync-main"><div class="thor-sync-status" id="thorSyncStatus">Sincronização</div><div class="thor-sync-times"><span>Última: <b id="thorSyncLast">--:--:--</b></span><span>Próxima: <b id="thorSyncNext">--:--</b></span></div></div>`;
    const host=input.parentElement;
    if(host&&host.parentElement===topBar)host.insertAdjacentElement('afterend',box); else topBar.appendChild(box);
    render();
  }

  function formatTime(value){
    if(!value)return '--:--:--';
    const d=new Date(value); if(Number.isNaN(d.getTime()))return '--:--:--';
    return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function countdown(){
    if(!state.lastSyncAt)return '--:--';
    const last=new Date(state.lastSyncAt).getTime(); if(!Number.isFinite(last))return '--:--';
    const remain=Math.max(0,last+SYNC_INTERVAL_MS-Date.now());
    const total=Math.ceil(remain/1000),m=Math.floor(total/60),s=total%60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  function render(){
    const box=document.getElementById('thorSyncFeedback'); if(!box)return;
    box.classList.remove('online','syncing','error');
    const status=document.getElementById('thorSyncStatus');
    if(state.syncing){box.classList.add('syncing');if(status)status.textContent='Sincronizando agora...';}
    else if(state.lastError&&!state.online){box.classList.add('error');if(status)status.textContent='Sincronização com falha';}
    else if(state.online){box.classList.add('online');if(status)status.textContent='Sincronização online';}
    else {if(status)status.textContent='Aguardando conexão';}
    const last=document.getElementById('thorSyncLast');if(last)last.textContent=formatTime(state.lastSyncAt);
    const next=document.getElementById('thorSyncNext');if(next)next.textContent=state.syncing?'agora':countdown();
    if(box&&state.lastError)box.title=`Último erro: ${state.lastError}`;else if(box)box.title='Sincronização automática a cada 5 minutos';
  }
  async function refreshStatus(){
    try{
      const s=await window.thor?.status?.();
      if(s)state={lastSyncAt:s.lastSyncAt||null,online:Boolean(s.online),syncing:Boolean(s.syncing),lastError:s.lastError||null};
    }catch{}
    ensureFeedback();render();
  }

  const obs=new MutationObserver(()=>ensureFeedback());
  obs.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureFeedback,{once:true});else ensureFeedback();
  setInterval(()=>{ensureFeedback();render();},1000);
  setInterval(refreshStatus,3000);
  refreshStatus();
})();
