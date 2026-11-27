// Hides polygons whose projected size is below a pixel-area threshold.
const RAD = Math.PI / 180,
  areas = new WeakMap();

/**
 * Approximate area (steradians) of a polygon's outer ring, or Infinity when
 * the ring is too large or odd for the local approximation to be trusted.
 * Cached per ring array; only small rings ever get culled, so the
 * equirectangular estimate around the ring's mean latitude is sufficient.
 */
export function polygonAreaSr(poly) {
  const ring = poly?.[0];
  if (!ring || ring.length < 4) return Infinity;
  let cached = areas.get(ring);
  if (cached !== undefined) return cached;
  let minLon = Infinity,
    maxLon = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (!(Number.isFinite(lon) && Number.isFinite(lat))) {
      areas.set(ring, (cached = Infinity));
      return cached;
    }
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Wide or polar rings (and antimeridian crossings) are never "small".
  if (
    maxLon - minLon > 30 ||
    maxLat - minLat > 30 ||
    maxLat > 80 ||
    minLat < -80
  )
    cached = Infinity;
  else {
    const k = Math.cos(((minLat + maxLat) / 2) * RAD);
    let twice = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++)
      twice +=
        ring[i][0] * k * ring[i + 1][1] - ring[i + 1][0] * k * ring[i][1];
    cached = (Math.abs(twice) / 2) * RAD * RAD;
  }
  areas.set(ring, cached);
  return cached;
}

/** True when the polygon covers fewer than `minPx` square pixels at `scale`. */
export const isSmallPolygon = (poly, scale, minPx) =>
  minPx > 0 && polygonAreaSr(poly) * scale * scale < minPx;

/**
 * Drops small polygons from a feature collection. Features keep their
 * identity when nothing is dropped; the returned `dropped` counts polygons.
 */
export function dropSmallPolygons(geojson, scale, minPx) {
  const feats = geojson?.features;
  if (!(minPx > 0) || !(scale > 0) || !feats?.length)
    return { geojson, dropped: 0 };
  let dropped = 0,
    out = null;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i],
      g = f.geometry;
    let next = f;
    if (g?.type === "Polygon") {
      if (isSmallPolygon(g.coordinates, scale, minPx)) {
        dropped++;
        next = null;
      }
    } else if (g?.type === "MultiPolygon") {
      const kept = g.coordinates.filter(
        (p) => !isSmallPolygon(p, scale, minPx),
      );
      if (kept.length !== g.coordinates.length) {
        dropped += g.coordinates.length - kept.length;
        next = kept.length
          ? { ...f, geometry: { type: "MultiPolygon", coordinates: kept } }
          : null;
      }
    }
    if (next !== f && !out) out = feats.slice(0, i);
    if (out && next) out.push(next);
  }
  return out
    ? { geojson: { type: "FeatureCollection", features: out }, dropped }
    : { geojson, dropped: 0 };
}
