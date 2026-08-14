(()=>{
  const PERMISSION='cash.correct_closure';
  function enhance(){
    if(!location.pathname.includes('/dashboard/perfis-adm'))return;
    document.querySelectorAll('textarea[name="permissions_text"]').forEach(textarea=>{
      if(textarea.dataset.cashPermission==='1')return;
      textarea.dataset.cashPermission='1';
      textarea.placeholder='produtos, estoque, financeiro, relatorios, cash.correct_closure';
      const box=document.createElement('label');
      box.className='adm-permission-option';
      const input=document.createElement('input');
      input.type='checkbox';
      input.checked=textarea.value.split(',').map(x=>x.trim()).includes(PERMISSION);
      const copy=document.createElement('span');
      copy.innerHTML='<b>Corrigir fechamento de caixa</b><small>Permite alterar somente o valor contado de um caixa já fechado. Toda correção fica auditada.</small>';
      box.append(input,copy);
      textarea.closest('label')?.insertAdjacentElement('afterend',box);
      const sync=()=>{
        const tokens=textarea.value.split(',').map(x=>x.trim()).filter(Boolean).filter(x=>x!==PERMISSION);
        if(input.checked)tokens.push(PERMISSION);
        textarea.value=tokens.join(', ');
        textarea.dispatchEvent(new Event('input',{bubbles:true}));
        textarea.dispatchEvent(new Event('change',{bubbles:true}));
      };
      input.addEventListener('change',sync);
      textarea.addEventListener('input',()=>{input.checked=textarea.value.split(',').map(x=>x.trim()).includes(PERMISSION)});
    });
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
