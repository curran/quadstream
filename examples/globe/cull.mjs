const RAD = Math.PI / 180;
const CAP_MARGIN_RAD = 0.02;

export function lonLatToVec(lon, lat) {
  const lambda = lon * RAD,
    phi = lat * RAD,
    cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function forEachRingCoord(geometry, fn) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) for (const pt of ring) fn(pt);
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates)
      for (const ring of poly) for (const pt of ring) fn(pt);
  }
}

// Scratch unit vectors let the cap use one trig pass instead of two.
let scratch = new Float64Array(3 * 4096);
export function computeFeatureCap(feature) {
  let sx = 0,
    sy = 0,
    sz = 0,
    count = 0;
  forEachRingCoord(feature.geometry, ([lon, lat]) => {
    if (count * 3 + 3 > scratch.length) {
      const grown = new Float64Array(scratch.length * 2);
      grown.set(scratch);
      scratch = grown;
    }
    const [x, y, z] = lonLatToVec(lon, lat);
    scratch[count * 3] = x;
    scratch[count * 3 + 1] = y;
    scratch[count * 3 + 2] = z;
    sx += x;
    sy += y;
    sz += z;
    count++;
  });
  if (!count) return { cx: 1, cy: 0, cz: 0, radiusRad: 0 };
  const len = Math.hypot(sx, sy, sz);
  if (len < 1e-6) return { cx: 1, cy: 0, cz: 0, radiusRad: Math.PI };
  const cx = sx / len,
    cy = sy / len,
    cz = sz / len;
  let minDot = 1;
  for (let i = 0; i < count; i++) {
    const dot =
      cx * scratch[i * 3] + cy * scratch[i * 3 + 1] + cz * scratch[i * 3 + 2];
    if (dot < minDot) minDot = dot;
  }
  const maxAngle = Math.acos(Math.max(-1, Math.min(1, minDot)));
  return {
    cx,
    cy,
    cz,
    radiusRad: Math.min(Math.PI, maxAngle + CAP_MARGIN_RAD),
  };
}

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

export function computeFeatureCaps(geojson) {
  return (geojson?.features ?? []).map(computeFeatureCap);
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

export function isCapVisible(cap, cone) {
  const maxAngle = cap.radiusRad + cone.viewRadius;
  if (maxAngle >= Math.PI) return true;
  const dot = cap.cx * cone.vx + cap.cy * cone.vy + cap.cz * cone.vz;
  return dot >= Math.cos(maxAngle);
}

export function filterVisibleFeatures(geojson, state, capCache, source) {
  const features = geojson?.features;
  if (!features?.length) return geojson;
  const cone = orthographicViewCone(state),
    visible = [];
  if (source) {
    for (let i = 0; i < features.length; i++)
      if (isCapVisible(featureCap(features[i], i, source), cone))
        visible.push(features[i]);
    return { type: "FeatureCollection", features: visible };
  }
  let caps = capCache?.get(geojson);
  if (!caps) {
    caps = computeFeatureCaps(geojson);
    capCache?.set(geojson, caps);
  }
  for (let i = 0; i < features.length; i++) {
    if (isCapVisible(caps[i], cone)) visible.push(features[i]);
  }
  return { type: "FeatureCollection", features: visible };
}
