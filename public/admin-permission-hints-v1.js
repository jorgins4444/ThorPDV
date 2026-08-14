(()=>{
  const PERMISSION='cash.correct_closure';
  const tokensOf=textarea=>textarea.value.split(',').map(x=>x.trim()).filter(Boolean);
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
      const copy=document.createElement('span');
      const refresh=()=>{
        const tokens=tokensOf(textarea);const all=tokens.includes('all');
        input.checked=all||tokens.includes(PERMISSION);input.disabled=all;
        copy.innerHTML=all
          ?'<b>Corrigir fechamento de caixa</b><small>Permitido pelo acesso total deste perfil (all).</small>'
          :'<b>Corrigir fechamento de caixa</b><small>Permite alterar somente o valor contado de um caixa já fechado. Toda correção fica auditada.</small>';
      };
      refresh();box.append(input,copy);textarea.closest('label')?.insertAdjacentElement('afterend',box);
      input.addEventListener('change',()=>{
        const tokens=tokensOf(textarea).filter(x=>x!==PERMISSION);
        if(input.checked)tokens.push(PERMISSION);
        textarea.value=tokens.join(', ');
        textarea.dispatchEvent(new Event('input',{bubbles:true}));
        textarea.dispatchEvent(new Event('change',{bubbles:true}));
        refresh();
      });
      textarea.addEventListener('input',refresh);
    });
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
