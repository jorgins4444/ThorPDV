(()=>{
  const ROOT='.erp-fiscal-grid';
  const keyFor=card=>`thor:fiscal:${(card.querySelector('h2')?.textContent||'section').trim().toLowerCase().replace(/\s+/g,'-')}`;
  function setupCard(card){
    if(card.dataset.fiscalCompact==='1'||card.classList.contains('fiscal-matrix-source'))return;
    const head=card.querySelector(':scope > .fiscal-section-head');
    if(!head)return;
    card.dataset.fiscalCompact='1';
    card.classList.add('fiscal-ui-collapsible');
    const key=keyFor(card);
    const remembered=sessionStorage.getItem(key);
    const collapsed=remembered!=='open';
    card.classList.toggle('is-collapsed',collapsed);
    const button=document.createElement('button');
    button.type='button';
    button.className='fiscal-expand-toggle';
    const sync=()=>{
      const isCollapsed=card.classList.contains('is-collapsed');
      button.textContent=isCollapsed?'Editar':'Fechar';
      button.setAttribute('aria-expanded',String(!isCollapsed));
    };
    const toggle=()=>{
      const next=!card.classList.contains('is-collapsed');
      card.classList.toggle('is-collapsed',next);
      sessionStorage.setItem(key,next?'closed':'open');
      sync();
    };
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle();});
    head.appendChild(button);
    sync();
  }
  function scan(){
    const root=document.querySelector(ROOT);
    if(!root)return;
    root.querySelectorAll('.fiscal-config-card:not(.fiscal-matrix-source), .fiscal-certificate-card').forEach(setupCard);
  }
  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;scan();});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
