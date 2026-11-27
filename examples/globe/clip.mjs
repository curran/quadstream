// Demo-specific padded viewport cache; geometry algorithms live in the library.
import { orthographicViewCone, filterVisibleFeatures, featureCap } from "./cull.mjs";
import { clipWindow, clipFeatureCollection, buildFeatureInfo, countVertices } from "../../dist/spherical-clip.js";
export { clipWindow, clipFeatureCollection, buildFeatureInfo, countVertices, clipRing, clipRingReference, ringInfo, circleRing, pairPieces, pairPiecesReference, clipToWindow } from "../../dist/spherical-clip.js";

export const CLIP_MARGIN_RAD = 0;
export const CLIP_RADIUS_SCALE = 1.2;
export const CLIP_MAX_RADIUS_RAD = Math.PI / 2 - 0.12;

const angleBetween = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, a.cx * b.vx + a.cy * b.vy + a.cz * b.vz)));

/**
 * Stateful clipper. The result is computed for a padded window and reused
 * while the live view cone (plus margin) stays inside it, so dragging only
 * re-clips when the view leaves the window.
 */
export function createViewClipper({ margin = CLIP_MARGIN_RAD } = {}) {
  const infoCache = new WeakMap(),
    capCache = new WeakMap();
  let cached = null;

  function infoFor(geojson, source) {
    let infos = infoCache.get(geojson);
    if (!infos || infos.source !== source) {
      infos = {
        features: [],
        source,
        sourceVertices: infos?.sourceVertices ?? countVertices(geojson),
      };
      infoCache.set(geojson, infos);
    }
    return infos;
  }
  const getInfoFor = (infos, source) => (i, feature) =>
    (infos.features[i] ??= buildFeatureInfo(
      feature,
      featureCap(feature, i, source),
    ));

  return function clip(geojson, state, source) {
    const cone = orthographicViewCone(state),
      infos = geojson?.features?.length ? infoFor(geojson, source) : null,
      sourceVertices = infos?.sourceVertices ?? 0,
      sourceFeatures = geojson?.features?.length ?? 0;
    if (!infos || cone.viewRadius + margin > CLIP_MAX_RADIUS_RAD) {
      cached = null;
      const visible = filterVisibleFeatures(geojson, state, capCache, source);
      return {
        geojson: visible,
        stats: {
          mode: "cull",
          rebuilt: true,
          features: visible?.features?.length ?? 0,
          sourceFeatures,
          vertices: countVertices(visible),
          sourceVertices,
          rings: { kept: 0, clipped: 0, wrapped: 0, dropped: 0 },
        },
      };
    }
    if (
      cached &&
      cached.source === geojson &&
      angleBetween(cached.window, {
        vx: cone.vx,
        vy: cone.vy,
        vz: cone.vz,
      }) +
        cone.viewRadius +
        margin <=
        cached.window.radius
    )
      return {
        geojson: cached.geojson,
        stats: { ...cached.stats, rebuilt: false },
      };
    const radius = Math.min(
      CLIP_MAX_RADIUS_RAD,
      cone.viewRadius * CLIP_RADIUS_SCALE + margin,
    ),
      window = clipWindow(cone.vx, cone.vy, cone.vz, radius),
      { geojson: out, stats } = clipFeatureCollection(
        geojson,
        window,
        getInfoFor(infos, source),
      );
    const full = { mode: "clip", sourceFeatures, sourceVertices, ...stats };
    cached = { source: geojson, window, geojson: out, stats: full };
    return { geojson: out, stats: { ...full, rebuilt: true } };
  };
}
