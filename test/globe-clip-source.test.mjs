import assert from "node:assert/strict";
import test from "node:test";
import { buildFeatureInfo } from "../dist/spherical-clip.js";
import { createViewClipper } from "../examples/globe/clip.mjs";
import { computeFeatureCap } from "../dist/index.js";
import { featureCap, filterVisibleFeatures } from "../examples/globe/cull.mjs";

const square = (lon, lat, size, properties = {}) => ({
  type: "Feature",
  properties,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  },
});
const collection = (features) => ({ type: "FeatureCollection", features });
const state = (lon, lat, scale = 300) => ({
  rotation: [-lon, -lat, 0],
  scale,
  width: 800,
  height: 600,
});

test("featureCap uses the source cap when index and properties match", () => {
  const p = { name: "a" };
  const source = collection([square(0, 0, 40, p)]);
  const coarse = square(0, 0, 10, p);
  const cap = featureCap(coarse, 0, source);
  assert.deepEqual(cap, computeFeatureCap(source.features[0]));
  assert.equal(featureCap(coarse, 0, source), cap);
});

test("featureCap falls back to the frame feature on mismatch", () => {
  const source = collection([square(0, 0, 40, { name: "a" })]);
  const other = square(0, 0, 10, { name: "b" });
  assert.deepEqual(featureCap(other, 0, source), computeFeatureCap(other));
  assert.deepEqual(featureCap(other, 3, source), computeFeatureCap(other));
  assert.deepEqual(featureCap(other, 0, undefined), computeFeatureCap(other));
});

test("computeFeatureCap bounds every vertex, including large scratch use", () => {
  const ring = [];
  for (let i = 0; i < 6000; i++) {
    const a = (i / 6000) * Math.PI * 2;
    ring.push([20 * Math.cos(a), 20 * Math.sin(a)]);
  }
  ring.push(ring[0]);
  const f = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  const cap = computeFeatureCap(f);
  assert.ok(cap.radiusRad > (20 * Math.PI) / 180 - 1e-6);
  assert.ok(cap.radiusRad < (22 * Math.PI) / 180);
});

test("ring infos are built lazily and only for visible features", () => {
  let touched = 0;
  const f = square(0, 0, 10);
  const info = buildFeatureInfo(f);
  const ring = info.ring(0, 0);
  assert.equal(info.ring(0, 0), ring);
  const far = square(170, 0, 5);
  const clipper = createViewClipper();
  const spy = {
    ...far,
    get geometry() {
      touched++;
      return far.geometry;
    },
  };
  const near = square(0, 0, 10);
  clipper(collection([near, spy]), state(0, 0, 1200));
  assert.ok(touched >= 1);
});

test("clipping with a source gives the same output as without", () => {
  const features = [
    square(-10, -10, 20, { n: 1 }),
    square(60, 20, 30, { n: 2 }),
    square(-170, 40, 25, { n: 3 }),
    square(100, -60, 15, { n: 4 }),
  ];
  const source = collection(features);
  const frame = collection(
    features.map((f) => ({ ...f, geometry: structuredClone(f.geometry) })),
  );
  for (const [lon, lat, scale] of [
    [0, 0, 400],
    [70, 30, 900],
    [180, 40, 700],
    [100, -50, 1500],
  ]) {
    const a = createViewClipper()(frame, state(lon, lat, scale));
    const b = createViewClipper()(frame, state(lon, lat, scale), source);
    assert.deepEqual(b.geojson, a.geojson);
    assert.equal(b.stats.vertices, a.stats.vertices);
  }
});

test("cull fallback accepts a source and matches the plain result", () => {
  const features = [square(0, 0, 20, { n: 1 }), square(120, 0, 20, { n: 2 })];
  const source = collection(features);
  const frame = collection(features.map((f) => ({ ...f })));
  const wide = state(0, 0, 40);
  const a = filterVisibleFeatures(frame, wide, new WeakMap());
  const b = filterVisibleFeatures(frame, wide, new WeakMap(), source);
  assert.deepEqual(
    b.features.map((f) => f.properties),
    a.features.map((f) => f.properties),
  );
});
