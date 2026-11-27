// Demo-specific view projection and frame/source cache policy.
import { computeFeatureCap, computeFeatureCaps, isCapVisible, lonLatToVec, filterSphericalFeatures } from "../../dist/spherical-cull.js";
export { computeFeatureCap, computeFeatureCaps, isCapVisible, lonLatToVec };

// Every LOD frame keeps a subset of its source feature's vertices, so a cap
// computed once from the full-detail source also bounds every frame feature.
// Frame features are matched to the source by index and shared `properties`.
const sourceCaps = new WeakMap();
export function featureCap(feature, index, source) {
  const original = source?.features?.[index];
  if (
    original &&
    (original === feature ||
      (original.properties && original.properties === feature.properties))
  ) {
    let caps = sourceCaps.get(source);
    if (!caps) sourceCaps.set(source, (caps = []));
    return (caps[index] ??= computeFeatureCap(original));
  }
  return computeFeatureCap(feature);
}

export function orthographicViewCone({
  rotation = [0, 0, 0],
  scale = 1,
  width = 0,
  height = 0,
  translation,
}) {
  const [vx, vy, vz] = lonLatToVec(-rotation[0], -rotation[1]);
  const tx = translation?.[0] ?? width / 2,
    ty = translation?.[1] ?? height / 2;
  const cornerDistPx = Math.max(
    Math.hypot(tx, ty),
    Math.hypot(width - tx, ty),
    Math.hypot(tx, height - ty),
    Math.hypot(width - tx, height - ty),
  );
  const viewport =
    scale > 0 ? Math.asin(Math.min(1, cornerDistPx / scale)) : Math.PI / 2;
  return {
    vx,
    vy,
    vz,
    viewRadius: Math.min(Math.PI / 2, viewport),
  };
}

export function filterVisibleFeatures(geojson, state, capCache, source) {
  const features = geojson?.features;
  if (!features?.length) return geojson;
  const cone = orthographicViewCone(state);
  if (source) {
    return filterSphericalFeatures(geojson, cone, features.map((f, i) => featureCap(f, i, source)));
  }
  let caps = capCache?.get(geojson);
  if (!caps) {
    caps = computeFeatureCaps(geojson);
    capCache?.set(geojson, caps);
  }
  return filterSphericalFeatures(geojson, cone, caps);
}
