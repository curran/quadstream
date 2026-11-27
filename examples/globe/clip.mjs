// Render-side spherical clipping to the visible cone. Rings that cross the
// cone boundary keep their inside vertices plus the exact boundary crossings;
// every outside run collapses to a walk along the (padded) cone boundary, in
// the winding direction that preserves the polygon's interior side. Source
// geometry and Quadstream topology are never modified.
import {
  isCapVisible,
  lonLatToVec,
  orthographicViewCone,
  filterVisibleFeatures,
  computeFeatureCap,
  featureCap,
} from "./cull.mjs";

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
export const CLIP_MARGIN_RAD = 0.05;
export const CLIP_MAX_RADIUS_RAD = Math.PI / 2 - 0.12;
const WALK_STEP_RAD = (4 * Math.PI) / 180;
const CAP_MARGIN_RAD = 0.02;

// d3 spherical winding: material lies to the right of an exterior ring, so the
// boundary walk goes clockwise (decreasing azimuth). Holes are clipped as the
// region they enclose, which lies to their left.
const EXTERIOR = -1;
const HOLE = 1;

export function clipWindow(cx, cy, cz, radius) {
  const ex = Math.abs(cz) < 0.9 ? [0, 0, 1] : [1, 0, 0],
    d = ex[0] * cx + ex[1] * cy + ex[2] * cz;
  let ux = ex[0] - d * cx,
    uy = ex[1] - d * cy,
    uz = ex[2] - d * cz;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  return {
    cx,
    cy,
    cz,
    radius,
    cosR: Math.cos(radius),
    sinR: Math.sin(radius),
    ux,
    uy,
    uz,
    bx: cy * uz - cz * uy,
    by: cz * ux - cx * uz,
    bz: cx * uy - cy * ux,
    // Fields consumed by isCapVisible.
    vx: cx,
    vy: cy,
    vz: cz,
    viewRadius: radius,
  };
}

function toLonLat(x, y, z) {
  return [
    Math.atan2(y, x) * DEG,
    Math.asin(Math.max(-1, Math.min(1, z))) * DEG,
  ];
}

function circlePoint(w, phi) {
  const c = Math.cos(phi),
    s = Math.sin(phi);
  return toLonLat(
    w.cx * w.cosR + w.sinR * (w.ux * c + w.bx * s),
    w.cy * w.cosR + w.sinR * (w.uy * c + w.by * s),
    w.cz * w.cosR + w.sinR * (w.uz * c + w.bz * s),
  );
}

function azimuth(w, x, y, z) {
  return Math.atan2(
    x * w.bx + y * w.by + z * w.bz,
    x * w.ux + y * w.uy + z * w.uz,
  );
}

const mod = (a) => ((a % TAU) + TAU) % TAU;

// Points strictly between two boundary azimuths, walking in `side` direction.
function walk(w, from, to, side, out) {
  let delta = mod(side < 0 ? from - to : to - from);
  if (delta < 1e-9 || delta > TAU - 1e-9) return;
  const steps = Math.ceil(delta / WALK_STEP_RAD);
  for (let k = 1; k < steps; k++)
    out.push(circlePoint(w, from + (side * delta * k) / steps));
}

export function circleRing(w, side = EXTERIOR) {
  const n = Math.ceil(TAU / WALK_STEP_RAD),
    ring = [];
  for (let k = 0; k < n; k++) ring.push(circlePoint(w, (side * TAU * k) / n));
  ring.push(ring[0]);
  return ring;
}

// Crossings of the minor arc A->B with the window boundary, in travel order
// along the canonical (lexicographically ordered) orientation so shared
// borders produce bit-identical points on both neighbours.
function arcCrossings(w, a0, a1, a2, b0, b1, b2) {
  const swapped = a0 > b0 || (a0 === b0 && (a1 > b1 || (a1 === b1 && a2 > b2)));
  let ax = a0,
    ay = a1,
    az = a2,
    bx = b0,
    by = b1,
    bz = b2;
  if (swapped) {
    ax = b0;
    ay = b1;
    az = b2;
    bx = a0;
    by = a1;
    bz = a2;
  }
  let nx = ay * bz - az * by,
    ny = az * bx - ax * bz,
    nz = ax * by - ay * bx;
  const sinL = Math.hypot(nx, ny, nz);
  if (sinL < 1e-14) return null;
  nx /= sinL;
  ny /= sinL;
  nz /= sinL;
  const cn = w.cx * nx + w.cy * ny + w.cz * nz;
  let px = w.cx - cn * nx,
    py = w.cy - cn * ny,
    pz = w.cz - cn * nz;
  const cosD = Math.hypot(px, py, pz);
  if (cosD < 1e-12 || cosD < w.cosR) return null;
  px /= cosD;
  py /= cosD;
  pz /= cosD;
  const theta = Math.acos(Math.min(1, w.cosR / cosD)),
    ct = Math.cos(theta),
    st = Math.sin(theta),
    // Travel direction at p: n x p.
    tx = ny * pz - nz * py,
    ty = nz * px - nx * pz,
    tz = nx * py - ny * px,
    first = [px * ct - tx * st, py * ct - ty * st, pz * ct - tz * st],
    second = [px * ct + tx * st, py * ct + ty * st, pz * ct + tz * st];
  const L = Math.atan2(sinL, ax * bx + ay * by + az * bz),
    alpha = (q) =>
      Math.atan2(
        nx * (ay * q[2] - az * q[1]) +
          ny * (az * q[0] - ax * q[2]) +
          nz * (ax * q[1] - ay * q[0]),
        ax * q[0] + ay * q[1] + az * q[2],
      );
  return { first, second, swapped, alpha, L };
}

