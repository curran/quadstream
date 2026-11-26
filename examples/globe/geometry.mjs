import { buildSphericalQuadstream, canonicalLonLat } from "../../dist/index.js";
// d3 and topojson-client are injected: Node tests use ESM; browser uses local UMD.
const polys = (g) =>
  g.type === "Polygon"
    ? [g.coordinates]
    : g.type === "MultiPolygon"
      ? g.coordinates
      : [];
const key = (p) => JSON.stringify(canonicalLonLat(p));
const count = (g) =>
  polys(g)
    .flat()
    .reduce((n, r) => n + r.length, 0);
export const vertexCount = (fc) =>
  fc.features.reduce((n, f) => n + count(f.geometry), 0);
const clock = () => performance.now();
const hasThreeDistinct = (ring) => {
  const end = ring.length - 1;
  if (end < 3) return false;
  const x0 = ring[0][0],
    y0 = ring[0][1];
  let x1,
    y1,
    foundSecond = false;
  for (let i = 1; i < end; i++) {
    const x = ring[i][0],
      y = ring[i][1];
    if (!foundSecond) {
      if (x !== x0 || y !== y0) {
        x1 = x;
        y1 = y;
        foundSecond = true;
      }
    } else if ((x !== x0 || y !== y0) && (x !== x1 || y !== y1)) {
      return true;
    }
  }
  return false;
};
const removeDegenerateRings = (geometry) => {
  if (geometry.type === "Polygon")
    return {
      ...geometry,
      coordinates: geometry.coordinates.filter(hasThreeDistinct),
    };
  if (geometry.type === "MultiPolygon")
    return {
      ...geometry,
      coordinates: geometry.coordinates
        .map((polygon) => polygon.filter(hasThreeDistinct))
        .filter((polygon) => polygon.length),
    };
  return geometry;
};
export function decodeCountries(source, topojson) {
  const input =
    source.type === "Topology"
      ? topojson.feature(source, source.objects.countries)
      : source;
  if (
    input?.type !== "FeatureCollection" ||
    !input.features.length ||
    input.features.some(
      (f) => !["Polygon", "MultiPolygon"].includes(f.geometry?.type),
    )
  )
    throw new Error(
      "Expected polygon countries FeatureCollection or named countries TopoJSON",
    );
  return {
    ...input,
    features: input.features.map((feature) => ({
      ...feature,
      geometry: removeDegenerateRings(feature.geometry),
    })),
  };
}
function cleanRing(r) {
  const out = [];
  for (const p of r) {
    const k = key(p);
    if (!out.length || key(out.at(-1)) !== k) out.push(canonicalLonLat(p));
  }
  if (out.length && key(out[0]) !== key(out.at(-1)))
    throw new Error("Unclosed atlas ring");
  return out;
}
function clean(f) {
  const g = f.geometry,
    p = polys(g).map((p) => p.map(cleanRing));
  return {
    ...f,
    geometry: { type: g.type, coordinates: g.type === "Polygon" ? p[0] : p },
  };
}
// D3 independently interprets ring interiors; check each ring, including holes.
// This does not prove global topology or bound cartographic error.
export function d3Compatible(source, candidate, d3, full = false) {
  const a = polys(source.geometry),
    b = polys(candidate.geometry);
  if (source.geometry.type !== candidate.geometry.type || a.length !== b.length)
    return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      const area = (r) => d3.geoArea({ type: "Polygon", coordinates: [r] });
      const x = area(a[i][j]),
        y = area(b[i][j]);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x > 2 * Math.PI !== y > 2 * Math.PI
      )
        return false;
      if (full && Math.abs(x - y) > 1e-9) return false;
    }
  }
  if (full) {
    if (Math.abs(d3.geoArea(source) - d3.geoArea(candidate)) > 1e-9)
      return false;
    for (const p of [
      [0.37, 0.61],
      [90.37, 0.61],
      [-90.37, 0.61],
      [179.37, 15.61],
      [-179.37, -15.61],
      [0.37, 89.61],
      [0.37, -89.61],
      [30.37, 30.61],
      [-60.37, -30.61],
    ]) {
      if (d3.geoContains(source, p) !== d3.geoContains(candidate, p))
        return false;
    }
  }
  return true;
}
// Partition into exact-coordinate-connected components only when the global
// build rejects the source. Never independently simplify neighbors sharing a
// vertex: every such connected component is kept together.
function components(features) {
  const parent = features.map((_, i) => i),
    owner = new Map();
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < features.length; i++)
    for (const p of polys(features[i].geometry))
      for (const r of p)
        for (const v of r) {
          const k = key(v);
          if (owner.has(k)) {
            const a = root(i),
              b = root(owner.get(k));
            if (a !== b) parent[a] = b;
          } else owner.set(k, i);
        }
  const groups = new Map();
  for (let i = 0; i < features.length; i++) {
    const k = root(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return [...groups.values()];
}
export function createGlobeGeometry(original, d3, { maxLevel = 20 } = {}) {
  const start = clock(),
    features = original.features,
    sourceVertices = vertexCount(original),
    all = features.map((_, i) => i);
  function build(indices) {
    try {
      const input = {
        type: "FeatureCollection",
        features: indices.map((i) => ({
          ...clean(features[i]),
          id: String(i),
        })),
      };
      const engine = buildSphericalQuadstream(input, { maxLevel });
      const full = engine.query({ level: maxLevel - 1 }).geojson.features;
      if (
        !full.every((f, j) => d3Compatible(features[indices[j]], f, d3, true))
      )
        throw new Error("D3 full-detail oracle disagrees");
      return { indices, engine };
    } catch (e) {
      return { indices, error: String(e.message ?? e) };
    }
  }
  let groups = [build(all)];
  if (groups[0].error && features.length > 1) {
    try {
      const singletonGroups = all.map((i) => build([i])),
        invalid = singletonGroups.filter((g) => g.error),
        valid = all.filter((i) => !singletonGroups[i].error);
      groups = [...(valid.length ? [build(valid)] : []), ...invalid];
      if (groups.some((g) => g.error && g.indices.length > 1))
        groups = components(features).map(build);
    } catch (error) {
      void error;
    }
  }
  const buildMs = clock() - start,
    cache = new Map();
  const unavailable = groups
    .filter((g) => g.error)
    .reduce((n, g) => n + g.indices.length, 0);
  const reasons = [
    ...new Set(groups.filter((g) => g.error).map((g) => g.error)),
  ].slice(0, 4);
  function cacheHit(level) {
    if (!cache.has(level)) return null;
    const hit = cache.get(level);
    cache.delete(level);
    cache.set(level, hit);
    return { ...hit, cached: true, queryMs: 0 };
  }
  function saveFrame(level, frame) {
    cache.set(level, frame);
    if (cache.size > 48) cache.delete(cache.keys().next().value);
    return frame;
  }
  function prepareOut(level) {
    return level === maxLevel - 1
      ? [...features]
      : features.map((feature) => ({
          ...feature,
          geometry: removeDegenerateRings(feature.geometry),
        }));
  }
  function applyGroup(g, selected, level, out, stats) {
    const compatible =
      (selected.valid && level < maxLevel - 1) ||
      selected.geojson.features.every((f, j) =>
        d3Compatible(features[g.indices[j]], f, d3, level === maxLevel - 1),
      );
    if (!selected.valid) stats.validatorInvalidGroups++;
    if (!compatible) stats.invalidGroups++;
    stats.effectiveLevels.push(level);
    for (let j = 0; j < g.indices.length; j++) {
      const i = g.indices[j];
      out[i] = {
        ...features[i],
        geometry:
          level === maxLevel - 1
            ? selected.geojson.features[j].geometry
            : removeDegenerateRings(selected.geojson.features[j].geometry),
      };
    }
  }
  function finalize(level, start, out, stats) {
    const geojson = { type: "FeatureCollection", features: out };
    return saveFrame(level, {
      level,
      geojson,
      sourceVertices,
      vertices: vertexCount(geojson),
      buildMs,
      queryMs: clock() - start,
      fallbackGroups: stats.fallbackGroups,
      invalidGroups: stats.invalidGroups,
      validatorInvalidGroups: stats.validatorInvalidGroups,
      unavailable,
      reasons,
      effectiveLevels: stats.effectiveLevels,
      cached: false,
    });
  }
  function query(requested) {
    if (!Number.isFinite(requested) || requested < 0 || requested >= maxLevel)
      throw new Error("Invalid globe detail level");
    // Levels are quantized to tenths so float noise (7.300000001) shares one cache entry.
    const level = Math.round(requested * 10) / 10;
    const hit = cacheHit(level);
    if (hit) return hit;
    const start = clock(),
      out = prepareOut(level),
      stats = {
        fallbackGroups: 0,
        invalidGroups: 0,
        validatorInvalidGroups: 0,
        effectiveLevels: [],
      };
    for (const g of groups) {
      if (!g.engine) {
        stats.fallbackGroups++;
        continue;
      }
      applyGroup(g, g.engine.query({ level }), level, out, stats);
    }
    return finalize(level, start, out, stats);
  }
  async function queryInterruptible(
    requested,
    { shouldAbort, yieldTurn, sliceMs = 8 } = {},
  ) {
    if (!Number.isFinite(requested) || requested < 0 || requested >= maxLevel)
      throw new Error("Invalid globe detail level");
    const level = Math.round(requested * 10) / 10;
    const hit = cacheHit(level);
    if (hit) return hit;
    if (shouldAbort?.()) return null;
    const start = clock(),
      out = prepareOut(level),
      stats = {
        fallbackGroups: 0,
        invalidGroups: 0,
        validatorInvalidGroups: 0,
        effectiveLevels: [],
      };
    for (const g of groups) {
      if (!g.engine) {
        stats.fallbackGroups++;
        continue;
      }
      const selected = await g.engine.queryInterruptible({
        level,
        shouldAbort,
        yieldTurn,
        sliceMs,
      });
      if (!selected || shouldAbort?.()) return null;
      applyGroup(g, selected, level, out, stats);
    }
    return finalize(level, start, out, stats);
  }
  return {
    query,
    queryInterruptible,
    sourceVertices,
    buildMs,
    unavailable,
    reasons,
  };
}
