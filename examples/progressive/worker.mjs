import {buildQuadstream,exportPartitions,QuadstreamSession,QuadstreamLoader,ProgressiveMap,importGeoJSON,importTopoJSON} from '../../dist/index.js';
import {schematic} from './fixture.mjs';
let engine,generation=0;
self.onmessage=async({data})=>{
 const {type,id}=data;
 if(type==='cancel'){generation++;engine?.cancel();return;}
 if(type==='init'){
  generation++;engine?.cancel();engine=undefined;
  try{
   const input=data.source===undefined?schematic:(data.source.type==='Topology'?importTopoJSON(data.source):importGeoJSON(data.source));
   const bundle=exportPartitions(buildQuadstream(input,{maxLevel:16}),{fileDepth:2});
   const fetcher=(key,{signal})=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve(bundle.partitions.get(key).slice());},data.latency??0);
    signal.addEventListener('abort',cancel,{once:true});
   });
   engine=new ProgressiveMap(new QuadstreamLoader(new QuadstreamSession(bundle.manifest),fetcher,{concurrency:4,cacheBytes:1024*1024}));
   self.postMessage({type:'ready',id,maxLevel:16,vertices:bundle.manifest.vertices.length,partitions:bundle.partitions.size});
  }catch(error){self.postMessage({type:'error',id,message:error.message});}
  return;
 }
 if(type==='request'){
  const token=++generation;
  try{
   if(!engine)throw new Error('Worker not initialized');
   await engine.request(data.query,frame=>{if(token===generation)self.postMessage({type:'frame',id,frame});});
   if(token===generation)self.postMessage({type:'done',id});
  }catch(error){if(token===generation)self.postMessage({type:'error',id,message:error.message});}
 }
};
