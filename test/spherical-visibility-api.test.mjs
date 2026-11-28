import test from "node:test";
import assert from "node:assert/strict";
import {
  clipWindow,
  clipToWindow,
  computeFeatureCap,
  computeFeatureCaps,
  filterSphericalFeatures,
  isCapVisible,
  lonLatVector,
} from "../dist/index.js";

const fc = (...features) => ({ type: "FeatureCollection", features });
const polygon = (id, ring) => ({
  type: "Feature",
  id,
  properties: { id },
  geometry: { type: "Polygon", coordinates: [ring] },
});
const square = (x, y, r) => [
  [x - r, y - r],
  [x - r, y + r],
  [x + r, y + r],
  [x + r, y - r],
  [x - r, y - r],
];
const windowAt = (x, y, r) =>
  clipWindow(...lonLatVector([x, y]), (r * Math.PI) / 180);
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test("public culling accepts an explicit cone and reuses precomputed caps", () => {
  const near = polygon("near", square(0, 0, 2));
  const far = polygon("far", square(160, 0, 2));
  const source = freeze(fc(near, far));
  const w = windowAt(0, 0, 10);
  const caps = computeFeatureCaps(source);
  assert.ok(isCapVisible(caps[0], w));
  assert.ok(!isCapVisible(caps[1], w));
  assert.deepEqual(filterSphericalFeatures(source, w, caps), fc(near));
  assert.equal(filterSphericalFeatures(source, w).features[0], near);
  assert.throws(() => filterSphericalFeatures(source, w, []), /feature count/);
  assert.deepEqual(computeFeatureCap(near), caps[0]);
});

test("public clipping preserves identity and properties, never mutates frozen input", () => {
  const near = polygon("near", square(0, 0, 2));
  const crossing = polygon("crossing", square(8, 0, 6));
  const far = polygon("far", square(160, 0, 2));
  const source = freeze(fc(near, crossing, far));
  const snapshot = structuredClone(source);
  const w = windowAt(0, 0, 10);
  const result = clipToWindow(source, w);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(result, clipToWindow(source, w));
  assert.equal(result.geojson.features.length, 2);
  assert.equal(result.geojson.features[0], near);
  const clipped = result.geojson.features[1];
  assert.notEqual(clipped, crossing);
  assert.equal(clipped.id, crossing.id);
  assert.equal(clipped.properties, crossing.properties);
  assert.ok(result.stats.rings.clipped > 0);
  assert.equal(result.stats.features, 2);
  assert.equal(
    result.stats.vertices,
    result.geojson.features.reduce(
      (sum, f) =>
        sum + f.geometry.coordinates.reduce((n, ring) => n + ring.length, 0),
      0,
    ),
  );
  assert.equal(
    result.stats.stream.classified,
    result.stats.stream.inside + result.stats.stream.outside,
  );
});

test("empty input and non-polygon geometry have explicit behavior", () => {
  const empty = fc();
  const w = windowAt(0, 0, 10);
  assert.equal(filterSphericalFeatures(empty, w), empty);
  const clipped = clipToWindow(empty, w);
  assert.deepEqual(clipped.geojson, empty);
  assert.equal(clipped.stats.vertices, 0);
  for (const geometry of [
    {
      type: "LineString",
      coordinates: [
        [170, 0],
        [171, 0],
      ],
    },
    {
      type: "MultiLineString",
      coordinates: [
        [
          [170, 0],
          [171, 0],
        ],
      ],
    },
  ]) {
    const f = { type: "Feature", properties: null, geometry };
    const source = fc(f);
    assert.equal(filterSphericalFeatures(source, w).features[0], f);
    assert.throws(
      () => clipToWindow(source, w),
      /Polygon and MultiPolygon only/,
    );
  }
});

test("window constructor rejects invalid radius and center", () => {
  for (const args of [
    [0, 0, 0, 0.1],
    [2, 0, 0, 0.1],
    [NaN, 0, 0, 0.1],
    [1, 0, 0, -0.1],
    [1, 0, 0, Math.PI / 2],
    [1, 0, 0, Infinity],
    [1, 0, 0, NaN],
  ])
    assert.throws(() => clipWindow(...args), /unit center/);
});

test("public API handles seam-adjacent and high-latitude windows deterministically", () => {
  const cases = [
    [
      179,
      0,
      polygon("seam", [
        [175, -4],
        [175, 4],
        [-175, 4],
        [-175, -4],
        [175, -4],
      ]),
    ],
    [30, 83, polygon("polar", square(30, 82, 5))],
  ];
  for (const [lon, lat, feature] of cases) {
    const source = freeze(fc(feature));
    const w = windowAt(lon, lat, 3);
    const a = clipToWindow(source, w);
    assert.deepEqual(a, clipToWindow(source, w));
    assert.equal(a.geojson.features.length, 1);
    for (const ring of a.geojson.features[0].geometry.coordinates) {
      assert.deepEqual(ring[0], ring.at(-1));
      for (const point of ring) {
        const [x, y, z] = lonLatVector(point);
        assert.ok(x * w.cx + y * w.cy + z * w.cz >= w.cosR - 1e-9);
      }
    }
  }
});
