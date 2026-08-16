(function(){
  const MESSAGE='Licença de uso bloqueada, por favor entrar em contato com o Administrador do Sistema';
  let checking=false;

  const previousFriendly=friendlyError;
  friendlyError=function(value){
    const raw=String(value?.message||value||'');
    if(/license_blocked|license_inactive|license_expired|license_not_found|pdv_module_disabled|device_blocked/i.test(raw))return MESSAGE;
    return previousFriendly(value);
  };

  function removeNormalAccess(){
    try{v3State().operator=null;v3State().operatorPromptOpen=false;}catch{}
    if(state.status)state.status.operator=null;
    try{thorOperatorGateRemove();}catch{}
    document.querySelectorAll('.modal').forEach(node=>node.remove());
  }

  function showBlocked(status){
    removeNormalAccess();
    let gate=document.getElementById('thorLicenseBlock');
    if(!gate){gate=document.createElement('div');gate.id='thorLicenseBlock';gate.className='v107-license-block';document.body.appendChild(gate);}
    const context=status?.context||state.status?.context||{};
    gate.innerHTML=`<section class="v107-license-card"><div class="v107-license-brand">ϟ THOR<span>PDV</span></div><div class="v107-license-icon">!</div><small>ACESSO AO SISTEMA</small><h1>Licença bloqueada</h1><p>${esc(MESSAGE)}</p><div class="v107-license-context"><span><small>Filial</small><b>${esc(context.branch_name||'—')}</b></span><span><small>Terminal</small><b>${esc(context.pos_name||context.pos_code||'PDV')}</b></span></div><button type="button" id="v107LicenseRetry">Verificar licença novamente</button><em id="v107LicenseStatus">O modo offline não está disponível para licenças bloqueadas.</em></section>`;
    gate.querySelector('#v107LicenseRetry').onclick=async()=>{
      const button=gate.querySelector('#v107LicenseRetry'),label=gate.querySelector('#v107LicenseStatus');
      try{button.disabled=true;button.textContent='Verificando...';label.textContent='Consultando o ThorControl...';await window.thor.sync().catch(()=>{});const fresh=await window.thor.status();state.status=fresh;if(!fresh.licenseBlocked){gate.remove();render();showToast('Licença liberada. Identifique o operador para continuar.');}else label.textContent='A licença continua bloqueada no ThorControl.';}catch{label.textContent='Não foi possível consultar o servidor. O bloqueio confirmado permanece ativo.';}finally{if(button?.isConnected){button.disabled=false;button.textContent='Verificar licença novamente';}}
    };
  }

  async function check(){
    if(checking)return;checking=true;
    try{
      const status=await window.thor.status();
      if(status?.licenseBlocked){state.status=status;showBlocked(status);return;}
      const gate=document.getElementById('thorLicenseBlock');
      if(gate){state.status=status;gate.remove();render();}
    }catch{}finally{checking=false;}
  }

  setInterval(check,1500);
  setTimeout(check,150);
})();
