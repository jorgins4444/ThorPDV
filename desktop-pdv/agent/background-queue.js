class BackgroundTaskQueue {
  constructor({ concurrency=2, metric }={}) {
    this.concurrency=Math.max(1,Number(concurrency)||2);
    this.metric=typeof metric==='function'?metric:()=>{};
    this.pending=[];
    this.active=0;
    this.sequence=0;
  }
  add(name,task,metadata={}){
    const id=++this.sequence;
    this.pending.push({id,name,task,metadata,queuedAt:Date.now()});
    queueMicrotask(()=>this.drain());
    return {id,queued:true,position:this.pending.length};
  }
  drain(){
    while(this.active<this.concurrency&&this.pending.length){
      const item=this.pending.shift();
      this.active+=1;
      const started=Date.now();
      Promise.resolve().then(item.task).then(
        ()=>this.metric(item.name,Date.now()-started,{...item.metadata,queueWaitMs:started-item.queuedAt,ok:true}),
        (error)=>this.metric(item.name,Date.now()-started,{...item.metadata,queueWaitMs:started-item.queuedAt,ok:false,error:String(error?.message||error)})
      ).finally(()=>{this.active-=1;this.drain();});
    }
  }
  stats(){return {active:this.active,pending:this.pending.length,concurrency:this.concurrency};}
}
module.exports={BackgroundTaskQueue};
