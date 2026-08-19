const { parentPort } = require('worker_threads');

parentPort.on('message',async(message)=>{
  const {id,url,headers,body,timeoutMs}=message||{};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(timeoutMs)||15000);
  const started=Date.now();
  try{
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body||{}),signal:controller.signal});
    const data=await response.json().catch(()=>({ok:false,error:`http_${response.status}`}));
    parentPort.postMessage({id,ok:response.ok&&data?.ok!==false,status:response.status,data,durationMs:Date.now()-started});
  }catch(error){
    parentPort.postMessage({id,ok:false,error:error?.name==='AbortError'?'sync_timeout':String(error?.message||error),durationMs:Date.now()-started});
  }finally{clearTimeout(timeout);}
});