// Outside -> outside edge: both crossings must lie on the arc.
function throughCrossings(w, A, B) {
  const c = arcCrossings(w, A[0], A[1], A[2], B[0], B[1], B[2]);
  if (!c) return null;
  const eps = 1e-12,
    a1 = c.alpha(c.first),
    a2 = c.alpha(c.second);
  if (a1 < -eps || a1 > c.L + eps || a2 < -eps || a2 > c.L + eps) return null;
  return c.swapped ? [c.second, c.first] : [c.first, c.second];
}
function exitPoint(w, A, B) {
  const c = arcCrossings(w, A[0], A[1], A[2], B[0], B[1], B[2]);
  if (!c) return null;
  return c.swapped ? c.first : c.second;
}
function entryPoint(w, A, B) {
  const c = arcCrossings(w, A[0], A[1], A[2], B[0], B[1], B[2]);
  if (!c) return null;
  return c.swapped ? c.second : c.first;
}

export function ringInfo(ring) {
  let n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1])
    n--;
  const xyz = new Float64Array(n * 3);
  let sx = 0,
    sy = 0,
    sz = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = lonLatToVec(ring[i][0], ring[i][1]);
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    sx += x;
    sy += y;
    sz += z;
  }
  const len = Math.hypot(sx, sy, sz);
  let cap;
  if (!n) cap = { cx: 1, cy: 0, cz: 0, radiusRad: 0 };
  else if (len < 1e-6) cap = { cx: 1, cy: 0, cz: 0, radiusRad: Math.PI };
  else {
    const cx = sx / len,
      cy = sy / len,
      cz = sz / len;
    let minDot = 1;
    for (let i = 0; i < n; i++) {
      const d = cx * xyz[i * 3] + cy * xyz[i * 3 + 1] + cz * xyz[i * 3 + 2];
      if (d < minDot) minDot = d;
    }
    cap = {
      cx,
      cy,
      cz,
      radiusRad: Math.min(
        Math.PI,
        Math.acos(Math.max(-1, Math.min(1, minDot))) + CAP_MARGIN_RAD,
      ),
    };
  }
  return { ring, n, xyz, cap };
}

// Winding of the ring around the window centre as azimuth sum. With no edge
// entering the cone, the whole cone is on one side of the ring.
function windingAroundCenter(w, info) {
  const { xyz, n } = info;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      ax = xyz[i * 3],
      ay = xyz[i * 3 + 1],
      az = xyz[i * 3 + 2],
      bx = xyz[j * 3],
      by = xyz[j * 3 + 1],
      bz = xyz[j * 3 + 2],
      da = ax * w.cx + ay * w.cy + az * w.cz,
      db = bx * w.cx + by * w.cy + bz * w.cz,
      atx = ax - da * w.cx,
      aty = ay - da * w.cy,
      atz = az - da * w.cz,
      btx = bx - db * w.cx,
      bty = by - db * w.cy,
      btz = bz - db * w.cz;
    if (Math.hypot(atx, aty, atz) < 1e-12 || Math.hypot(btx, bty, btz) < 1e-12)
      continue;
    total += Math.atan2(
      (aty * btz - atz * bty) * w.cx +
        (atz * btx - atx * btz) * w.cy +
        (atx * bty - aty * btx) * w.cz,
      atx * btx + aty * bty + atz * btz,
    );
  }
  return total;
}

const NEAR = 2e-9,
  SORT_MIN = 12;

