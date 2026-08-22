(()=>{
  'use strict';

  function topLevelModals(){
    return [...document.body.children].filter(el=>el instanceof HTMLElement&&el.classList.contains('modal'));
  }

  function visible(el){
    if(!el?.isConnected)return false;
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
  }

  function normalizeStack(){
    const modals=topLevelModals().filter(visible);
    if(!modals.length)return;
    const top=modals[modals.length-1];
    modals.forEach((m,index)=>{
      const active=m===top;
      m.style.pointerEvents=active?'auto':'none';
      m.style.zIndex=String(1000+index);
      if(active)m.removeAttribute('aria-hidden');
      else m.setAttribute('aria-hidden','true');
    });
  }

  function editable(el){
    if(!(el instanceof HTMLElement))return false;
    if(el.matches('textarea,select,[contenteditable="true"]'))return !el.hasAttribute('disabled')&&!el.hasAttribute('readonly');
    if(!el.matches('input'))return false;
    const type=String(el.getAttribute('type')||'text').toLowerCase();
    if(['button','submit','reset','checkbox','radio','file','hidden','range','color'].includes(type))return false;
    return !el.hasAttribute('disabled')&&!el.hasAttribute('readonly');
  }

  document.addEventListener('pointerdown',event=>{
    const field=event.target?.closest?.('.modal input,.modal textarea,.modal select,.modal [contenteditable="true"]');
    if(!editable(field))return;
    queueMicrotask(()=>{
      if(!field.isConnected||field.hasAttribute('disabled'))return;
      try{field.focus({preventScroll:true});}catch{try{field.focus();}catch{}}
    });
  },true);

  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.type==='childList'&&(r.target===document.body||[...r.addedNodes,...r.removedNodes].some(n=>n instanceof HTMLElement&&n.classList?.contains('modal')))))normalizeStack();
  });

  function start(){
    observer.observe(document.body,{childList:true});
    normalizeStack();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
