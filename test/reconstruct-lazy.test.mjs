import test from "node:test";
import assert from "node:assert/strict";
import { QuadstreamDataset } from "../dist/index.js";
import { reconstructFeature } from "../dist/reconstruct.js";
import { selectBlgPositions, buildBlgTree } from "../dist/blg.js";
import { validPolygon, simpleClosedRing } from "../dist/index.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
// Verbatim pre-optimization algorithm (eager original-ID walk, Set of joined keys).
function reference(f, arcs, trees, level, lookup) {
  let missing = false,
    selectedVertices = 0;
  const paths = [];
  for (const path of f.paths) {
    const coords = [],
      allIds = [];
    let n = 0;
    for (const ref of path.arcs) {
      const arcId = Math.abs(ref) - 1,
        arc = arcs[arcId];
      const positions = selectBlgPositions(
        trees[arcId],
        typeof level === "number" ? level : level(arcId),
      );
      if (ref < 0) positions.reverse();
      const ordered = ref < 0 ? [...arc.vertexIds].reverse() : arc.vertexIds;
      for (const id of ordered)
        if (!allIds.length || allIds.at(-1) !== id) allIds.push(id);
      for (let i = 0; i < positions.length; i++) {
        const xy = lookup(arc.vertexIds[positions[i]]);
        if (!xy) {
          missing = true;
          continue;
        }
        if (
          coords.length &&
          i === 0 &&
          xy[0] === coords.at(-1)[0] &&
          xy[1] === coords.at(-1)[1]
        )
          continue;
        coords.push(xy);
        n++;
      }
    }
    if (path.closed) {
      const distinct = new Set(coords.slice(0, -1).map((p) => p.join(",")));
      if (distinct.size < 3) {
        coords.length = 0;
        n = 0;
        for (const id of allIds) {
          const xy = lookup(id);
          if (
            xy &&
            (!coords.length ||
              xy[0] !== coords.at(-1)[0] ||
              xy[1] !== coords.at(-1)[1])
          ) {
            coords.push(xy);
            n++;
          }
        }
      }
    }
    if (
      path.closed &&
      coords.length &&
      (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])
    )
      coords.push(coords[0]);
    selectedVertices += n;
    paths.push(coords);
  }
  const groups = f.groups.map((g) => g.map((i) => paths[i]));
  let valid = true;
  if (f.geometryType === "Polygon") {
    valid = validPolygon(groups[0]);
    if (!groups[0].every(simpleClosedRing)) valid = false;
  } else if (f.geometryType === "MultiPolygon")
    valid = groups.every(validPolygon);
  return { groups, missing, valid, selectedVertices };
}
// Grid of wiggly neighbouring cells so arcs are shared and referenced in reverse.
function tiling(rand, cols, rows, edge) {
  const hv = [];
  const wiggle = (a, b, k) =>
    Array.from({ length: edge }, (_, i) => {
      const t = (i + 1) / (edge + 1);
      return [
        a[0] +
          (b[0] - a[0]) * t +
          (k === "v" ? 0.1 * Math.sin(Math.PI * t) * (rand() - 0.5) : 0),
        a[1] +
          (b[1] - a[1]) * t +
          (k === "h" ? 0.1 * Math.sin(Math.PI * t) * (rand() - 0.5) : 0),
      ];
    });
  const H = (x, y) => (hv[`h${x},${y}`] ??= wiggle([x, y], [x + 1, y], "h"));
  const V = (x, y) => (hv[`v${x},${y}`] ??= wiggle([x, y], [x, y + 1], "v"));
  const features = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const ring = [
        [x, y],
        ...H(x, y),
        [x + 1, y],
        ...V(x + 1, y),
        [x + 1, y + 1],
        ...[...H(x, y + 1)].reverse(),
        [x, y + 1],
        ...[...V(x, y)].reverse(),
        [x, y],
      ];
      features.push({
        type: "Feature",
        id: `c${x}_${y}`,
        properties: { x, y },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  return { type: "FeatureCollection", features };
}
const summary = (r) => ({
  groups:
    r.feature.geometry.type === "Polygon"
      ? [r.feature.geometry.coordinates]
      : r.feature.geometry.coordinates,
  missing: r.missing,
  valid: r.valid,
  selectedVertices: r.selectedVertices,
});

test("lazy reconstruction equals the eager reference across levels on shared-arc tilings", () => {
  for (const [seed, cols, rows, edge] of [
    [1, 3, 3, 6],
    [2, 4, 2, 15],
    [3, 2, 2, 40],
  ]) {
    const ds = new QuadstreamDataset(tiling(rng(seed), cols, rows, edge), {
      maxLevel: 12,
    });
    const { arcs, features, vertices } = ds.topology;
    assert.ok(
      features.some((f) => f.paths.some((p) => p.arcs.some((a) => a < 0))),
      "tiling must use reversed arc references",
    );
    const lookup = (id) => {
      const v = vertices[id];
      return v ? [v.x, v.y] : undefined;
    };
    for (const level of [0, 0.4, 1, 2, 3.5, 5, 8, 11, Infinity])
      for (const f of features)
        assert.deepEqual(
          summary(reconstructFeature(f, arcs, ds.arcTrees, level, lookup)),
          reference(f, arcs, ds.arcTrees, level, lookup),
          `seed ${seed} level ${level} feature ${f.id}`,
        );
  }
});

test("per-arc level functions and missing coordinates match the reference", () => {
  const ds = new QuadstreamDataset(tiling(rng(9), 3, 2, 12), { maxLevel: 10 });
  const { arcs, features, vertices } = ds.topology;
  const holes = new Set([3, 7, 11, 20]);
  const lookup = (id) =>
    holes.has(id) ? undefined : [vertices[id].x, vertices[id].y];
  const perArc = (arcId) => (arcId % 3) * 2;
  for (const f of features) {
    const got = reconstructFeature(f, arcs, ds.arcTrees, perArc, lookup);
    assert.deepEqual(
      summary(got),
      reference(f, arcs, ds.arcTrees, perArc, lookup),
    );
  }
  const anyMissing = features.some(
    (f) => reconstructFeature(f, arcs, ds.arcTrees, 10, lookup).missing,
  );
  assert.equal(anyMissing, true);
});

test("collapsed rings restore every original vertex, forward and reversed", () => {
  const ds = new QuadstreamDataset(tiling(rng(4), 2, 2, 25), { maxLevel: 14 });
  const { arcs, features, vertices } = ds.topology;
  const lookup = (id) => [vertices[id].x, vertices[id].y];
  let collapsed = 0;
  for (const f of features) {
    const r = reconstructFeature(f, arcs, ds.arcTrees, 0, lookup);
    assert.deepEqual(summary(r), reference(f, arcs, ds.arcTrees, 0, lookup));
    collapsed += r.selectedVertices > 0 ? 1 : 0;
    const ring = r.feature.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1), "closed");
  }
  assert.equal(collapsed, features.length);
});

