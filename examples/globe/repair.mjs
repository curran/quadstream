import {
  canonicalLonLat,
  projectSpherical,
  simpleClosedRing,
  sphericalChart,
} from "../../dist/index.js";

const DEG = 180 / Math.PI,
  MAX_RING = 5000,
  MAX_PASSES = 16;

const orient = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// First pair of non-adjacent edges that properly cross (O(n^2), only run on
// rings the validator already rejected).
function firstCrossing(xy) {
  const n = xy.length - 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = xy[i],
        b = xy[i + 1],
        c = xy[j],
        d = xy[j + 1],
        d1 = orient(a, b, c),
        d2 = orient(a, b, d),
        d3 = orient(c, d, a),
        d4 = orient(c, d, b);
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        const t = d3 / (d3 - d4);
        return {
          i,
          j,
          x: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        };
      }
    }
  return null;
}

function unproject([x, y], chart) {
  const v = [0, 1, 2].map(
    (k) => chart.center[k] + x * chart.east[k] + y * chart.north[k],
  );
  const len = Math.hypot(...v);
  return canonicalLonLat([
    Math.atan2(v[1], v[0]) * DEG,
    Math.asin(Math.max(-1, Math.min(1, v[2] / len))) * DEG,
  ]);
}

/**
 * Removes self-intersection loops from a closed lon/lat ring by cutting at
 * each crossing and discarding the loop with fewer vertices. Returns the
 * repaired ring, or null when the ring is not repairable this way.
 */
export function repairRing(ring, chart = null) {
  if (ring.length < 4 || ring.length > MAX_RING) return null;
  let pts = ring.slice(0, -1);
  try {
    chart ??= sphericalChart(ring);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const closed = [...pts, pts[0]],
        xy = closed.map((p) => projectSpherical(p, chart));
      if (simpleClosedRing(xy)) return closed;
      const hit = firstCrossing(xy);
      if (!hit) return null;
      const x = unproject(hit.x, chart),
        inner = pts.slice(hit.i + 1, hit.j + 1);
      pts =
        inner.length <= pts.length - inner.length
          ? [...pts.slice(0, hit.i + 1), x, ...pts.slice(hit.j + 1)]
          : [x, ...inner];
      if (pts.length < 3) return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Repairs every ring of a Polygon/MultiPolygon; reports whether it changed. */
export function repairGeometry(geometry) {
  let changed = false;
  const fix = (poly) => {
    let chart = null;
    try {
      chart = sphericalChart(poly[0]);
    } catch {
      return poly;
    }
    return poly.map((ring) => {
      const xy = (() => {
        try {
          return ring.map((p) => projectSpherical(p, chart));
        } catch {
          return null;
        }
      })();
      if (!xy || simpleClosedRing(xy)) return ring;
      const fixed = repairRing(ring, chart);
      if (!fixed) return ring;
      changed = true;
      return fixed;
    });
  };
  const next =
    geometry.type === "Polygon"
      ? { ...geometry, coordinates: fix(geometry.coordinates) }
      : geometry.type === "MultiPolygon"
        ? { ...geometry, coordinates: geometry.coordinates.map(fix) }
        : geometry;
  return { geometry: next, changed };
}
