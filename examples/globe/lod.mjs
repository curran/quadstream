// Provisional scale thresholds, not a measured projected-error guarantee.
export const MIN_AUTO_LEVEL=4, MAX_LEVEL=19;
export function levelForScale(scale,previous,{min=MIN_AUTO_LEVEL,max=MAX_LEVEL,base=120,hysteresis=.15}={}){
 if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid projection scale');
 const continuous=min+Math.log2(scale/base);
 if(previous===undefined)return Math.max(min,Math.min(max,Math.floor(continuous)));
 let level=Math.max(min,Math.min(max,previous));
 while(level<max&&continuous>=level+1+hysteresis)level++;
 while(level>min&&continuous<level-hysteresis)level--;
 return level;
}
export function createLatestGeometry({request,onFrame,onError=()=>{}}){
 let generation=0,desired=null,disposed=false;const cache=new Map();
 return {
  async select(level){
   if(disposed||desired===level)return;desired=level;const id=++generation;
   try{
    let frame=cache.get(level);
    if(!frame){frame=await request(level);if(disposed||id!==generation)return;cache.set(level,frame);
     if(cache.size>4)cache.delete(cache.keys().next().value);}
    if(!disposed&&id===generation)onFrame(frame);
   }catch(e){if(!disposed&&id===generation){desired=null;onError(e);}}
  },
  invalidate(){generation++;desired=null;cache.clear();},
  dispose(){disposed=true;generation++;cache.clear();},
  get target(){return desired;}
 };
}
