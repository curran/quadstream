import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import {
  dropSmallPolygons,
  isSmallPolygon,
  polygonAreaSr,
} from "../examples/globe/small.mjs";
import { decodeCountries } from "../examples/globe/geometry.mjs";

const require = createRequire(import.meta.url);
const square = (lon, lat, size) => [
  [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ],
];
const multi = (...polys) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "MultiPolygon", coordinates: polys },
});
const collection = (...features) => ({ type: "FeatureCollection", features });

test("polygonAreaSr approximates d3.geoArea for small rings", () => {
  for (const [lon, lat, size] of [
    [10, 10, 0.5],
    [-120, 45, 2],
    [100, -30, 5],
    [0, 0, 0.01],
  ]) {
    const poly = square(lon, lat, size);
    const exact = d3.geoArea({ type: "Polygon", coordinates: poly });
    const got = polygonAreaSr(poly);
    // d3 treats the winding as the small side, so compare magnitudes.
    const ref = Math.min(exact, 4 * Math.PI - exact);
    assert.ok(Math.abs(got - ref) / ref < 0.02, `${lon},${lat},${size}`);
  }
});

test("large, polar, antimeridian and degenerate rings are never small", () => {
  assert.equal(polygonAreaSr(square(0, 0, 40)), Infinity);
  assert.equal(polygonAreaSr(square(0, 82, 1)), Infinity);
  assert.equal(
    polygonAreaSr(square(-179.9, 0, 1)),
    polygonAreaSr(square(-179.9, 0, 1)),
  );
  assert.equal(polygonAreaSr([[[0, 0]]]), Infinity);
  assert.equal(
    polygonAreaSr([
      [
        [0, 0],
        [NaN, 1],
        [1, 1],
        [0, 0],
      ],
    ]),
    Infinity,
  );
  assert.equal(
    polygonAreaSr([
      [
        [170, 0],
        [-170, 0],
        [-170, 1],
        [170, 1],
        [170, 0],
      ],
    ]),
    Infinity,
  );
  assert.equal(isSmallPolygon(square(0, 0, 40), 1e9, 1), false);
});

test("isSmallPolygon scales with zoom and is disabled by minPx 0", () => {
  const poly = square(10, 10, 1);
  const area = polygonAreaSr(poly);
  assert.equal(isSmallPolygon(poly, Math.sqrt(0.9 / area), 1), true);
  assert.equal(isSmallPolygon(poly, Math.sqrt(1.1 / area), 1), false);
  assert.equal(isSmallPolygon(poly, 1, 0), false);
});

test("dropSmallPolygons keeps mainland, drops islets and preserves identity", () => {
  const main = square(0, 0, 10),
    islet = square(20, 20, 0.05);
  const feature = multi(main, islet);
  const only = multi(islet);
  const big = multi(main);
  const fc = collection(feature, only, big);
  const out = dropSmallPolygons(fc, 120, 1);
  assert.equal(out.dropped, 2);
  assert.equal(out.geojson.features.length, 2);
  assert.deepEqual(out.geojson.features[0].geometry.coordinates, [main]);
  assert.equal(out.geojson.features[1], big);
  assert.equal(feature.geometry.coordinates.length, 2);

  const same = collection(big);
  const noop = dropSmallPolygons(same, 120, 1);
  assert.equal(noop.geojson, same);
  assert.equal(noop.dropped, 0);
  assert.equal(dropSmallPolygons(fc, 120, 0).geojson, fc);
  assert.equal(dropSmallPolygons(fc, 0, 1).geojson, fc);
});

test("dropSmallPolygons handles Polygon features and missing geometry", () => {
  const poly = (c) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: c },
  });
  const fc = collection(poly(square(0, 0, 0.02)), poly(square(0, 0, 10)), {
    type: "Feature",
    properties: {},
    geometry: null,
  });
  const out = dropSmallPolygons(fc, 120, 1);
  assert.equal(out.dropped, 1);
  assert.equal(out.geojson.features.length, 2);
});

test("on the 50m atlas, the default cut hides most polygons but few vertices", async () => {
  const fc = decodeCountries(
    JSON.parse(
      await readFile(require.resolve("world-atlas/countries-50m.json"), "utf8"),
    ),
    topojson,
  );
  const count = (g) =>
    g.features.reduce(
      (a, f) =>
        a +
        (f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.coordinates
        ).reduce((b, p) => b + p.reduce((c, r) => c + r.length, 0), 0),
      0,
    );
  const total = count(fc);
  const out = dropSmallPolygons(fc, 120, 1);
  assert.ok(out.dropped > 1000, `dropped ${out.dropped}`);
  assert.ok(count(out.geojson) > total * 0.7);
  // Zooming in brings islets back.
  const zoomed = dropSmallPolygons(fc, 1200, 1);
  assert.ok(zoomed.dropped < out.dropped / 5);
  assert.equal(dropSmallPolygons(fc, 120, 0).dropped, 0);
});
