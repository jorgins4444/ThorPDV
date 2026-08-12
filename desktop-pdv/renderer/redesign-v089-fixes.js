(function(){
  let queued=false;
  function apply(){
    queued=false;
    const grid=document.querySelector('.v089-actions-modal .v089-menu-grid');
    if(!grid||grid.dataset.v089Extras==='1')return;
    grid.dataset.v089Extras='1';
    const scale=document.createElement('button');
    scale.type='button';scale.dataset.act='scale';scale.innerHTML='<i>⚖</i><b>Balança</b><small>Ler peso do item atual</small>';
    scale.onclick=()=>{const modal=grid.closest('.modal');modal?.remove();setTimeout(()=>document.getElementById('scaleRead')?.click(),20);};
    const clear=document.createElement('button');
    clear.type='button';clear.dataset.act='clear';clear.innerHTML='<i>×</i><b>Limpar venda</b><small>Remover todos os itens do cupom</small>';
    clear.onclick=()=>{const modal=grid.closest('.modal');modal?.remove();setTimeout(()=>document.getElementById('clear')?.click(),20);};
    grid.append(scale,clear);
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  schedule();
})();