function pairDelta(p, q, side) {
  const delta = mod(side < 0 ? p.to - q.from : q.from - p.to);
  return delta > TAU - 1e-9 ? 0 : delta;
}

/** Reference O(c^2) pairing: the first entry met walking from each exit. */
export function pairPiecesReference(pieces, side = EXTERIOR) {
  return pieces.map((p) => {
    let best = 0,
      bestDelta = Infinity;
    pieces.forEach((q, m) => {
      const d = pairDelta(p, q, side);
      if (d < bestDelta) {
        bestDelta = d;
        best = m;
      }
    });
    return best;
  });
}

/**
 * Sorted-event pairing: entries are ordered by azimuth, each exit binary
 * searches its neighbourhood and the exact reference delta rule decides among
 * the few candidates, so ties, wraparound and epsilon behave identically.
 */
export function pairPieces(pieces, side = EXTERIOR) {
  const c = pieces.length;
  if (c < SORT_MIN) return pairPiecesReference(pieces, side);
  const keys = pieces.map((q) => mod(q.from)),
    order = Array.from(keys.keys()).sort((a, b) => keys[a] - keys[b] || a - b),
    sorted = order.map((i) => keys[i]);
  const lowerBound = (v) => {
    let lo = 0,
      hi = c;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return pieces.map((p) => {
    const t = mod(p.to),
      cand = [];
    // Walk away from the exit along the boundary in the pairing direction.
    const dir = side < 0 ? -1 : 1;
    const dist = (k) => mod(dir * (sorted[k] - t) + NEAR);
    let k = side < 0 ? lowerBound(t + NEAR + 1e-300) - 1 : lowerBound(t - NEAR);
    k = ((k % c) + c) % c;
    for (let seen = 0; seen < c; seen++, k = (((k + dir) % c) + c) % c) {
      const d = dist(k);
      if (d > 2 * NEAR) {
        // First strictly beyond the cluster, plus numerically equal neighbours.
        cand.push(order[k]);
        const f = sorted[k];
        for (let j = (((k + dir) % c) + c) % c, n = 1; n < c; n++) {
          if (Math.abs(sorted[j] - f) > 1e-12) break;
          cand.push(order[j]);
          j = (((j + dir) % c) + c) % c;
        }
        break;
      }
      cand.push(order[k]);
    }
    cand.sort((a, b) => a - b);
    let best = cand[0],
      bestDelta = Infinity;
    for (const m of cand) {
      const d = pairDelta(p, pieces[m], side);
      if (d < bestDelta) {
        bestDelta = d;
        best = m;
      }
    }
    return best;
  });
}

/**
 * Clip one ring to the window. Status:
 * - inside: every vertex inside, `ring` is the original array
 * - clipped: `rings` are new closed rings (a ring that dips in and out of
 *   the window can split into several)
 * - wraps: no crossing and the ring's material side (exterior) or enclosed
 *   region (hole) covers the whole window
 * - away: no crossing and the window is on the other side
 */
export function clipRing(w, info, side = EXTERIOR) {
  const { xyz, n, ring } = info;
  if (n < 3) return { status: "away" };
  const inside = new Uint8Array(n);
  let start = -1;
  for (let i = 0; i < n; i++) {
    inside[i] =
      xyz[i * 3] * w.cx + xyz[i * 3 + 1] * w.cy + xyz[i * 3 + 2] * w.cz >=
      w.cosR
        ? 1
        : 0;
    if (!inside[i] && start < 0) start = i;
  }
  if (start < 0) return { status: "inside", ring };
  const vec = (i) => [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]],
    pieces = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n,
      j = (i + 1) % n;
    if (!inside[i] && !inside[j]) {
      const pair = throughCrossings(w, vec(i), vec(j));
      if (pair)
        pieces.push({
          pts: [toLonLat(...pair[0]), toLonLat(...pair[1])],
          from: azimuth(w, ...pair[0]),
          to: azimuth(w, ...pair[1]),
        });
    } else if (inside[i] && !inside[j]) {
      const x = exitPoint(w, vec(i), vec(j)) ?? vec(i);
      cur.pts.push(toLonLat(...x));
      cur.to = azimuth(w, ...x);
      pieces.push(cur);
      cur = null;
    } else if (!inside[i] && inside[j]) {
      const x = entryPoint(w, vec(i), vec(j)) ?? vec(j);
      cur = { pts: [toLonLat(...x), ring[j]], from: azimuth(w, ...x), to: 0 };
    } else cur.pts.push(ring[j]);
  }
  if (!pieces.length) {
    const total = windingAroundCenter(w, info);
    return {
      status: (side === EXTERIOR ? total < -Math.PI : total > Math.PI)
        ? "wraps"
        : "away",
    };
  }
  // Pair every exit with the first entry met walking along the boundary, so
  // disjoint pieces of one ring become separate rings.
  const next = pairPieces(pieces, side);
  const used = new Uint8Array(pieces.length),
    rings = [];
  for (let s = 0; s < pieces.length; s++) {
    if (used[s]) continue;
    const out = [];
    for (let m = s; !used[m]; m = next[m]) {
      used[m] = 1;
      for (const pt of pieces[m].pts) out.push(pt);
      walk(w, pieces[m].to, pieces[next[m]].from, side, out);
    }
    out.push(out[0]);
    if (out.length >= 4) rings.push(out);
  }
  return rings.length ? { status: "clipped", rings } : { status: "away" };
}

