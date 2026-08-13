(()=>{
  if(typeof safePrint!=='function')return;
  const previousSafePrint=safePrint;
  safePrint=async function(key,type){
    const result=await previousSafePrint(key,type);
    if(result!==false||type!=='pre_sale')return result;
    const progress=[...document.querySelectorAll('.modal')].reverse().find(m=>m.querySelector('#v103ReprocessTitle'));
    if(!progress)return result;
    setTimeout(()=>{
      if(!progress.isConnected)return;
      const title=progress.querySelector('#v103ReprocessTitle');
      const text=progress.querySelector('#v103ReprocessText');
      if(title)title.textContent='Venda recuperada';
      if(text)text.textContent='A sincronização foi concluída. O comprovante de Pré-venda não foi impresso; você pode imprimi-lo depois nos detalhes da venda.';
    },0);
    return true;
  };
  window.safePrint=safePrint;
})();
