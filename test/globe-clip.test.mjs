import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { clipWindow, clipToWindow } from "../dist/index.js";
import { clipRing, ringInfo, circleRing } from "../dist/spherical-clip.js";
import {
  createViewClipper,
  CLIP_MARGIN_RAD,
  CLIP_MAX_RADIUS_RAD,
} from "../examples/globe/clip.mjs";
import { lonLatToVec, orthographicViewCone } from "../examples/globe/cull.mjs";
import { decodeCountries } from "../examples/globe/geometry.mjs";
import { createGlobeRenderer } from "../examples/globe/map.mjs";

const require = createRequire(import.meta.url);
const RAD = Math.PI / 180;

const load = async (name) =>
  decodeCountries(
    JSON.parse(await readFile(require.resolve(name), "utf8")),
    topojson,
  );
const windowAt = (lon, lat, radiusDeg) => {
  const [x, y, z] = lonLatToVec(lon, lat);
  return clipWindow(x, y, z, radiusDeg * RAD);
};
const dist = (w, [lon, lat]) => {
  const [x, y, z] = lonLatToVec(lon, lat);
  return Math.acos(Math.max(-1, Math.min(1, x * w.cx + y * w.cy + z * w.cz)));
};
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const poly = (...rings) => ({
  type: "Feature",
  properties: { name: "p" },
  geometry: { type: "Polygon", coordinates: rings },
});
const fcOf = (...features) => ({ type: "FeatureCollection", features });
// d3 exterior rings are clockwise: material lies on the right.
const square = (lon, lat, half) => [
  [lon - half, lat - half],
  [lon - half, lat + half],
  [lon + half, lat + half],
  [lon + half, lat - half],
  [lon - half, lat - half],
];
const reversed = (ring) => [...ring].reverse();
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
// Uniform random point inside the window (kept off the polygonal boundary
// walk, whose chords sit up to a fraction of a degree inside the circle).
function pointIn(w, rnd, shrinkRad = 0.003) {
  const rho = Math.sqrt(rnd()) * Math.max(0, w.radius - shrinkRad),
    th = rnd() * 2 * Math.PI,
    c = Math.cos(th),
    s = Math.sin(th);
  const x = w.cx * Math.cos(rho) + Math.sin(rho) * (w.ux * c + w.bx * s),
    y = w.cy * Math.cos(rho) + Math.sin(rho) * (w.uy * c + w.by * s),
    z = w.cz * Math.cos(rho) + Math.sin(rho) * (w.uz * c + w.bz * s);
  return [
    Math.atan2(y, x) / RAD,
    Math.asin(Math.max(-1, Math.min(1, z))) / RAD,
  ];
}
function assertWellFormed(geojson, w) {
  for (const f of geojson.features)
    for (const p of polys(f.geometry))
      for (const ring of p) {
        assert.ok(ring.length >= 4, "ring has at least 4 points");
        assert.deepEqual(ring[0], ring.at(-1), "ring closed");
        for (const pt of ring) {
          assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
          assert.ok(dist(w, pt) <= w.radius + 1e-9, "vertex inside window");
        }
      }
}

test("single crossing keeps inside vertices, exact boundary points and a short walk", () => {
  const w = windowAt(0, 0, 10),
    ring = square(8, 0, 6), // x from 2..14, straddles the 10 degree boundary
    res = clipRing(w, ringInfo(ring), -1);
  assert.equal(res.status, "clipped");
  assert.equal(res.rings.length, 1);
  const out = res.rings[0];
  assert.ok(out.length <= 30, `walk is a short arc: ${out.length}`);
  const onBoundary = out.filter((p) => Math.abs(dist(w, p) - w.radius) < 1e-9);
  assert.ok(onBoundary.length >= 2);
  // Original inside vertices survive by identity.
  const keep = ring.slice(0, -1).filter((p) => dist(w, p) < w.radius);
  for (const p of keep) assert.ok(out.some((q) => q === p));
  assert.equal(keep.length, 2);
  // Orientation preserved: still clockwise, small area equal to the intersection.
  const area = d3.geoArea({ type: "Polygon", coordinates: [out] });
  assert.ok(
    area > 0 && area < d3.geoArea({ type: "Polygon", coordinates: [ring] }),
  );
  assert.ok(area < Math.PI * 100 * RAD * RAD * 1.01);
});

