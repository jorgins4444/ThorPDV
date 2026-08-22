(()=>{
  'use strict';

  function editable(el){
    if(!(el instanceof Element))return false;
    if(el.matches('textarea,select,[contenteditable="true"]'))return !el.hasAttribute('disabled')&&!el.hasAttribute('readonly');
    if(!el.matches('input'))return false;
    const type=String(el.getAttribute('type')||'text').toLowerCase();
    if(['button','submit','reset','checkbox','radio','file','hidden','range','color'].includes(type))return false;
    return !el.hasAttribute('disabled')&&!el.hasAttribute('readonly');
  }

  function isTypingKey(event){
    if(event.ctrlKey||event.altKey||event.metaKey)return false;
    if(event.key==='Enter'||event.key==='Escape'||event.key==='Tab')return false;
    if(/^F\d{1,2}$/i.test(String(event.key||'')))return false;
    if(String(event.key||'').length===1)return true;
    return ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key);
  }

  // Roda no window/capture, antes dos atalhos globais registrados em document.
  // Não cancela o comportamento padrão do campo; apenas impede que handlers
  // globais antigos do PDV interceptem teclas de digitação.
  window.addEventListener('keydown',event=>{
    const field=event.target;
    if(!editable(field)||!isTypingKey(event))return;
    event.stopPropagation();
  },true);

  // Garante foco normal somente no campo realmente clicado, sem timers ou
  // restauração automática para elementos antigos.
  window.addEventListener('pointerdown',event=>{
    const field=event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
    if(!editable(field))return;
    queueMicrotask(()=>{
      if(!field.isConnected||field.hasAttribute('disabled'))return;
      try{field.focus({preventScroll:true});}catch{try{field.focus();}catch{}}
    });
  },true);

  function installStyle(){
    if(document.getElementById('thorInputInteractionV095Style'))return;
    const style=document.createElement('style');
    style.id='thorInputInteractionV095Style';
    style.textContent=`
      input:not(:disabled):not([readonly]),textarea:not(:disabled):not([readonly]),select:not(:disabled),[contenteditable="true"]{pointer-events:auto}
    `;
    document.head.appendChild(style);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installStyle,{once:true});else installStyle();
})();
