// Adapted from the MIT-licensed VizHub globe rPa9vFJ0kEvpjaJn-280C.
// Pointer positions and scale baselines are synchronous, independent of rendering.
export function createGlobeInteraction({getState,update,onActive=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 const pointers=new Map();let pinch=null,wheelTimer=null,wheeling=false,active=false;
 const sync=()=>{const next=pointers.size>0||wheeling;if(next!==active){active=next;onActive(next);}};
 const clamp=(s,base)=>Math.max(base*.6,Math.min(base*8,s));
 const distance=()=>{const [a,b]=pointers.values();return Math.hypot(a.x-b.x,a.y-b.y);};
 const rebase=()=>{pinch=pointers.size===2?{distance:distance(),scale:getState().scale}:null;};
 return {
  down(id,x,y){if(pointers.has(id))return;pointers.set(id,{x,y});rebase();sync();},
  move(id,x,y){const old=pointers.get(id);if(!old)return;
   pointers.set(id,{x,y});const state=getState();
   if(pointers.size===1){
    const k=58*(Math.min(state.width,state.height)/600)/(state.scale||1);
    update({rotation:[state.rotation[0]+(x-old.x)*k,state.rotation[1]-(y-old.y)*k,state.rotation[2]]});
   }else if(pointers.size===2){
    const d=distance();
    if(!pinch||pinch.distance<=0){if(d>0)rebase();return;}
    update({scale:clamp(pinch.scale*d/pinch.distance,state.initialScale)});
   }
  },
  up(id){if(!pointers.delete(id))return;rebase();sync();},
  wheel(delta){if(!Number.isFinite(delta))return;const s=getState();wheeling=true;sync();
   update({scale:clamp(s.scale*Math.exp(-delta*.0015),s.initialScale)});
   if(wheelTimer!==null)clearTimer(wheelTimer);
   wheelTimer=setTimer(()=>{wheelTimer=null;wheeling=false;sync();},150);
   // A simultaneous pinch should resume from the wheel-adjusted scale.
   rebase();
  },
  rebase,
  dispose(){pointers.clear();pinch=null;if(wheelTimer!==null)clearTimer(wheelTimer);wheelTimer=null;wheeling=false;sync();},
  get pointerCount(){return pointers.size;}
 };
}
export function attachGlobeInteraction(canvas,controller){
 const registrations=[];const on=(type,fn,options)=>{canvas.addEventListener(type,fn,options);registrations.push([type,fn,options]);};
 const captured=new Set();
 on('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;
  try{canvas.setPointerCapture(e.pointerId);}catch{}captured.add(e.pointerId);
  controller.down(e.pointerId,e.clientX,e.clientY);canvas.style.cursor='grabbing';
 });
 on('pointermove',e=>controller.move(e.pointerId,e.clientX,e.clientY));
 const release=e=>{controller.up(e.pointerId);captured.delete(e.pointerId);
  try{if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}
  if(!controller.pointerCount)canvas.style.cursor='grab';
 };
 for(const t of ['pointerup','pointercancel','lostpointercapture'])on(t,release);
 on('wheel',e=>{e.preventDefault();controller.wheel(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1));},{passive:false});
 for(const t of ['gesturestart','gesturechange','gestureend'])on(t,e=>e.preventDefault(),{passive:false});
 return ()=>{for(const [t,f,o] of registrations)canvas.removeEventListener(t,f,o);
  for(const id of captured){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}}
  captured.clear();controller.dispose();canvas.style.cursor='grab';
 };
}
export function resizedView(state,width,height,margin=20){
 const initialScale=Math.max(1,(Math.min(width,height)-2*margin)/2);
 const ratio=state.initialScale?state.scale/state.initialScale:1;
 return {width,height,initialScale,scale:initialScale*ratio,translation:[width/2,height/2]};
}
