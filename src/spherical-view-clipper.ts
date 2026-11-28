import { clipWindow, clipFeatureCollection, buildFeatureInfo, countVertices } from "./spherical-clip.js";
import type { SphericalClipWindow, SphericalClipStats } from "./spherical-clip.js";
import { computeFeatureCaps, filterSphericalFeatures } from "./spherical-cull.js";
import type { SphericalViewCone, SphericalCap } from "./spherical-cull.js";
import type { FeatureCollection } from "./types.js";

export interface SphericalViewClipperOptions { margin?:number; radiusScale?:number; maxRadius?:number }
export interface CachedSphericalClipResult { geojson:FeatureCollection; stats:SphericalClipStats & {mode:"clip"|"cull";rebuilt:boolean;sourceVertices:number;sourceFeatures:number} }
/** Inputs are immutable by convention. Change identity or call invalidate after edits.
 * Supplied caps must conservatively enclose their corresponding frame features. */
export function createSphericalViewClipper({margin=0,radiusScale=1.2,maxRadius=Math.PI/2-0.12}:SphericalViewClipperOptions={}) {
  if(!Number.isFinite(margin)||margin<0||!Number.isFinite(radiusScale)||radiusScale<1||!Number.isFinite(maxRadius)||maxRadius<=0||maxRadius>=Math.PI/2) throw new Error("Invalid spherical clip options");
  type Info=ReturnType<typeof buildFeatureInfo>;
  let frame:FeatureCollection|undefined, capIdentity:readonly SphericalCap[]|undefined, caps:readonly SphericalCap[]|undefined, infos:Info[]=[], sourceVertices=0;
  let cached:{window:SphericalClipWindow;result:CachedSphericalClipResult}|undefined;
  const invalidate=()=>{frame=undefined;capIdentity=undefined;caps=undefined;infos=[];cached=undefined;sourceVertices=0;};
  function clip(geojson:FeatureCollection, cone:SphericalViewCone, suppliedCaps?:readonly SphericalCap[]):CachedSphericalClipResult {
    if(!Number.isFinite(cone.viewRadius)||cone.viewRadius<0||cone.viewRadius>Math.PI||Math.abs(Math.hypot(cone.vx,cone.vy,cone.vz)-1)>1e-9||![cone.vx,cone.vy,cone.vz].every(Number.isFinite))throw new Error("Invalid spherical view cone");
    if(suppliedCaps&&suppliedCaps.length!==geojson.features.length)throw new Error("Spherical caps must match feature count");
    if(frame!==geojson||capIdentity!==suppliedCaps){invalidate();frame=geojson;capIdentity=suppliedCaps;caps=suppliedCaps??computeFeatureCaps(geojson);sourceVertices=countVertices(geojson);}
    const sourceFeatures=geojson.features.length;
    if(!sourceFeatures||cone.viewRadius+margin>maxRadius||cone.viewRadius+margin===0){
      cached=undefined;const visible=filterSphericalFeatures(geojson,cone,caps);
      return {geojson:visible,stats:{mode:"cull",rebuilt:true,sourceFeatures,sourceVertices,features:visible.features.length,vertices:countVertices(visible),rings:{kept:0,clipped:0,wrapped:0,dropped:0},stream:{classified:0,inside:0,outside:0}}};
    }
    if(cached){
      const w=cached.window;
      const angle=Math.acos(Math.max(-1,Math.min(1,w.cx*cone.vx+w.cy*cone.vy+w.cz*cone.vz)));
      if(angle+cone.viewRadius+margin<=w.radius) return {geojson:cached.result.geojson,stats:{...cached.result.stats,rebuilt:false}};
    }
    const window=clipWindow(cone.vx,cone.vy,cone.vz,Math.min(maxRadius,cone.viewRadius*radiusScale+margin));
    const {geojson:out,stats}=clipFeatureCollection(geojson,window,(i,f)=>infos[i]??=(buildFeatureInfo(f,caps![i]!)));
    const result:CachedSphericalClipResult={geojson:out,stats:{...stats,mode:"clip",rebuilt:true,sourceFeatures,sourceVertices}};
    cached={window,result};return result;
  }
  return Object.assign(clip,{invalidate});
}
