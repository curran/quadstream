import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { buildSphericalQuadstream } from "../dist/index.js";
import {
  buildBlgTree,
  selectBlgPositions,
  stableBlgRandom,
} from "../dist/blg.js";
import { reconstructFeature } from "../dist/reconstruct.js";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";

const require = createRequire(import.meta.url);
const load = async (atlas) =>
  decodeCountries(
    JSON.parse(
      await readFile(
        require.resolve(`world-atlas/countries-${atlas}.json`),
        "utf8",
      ),
    ),
    topojson,
  );
const feature = (id, geometry) => ({
  type: "Feature",
  id,
  properties: {},
  geometry,
});
const fc = (...features) => ({ type: "FeatureCollection", features });
// Clockwise (D3 small-interior) noisy circle of n vertices.
function blob(cx, cy, r, n, seed = 1) {
  let s = seed;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (-2 * Math.PI * i) / n,
      k = r * (0.8 + 0.2 * rnd());
    ring.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]);
  }
  return [...ring, ring[0]];
}
const polysOf = (g) =>
  g.type === "Polygon"
    ? g.coordinates.length
      ? [g.coordinates]
      : []
    : g.coordinates;
const keyOf = (p) => p[0] + "," + p[1];

function synthetic() {
  const shell = [
      [-30, -30],
      [-30, 30],
      [30, 30],
      [30, -30],
      [-30, -30],
    ],
    hole = blob(0, 0, 6, 40, 3).reverse();
  return fc(
    feature("country", {
      type: "Polygon",
      coordinates: [shell, hole],
    }),
    // Enclave: the hole's boundary, wound the other way.
    feature("enclave", {
      type: "Polygon",
      coordinates: [[...hole].reverse()],
    }),
    feature("islands", {
      type: "MultiPolygon",
      coordinates: [
        [blob(60, 10, 8, 60, 5)],
        [blob(80, 10, 0.02, 40, 6)],
        [blob(90, -20, 0.5, 40, 7)],
      ],
    }),
  );
}

/** Distinct vertices the quadtree activates on a path: BLG selection by vertex priority alone. */
function selectedDistinct(ds, f, path, level) {
  const ids = new Set();
  for (const ref of path.arcs) {
    const arc = ds.topology.arcs[Math.abs(ref) - 1],
      tree = buildBlgTree(
        arc.vertexIds.map((id) => ds.priorities.levelByVertexId[id]),
        arc.vertexIds.map((id) =>
          ds.topology.vertices[id].critical ? 1 : stableBlgRandom(id),
        ),
      );
    for (const p of selectBlgPositions(tree, level)) ids.add(arc.vertexIds[p]);
  }
  return ids.size;
}
const LEVELS = Array.from({ length: 80 }, (_, i) => i * 0.25);

test("ring activation level is exactly where the tree activates 3 distinct ring vertices", () => {
  const ds = buildSphericalQuadstream(synthetic(), { maxLevel: 20 });
  ds.topology.features.forEach((f, i) =>
    f.paths.forEach((path, j) => {
      for (const level of LEVELS)
        assert.equal(
          selectedDistinct(ds, f, path, level) >= 3,
          ds.ringActivation[i][j] <= level,
          `${f.id} path ${j} at ${level}`,
        );
    }),
  );
});

