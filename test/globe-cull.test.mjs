import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { computeFeatureCap, isCapVisible } from "../dist/index.js";
import { lonLatToVec } from "../dist/spherical-cull.js";
import {
  orthographicViewCone,
  filterVisibleFeatures,
} from "../examples/globe/cull.mjs";
import { decodeCountries } from "../examples/globe/geometry.mjs";
import { createGlobeRenderer } from "../examples/globe/map.mjs";

const require = createRequire(import.meta.url);

function makeMockCtx() {
  const calls = [];
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    calls,
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    createRadialGradient: () => grad,
    beginPath: () => calls.push("beginPath"),
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
  };
}

test("spherical bounding caps contain every vertex of antimeridian and polar atlas features", async () => {
  const topo = JSON.parse(
    await readFile(require.resolve("world-atlas/countries-110m.json"), "utf8"),
  );
  const countries = decodeCountries(topo, topojson);
  const byName = new Map(countries.features.map((f) => [f.properties.name, f]));

  for (const name of ["Russia", "Antarctica", "Fiji"]) {
    const f = byName.get(name);
    assert.ok(f, `missing ${name}`);
    const cap = computeFeatureCap(f);
    const polys =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [lon, lat] of ring) {
          const [x, y, z] = lonLatToVec(lon, lat);
          const angle = Math.acos(
            Math.max(-1, Math.min(1, cap.cx * x + cap.cy * y + cap.cz * z)),
          );
          assert.ok(
            angle <= cap.radiusRad + 1e-9,
            `${name} vertex (${lon}, ${lat}) exceeded cap radius`,
          );
        }
      }
    }
  }
});

test("filterVisibleFeatures culls back-hemisphere and zoomed-out-of-viewport countries", async () => {
  const topo = JSON.parse(
    await readFile(require.resolve("world-atlas/countries-110m.json"), "utf8"),
  );
  const countries = decodeCountries(topo, topojson);
  const capCache = new WeakMap();

  // Centered on Europe (lon 10, lat 50), zoomed in 6x.
  const zoomedEurope = {
    width: 800,
    height: 600,
    rotation: [-10, -50, 0],
    scale: 1800,
    translation: [400, 300],
  };
  const cone = orthographicViewCone(zoomedEurope);
  assert.ok(cone.viewRadius < 0.35);

  const visible = filterVisibleFeatures(countries, zoomedEurope, capCache);
  const names = new Set(visible.features.map((f) => f.properties.name));
  assert.ok(names.has("France"));
  assert.ok(names.has("Germany"));
  assert.ok(!names.has("Australia"));
  assert.ok(!names.has("Argentina"));
  assert.ok(!names.has("Antarctica"));
  assert.ok(visible.features.length < countries.features.length / 3);

  // Opposite-hemisphere feature is culled even at 1x globe scale.
  const fullAtlantic = {
    width: 800,
    height: 600,
    rotation: [0, -20, 0],
    scale: 250,
    translation: [400, 300],
  };
  const atlanticVisible = filterVisibleFeatures(
    countries,
    fullAtlantic,
    capCache,
  );
  const atlanticNames = new Set(
    atlanticVisible.features.map((f) => f.properties.name),
  );
  assert.ok(!atlanticNames.has("Fiji"));
  assert.ok(atlanticNames.has("Brazil"));

  // Non-intersecting cap check.
  const australiaCap = computeFeatureCap(
    countries.features.find((f) => f.properties.name === "Australia"),
  );
  assert.equal(isCapVisible(australiaCap, cone), false);
});

test("createGlobeRenderer skips off-screen land draw calls when cull is true", () => {
  const farFeature = {
    type: "Feature",
    id: "far",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [170, -10],
          [175, -10],
          [175, -5],
          [170, -5],
          [170, -10],
        ],
      ],
    },
  };
  const fc = { type: "FeatureCollection", features: [farFeature] };
  const state = {
    width: 800,
    height: 600,
    rotation: [0, 0, 0],
    scale: 250,
    translation: [400, 300],
    interacting: false,
    dpr: 1,
  };

  const ctxOff = makeMockCtx();
  createGlobeRenderer(d3, ctxOff)(state, fc);
  assert.equal(ctxOff.calls.filter((c) => c === "fill").length, 2);

  const ctxOn = makeMockCtx();
  createGlobeRenderer(d3, ctxOn, { cull: true })(state, fc);
  // Only ocean sphere is filled; farFeature on back hemisphere is culled.
  assert.equal(ctxOn.calls.filter((c) => c === "fill").length, 1);
});
