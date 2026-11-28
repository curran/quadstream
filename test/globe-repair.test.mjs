import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  projectSpherical,
  simpleClosedRing,
  sphericalChart,
} from "../dist/index.js";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";
import { repairGeometry, repairRing } from "../dist/index.js";

const require = createRequire(import.meta.url);
const d3 = require("d3"),
  topojson = require("topojson-client");

const simple = (ring) => {
  const chart = sphericalChart(ring);
  return simpleClosedRing(ring.map((p) => projectSpherical(p, chart)));
};
// Square with a small figure-eight kink on its top edge.
const kinked = [
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 10],
  [4, 10.5],
  [6, 10.5],
  [4, 10],
  [0, 10],
  [0, 0],
];

test("repairRing removes a small self-crossing loop and keeps the rest", () => {
  assert.equal(simple(kinked), false);
  const fixed = repairRing(kinked);
  assert.ok(fixed, "repaired");
  assert.equal(simple(fixed), true);
  assert.deepEqual(fixed.at(0), fixed.at(-1));
  assert.ok(fixed.length >= 6 && fixed.length <= kinked.length + 1);
  for (const corner of [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ])
    assert.ok(fixed.some((p) => p[0] === corner[0] && p[1] === corner[1]));
});

test("repairRing leaves valid rings alone and refuses unfixable input", () => {
  const ok = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
    [0, 0],
  ];
  assert.deepEqual(repairRing(ok), ok);
  assert.equal(repairRing([[0, 0]]), null);
});

test("repairGeometry reports changes only when it fixed something", () => {
  const poly = (c) => ({ type: "Polygon", coordinates: [c] });
  const clean = repairGeometry(
    poly([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ]),
  );
  assert.equal(clean.changed, false);
  const fixed = repairGeometry({
    type: "MultiPolygon",
    coordinates: [
      [kinked],
      [
        [
          [50, 0],
          [54, 0],
          [54, 4],
          [50, 4],
          [50, 0],
        ],
      ],
    ],
  });
  assert.equal(fixed.changed, true);
  assert.ok(simple(fixed.geometry.coordinates[0][0]));
});

test("110m Sudan (self-crossing in the source) is now simplified", () => {
  const original = decodeCountries(
    JSON.parse(
      readFileSync(require.resolve("world-atlas/countries-110m.json"), "utf8"),
    ),
    topojson,
  );
  const index = original.features.findIndex(
    (f) => f.properties?.name === "Sudan",
  );
  assert.ok(index >= 0);
  const engine = createGlobeGeometry(original, d3);
  assert.deepEqual(engine.reasons, []);
  assert.equal(engine.unavailable, 0);
  const verts = (g) =>
    (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
      .flat()
      .reduce((n, r) => n + r.length, 0);
  const coarse = engine.query(1.8);
  assert.equal(coarse.fallbackGroups, 0);
  assert.ok(
    verts(coarse.geojson.features[index].geometry) <
      verts(original.features[index].geometry),
  );
  // Full detail stays within a sliver of the source.
  const full = engine.query(19);
  const diff = Math.abs(
    d3.geoArea(full.geojson.features[index]) -
      d3.geoArea(original.features[index]),
  );
  assert.ok(diff < 1e-5, `area diff ${diff}`);
});
