(function(){
  let entering=false;
  let unlockedUntil=0;

  function resolveOperator(rows,value){
    const key=String(value||'').trim().toLowerCase();
    if(!key)return null;
    return rows.find(row=>String(row.email||'').trim().toLowerCase()===key)
      || rows.find(row=>String(row.name||'').trim().toLowerCase()===key)
      || rows.find(row=>String(row.id||'').trim().toLowerCase()===key)
      || null;
  }

  function setGateError(gate,message){
    const error=gate?.querySelector('#gateError');
    if(error)error.textContent=message||'';
  }

  function setFieldsDisabled(gate,disabled){
    ['#gateOperatorSearch','#gatePin','#gateLogin','#gateCardAccess'].forEach(selector=>{
      const node=gate?.querySelector(selector);
      if(node)node.disabled=Boolean(disabled);
    });
  }

  function timeoutAfter(ms){
    return new Promise((_,reject)=>setTimeout(()=>reject(new Error('operator_login_timeout')),ms));
  }

  function revealPdv(operator){
    state.status={...(state.status||{}),operator};
    try{
      const v=v3State();
      v.operator=operator;
      v.operatorPromptOpen=false;
    }catch{}

    // O PDV já está renderizado atrás do login. Remover somente o overlay é mais
    // seguro do que reconstruir a aplicação inteira e elimina a corrida que podia
    // deixar a tela parada em "Validando acesso" ou "100%".
    unlockedUntil=Date.now()+15000;
    thorOperatorGateRemove();
    try{renderWorkspace();}catch{}
    try{updateTop();}catch{}
  }

  async function enterNow(){
    const gate=document.getElementById('thorOperatorGate');
    if(!gate||entering)return;

    const userInput=gate.querySelector('#gateOperatorSearch');
    const pin=gate.querySelector('#gatePin');
    if(!userInput||!pin)return;

    let operators=[];
    try{operators=await window.thor.operators();}catch{}
    const selected=resolveOperator(operators,userInput.value);
    if(!selected){setGateError(gate,'Informe um usuário ou e-mail válido.');userInput.focus();return;}
    if(!String(pin.value||'').trim()){setGateError(gate,'Informe sua senha ou PIN.');pin.focus();return;}

    entering=true;
    const originalPin=pin.value;
    try{
      setGateError(gate,'');
      setFieldsDisabled(gate,true);
      try{thorGateProgress(gate,32,'Validando acesso...','Conferindo licença, usuário e PIN.');}catch{}

      const result=await Promise.race([
        window.thor.operatorLogin({userId:selected.id,pin:originalPin}),
        timeoutAfter(6000),
      ]);
      if(!result?.operator)throw new Error('operator_login_failed');

      revealPdv(result.operator);
      try{showToast(`Bem-vindo, ${result.operator.name}. Sincronização continua em segundo plano.`);}catch{}

      // A leitura remota acontece depois que o caixa já foi liberado.
      setTimeout(async()=>{
        try{
          const fresh=await window.thor.status();
          state.status=fresh;
          if(fresh.licenseBlocked||fresh.pairingInvalidated){
            unlockedUntil=0;
            render();
            return;
          }
          if(!fresh.operator){
            unlockedUntil=0;
            render();
            return;
          }
          try{updateTop();}catch{}
        }catch{}
      },1800);
    }catch(error){
      const raw=String(error?.message||error||'');
      const message=raw==='operator_login_timeout'
        ? 'A validação não respondeu no tempo esperado. Tente novamente.'
        : friendlyError(raw);
      setGateError(gate,message);
      setFieldsDisabled(gate,false);
      pin.value='';
      pin.focus();
      const progress=gate.querySelector('#gateProgress');
      if(progress)progress.hidden=true;
      gate.querySelector('#gateLoginFields')?.classList.remove('syncing');
    }finally{
      entering=false;
    }
  }

  const previousShow=thorOperatorGateShow;
  thorOperatorGateShow=async function(message=''){
    const operator=state.status?.operator||(()=>{try{return v3State().operator}catch{return null}})();
    if(operator||Date.now()<unlockedUntil){
      thorOperatorGateRemove();
      return;
    }
    return previousShow(message);
  };

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#gateLogin');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void enterNow();
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter')return;
    const gate=document.getElementById('thorOperatorGate');
    if(!gate||!gate.contains(event.target))return;
    const target=event.target;
    if(target?.id!=='gatePin'&&target?.id!=='gateOperatorSearch')return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void enterNow();
  },true);
})();