test("drop policy hides polygons per level, never reconstructing hidden ones, and is monotonic", () => {
  const source = synthetic(),
    ds = buildSphericalQuadstream(source, { maxLevel: 20 });
  let previous = new Set(),
    sawHidden = false;
  for (const level of LEVELS.filter((l) => l < 20)) {
    const q = ds.query({ level, collapsedRingPolicy: "drop" });
    assert.equal(q.valid, true);
    assert.equal(q.geojson.features.length, 3);
    const visible = new Set();
    q.geojson.features.forEach((f, i) => {
      const topo = ds.topology.features[i],
        act = ds.ringActivation[i],
        expected = topo.groups.filter((g) => act[g[0]] <= level),
        out = polysOf(f.geometry);
      assert.equal(out.length, expected.length, `${f.id} at ${level}`);
      // Identity, not just count: output polygon j comes from expected polygon j.
      const srcPolys = polysOf(source.features[i].geometry);
      out.forEach((p, k) => {
        const srcIndex = topo.groups.indexOf(expected[k]);
        const allowed = new Set(srcPolys[srcIndex].flat().map(keyOf));
        for (const ring of p)
          for (const c of ring) assert.ok(allowed.has(keyOf(c)));
        assert.ok(p[0].length >= 4, "at least 3 distinct vertices");
        visible.add(`${i}:${srcIndex}`);
      });
    });
    for (const k of previous) assert.ok(visible.has(k), `${k} vanished`);
    previous = visible;
    sawHidden ||= q.hiddenPolygons > 0;
    assert.ok(q.hiddenRings >= q.hiddenPolygons);
  }
  assert.ok(sawHidden);
});

test("polygons appear as the level passes their activation and full detail is exactly the source", () => {
  const source = synthetic(),
    ds = buildSphericalQuadstream(source, { maxLevel: 20 }),
    islands = (level) =>
      polysOf(
        ds.query({ level, collapsedRingPolicy: "drop" }).geojson.features[2]
          .geometry,
      ).length,
    counts = LEVELS.filter((l) => l < 20).map(islands);
  assert.equal(counts[0], 0);
  assert.equal(counts.at(-1), 3);
  assert.ok(
    counts.some((n) => n > 0 && n < 3),
    "partial visibility exists",
  );
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => a - b),
  );
  const full = ds.query({ level: 19, collapsedRingPolicy: "drop" });
  assert.equal(full.hiddenPolygons, 0);
  assert.equal(full.hiddenRings, 0);
  assert.deepEqual(full.geojson, ds.query({ level: 19 }).geojson);
});

test("hole and matching enclave share visibility; a hidden exterior suppresses its holes", () => {
  const ds = buildSphericalQuadstream(synthetic(), { maxLevel: 20 }),
    [country, enclave] = ds.topology.features;
  const holeAct = ds.ringActivation[0][country.groups[0][1]],
    enclaveAct = ds.ringActivation[1][enclave.groups[0][0]];
  assert.equal(holeAct, enclaveAct);
  for (const level of LEVELS.filter((l) => l < 20)) {
    const q = ds.query({ level, collapsedRingPolicy: "drop" }),
      rings = polysOf(q.geojson.features[0].geometry)[0]?.length ?? 0,
      enclaveShown = polysOf(q.geojson.features[1].geometry).length;
    assert.equal(rings === 2, enclaveShown === 1, `at ${level}`);
  }
  const f = country,
    lookup = (id) => [ds.topology.vertices[id].x, ds.topology.vertices[id].y],
    run = (options) =>
      reconstructFeature(
        f,
        ds.topology.arcs,
        ds.arcTrees,
        19,
        lookup,
        false,
        false,
        options,
      );
  assert.equal(
    run({ hiddenPaths: new Set([f.groups[0][1]]) }).feature.geometry.coordinates
      .length,
    1,
  );
  const gone = run({
    hiddenPaths: new Set([f.groups[0][0]]),
    collapsed: "drop",
  });
  assert.deepEqual(gone.feature.geometry.coordinates, []);
  assert.equal(gone.selectedVertices, 0);
});

test("topology anchors keep rings from collapsing: restore and drop agree without hiddenPaths", () => {
  const ds = buildSphericalQuadstream(synthetic(), { maxLevel: 20 }),
    lookup = (id) => [ds.topology.vertices[id].x, ds.topology.vertices[id].y];
  for (const f of ds.topology.features)
    for (const level of [0, 1.5, 6]) {
      const run = (collapsed) =>
        reconstructFeature(
          f,
          ds.topology.arcs,
          ds.arcTrees,
          level,
          lookup,
          false,
          false,
          { collapsed },
        );
      assert.deepEqual(run("drop").feature, run("restore").feature);
      assert.equal(run("drop").hiddenRings, 0);
    }
});