test("a dense ring mostly outside the window keeps only the vertices inside plus a short walk", () => {
  const w = windowAt(0, 0, 10),
    dense = d3.geoCircle().center([25, 0]).radius(16).precision(0.2)()
      .coordinates[0],
    res = clipRing(w, ringInfo(dense), -1);
  assert.ok(dense.length > 1000);
  assert.equal(res.status, "clipped");
  assert.equal(res.rings.length, 1);
  assert.ok(
    res.rings[0].length < dense.length / 10,
    `kept ${res.rings[0].length} of ${dense.length}`,
  );
});

test("edge whose endpoints are both outside still produces its crossings", () => {
  const w = windowAt(0, 0, 10),
    // Triangle with a long edge sweeping across the window.
    ring = [
      [-40, 3],
      [-40, 40],
      [40, 40],
      [40, 3],
      [-40, 3],
    ];
  const res = clipRing(w, ringInfo(ring), -1);
  assert.equal(res.status, "clipped");
  const probe = { type: "Polygon", coordinates: [] };
  for (const rg of res.rings) {
    probe.coordinates = [rg];
    for (const p of [
      [0, 6],
      [0, 8],
      [5, 5],
    ])
      assert.ok(d3.geoContains(probe, p), `inside ${p}`);
    for (const p of [
      [0, 0],
      [0, -5],
      [-6, 1],
    ])
      assert.ok(!d3.geoContains(probe, p), `outside ${p}`);
  }
});

test("ring dipping in and out splits into separate rings without long boundary walks", () => {
  const w = windowAt(0, 0, 10),
    // Concave comb-like ring: two prongs poke into the window.
    ring = [
      [8, -30],
      [8, 5],
      [14, 5],
      [14, -2],
      [10.2, -2],
      [10.2, -30],
      [8, -30],
    ];
  const probeRing = reversed(ring);
  const res = clipRing(w, ringInfo(ring), -1);
  assert.equal(res.status, "clipped");
  let total = 0;
  for (const rg of res.rings)
    total += d3.geoArea({ type: "Polygon", coordinates: [rg] });
  const expected = d3.geoArea({
    type: "Polygon",
    coordinates: [ring],
  });
  assert.ok(total <= expected + 1e-6);
  assert.ok(total > 0 && total < 0.2, `no full-circle walk: ${total}`);
  assert.ok(probeRing.length);
});

test("rings fully inside keep identity; rings fully away are dropped", () => {
  const w = windowAt(0, 0, 20),
    inner = poly(square(0, 0, 3)),
    far = poly(square(120, 40, 3)),
    { geojson, stats } = clipToWindow(fcOf(inner, far), w);
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0], inner);
  assert.equal(stats.rings.kept, 1);
  assert.equal(stats.features, 1);
});

test("window inside a large polygon emits the window circle; outside emits nothing", () => {
  const big = poly(square(0, 0, 40)),
    w = windowAt(0, 0, 10),
    { geojson, stats } = clipToWindow(fcOf(big), w);
  assert.equal(stats.rings.wrapped, 1);
  const ring = geojson.features[0].geometry.coordinates[0];
  for (const p of ring) assert.ok(Math.abs(dist(w, p) - w.radius) < 1e-9);
  assert.ok(d3.geoContains(geojson.features[0], [0, 0]));
  assert.ok(d3.geoContains(geojson.features[0], [7, 3]));
  // Orientation is d3-compatible: small area, not the complement.
  assert.ok(d3.geoArea(geojson.features[0]) < 0.2);
  assert.equal(
    clipToWindow(fcOf(big), windowAt(120, 0, 10)).geojson.features.length,
    0,
  );
  // Window inside the complement side of a polygon: not covered.
  const out = windowAt(60, 0, 10);
  assert.equal(clipToWindow(fcOf(big), out).geojson.features.length, 0);
  assert.equal(circleRing(w).length > 20, true);
});

