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
    const total=Math.ceil(remaining/1000),min=Math.floor(total/60),sec=total%60;
    return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function statusLabel(){
    if(syncState.syncing)return 'Sincronizando';
    if(syncState.lastError&&!syncState.online)return 'Falha no sync';
    if(syncState.online)return 'Sincronizado';
    return 'Offline';
  }

  function productSearchInput(){
    return [...document.querySelectorAll('input')].find(input=>{
      const p=String(input.getAttribute('placeholder')||'').toLocaleLowerCase('pt-BR');
      return p.includes('buscar produto')||(p.includes('produto')&&(p.includes('ean')||p.includes('código')||p.includes('codigo')));
    })||null;
  }

  function findToolbar(input){
    if(!input)return null;
    let node=input.parentElement;
    for(let i=0;node&&i<7;i++,node=node.parentElement){
      const r=node.getBoundingClientRect();
      if(r.width>window.innerWidth*.72&&r.height>=38&&r.height<=105&&r.top<130)return node;
    }
    return input.parentElement?.parentElement||null;
  }

  function installStyle(){
    if(document.getElementById('thorSyncHeaderStyle'))return;
    const style=document.createElement('style');
    style.id='thorSyncHeaderStyle';
    style.textContent=`
      .thor-sync-replaced-icon{display:none!important}
      #thorSyncHeader{height:42px;min-width:176px;max-width:210px;display:flex;align-items:center;gap:9px;padding:5px 11px;border-radius:11px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);color:#fff;box-sizing:border-box;flex:0 0 auto;margin-left:8px;margin-right:4px;font-family:inherit;line-height:1.08}
      #thorSyncHeader .thor-sync-dot{width:9px;height:9px;border-radius:50%;background:#aeb7c2;flex:0 0 auto;box-shadow:0 0 0 3px rgba(255,255,255,.10)}
      #thorSyncHeader.online .thor-sync-dot{background:#2ee48b}#thorSyncHeader.syncing .thor-sync-dot{background:#ffd25a}#thorSyncHeader.error .thor-sync-dot{background:#ff7e89}
      #thorSyncHeader .thor-sync-copy{min-width:0;display:flex;flex-direction:column;gap:3px}.thor-sync-title{font-size:11px;font-weight:900;white-space:nowrap}.thor-sync-next{font-size:10px;color:rgba(255,255,255,.88);white-space:nowrap}.thor-sync-next b{font-size:11px;color:#fff}
      @media(max-width:1180px){#thorSyncHeader{min-width:150px;padding:5px 8px}.thor-sync-title{font-size:10px}.thor-sync-next{font-size:9px}}
    `;
    document.head.appendChild(style);
  }

  function ensureHeader(){
    installStyle();
    const input=productSearchInput();if(!input)return;
    const host=input.parentElement;if(!host)return;
    const toolbar=findToolbar(input);if(!toolbar)return;
    const hostRect=host.getBoundingClientRect();
    const controls=[...toolbar.querySelectorAll('button,a,[role="button"]')]
      .filter(el=>{
        if(el.id==='thorConsultaGeralBtn'||el.id==='thorSyncHeader'||el.closest('#thorSyncHeader'))return false;
        if(el.classList.contains('thor-sync-replaced-icon'))return false;
        const r=el.getBoundingClientRect();
        return r.width>0&&r.height>0&&r.width<=68&&r.height<=68&&r.left>=hostRect.right-2;
      })
      .sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left)
      .slice(0,3);
    controls.forEach(el=>el.classList.add('thor-sync-replaced-icon'));

    let chip=document.getElementById('thorSyncHeader');
    if(chip&&chip.parentElement===toolbar){renderHeader();return;}
    chip?.remove();
    chip=document.createElement('div');
    chip.id='thorSyncHeader';
    chip.innerHTML='<span class="thor-sync-dot"></span><span class="thor-sync-copy"><span class="thor-sync-title" id="thorSyncHeaderTitle">Sincronização</span><span class="thor-sync-next">Próxima: <b id="thorSyncHeaderNext">--:--</b></span></span>';
    if(controls[0]?.parentElement===toolbar)toolbar.insertBefore(chip,controls[0]);
    else if(host.parentElement===toolbar)host.insertAdjacentElement('afterend',chip);
    else toolbar.appendChild(chip);
    renderHeader();
  }

  function renderHeader(){
    const chip=document.getElementById('thorSyncHeader');if(!chip)return;
    chip.classList.remove('online','syncing','error');
    if(syncState.syncing)chip.classList.add('syncing');
    else if(syncState.lastError&&!syncState.online)chip.classList.add('error');
    else if(syncState.online)chip.classList.add('online');
    const title=document.getElementById('thorSyncHeaderTitle');if(title)title.textContent=statusLabel();
    const next=document.getElementById('thorSyncHeaderNext');if(next)next.textContent=countdown();
    chip.title=`Última sincronização: ${formatClock(syncState.lastSyncAt)}${syncState.lastError?` • Erro: ${syncState.lastError}`:''}`;
  }

  function renderFooter(){
    const footer=document.getElementById('footerSync');if(!footer)return;
    footer.textContent=`${statusLabel()} • Última sincronização: ${formatClock(syncState.lastSyncAt)} • Próxima: ${countdown()}`;
    footer.title=syncState.lastError?`Último erro: ${syncState.lastError}`:'Sincronização automática a cada 5 minutos';
    footer.style.whiteSpace='nowrap';
  }

  function render(){ensureHeader();renderHeader();renderFooter();}

  async function refresh(){
    try{
      const s=await window.thor?.status?.();
      if(s)syncState={lastSyncAt:s.lastSyncAt||null,online:Boolean(s.online),syncing:Boolean(s.syncing),lastError:s.lastError||null};
    }catch{}
    render();
  }

  setInterval(render,1000);
  setInterval(refresh,3000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();
})();
