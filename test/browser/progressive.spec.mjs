import {test,expect} from '@playwright/test';
const ready=page=>expect(page.getByRole('status').and(page.locator('#status'))).toHaveAttribute('data-final','true',{timeout:30000});
const setRange=async(page,label,value)=>page.getByLabel(label,{exact:true}).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
test('canvas controls, keyboard pan and deterministic pixel round trip',async({page})=>{
 await page.goto('/');await ready(page);
 const canvas=page.locator('canvas#canvas');
 await expect(canvas).toHaveAttribute('aria-label',/Arrow keys pan/);
 const pixels=()=>canvas.evaluate(el=>el.toDataURL());
 const original=await pixels();
 const distinct=await canvas.evaluate(el=>{const d=el.getContext('2d').getImageData(0,0,el.width,el.height).data;const colors=new Set();for(let i=0;i<d.length;i+=4)colors.add(d.slice(i,i+3).join(','));return colors.size;});
 expect(distinct).toBeGreaterThan(3);
 await setRange(page,'Zoom',3);await ready(page);await canvas.focus();await page.keyboard.press('ArrowRight');await ready(page);
 expect(await pixels()).not.toBe(original);
 await page.getByRole('button',{name:'Reset view'}).click();await ready(page);
 expect(await pixels()).toBe(original);
 await page.getByLabel('Shared edges').uncheck();expect(await pixels()).not.toBe(original);
});
test('slow simulated partitions, rapid level changes and stale suppression',async({page})=>{
 await page.goto('/');await ready(page);
 await page.getByLabel('Simulated slow network').check();
 await expect(page.getByRole('status').and(page.locator('#status'))).toHaveAttribute('data-final','false');
 await setRange(page,'Detail',15);await setRange(page,'Detail',2);await setRange(page,'Detail',6);
 await ready(page);await expect(page.getByRole('status').and(page.locator('#status'))).toContainText('level 6/6');
 await page.waitForTimeout(400);await expect(page.getByRole('status').and(page.locator('#status'))).toContainText('level 6/6');
});
test('MapLibre integration uses local style, source updates and renderer switching',async({page})=>{
 await page.goto('/');await ready(page);
 await page.getByLabel('Renderer').selectOption('maplibre');
 await expect(page.locator('#map canvas')).toBeVisible();await ready(page);
 await setRange(page,'Detail',12);await ready(page);await expect(page.getByRole('status').and(page.locator('#status'))).toContainText('level 12/12');
 await page.getByLabel('Renderer').selectOption('canvas');await ready(page);
 await expect(page.locator('#canvas')).toBeVisible();
});
test('malformed local input reports error accessibly and recovery works',async({page})=>{
 await page.goto('/');await ready(page);
 await page.getByLabel('Local GeoJSON / TopoJSON').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});
 await expect(page.getByRole('status').and(page.locator('#status'))).toContainText('Error:');
 await page.getByRole('button',{name:'Retry'}).click();await ready(page);
});