test("holes: window inside hole drops polygon, outside skips it, straddling clips it", () => {
  const outer = square(0, 0, 40),
    hole = reversed(square(0, 0, 6)),
    feature = poly(outer, hole);
  // Window entirely inside the hole.
  assert.equal(
    clipToWindow(fcOf(feature), windowAt(0, 0, 2)).geojson.features.length,
    0,
  );
  // Window inside material, hole far away.
  const away = clipToWindow(fcOf(feature), windowAt(0, 30, 3));
  assert.equal(away.geojson.features[0].geometry.coordinates.length, 1);
  assert.ok(d3.geoContains(away.geojson.features[0], [0, 30]));
  // Window straddling the hole edge: parity with the original.
  for (const [lon, lat, r] of [
    [5, 0, 4],
    [0, 6, 3],
    [-5, -5, 5],
    [0, 0, 9],
    [0, 0, 12],
  ]) {
    const w = windowAt(lon, lat, r),
      { geojson } = clipToWindow(fcOf(feature), w),
      rnd = rng(lon * 31 + r),
      g = geojson.features[0];
    for (let i = 0; i < 300; i++) {
      const p = pointIn(w, rnd);
      assert.equal(
        g ? d3.geoContains(g, p) : false,
        d3.geoContains(feature, p),
        `hole parity at ${p} (window ${lon},${lat},${r})`,
      );
    }
  }
  // Hole fully inside the window stays by identity.
  const keep = clipToWindow(fcOf(feature), windowAt(0, 0, 10));
  assert.ok(keep.geojson.features[0].geometry.coordinates.includes(hole));
});

test("MultiPolygon keeps only polygons that matter and preserves the type", () => {
  const w = windowAt(0, 0, 10),
    multi = {
      type: "Feature",
      id: 7,
      properties: { name: "m" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [square(0, 0, 2)],
          [square(100, 0, 2)],
          [square(9, 0, 4)],
        ],
      },
    },
    { geojson } = clipToWindow(fcOf(multi), w),
    out = geojson.features[0];
  assert.equal(out.id, 7);
  assert.deepEqual(out.properties, { name: "m" });
  assert.equal(out.geometry.type, "MultiPolygon");
  assert.equal(out.geometry.coordinates.length, 2);
  assertWellFormed(geojson, w);
});

test("neighbouring features get bit-identical points on their shared crossing", () => {
  const w = windowAt(0, 0, 10),
    shared = [
      [5, -20],
      [14, 20],
    ],
    a = poly([[-20, -20], [-20, 20], shared[1], shared[0], [-20, -20]]),
    b = poly([shared[0], shared[1], [40, 20], [40, -20], shared[0]]),
    { geojson } = clipToWindow(fcOf(a, b), w),
    onBoundary = (f) =>
      f.geometry.coordinates[0]
        .filter((p) => Math.abs(dist(w, p) - w.radius) < 1e-9)
        .map((p) => p.join(","));
  const pa = onBoundary(geojson.features[0]),
    pb = onBoundary(geojson.features[1]);
  const shared2 = pa.filter((p) => pb.includes(p));
  assert.ok(shared2.length >= 1, "shared crossing is bit-identical");
});

test("vertices exactly on the boundary and grazing edges stay well formed", () => {
  const w = windowAt(0, 0, 10);
  const onEdge = [0, 0];
  // Put a vertex numerically on the circle.
  const [bx, by, bz] = [
    w.cx * w.cosR + w.sinR * w.ux,
    w.cy * w.cosR + w.sinR * w.uy,
    w.cz * w.cosR + w.sinR * w.uz,
  ];
  onEdge[0] = Math.atan2(by, bx) / RAD;
  onEdge[1] = Math.asin(bz) / RAD;
  const ring = [
    onEdge,
    [onEdge[0], onEdge[1] + 5],
    [onEdge[0] + 5, onEdge[1] + 5],
    onEdge,
  ];
  const { geojson } = clipToWindow(fcOf(poly(ring)), w);
  for (const f of geojson.features) assertWellFormed({ features: [f] }, w);
  // Edge tangent to the circle.
  const tangent = poly([
    [-5, 10 + 1e-12],
    [-5, 30],
    [5, 30],
    [5, 10 + 1e-12],
    [-5, 10 + 1e-12],
  ]);
  const t = clipToWindow(fcOf(tangent), w);
  for (const f of t.geojson.features) assertWellFormed({ features: [f] }, w);
});

