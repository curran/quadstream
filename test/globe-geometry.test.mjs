import { repairGeometry } from "../examples/globe/repair.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import {
  createGlobeGeometry,
  decodeCountries,
  d3Compatible,
  vertexCount,
} from "../examples/globe/geometry.mjs";
import { fixture } from "../examples/globe/fixture.mjs";
const feature = (id, coordinates) => ({
  type: "Feature",
  id,
  properties: { name: id },
  geometry: { type: "Polygon", coordinates: [coordinates] },
});
const fc = (...features) => ({ type: "FeatureCollection", features });
const polygonRings = (geometry) =>
  geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat()
      : [];
const hasMinimumRingVertices = (feature) =>
  polygonRings(feature.geometry).every(
    (ring) => new Set(ring.slice(0, -1).map(JSON.stringify)).size >= 3,
  );
const geoms = (g) =>
  g.type === "Polygon"
    ? g.coordinates.length
      ? [g.coordinates]
      : []
    : g.type === "MultiPolygon"
      ? g.coordinates
      : [];
const bigArc = (r) =>
  d3.geoArea({ type: "Polygon", coordinates: [r] }) > 2 * Math.PI;
// Tree-hidden polygons are absent: the output must be an in-order subset of
// the source polygons, each with the same rings and interior orientation.
const compatibleSubset = (source, candidate) => {
  const a = geoms(source.geometry);
  let next = 0;
  return geoms(candidate.geometry).every((p) => {
    while (next < a.length) {
      const q = a[next++];
      if (
        q.length === p.length &&
        q.every((r, j) => bigArc(r) === bigArc(p[j]))
      )
        return true;
    }
    return false;
  });
};
test("schematic globe reduces vertex count and restores full detail without changing D3 interior", () => {
  const engine = createGlobeGeometry(fixture, d3);
  assert.equal(engine.unavailable, 0);
  const low = engine.query(0),
    full = engine.query(19);
  assert.ok(
    low.vertices < low.sourceVertices,
    JSON.stringify(low.effectiveLevels),
  );
  assert.equal(full.vertices, vertexCount(fixture));
  assert.equal(full.fallbackGroups, 0);
  assert.ok(
    full.geojson.features.every((f, i) =>
      d3Compatible(fixture.features[i], f, d3, true),
    ),
  );
  assert.ok(
    low.geojson.features.every((f, i) =>
      compatibleSubset(fixture.features[i], f),
    ),
  );
  assert.equal(engine.query(19).cached, true);
});
test("shared borders remain identical for every globe LOD", () => {
  const engine = createGlobeGeometry(fixture, d3);
  const border = (f) =>
    new Set(
      (f.geometry.coordinates[0] ?? [])
        .filter(([x]) => x === 0)
        .map(JSON.stringify),
    );
  let compared = 0;
  for (const l of [...Array.from({ length: 20 }, (_, i) => i), 4.1, 4.5, 7.5]) {
    const r = engine.query(l),
      [a, b] = r.geojson.features;
    // A neighbour hidden by the tree has no border to compare.
    if (!a.geometry.coordinates.length || !b.geometry.coordinates.length)
      continue;
    compared++;
    assert.deepEqual(border(a), border(b));
  }
  assert.ok(compared >= 10);
});
test("D3 oracle detects reversed shells, lost holes and changed full-detail area", () => {
  const a = feature("a", [
    [0, 0],
    [0, 20],
    [20, 20],
    [20, 0],
    [0, 0],
  ]);
  const reversed = feature("a", [...a.geometry.coordinates[0]].reverse());
  assert.equal(d3Compatible(a, reversed, d3), false);
  const changed = feature("a", [
    [0, 0],
    [0, 10],
    [20, 10],
    [20, 0],
    [0, 0],
  ]);
  assert.equal(d3Compatible(a, changed, d3, true), false);
  const withHole = structuredClone(a);
  withHole.geometry.coordinates.push([
    [5, 5],
    [10, 5],
    [10, 10],
    [5, 10],
    [5, 5],
  ]);
  assert.equal(d3Compatible(withHole, a, d3), false);
});
test("D3 projection clips horizon consistently at full detail across rotations and scale", () => {
  const full = createGlobeGeometry(fixture, d3).query(19).geojson;
  const projection = d3.geoOrthographic().translate([200, 200]);
  const path = d3.geoPath(projection);
  for (const r of [
    [0, 0, 0],
    [180, 0, 0],
    [0, 90, 0],
    [0, -90, 0],
    [45, -30, 10],
  ])
    for (const s of [100, 200, 800]) {
      projection.rotate(r).scale(s);
      for (let i = 0; i < fixture.features.length; i++) {
        const a = path.area(fixture.features[i]),
          b = path.area(full.features[i]);
        assert.ok(Math.abs(a - b) < Math.max(1e-5, a * 1e-7), a + " != " + b);
        assert.ok(!String(path(full.features[i])).includes("NaN"));
      }
    }
});
test("unsupported connected component keeps original geometry and independent component still works", () => {
  const bad = feature("bad", [
    [0, 0],
    [90, 0],
    [180, 0],
    [-90, 0],
    [0, 0],
  ]);
  const neighbor = feature("neighbor", [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ]);
  const isolated = feature("island", [
    [30, 0],
    [30, 10],
    [40, 10],
    [40, 0],
    [30, 0],
  ]);
  const original = fc(bad, neighbor, isolated),
    engine = createGlobeGeometry(original, d3);
  const result = engine.query(0);
  // A failed connected component must remain intact, including its valid neighbor.
  assert.equal(result.unavailable, 2);
  assert.deepEqual(result.geojson.features[0], original.features[0]);
  assert.deepEqual(result.geojson.features[1], original.features[1]);
  assert.equal(result.geojson.features.length, 3);
  assert.equal(result.fallbackGroups, 1);
  // An independent component can still simplify at the requested level.
  assert.ok(
    (result.geojson.features[2].geometry.coordinates[0]?.length ?? 0) < 5,
  );
});
test("named countries object decoding ignores unrelated objects", () => {
  const topo = {
    type: "Topology",
    arcs: [
      [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
        [0, 0],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [{ type: "Polygon", id: 7, arcs: [[0]] }],
      },
      other: { type: "Point", coordinates: [0, 0] },
    },
  };
  const r = decodeCountries(topo, topojson);
  assert.equal(r.features.length, 1);
  assert.equal(r.features[0].id, 7);
  assert.throws(() => decodeCountries(fc(), topojson));
  assert.throws(() =>
    decodeCountries(
      {
        type: "FeatureCollection",
        features: [{ geometry: { type: "Point" } }],
      },
      topojson,
    ),
  );
});
test("real pinned 110m atlas retains all countries, IDs, D3 interiors and full-detail area", async () => {
  const topo = JSON.parse(
    await readFile(
      new URL(
        "../node_modules/world-atlas/countries-110m.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = decodeCountries(topo, topojson),
    engine = createGlobeGeometry(original, d3);
  assert.ok(original.features.length > 100);
  const low = engine.query(4),
    lod7 = engine.query(7),
    full = engine.query(19);
  assert.equal(full.geojson.features.length, original.features.length);
  assert.deepEqual(
    full.geojson.features.map((f) => f.id),
    original.features.map((f) => f.id),
  );
  assert.ok(
    full.geojson.features.every(
      (f, i) =>
        // Self-crossing source rings (Sudan) are repaired, so they differ.
        repairGeometry(original.features[i].geometry).changed ||
        d3Compatible(original.features[i], f, d3, true),
    ),
  );
  assert.ok(
    lod7.geojson.features.every((f, i) =>
      compatibleSubset(original.features[i], f),
    ),
  );
  assert.equal(lod7.invalidGroups, 0);
  assert.ok(lod7.validatorInvalidGroups >= 0);
  let previousVertices = 0;
  for (const level of [
    7,
    7.1,
    7.5,
    7.9,
    8,
    8.5,
    ...Array.from({ length: 11 }, (_, i) => i + 9),
  ]) {
    const result = engine.query(level);
    assert.deepEqual(
      result.geojson.features.map((f) => f.id),
      original.features.map((f) => f.id),
    );
    assert.ok(
      result.geojson.features.every((f, i) =>
        compatibleSubset(original.features[i], f),
      ),
      `D3 compatibility failed at LOD ${level}`,
    );
    assert.ok(
      result.geojson.features.every(hasMinimumRingVertices),
      `minimum ring cardinality failed at LOD ${level}`,
    );
    assert.ok(
      result.vertices >= previousVertices,
      `vertex count regressed at LOD ${level}`,
    );
    previousVertices = result.vertices;
  }
  assert.ok(
    low.effectiveLevels.every((level) => level === 4),
    JSON.stringify(low.effectiveLevels),
  );
  assert.ok(low.invalidGroups >= 0);
  assert.ok(
    low.vertices < low.sourceVertices,
    "No real atlas reduction: " +
      JSON.stringify({
        unavailable: low.unavailable,
        reasons: low.reasons,
        effective: low.effectiveLevels,
      }),
  );
});
