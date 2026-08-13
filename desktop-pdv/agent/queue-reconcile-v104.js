function installQueueReconcileV104(Store){
  if(Store.prototype.__queueReconcileV104)return;
  Store.prototype.__queueReconcileV104=true;
  const previousApplyPull=Store.prototype.applyPull;
  Store.prototype.applyPull=function(data){
    const result=previousApplyPull.call(this,data);
    const sales=Array.isArray(data?.sales_history)?data.sales_history:[];
    const now=new Date().toISOString();
    const mark=this.db.prepare("update queue set state='synced',last_error=null,updated_at=? where id=? and type='sale_completed'");
    const receipt=this.db.prepare("update receipts set server_sale_id=coalesce(server_sale_id,?),server_number=case when ?<>'' then ? else server_number end where event_id=?");
    const tx=this.db.transaction(()=>{
      for(const sale of sales){
        const eventId=String(sale?.client_event_id||'').trim();
        if(!eventId)continue;
        mark.run(now,eventId);
        receipt.run(String(sale?.id||''),String(sale?.number||''),String(sale?.number||''),eventId);
      }
    });
    tx();
    return result;
  };
}
module.exports={installQueueReconcileV104};
