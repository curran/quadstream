import type { FeatureCollection, Geometry, Position } from "./types.js";
export interface PackedGeometry { coords: Float64Array; meta: Int32Array }
type PolygonGeometry = Extract<Geometry, {type:"Polygon"|"MultiPolygon"}>;
function polygons(g: Geometry): Position[][][] {
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  throw new Error("Packed geometry supports only Polygon and MultiPolygon");
}
/** Transferable geometry only; feature order and metadata are supplied by the original. */
export function packGeometry(geojson: FeatureCollection): PackedGeometry {
  let metaLen=0, coordCount=0;
  for (const f of geojson.features) {
    const polys=polygons(f.geometry);
    metaLen++;
    for (const rings of polys) {
      metaLen+=1+rings.length;
      for (const ring of rings) coordCount+=ring.length*2;
    }
  }
  const meta=new Int32Array(metaLen), coords=new Float64Array(coordCount);
  let mi=0,ci=0;
  for (const f of geojson.features) {
    const polys=polygons(f.geometry); meta[mi++]=polys.length;
    for (const rings of polys) {
      meta[mi++]=rings.length;
      for (const ring of rings) {
        meta[mi++]=ring.length;
        for (const [x,y] of ring) { if (!Number.isFinite(x)||!Number.isFinite(y)) throw new Error("Non-finite coordinate"); coords[ci++]=x; coords[ci++]=y; }
      }
    }
  }
  return {coords,meta};
}
export function unpackGeometry(original: FeatureCollection, coords: Float64Array, meta: Int32Array): FeatureCollection {
  let mi=0,ci=0;
  const next=(limit:number)=>{const n=meta[mi++];if(n===undefined||n<0||n>limit)throw new Error("Malformed geometry metadata");return n;};
  const features=original.features.map(f=>{
    polygons(f.geometry);
    const count=next(meta.length-mi-1);
    if(f.geometry.type==="Polygon"&&count!==1)throw new Error("Malformed polygon");
    const polys:Position[][][]=[];
    for(let p=0;p<count;p++){
      const rings:Position[][]=[], nr=next(meta.length-mi-1);
      for(let r=0;r<nr;r++){
        const ring:Position[]=[], np=next(Math.floor((coords.length-ci)/2));
        for(let k=0;k<np;k++){const x=coords[ci++]!,y=coords[ci++]!;if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error("Non-finite coordinate");ring.push([x,y]);}
        rings.push(ring);
      }
      polys.push(rings);
    }
    const geometry:PolygonGeometry=f.geometry.type==="Polygon"?{type:"Polygon",coordinates:polys[0]!}:{type:"MultiPolygon",coordinates:polys};
    return {...f,geometry};
  });
  if(mi!==meta.length||ci!==coords.length)throw new Error("Trailing geometry data");
  return {type:"FeatureCollection",features};
}
