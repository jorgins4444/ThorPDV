function installOperationsServerV125(ThorAgent){
  const proto=ThorAgent.prototype;
  const previous=proto.operationHistory;
  const originalReprint=proto.reprintOperation;
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
    // Keep server records available for printing even when they do not exist in the local SQLite database.
    this._serverOperationDocuments = new Map(remote.map(row=>[row.id,row]));
    const map=new Map();
    for(const row of [...remote,...local]){
      const key=`${row.type}|${row.source_event_id||row.reference||row.id}`;
      if(!map.has(key)||row.origin==='server')map.set(key,row);
    }
    return [...map.values()].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0)).slice(0,Math.min(Math.max(Number(filters.limit)||250,1),500));
  };
  proto.reprintOperation=async function(args={}){
    this._ensureOperationsV120();
    const id=safeText(args.documentId);
    const local=this.store.db.prepare('select id from operation_documents where id=?').get(id);
    if(local)return originalReprint.call(this,args);

    const remote=this._serverOperationDocuments?.get(id);
    if(!remote || remote.origin!=='server')throw new Error('operation_document_not_found');

    // Prefer an existing local document with the same event, avoiding duplicate records.
    const existing=remote.source_event_id
      ?this.store.db.prepare('select id from operation_documents where source_event_id=? and type=?').get(remote.source_event_id,remote.type)
      :null;
    if(existing)return originalReprint.call(this,{...args,documentId:existing.id});

    // Materialize the server's authenticated history record as a local operation document.
    // The original reprint handler still enforces operator/supervisor permissions and audit.
    const localId='server-'+id;
    this.store.db.prepare(`insert or ignore into operation_documents
      (id,type,reference,source_event_id,payload,sensitive,created_at,updated_at)
      values(?,?,?,?,?,?,?,?)`).run(
      localId,remote.type,remote.reference||'',null,JSON.stringify(remote.payload||{}),
      remote.sensitive?1:0,remote.created_at,new Date().toISOString()
    );
    return originalReprint.call(this,{...args,documentId:localId});
  };
}
module.exports={installOperationsServerV125};