test("queries are order independent and synchronous equals interruptible", async () => {
  const ds = buildSphericalQuadstream(synthetic(), { maxLevel: 20 });
  const opts = (level) => ({ level, collapsedRingPolicy: "drop" });
  const snapshots = new Map();
  for (const level of [2, 15.5, 4.3, 19, 2, 15.5, 4.3, 19]) {
    const q = ds.query(opts(level)),
      json = JSON.stringify(q.geojson);
    if (snapshots.has(level)) assert.equal(json, snapshots.get(level));
    snapshots.set(level, json);
    const slow = await ds.queryInterruptible({
      ...opts(level),
      yieldTurn: () => Promise.resolve(),
      sliceMs: 0,
    });
    assert.equal(JSON.stringify(slow.geojson), json);
    assert.equal(slow.hiddenPolygons, q.hiddenPolygons);
    assert.equal(slow.hiddenRings, q.hiddenRings);
  }
  // Restore queries in between are unaffected.
  assert.equal(ds.query({ level: 2 }).hiddenPolygons, undefined);
});

test("real atlases: activation matches BLG selection and visible polygons only grow with level", async () => {
  const original = await load("110m"),
    ds = buildSphericalQuadstream(
      fc(
        ...original.features
          .map((f, i) => ({ ...f, id: String(i) }))
          .filter((f) => {
            try {
              buildSphericalQuadstream(fc(f), { maxLevel: 20 });
              return true;
            } catch {
              return false;
            }
          }),
      ),
      { maxLevel: 20 },
    );
  let sampled = 0;
  ds.topology.features.forEach((f, i) =>
    f.paths.forEach((path, j) => {
      if (!path.closed) return;
      for (const level of [0, 3.7, 4, 5.5, 8.1, 12]) {
        sampled++;
        assert.equal(
          selectedDistinct(ds, f, path, level) >= 3,
          ds.ringActivation[i][j] <= level,
          `${f.id}/${j}@${level}`,
        );
      }
    }),
  );
  assert.ok(sampled > 1000);
  let before = 0;
  for (const level of [0, 2, 4, 4.5, 5, 6, 8, 12, 19]) {
    const q = ds.query({ level, collapsedRingPolicy: "drop" }),
      count = q.geojson.features.reduce(
        (n, f) => n + polysOf(f.geometry).length,
        0,
      );
    const expected = ds.topology.features.reduce(
      (n, f, i) =>
        n + f.groups.filter((g) => ds.ringActivation[i][g[0]] <= level).length,
      0,
    );
    assert.equal(count, expected, `level ${level}`);
    assert.ok(count >= before);
    before = count;
    for (const f of q.geojson.features)
      for (const p of polysOf(f.geometry))
        for (const ring of p) assert.ok(new Set(ring.map(keyOf)).size >= 3);
  }
  const all = ds.topology.features.reduce((n, f) => n + f.groups.length, 0);
  assert.equal(before, all, "full detail shows every polygon");
});

test("globe geometry hides tree-collapsed polygons at 50m without touching fallback features", async () => {
  const original = await load("50m"),
    geometry = createGlobeGeometry(original, d3),
    coarse = geometry.query(4),
    full = geometry.query(19);
  const count = (fc2) =>
    fc2.features.reduce((n, f) => n + polysOf(f.geometry).length, 0);
  assert.equal(full.hiddenPolygons, 0);
  assert.ok(coarse.hiddenPolygons > 800);
  assert.ok(count(coarse.geojson) < count(full.geojson) * 0.5);
  assert.ok(coarse.vertices < full.vertices);
  assert.equal(coarse.geojson.features.length, original.features.length);
  // Source-fallback groups have no tree and are excluded from hiding.
  assert.equal(coarse.fallbackGroups, full.fallbackGroups);
  assert.ok(coarse.hiddenPolygons <= coarse.hiddenRings);
  assert.equal("smallCulled" in coarse, false);
});
