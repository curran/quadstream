import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";
import { fixture } from "../examples/globe/fixture.mjs";

const require = createRequire(import.meta.url);
const ringsOf = (geometry) =>
  geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat()
      : [];

test("decodeCountries and query strip degenerate rings while preserving valid 3+ distinct-point rings", () => {
  const validOuter = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ];
  const repeatedTwoPointRing = [
    [2, 2],
    [3, 3],
    [2, 2],
    [3, 3],
    [2, 2],
  ];
  const shortRing = [
    [4, 4],
    [5, 5],
    [4, 4],
  ];
  const validSecondPoly = [
    [20, 0],
    [20, 5],
    [25, 5],
    [25, 0],
    [20, 0],
  ];

  const input = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "poly-with-degenerate-hole",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [validOuter, repeatedTwoPointRing],
        },
      },
      {
        type: "Feature",
        id: "multipoly-with-degenerate-part",
        properties: {},
        geometry: {
          type: "MultiPolygon",
          coordinates: [[shortRing], [validSecondPoly]],
        },
      },
    ],
  };

  const decoded = decodeCountries(input, topojson);
  assert.equal(decoded.features[0].geometry.coordinates.length, 1);
  assert.deepEqual(decoded.features[0].geometry.coordinates[0], validOuter);
  assert.equal(decoded.features[1].geometry.coordinates.length, 1);
  assert.deepEqual(
    decoded.features[1].geometry.coordinates[0][0],
    validSecondPoly,
  );

  const engine = createGlobeGeometry(fixture, d3);
  for (const level of [0, 5.5, 19]) {
    const res = engine.query(level);
    for (const f of res.geojson.features) {
      for (const ring of ringsOf(f.geometry)) {
        const distinct = new Set(
          ring.slice(0, -1).map(([x, y]) => `${x},${y}`),
        );
        assert.ok(distinct.size >= 3);
      }
    }
  }
});

test("LRU cache retains >=10 tenths levels, refreshes recency on hit, and evicts LRU past 48 entries", () => {
  const engine = createGlobeGeometry(fixture, d3);

  const tenLevels = Array.from({ length: 10 }, (_, i) => i / 10);
  for (const l of tenLevels) {
    assert.equal(engine.query(l).cached, false);
  }
  for (const l of tenLevels) {
    assert.equal(engine.query(l).cached, true);
  }

  // Fill up to 48 entries (levels 0.0 through 4.7; 0.0..0.9 are already cached).
  const fortyEightLevels = Array.from({ length: 48 }, (_, i) => i / 10);
  for (let i = 10; i < fortyEightLevels.length; i++) {
    assert.equal(engine.query(fortyEightLevels[i]).cached, false);
  }

  // Hit 0.0 to refresh its recency so 0.1 becomes the least-recently-used entry.
  assert.equal(engine.query(0).cached, true);

  // Insert 49th entry (4.8), which should evict 0.1 while keeping 0.0.
  assert.equal(engine.query(4.8).cached, false);
  assert.equal(engine.query(0).cached, true);
  assert.equal(engine.query(0.1).cached, false);
});

test("world-atlas countries-110m query at levels 0, 5.5, 7.3, 19 has zero invalid groups", async () => {
  const atlasPath = require.resolve("world-atlas/countries-110m.json");
  const topology = JSON.parse(await readFile(atlasPath, "utf8"));
  const countries = decodeCountries(topology, topojson);
  const engine = createGlobeGeometry(countries, d3);

  for (const level of [0, 5.5, 7.3, 19]) {
    const res = engine.query(level);
    assert.equal(res.invalidGroups, 0);
    assert.equal(res.validatorInvalidGroups, 0);
  }
});
