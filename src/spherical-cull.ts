import type { Feature, FeatureCollection, Geometry, Position } from "./types.js";
import type { UnitVector } from "./spherical-geometry.js";

/** Unit-vector center and angular radius, in radians. */
export interface SphericalCap {
  cx: number;
  cy: number;
  cz: number;
  radiusRad: number;
}
export interface SphericalViewCone {
  vx: number;
  vy: number;
  vz: number;
  viewRadius: number;
}

const RAD = Math.PI / 180;
const CAP_MARGIN_RAD = 0.02;

export function lonLatToVec(lon: number, lat: number): UnitVector {
  const lambda = lon * RAD,
    phi = lat * RAD,
    cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function forEachRingCoord(geometry: Geometry, fn: (point: Position) => void) {
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
export function computeFeatureCap(feature: Feature): SphericalCap {
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
  // The original algorithm only visits polygon rings. Non-polygons must
  // remain visible rather than being treated as a point at (0, 0).
  if (!count && feature.geometry.type !== "Polygon" &&
      feature.geometry.type !== "MultiPolygon")
    return { cx: 1, cy: 0, cz: 0, radiusRad: Math.PI };
  if (!count) return { cx: 1, cy: 0, cz: 0, radiusRad: 0 };
  const len = Math.hypot(sx, sy, sz);
  if (len < 1e-6) return { cx: 1, cy: 0, cz: 0, radiusRad: Math.PI };
  const cx = sx / len,
    cy = sy / len,
    cz = sz / len;
  let minDot = 1;
  for (let i = 0; i < count; i++) {
    const dot =
      cx * scratch[i * 3]! + cy * scratch[i * 3 + 1]! + cz * scratch[i * 3 + 2]!;
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

export function computeFeatureCaps(geojson: FeatureCollection): SphericalCap[] {
  return (geojson?.features ?? []).map(computeFeatureCap);
}

export function isCapVisible(cap: SphericalCap, cone: SphericalViewCone): boolean {
  const maxAngle = cap.radiusRad + cone.viewRadius;
  if (maxAngle >= Math.PI) return true;
  const dot = cap.cx * cone.vx + cap.cy * cone.vy + cap.cz * cone.vz;
  return dot >= Math.cos(maxAngle);
}


/** Filter using an explicit view cone. Supplied caps must match this frame
 * by index and conservatively enclose its geometry. Inputs are not modified.
 * The cap construction is intended for small-interior spherical polygons;
 * it is not a proof of containment for arbitrary spherical geometry.
 */
export function filterSphericalFeatures(
  geojson: FeatureCollection,
  cone: SphericalViewCone,
  caps: readonly SphericalCap[] = computeFeatureCaps(geojson),
): FeatureCollection {
  if (caps.length !== geojson.features.length)
    throw new Error("Spherical caps must match feature count");
  if (!geojson.features.length) return geojson;
  return {
    type: "FeatureCollection",
    features: geojson.features.filter((_, i) => isCapVisible(caps[i]!, cone)),
  };
}
