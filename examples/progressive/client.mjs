export class WorkerMapClient {
 constructor(worker){
  this.worker=worker;this.id=0;this.pending=undefined;
  worker.addEventListener('message',({data})=>{
   const p=this.pending;if(!p||data.id!==p.id)return;
   if(data.type==='frame'){try{p.onFrame(data.frame);}catch(e){this.cancel(e);}return;}
   if(['ready','done','error'].includes(data.type)){
    this.pending=undefined;
    if(data.type==='error')p.reject(new Error(data.message));else p.resolve(data);
   }
  });
  worker.addEventListener('error',e=>this.cancel(new Error(e.message||'Worker failed')));
 }
 send(type,data,onFrame){
  this.cancel();const id=++this.id;
  return new Promise((resolve,reject)=>{
   this.pending={id,resolve,reject,onFrame};
   try{this.worker.postMessage({type,id,...data});}catch(e){this.pending=undefined;reject(e);}
  });
 }
 initialize(source,latency=0){return this.send('init',{source,latency});}
 request(query,onFrame){return this.send('request',{query},onFrame);}
 cancel(error=new DOMException('Cancelled','AbortError')){
  const p=this.pending;this.pending=undefined;if(p)p.reject(error);
  this.worker.postMessage({type:'cancel'});
 }
 dispose(){this.cancel();this.worker.terminate();}
}
