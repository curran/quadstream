// Adapted from VizHub rPa9vFJ0kEvpjaJn-280C (MIT). Geometry only.
export function createGlobeRenderer(d3,ctx){
 const projection=d3.geoOrthographic(),path=d3.geoPath(projection,ctx),graticule=d3.geoGraticule()();
 const sphere={type:'Sphere'};
 function drawShape(g,fill,stroke){ctx.beginPath();path(g);if(fill)ctx.fill();if(stroke)ctx.stroke();}
 return (state,geojson)=>{
  const {width,height,rotation,scale,translation,interacting,dpr=1}=state;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  projection.rotate(rotation).scale(scale).translate(translation);
  ctx.save();if(!interacting){ctx.shadowBlur=12;ctx.shadowColor='#8b7cf6';}
  const ocean=ctx.createRadialGradient(width*.35,height*.3,0,width*.35,height*.3,Math.max(width,height)*.75);
  ocean.addColorStop(0,'#2e2a5c');ocean.addColorStop(.6,'#1e1c46');ocean.addColorStop(1,'#12122c');
  ctx.fillStyle=ocean;ctx.strokeStyle='#b7a9f5';ctx.lineWidth=1.5;drawShape(sphere,true,true);
  ctx.shadowBlur=0;ctx.strokeStyle='#5c5c96';ctx.globalAlpha=.4;ctx.lineWidth=.5;drawShape(graticule,false,true);
  ctx.fillStyle='#2b2856';ctx.strokeStyle='#8f86d9';ctx.globalAlpha=.9;ctx.lineWidth=.5;
  for(const f of geojson?.features??[])drawShape(f,true,true);
  ctx.restore();
 };
}
