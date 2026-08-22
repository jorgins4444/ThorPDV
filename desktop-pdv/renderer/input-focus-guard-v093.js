(()=>{
  'use strict';
  let lastEditable=null;
  let lastPointerAt=0;

  function editable(el){
    if(!(el instanceof Element))return false;
    if(el.matches('textarea,select,[contenteditable="true"]'))return !el.disabled&&!el.hasAttribute('readonly');
    if(!el.matches('input'))return false;
    const type=String(el.type||'text').toLowerCase();
    if(['button','submit','reset','checkbox','radio','file','hidden','range','color'].includes(type))return false;
    return !el.disabled&&!el.readOnly;
  }

  function visible(el){
    if(!el?.isConnected)return false;
    const r=el.getBoundingClientRect();
    const s=getComputedStyle(el);
    return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
  }

  function remember(el){
    if(!editable(el))return;
    lastEditable=el;
  }

  function ensureFocus(el){
    if(!editable(el)||!visible(el))return;
    try{el.focus({preventScroll:true});}catch{try{el.focus();}catch{}}
  }

  function installStyle(){
    if(document.getElementById('thorInputFocusGuardStyle'))return;
    const style=document.createElement('style');
    style.id='thorInputFocusGuardStyle';
    style.textContent=`
      .modal input:not(:disabled):not([readonly]),
      .modal textarea:not(:disabled):not([readonly]),
      .modal select:not(:disabled),
      .modal [contenteditable="true"]{
        pointer-events:auto!important;
        user-select:text!important;
        -webkit-user-select:text!important;
      }
      .modal input:not(:disabled):not([readonly]):focus,
      .modal textarea:not(:disabled):not([readonly]):focus,
      .modal select:not(:disabled):focus{
        position:relative;
        z-index:2;
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('pointerdown',event=>{
    const el=event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    if(!editable(el))return;
    lastPointerAt=Date.now();
    remember(el);
    setTimeout(()=>{if(document.activeElement!==el)ensureFocus(el);},0);
  },true);

  document.addEventListener('focusin',event=>remember(event.target),true);

  // Se algum redesenho assíncrono do PDV roubar o foco logo após o clique,
  // devolve o foco somente ao campo que o operador acabou de selecionar.
  setInterval(()=>{
    if(!document.querySelector('.modal'))return;
    if(!lastEditable||Date.now()-lastPointerAt>3500)return;
    if(!lastEditable.closest('.modal')||!visible(lastEditable))return;
    const active=document.activeElement;
    if(active===lastEditable)return;
    if(editable(active))return;
    ensureFocus(lastEditable);
  },250);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installStyle,{once:true});else installStyle();
})();