test("dataset queries stay valid and identical in vertex counts at every integer level", () => {
  const ds = new QuadstreamDataset(tiling(rng(6), 3, 3, 10), { maxLevel: 12 });
  let previous = 0;
  for (let level = 0; level < 12; level++) {
    const q = ds.query({ level });
    assert.equal(q.geojson.features.length, 9);
    const total = q.geojson.features.reduce(
      (n, f) => n + f.geometry.coordinates[0].length,
      0,
    );
    assert.ok(total >= previous, "vertex count is monotonic");
    previous = total;
  }
});

test("collapsed closed paths are restored from original arc vertices, forward and reversed", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  const arcs = [{ vertexIds: [0, 1, 2, 3, 0] }];
  const trees = [buildBlgTree([0, 5, 5, 5, 0])];
  const lookup = (id) => [vertices[id].x, vertices[id].y];
  for (const ref of [1, -1]) {
    const f = {
      id: "f",
      properties: {},
      geometryType: "Polygon",
      paths: [{ arcs: [ref], closed: true }],
      groups: [[0]],
    };
    const got = reconstructFeature(f, arcs, trees, 0, lookup);
    assert.deepEqual(summary(got), reference(f, arcs, trees, 0, lookup));
    assert.equal(got.feature.geometry.coordinates[0].length, 5, "restored");
    assert.equal(got.selectedVertices, 5);
    assert.equal(got.valid, true);
    // Missing coordinates are skipped during restoration as well.
    const sparse = (id) => (id === 2 ? undefined : lookup(id));
    assert.deepEqual(
      summary(reconstructFeature(f, arcs, trees, 0, sparse)),
      reference(f, arcs, trees, 0, sparse),
    );
  }
});