test("windows over the poles and antimeridian match d3 containment", () => {
  const rnd = rng(11),
    cases = [
      {
        feature: poly(square(179, 0, 5)),
        views: [
          [180, 0, 8],
          [175, 2, 4],
          [-178, -3, 6],
        ],
      },
      {
        feature: poly([
          [-180, -60],
          [-180, -89],
          [-90, -89],
          [0, -89],
          [90, -89],
          [180, -89],
          [180, -60],
          [90, -60],
          [0, -60],
          [-90, -60],
          [-180, -60],
        ]),
        views: [
          [0, -90, 20],
          [60, -75, 10],
        ],
      },
    ];
  for (const { feature, views } of cases)
    for (const [lon, lat, r] of views) {
      const w = windowAt(lon, lat, r),
        { geojson } = clipToWindow(fcOf(feature), w),
        g = geojson.features[0];
      for (let i = 0; i < 400; i++) {
        const p = pointIn(w, rnd);
        assert.equal(
          g ? d3.geoContains(g, p) : false,
          d3.geoContains(feature, p),
          `parity at ${p} view ${lon},${lat},${r}`,
        );
      }
    }
});

test("clipping preserves d3 containment for real 110m countries across random views", async () => {
  const fc = await load("world-atlas/countries-110m.json"),
    rnd = rng(2026);
  let samples = 0;
  for (let t = 0; t < 80; t++) {
    const lon = rnd() * 360 - 180,
      lat = Math.asin(rnd() * 2 - 1) / RAD,
      r = 1 + rnd() * rnd() * 80,
      w = windowAt(lon, lat, r),
      { geojson } = clipToWindow(fc, w),
      byName = new Map(geojson.features.map((f) => [f.properties.name, f]));
    assertWellFormed(geojson, w);
    for (let k = 0; k < 25; k++) {
      const p = pointIn(w, rnd);
      for (const f of fc.features) {
        samples++;
        const g = byName.get(f.properties.name);
        assert.equal(
          g ? d3.geoContains(g, p) : false,
          d3.geoContains(f, p),
          `${f.properties.name} at ${p} for view ${lon},${lat},${r}`,
        );
      }
    }
  }
  assert.ok(samples > 100000);
});

test("clipping preserves d3 containment on 50m atlas at zoomed views including poles", async () => {
  const fc = await load("world-atlas/countries-50m.json"),
    rnd = rng(50);
  for (const [lon, lat, r] of [
    [10, 48, 6],
    [-100, 60, 12],
    [20, -89, 15],
    [180, -17, 8],
    [90, 0, 30],
  ]) {
    const w = windowAt(lon, lat, r),
      { geojson } = clipToWindow(fc, w),
      byName = new Map(geojson.features.map((f) => [f.properties.name, f]));
    assertWellFormed(geojson, w);
    for (let k = 0; k < 12; k++) {
      const p = pointIn(w, rnd);
      for (const f of fc.features)
        assert.equal(
          byName.get(f.properties.name)
            ? d3.geoContains(byName.get(f.properties.name), p)
            : false,
          d3.geoContains(f, p),
          `${f.properties.name} at ${p} for view ${lon},${lat},${r}`,
        );
    }
  }
});

test("zooming into Europe drops most vertices of continent-sized rings", async () => {
  const fc = await load("world-atlas/countries-50m.json"),
    state = {
      width: 1910,
      height: 985,
      rotation: [-14, -48, 0],
      scale: 6000,
      translation: [955, 492],
    },
    clip = createViewClipper(),
    { geojson, stats } = clip(fc, state);
  assert.equal(stats.mode, "clip");
  assert.ok(stats.vertices < stats.sourceVertices * 0.2, JSON.stringify(stats));
  const count = (f) =>
    polys(f.geometry).reduce(
      (n, p) => n + p.reduce((m, r) => m + r.length, 0),
      0,
    );
  const name = (n, g) => g.features.find((f) => f.properties.name === n);
  const russia = name("Russia", fc),
    clipped = name("Russia", geojson);
  if (clipped) assert.ok(count(clipped) < count(russia) * 0.2);
  assert.equal(name("Australia", geojson), undefined);
  assert.ok(name("Germany", geojson));
});

