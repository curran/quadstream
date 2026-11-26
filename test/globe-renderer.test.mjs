import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as d3 from "d3";
import { createGlobeRenderer } from "../examples/globe/map.mjs";

function createMockCtx() {
  const counts = {
    beginPath: 0,
    fill: 0,
    stroke: 0,
    createRadialGradient: 0,
  };
  const ctx = {
    counts,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {
      counts.beginPath += 1;
    },
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      counts.fill += 1;
    },
    stroke() {
      counts.stroke += 1;
    },
    createRadialGradient() {
      counts.createRadialGradient += 1;
      return { addColorStop() {} };
    },
  };
  return ctx;
}

function makeState(overrides = {}) {
  const width = overrides.width ?? 800;
  const height = overrides.height ?? 600;
  return {
    width,
    height,
    rotation: [0, 0, 0],
    scale: 250,
    translation: [width / 2, height / 2],
    interacting: false,
    dpr: 1,
    ...overrides,
  };
}

function makePolygonFeatures(count) {
  const features = [];
  for (let i = 0; i < count; i += 1) {
    const lon = -60 + (i % 10) * 10;
    const lat = -40 + Math.floor(i / 10) * 15;
    features.push({
      type: "Feature",
      properties: { id: i },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon, lat],
            [lon + 5, lat],
            [lon + 5, lat + 5],
            [lon, lat + 5],
            [lon, lat],
          ],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

describe("createGlobeRenderer", () => {
  it("batches all land features into O(1) path/fill/stroke calls", () => {
    const ctx = createMockCtx();
    const render = createGlobeRenderer(d3, ctx);
    const geojson = makePolygonFeatures(50);

    render(makeState(), geojson);

    assert.equal(ctx.counts.beginPath, 3);
    assert.equal(ctx.counts.fill, 2);
    assert.equal(ctx.counts.stroke, 3);
  });

  it("draws sphere and graticule when geojson is empty or undefined", () => {
    for (const geojson of [
      undefined,
      { type: "FeatureCollection", features: [] },
    ]) {
      const ctx = createMockCtx();
      const render = createGlobeRenderer(d3, ctx);

      assert.doesNotThrow(() => render(makeState(), geojson));
      assert.equal(ctx.counts.beginPath, 2);
      assert.equal(ctx.counts.fill, 1);
      assert.equal(ctx.counts.stroke, 2);
    }
  });

  it("caches ocean RadialGradient by width x height", () => {
    const ctx = createMockCtx();
    const render = createGlobeRenderer(d3, ctx);
    const geojson = makePolygonFeatures(1);

    render(makeState({ width: 800, height: 600 }), geojson);
    render(
      makeState({ width: 800, height: 600, rotation: [30, 0, 0] }),
      geojson,
    );
    assert.equal(ctx.counts.createRadialGradient, 1);

    render(makeState({ width: 1024, height: 600 }), geojson);
    assert.equal(ctx.counts.createRadialGradient, 2);

    render(makeState({ width: 1024, height: 768 }), geojson);
    assert.equal(ctx.counts.createRadialGradient, 3);
  });
});
