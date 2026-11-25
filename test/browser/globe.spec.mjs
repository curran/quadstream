import {test,expect} from '@playwright/test';
const url='/examples/globe/index.html?fixture=1';
const globe=page=>page.locator('#globe');
// The status changes when the worker responds, before the next animation
// frame publishes the canvas diagnostics. Wait for the actual requested frame.
const ready=async page=>{
 await page.waitForFunction(()=>{
  const el=document.querySelector('#globe'),d=el.dataset;
  return document.querySelector('#status').dataset.phase==='ready'
   && d.mode==='quadstream' && d.renderedLevel===document.querySelector('#level').value
   && !!d.rotation && Number(d.scale)>0 && Number(d.requests)>0
   && Number(d.sourceVertices)>0 && Number(d.vertices)>0;
 },null,{timeout:60000});
};
const state=async page=>globe(page).evaluate(el=>({rotation:JSON.parse(el.dataset.rotation),scale:Number(el.dataset.scale),initial:Number(el.dataset.initialScale),requests:Number(el.dataset.requests),interacting:el.dataset.interacting==='true',level:Number(el.dataset.renderedLevel),vertices:Number(el.dataset.vertices),source:Number(el.dataset.sourceVertices)}));
const near=(actual,expected)=>expect(Math.abs(actual-expected)).toBeLessThan(.001);
async function pointer(page,type,id,x,y,pointerType='touch'){
 await globe(page).dispatchEvent(type,{pointerId:id,pointerType,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,isPrimary:id===1});
}
async function waitScale(page,value){await expect.poll(async()=>Math.abs((await state(page)).scale-value)).toBeLessThan(.001);}
async function manual(page,level){await page.locator('#auto').uncheck();await page.locator('#level').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},level);await ready(page);await expect(globe(page)).toHaveAttribute('data-rendered-level',String(level));}
test('mouse drag rotates without geometry queries; wheel zoom and keyboard work',async({page})=>{
 await page.goto(url);await ready(page);const a=await state(page);
 await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(650,450,{steps:5});await page.mouse.up();
 await expect.poll(async()=>(await state(page)).rotation[0]).toBeGreaterThan(a.rotation[0]);
 const b=await state(page);expect(b.requests).toBe(a.requests);
 await page.mouse.wheel(0,-600);await expect.poll(async()=>(await state(page)).scale).toBeGreaterThan(b.scale);
 await expect(globe(page)).toHaveAttribute('data-interacting','false');
 await globe(page).focus();await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await state(page)).rotation[0]).toBeGreaterThan(b.rotation[0]);
});
test('two consecutive pinches and one-two-one transitions preserve baseline and rotation',async({page})=>{
 await page.goto(url);await ready(page);const a=await state(page);
 await pointer(page,'pointerdown',1,400,400);await pointer(page,'pointerdown',2,500,400);
 await pointer(page,'pointermove',2,600,400);await waitScale(page,a.scale*2);
 expect((await state(page)).rotation).toEqual(a.rotation);
 await pointer(page,'pointerup',2,600,400);await pointer(page,'pointermove',1,400,400);
 await pointer(page,'pointermove',1,420,400);await expect.poll(async()=>(await state(page)).rotation[0]).toBeGreaterThan(a.rotation[0]);
 const b=await state(page);await pointer(page,'pointerup',1,420,400);
 await pointer(page,'pointerdown',3,400,400);await pointer(page,'pointerdown',4,500,400);
 await pointer(page,'pointermove',4,450,400);await waitScale(page,b.scale*.5);
 await pointer(page,'pointercancel',4,450,400);await pointer(page,'lostpointercapture',3,400,400);
 await expect(globe(page)).toHaveAttribute('data-interacting','false');
});
test('three pointers pause, resume without scale jump and suppress native gestures',async({page})=>{
 await page.goto(url);await ready(page);const a=await state(page);
 await pointer(page,'pointerdown',1,400,400);await pointer(page,'pointerdown',2,500,400);
 await pointer(page,'pointerdown',3,600,400);await pointer(page,'pointermove',2,550,400);
 await waitScale(page,a.scale);await pointer(page,'pointerup',1,400,400);
 await pointer(page,'pointermove',3,650,400);await waitScale(page,a.scale*2);
 await pointer(page,'pointerup',2,550,400);await pointer(page,'pointerup',3,650,400);
 await expect(globe(page)).toHaveAttribute('data-interacting','false');
 expect(await globe(page).evaluate(el=>{const e=new Event('gesturestart',{cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;})).toBe(true);
 expect(await globe(page).evaluate(el=>getComputedStyle(el).touchAction)).toBe('none');
});
test('real Chromium multi-touch input through CDP preserves scale across separate pinches',async({page,browserName})=>{
 test.skip(browserName!=='chromium','CDP touch injection is Chromium-specific');
 await page.goto(url);await ready(page);const a=await state(page);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});
 await send('touchStart',[[1,400,400],[2,500,400]]);await send('touchMove',[[1,350,400],[2,550,400]]);await waitScale(page,a.scale*2);
 await send('touchEnd',[]);await expect(globe(page)).toHaveAttribute('data-interacting','false');
 await send('touchStart',[[3,400,400],[4,500,400]]);await send('touchMove',[[3,425,400],[4,475,400]]);await waitScale(page,a.scale);
 await send('touchEnd',[]);await cdp.detach();
});
test('resize preserves relative zoom and rotation',async({page})=>{
 await page.goto(url);await ready(page);await page.mouse.move(500,400);await page.mouse.wheel(0,-400);
 await expect.poll(async()=>(await state(page)).scale/(await state(page)).initial).toBeGreaterThan(1.5);
 const a=await state(page);await page.setViewportSize({width:390,height:740});
 await expect.poll(async()=>(await state(page)).initial).toBeLessThan(a.initial);
 const b=await state(page);near(b.scale/b.initial,a.scale/a.initial);expect(b.rotation).toEqual(a.rotation);
});
test('manual levels reduce geometry and return full detail; original toggle draws equivalent pixels',async({page})=>{
 await page.goto(url);await ready(page);await manual(page,0);const a=await state(page);expect(a.vertices).toBeLessThan(a.source);
 await manual(page,19);const b=await state(page);expect(b.vertices).toBe(b.source);
 await page.locator('#mode').selectOption('original');await expect(globe(page)).toHaveAttribute('data-mode','original');
 // Keep the original raw RGBA buffer in the browser. PNG encoding/decoding
 // and drawing onto another canvas can introduce color/alpha rounding.
 const original=await globe(page).evaluateHandle(el=>({width:el.width,height:el.height,data:el.getContext('2d').getImageData(0,0,el.width,el.height).data}));
 try{
  await page.locator('#mode').selectOption('quadstream');await ready(page);
  const difference=await globe(page).evaluate((el,snapshot)=>{
   if(el.width!==snapshot.width||el.height!==snapshot.height)throw new Error('Canvas size changed during comparison');
   const a=snapshot.data,b=el.getContext('2d').getImageData(0,0,el.width,el.height).data;
   let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2,3].map(j=>Math.abs(a[i+j]-b[i+j])))>12)n++;return n/(el.width*el.height);
  },original);expect(difference).toBeLessThan(.005);
 }finally{await original.dispose();}
});
test('default real atlas loads, supports reduction and full detail',async({page})=>{
 await page.goto('/examples/globe/index.html');await ready(page);await manual(page,4);const a=await state(page);
 expect(a.source).toBeGreaterThan(1000);expect(a.vertices).toBeLessThan(a.source);
 await manual(page,19);expect((await state(page)).vertices).toBeLessThanOrEqual(a.source);
});
test('failed local file surfaces an error and fixture reload recovers',async({page})=>{
 await page.goto(url);await ready(page);
 await page.locator('#file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await expect(page.locator('#status')).toHaveAttribute('data-phase','error');
 await page.locator('#atlas').selectOption('110m');await page.locator('#atlas').selectOption('fixture');await ready(page);
 expect((await state(page)).source).toBeGreaterThan(0);
});