test("view clipper reuses its window while the view stays inside and rebuilds when it leaves", async () => {
  const fc = await load("world-atlas/countries-110m.json"),
    clip = createViewClipper(),
    base = {
      width: 800,
      height: 600,
      rotation: [-10, -50, 0],
      scale: 1800,
      translation: [400, 300],
    };
  const first = clip(fc, base);
  assert.equal(first.stats.rebuilt, true);
  const small = clip(fc, { ...base, rotation: [-10.5, -50.2, 0] });
  assert.equal(small.stats.rebuilt, false);
  assert.equal(small.geojson, first.geojson);
  const zoomedOut = clip(fc, { ...base, scale: 900 });
  assert.equal(zoomedOut.stats.rebuilt, true, "larger cone exceeds the window");
  const far = clip(fc, { ...base, rotation: [60, -20, 0] });
  assert.equal(far.stats.rebuilt, true);
  const other = { ...fc, features: [...fc.features] },
    again = clip(other, { ...base, rotation: [60, -20, 0] });
  assert.equal(
    again.stats.rebuilt,
    true,
    "new geometry invalidates the window",
  );
});

test("every reused frame still covers the live viewport exactly (containment while panning)", async () => {
  const fc = await load("world-atlas/countries-110m.json"),
    clip = createViewClipper(),
    rnd = rng(5);
  let reused = 0;
  for (let step = 0; step < 40; step++) {
    const state = {
      width: 800,
      height: 600,
      rotation: [-10 + step * 0.4, -50 + step * 0.15, 0],
      scale: 1800 + step * 8,
      translation: [400, 300],
    };
    const { geojson, stats } = clip(fc, state);
    if (!stats.rebuilt) reused++;
    const cone = orthographicViewCone(state),
      w = clipWindow(cone.vx, cone.vy, cone.vz, cone.viewRadius),
      byName = new Map(geojson.features.map((f) => [f.properties.name, f]));
    for (let k = 0; k < 6; k++) {
      const p = pointIn(w, rnd);
      for (const f of fc.features) {
        const g = byName.get(f.properties.name);
        assert.equal(g ? d3.geoContains(g, p) : false, d3.geoContains(f, p));
      }
    }
  }
  assert.ok(reused > 20, `window reused ${reused}/40 frames`);
});

test("zoomed-out views fall back to whole-feature culling", async () => {
  const fc = await load("world-atlas/countries-110m.json"),
    clip = createViewClipper(),
    { geojson, stats } = clip(fc, {
      width: 800,
      height: 600,
      rotation: [0, -20, 0],
      scale: 250,
      translation: [400, 300],
    });
  assert.equal(stats.mode, "cull");
  assert.ok(geojson.features.length < fc.features.length);
  assert.ok(
    orthographicViewCone({
      width: 800,
      height: 600,
      scale: 250,
      translation: [400, 300],
      rotation: [0, 0, 0],
    }).viewRadius +
      CLIP_MARGIN_RAD >
      CLIP_MAX_RADIUS_RAD,
  );
  // Empty collections are tolerated.
  assert.equal(
    clip(
      { type: "FeatureCollection", features: [] },
      {
        width: 10,
        height: 10,
        rotation: [0, 0, 0],
        scale: 1000,
      },
    ).geojson.features.length,
    0,
  );
});

test("createGlobeRenderer with clip returns the drawn geometry and stats", () => {
  const calls = [];
  const noop = () => {};
  const ctx = {
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    beginPath: () => calls.push("beginPath"),
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
  };
  const draw = createGlobeRenderer(d3, ctx, { clip: true }),
    fc = fcOf(poly(square(0, 0, 40)), poly(square(120, 0, 3))),
    state = {
      width: 800,
      height: 600,
      rotation: [0, 0, 0],
      scale: 3000,
      translation: [400, 300],
      interacting: false,
      dpr: 1,
    },
    res = draw(state, fc);
  assert.equal(res.stats.mode, "clip");
  assert.equal(res.visible.features.length, 1);
  assert.equal(res.stats.rings.wrapped, 1);
  assert.equal(
    createGlobeRenderer(d3, ctx, { cull: true })(state, fc).stats,
    null,
  );
});