function polygonsOf(geometry) {
  return geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
}

// Ring vectors are built on first use: features whose cap misses the window
// never pay the per-vertex trigonometry.
export function buildFeatureInfo(feature, cap = computeFeatureCap(feature)) {
  const polys = polygonsOf(feature.geometry),
    built = polys.map((poly) => new Array(poly.length));
  return {
    cap,
    ring: (pi, ri) => (built[pi][ri] ??= ringInfo(polys[pi][ri])),
  };
}

/** Uncached clip of a collection to an explicit window. */
export function clipToWindow(geojson, w) {
  const infos = [];
  return clipFeatureCollection(
    geojson,
    w,
    (i, f) => (infos[i] ??= buildFeatureInfo(f)),
  );
}

function capInside(cap, w) {
  const room = w.radius - cap.radiusRad;
  return (
    room > 0 && cap.cx * w.cx + cap.cy * w.cy + cap.cz * w.cz >= Math.cos(room)
  );
}

export function countVertices(geojson) {
  let n = 0;
  for (const f of geojson?.features ?? [])
    for (const poly of polygonsOf(f.geometry))
      for (const ring of poly) n += ring.length;
  return n;
}

/** Clip every feature to the window; unchanged features keep their identity. */
export function clipFeatureCollection(geojson, w, getInfo) {
  const stats = {
    features: 0,
    rings: { kept: 0, clipped: 0, wrapped: 0, dropped: 0 },
    vertices: 0,
  };
  const features = [];
  const feats = geojson?.features ?? [];
  for (let fi = 0; fi < feats.length; fi++) {
    const feature = feats[fi],
      info = getInfo(fi, feature);
    if (!isCapVisible(info.cap, w)) continue;
    const polys = polygonsOf(feature.geometry);
    if (capInside(info.cap, w)) {
      features.push(feature);
      stats.features++;
      for (const poly of polys)
        for (const ring of poly) {
          stats.rings.kept++;
          stats.vertices += ring.length;
        }
      continue;
    }
    const outPolys = [];
    let changed = false;
    polys.forEach((poly, pi) => {
      const outRings = [];
      let drop = false,
        polyChanged = false;
      for (let ri = 0; ri < poly.length && !drop; ri++) {
        const hole = ri > 0,
          rinfo = info.ring(pi, ri);
        let res;
        if (!isCapVisible(rinfo.cap, w)) res = { status: "away" };
        else if (capInside(rinfo.cap, w))
          res = { status: "inside", ring: poly[ri] };
        else res = clipRing(w, rinfo, hole ? HOLE : EXTERIOR);
        if (res.status === "inside") {
          outRings.push(res.ring);
          stats.rings.kept++;
        } else if (res.status === "clipped") {
          outRings.push(...res.rings);
          stats.rings.clipped += res.rings.length;
          polyChanged = true;
        } else if (res.status === "wraps") {
          polyChanged = true;
          if (hole) drop = true;
          else {
            outRings.push(circleRing(w, EXTERIOR));
            stats.rings.wrapped++;
          }
        } else {
          polyChanged = true;
          if (hole) continue;
          drop = true;
        }
      }
      if (drop) {
        changed = true;
        stats.rings.dropped++;
        return;
      }
      if (polyChanged) changed = true;
      outPolys.push(outRings);
    });
    if (!outPolys.length) continue;
    stats.features++;
    if (!changed) features.push(feature);
    else {
      const type = feature.geometry.type;
      features.push({
        ...feature,
        geometry: {
          type,
          coordinates: type === "Polygon" ? outPolys[0] : outPolys,
        },
      });
    }
    for (const poly of outPolys)
      for (const ring of poly) stats.vertices += ring.length;
  }
  return { geojson: { type: "FeatureCollection", features }, stats };
}

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
        cone.viewRadius * 1.25 + 2 * margin,
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
