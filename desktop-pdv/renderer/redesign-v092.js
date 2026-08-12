(function(){
  let queued=false;
  function apply(){
    queued=false;
    document.querySelectorAll('.v089-badges .out').forEach(badge=>{
      if(badge.textContent?.trim()!=='SEM ESTOQUE') badge.textContent='SEM ESTOQUE';
      badge.setAttribute('title','Produto sem estoque disponível');
      badge.setAttribute('aria-label','Sem estoque');
    });
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  schedule();
})();
