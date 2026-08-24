function installOperationsServerV125(ThorAgent){
  const proto=ThorAgent.prototype;
  const previous=proto.operationHistory;
  const safeText=v=>String(v??'').trim();
  const normalize=(row,origin='local')=>({
    ...row,
    id:safeText(row.id),
    type:safeText(row.type),
    reference:safeText(row.reference),
    source_event_id:safeText(row.source_event_id),
    payload:row.payload&&typeof row.payload==='object'?row.payload:{},
    sensitive:Boolean(row.sensitive),
    created_at:row.created_at||new Date().toISOString(),
    origin:row.origin||origin,
  });
  proto.operationHistory=async function(filters={}){
    const local=await Promise.resolve(previous.call(this,filters)).then(rows=>Array.isArray(rows)?rows.map(r=>normalize(r,'local')):[]).catch(()=>[]);
    const token=this.deviceToken?.();
    if(!token)return local;
    let remote=[];
    try{
      const response=await fetch(`${String(this.apiBase||'').replace(/\/$/,'')}/api/pdv/operations`,{
        method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},
        body:JSON.stringify({query:filters.query||'',type:filters.type||'all',limit:filters.limit||250}),
      });
      const data=await response.json().catch(()=>({}));
      if(response.ok&&data?.ok&&Array.isArray(data.data))remote=data.data.map(r=>normalize(r,'server'));
    }catch{}
    const map=new Map();
    for(const row of [...remote,...local]){
      const key=`${row.type}|${row.source_event_id||row.reference||row.id}`;
      if(!map.has(key)||row.origin==='server')map.set(key,row);
    }
    return [...map.values()].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0)).slice(0,Math.min(Math.max(Number(filters.limit)||250,1),500));
  };
}
module.exports={installOperationsServerV125};
