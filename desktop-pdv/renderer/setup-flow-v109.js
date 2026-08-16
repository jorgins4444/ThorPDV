(function(){
  let activating=false;

  function timeoutAfter(ms,code){
    return new Promise((_,reject)=>setTimeout(()=>reject(new Error(code)),ms));
  }

  function ensureRuntimePolling(){
    if(window.__thorRuntimePollingV109)return;
    window.__thorRuntimePollingV109=setInterval(async()=>{
      try{
        const fresh=await window.thor.status();
        state.status=fresh;
        state.settings=fresh.settings||state.settings;
        try{updateTop();}catch{}

        const gate=document.getElementById('thorOperatorGate');
        if(gate&&!gate.querySelector('#gateOperatorSearch')&&!fresh.operator&&!fresh.licenseBlocked&&!fresh.pairingInvalidated){
          let rows=[];
          try{rows=await window.thor.operators();}catch{}
          if(rows.length){
            try{thorOperatorGateRemove();await thorOperatorGateShow();}catch{}
          }
        }
      }catch{}
    },3000);
  }

  function setupVersion(){return state.status?.appVersion||'—';}

  renderSetup=function(){
    const defaultName='Caixa - Windows';
    app.innerHTML=`
      <main class="setup-v109">
        <div class="setup-v109-appbar">
          <div><i>ϟ</i><span>ThorPDV Caixa - versão ${esc(setupVersion())}</span></div>
          <button type="button" id="setupTerminalSettingsTop">Configurações</button>
        </div>
        <section class="setup-v109-card">
          <header class="setup-v109-brand">
            <div class="setup-v109-mark">ϟ</div>
            <div class="setup-v109-word">Thor<span>PDV</span></div><i></i><b>Caixa</b>
          </header>
          <div class="setup-v109-accent"><i></i><b></b></div>
          <div class="setup-v109-copy">
            <small>ATIVAÇÃO SEGURA</small>
            <h1>Ativar este caixa</h1>
            <p>Gere o código no ThorGestão em <b>Administrativo → PDV Desktop</b> e informe abaixo.</p>
          </div>
          <label class="setup-v109-field">
            <span>Código de ativação</span>
            <div><i>⌁</i><input id="code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXXXXX"></div>
          </label>
          <button id="activate" class="setup-v109-primary" type="button"><span>↪</span> Ativar terminal</button>
          <div id="setupFeedback" class="setup-v109-feedback" hidden></div>
          <button id="setupTerminalSettings" class="setup-v109-settings-toggle" type="button"><span>⚙</span> Configurações do terminal <kbd>F10</kbd></button>
          <div id="setupTerminalPanel" class="setup-v109-terminal" hidden>
            <label><span>Identificação deste terminal</span><input id="name" value="${esc(defaultName)}" placeholder="Ex.: Caixa 01 - Balcão"></label>
            <p>Estas opções ficam ocultas no uso normal. A conexão, licença e sincronização são administradas automaticamente pelo ThorPDV.</p>
          </div>
        </section>
        <footer class="setup-v109-footer"><span>ThorPDV • Operação segura e offline-first</span><span id="setupConnection">Aguardando ativação</span></footer>
      </main>`;

    const code=document.getElementById('code');
    const button=document.getElementById('activate');
    const feedback=document.getElementById('setupFeedback');
    const panel=document.getElementById('setupTerminalPanel');
    const settingsButton=document.getElementById('setupTerminalSettings');
    const settingsTop=document.getElementById('setupTerminalSettingsTop');

    const toggleSettings=()=>{
      panel.hidden=!panel.hidden;
      settingsButton.classList.toggle('active',!panel.hidden);
      if(!panel.hidden)document.getElementById('name')?.focus();
    };
    settingsButton.onclick=toggleSettings;
    settingsTop.onclick=toggleSettings;

    const activate=async()=>{
      if(activating)return;
      const value=String(code.value||'').trim().toUpperCase();
      if(value.length<6){
        feedback.hidden=false;feedback.className='setup-v109-feedback error';feedback.textContent='Informe um código de ativação válido.';code.focus();return;
      }
      activating=true;
      feedback.hidden=false;
      feedback.className='setup-v109-feedback loading';
      feedback.innerHTML='<i></i><span><b>Ativando terminal...</b><small>Validando o código e criando a conexão segura.</small></span>';
      button.disabled=true;button.innerHTML='<span>↻</span> Ativando...';code.disabled=true;
      try{
        const result=await Promise.race([
          window.thor.enroll({code:value,name:String(document.getElementById('name')?.value||'Caixa - Windows').trim()}),
          timeoutAfter(11000,'activation_ui_timeout'),
        ]);
        if(!result?.enrolled)throw new Error('enrollment_failed');
        state.status=result;
        state.settings=result.settings||state.settings;
        feedback.className='setup-v109-feedback success';
        feedback.innerHTML='<strong>✓ Terminal ativado com sucesso</strong><span>Conexão criada. Abrindo a identificação do operador...</span>';
        document.getElementById('setupConnection').textContent='Terminal ativado';
        ensureRuntimePolling();

        // A confirmação fica visível por alguns milissegundos e a navegação não
        // aguarda download de produtos, usuários, caixa ou qualquer sincronização.
        setTimeout(()=>{
          try{render();}catch(error){console.error('[ThorPDV activation render]',error);}
          setTimeout(async()=>{
            try{
              const rows=await window.thor.operators();
              if(rows.length&&!state.status?.operator){
                thorOperatorGateRemove();
                await thorOperatorGateShow();
              }
            }catch{}
          },800);
        },500);
      }catch(error){
        const raw=String(error?.message||error||'');
        const labels={
          activation_ui_timeout:'A ativação demorou além do esperado. Confira a conexão e tente novamente.',
          enrollment_timeout:'O ThorGestão não respondeu à ativação no tempo esperado.',
          invalid_or_expired_code:'Código inválido, expirado ou já utilizado.',
          invalid_enrollment:'Código de ativação inválido.',
          pdv_license_limit_reached:'O limite de terminais da licença foi atingido.',
          pdv_module_not_licensed:'O módulo ThorPDV não está habilitado nesta licença.',
        };
        feedback.className='setup-v109-feedback error';
        feedback.textContent=labels[raw]||friendlyError(raw)||raw||'Não foi possível ativar o terminal.';
        button.disabled=false;button.innerHTML='<span>↪</span> Ativar terminal';code.disabled=false;code.focus();
      }finally{activating=false;}
    };

    button.onclick=activate;
    code.onkeydown=(event)=>{if(event.key==='Enter'){event.preventDefault();void activate();}};
    setTimeout(()=>code.focus(),50);
  };

  function toggleLoginTerminalSettings(){
    const gate=document.getElementById('thorOperatorGate');
    if(!gate)return false;
    gate.classList.toggle('show-terminal-config');
    return true;
  }

  document.addEventListener('click',event=>{
    const item=event.target?.closest?.('.operator-gate-shortcuts span:first-child');
    if(!item)return;
    event.preventDefault();
    event.stopPropagation();
    toggleLoginTerminalSettings();
  },true);

  window.addEventListener('keydown',event=>{
    if(event.key!=='F10')return;
    const setup=document.querySelector('.setup-v109');
    const gate=document.getElementById('thorOperatorGate');
    if(!setup&&!gate)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(gate){toggleLoginTerminalSettings();return;}
    document.getElementById('setupTerminalSettings')?.click();
  },true);

  // Se o boot assíncrono antigo já tiver desenhado a ativação antes deste patch
  // carregar, redesenha uma única vez no fluxo novo.
  setTimeout(()=>{try{if(state.status&&!state.status.enrolled)renderSetup();}catch{}},0);
})();