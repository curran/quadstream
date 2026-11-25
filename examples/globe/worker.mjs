// Classic worker loads pinned local demo dependencies, not CDNs.
importScripts('../../node_modules/d3/dist/d3.min.js','../../node_modules/topojson-client/dist/topojson-client.min.js');
let engine;const ready=import('./geometry.mjs');
let chain=Promise.resolve();
self.onmessage=({data:m})=>{
 chain=chain.then(async()=>{
  try{
   const {createGlobeGeometry,decodeCountries}=await ready;
   if(m.type==='init'){
    const original=decodeCountries(m.source,self.topojson);
    engine=createGlobeGeometry(original,self.d3);
    self.postMessage({id:m.id,original,sourceVertices:engine.sourceVertices,buildMs:engine.buildMs,unavailable:engine.unavailable,reasons:engine.reasons});
   }else if(m.type==='query'){
    if(!engine)throw new Error('Geometry worker not initialized');
    self.postMessage({id:m.id,frame:engine.query(m.level)});
   }
  }catch(e){self.postMessage({id:m.id,error:String(e.message??e)});}
 });
};
