// Demo-specific padded viewport cache; geometry algorithms live in the library.
import { orthographicViewCone, featureCap } from "./cull.mjs";
import { createSphericalViewClipper } from "../../dist/index.js";
export { clipWindow, clipFeatureCollection, buildFeatureInfo, countVertices, clipRing, clipRingReference, ringInfo, circleRing, pairPieces, pairPiecesReference, clipToWindow } from "../../dist/spherical-clip.js";

export const CLIP_MARGIN_RAD = 0;
export const CLIP_RADIUS_SCALE = 1.2;
export const CLIP_MAX_RADIUS_RAD = Math.PI / 2 - 0.12;

export function createViewClipper({ margin = CLIP_MARGIN_RAD } = {}) {
  const clip = createSphericalViewClipper({margin,radiusScale:CLIP_RADIUS_SCALE,maxRadius:CLIP_MAX_RADIUS_RAD});
  let lastFrame, lastSource, caps;
  return (geojson,state,source) => {
    if (geojson !== lastFrame || source !== lastSource) {
      lastFrame=geojson;lastSource=source;
      caps=geojson?.features.map((f,i)=>featureCap(f,i,source));
    }
    if (!geojson) { clip.invalidate(); return {geojson,stats:{mode:"cull",rebuilt:true,features:0,sourceFeatures:0,vertices:0,sourceVertices:0,rings:{kept:0,clipped:0,wrapped:0,dropped:0}}}; }
    return clip(geojson,orthographicViewCone(state),caps);
  };
}
