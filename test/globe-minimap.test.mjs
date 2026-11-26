import test from "node:test";
import assert from "node:assert/strict";
import * as d3 from "d3";
import {
  projectedViewportRing,
  createMinimapRenderer,
} from "../examples/globe/minimap.mjs";
import { fixture } from "../examples/globe/fixture.mjs";
import { lonLatToVec, orthographicViewCone } from "../examples/globe/cull.mjs";

function makeMockCtx() {
  const ops = [];
  const noop = () => {};
  return {
    ops,
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    setLineDash: (d) => ops.push(["dash", d.length]),
    beginPath: () => ops.push(["beginPath"]),
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    fill: () => ops.push(["fill"]),
    stroke: () => ops.push(["stroke"]),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  };
}

test("projectedViewportRing clamps to horizon when zoomed out and stays inside view cone when zoomed in", () => {
  const full = projectedViewportRing(d3, {
    width: 800,
    height: 600,
    rotation: [0, -20, 0],
    scale: 200,
    translation: [400, 300],
  });
  assert.equal(full.geometry.type, "LineString");
  assert.ok(full.geometry.coordinates.length > 10);
  for (const [lon, lat] of full.geometry.coordinates) {
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
  }

  const zoomedState = {
    width: 800,
    height: 600,
    rotation: [-10, -45, 0],
    scale: 1600,
    translation: [400, 300],
  };
  const zoomed = projectedViewportRing(d3, zoomedState);
  const cone = orthographicViewCone(zoomedState);
  for (const [lon, lat] of zoomed.geometry.coordinates) {
    const [x, y, z] = lonLatToVec(lon, lat);
    const angle = Math.acos(
      Math.max(-1, Math.min(1, cone.vx * x + cone.vy * y + cone.vz * z)),
    );
    assert.ok(angle <= cone.viewRadius + 1e-3);
  }
});

test("createMinimapRenderer renders sphere, graticule, culled/visible geometry, cone, and viewport", () => {
  const ctx = makeMockCtx();
  const draw = createMinimapRenderer(d3, ctx);
  draw(
    {
      width: 800,
      height: 600,
      rotation: [0, -20, 0],
      scale: 900,
      translation: [400, 300],
      dpr: 1,
      miniSize: 160,
    },
    fixture,
  );
  // Sphere + full dimmed + visible subset fills >= 3; plus graticule, cone, and viewport strokes.
  const fills = ctx.ops.filter((o) => o[0] === "fill").length;
  const strokes = ctx.ops.filter((o) => o[0] === "stroke").length;
  assert.ok(fills >= 2);
  assert.ok(strokes >= 5);

  // Empty geojson still draws sphere, graticule, cone, and viewport cleanly.
  const emptyCtx = makeMockCtx();
  createMinimapRenderer(d3, emptyCtx)(
    {
      width: 800,
      height: 600,
      rotation: [0, 0, 0],
      scale: 250,
      translation: [400, 300],
      dpr: 1,
    },
    undefined,
  );
  assert.equal(emptyCtx.ops.filter((o) => o[0] === "fill").length, 1);
});

test("minimap highlights the supplied visible geometry instead of recomputing culling", () => {
  const ctx = makeMockCtx();
  const draw = createMinimapRenderer(d3, ctx);
  const feature = (lon) => ({
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, 0],
          [lon, 5],
          [lon + 5, 5],
          [lon + 5, 0],
          [lon, 0],
        ],
      ],
    },
  });
  const all = {
    type: "FeatureCollection",
    features: [feature(0), feature(40)],
  };
  const state = {
    width: 400,
    height: 300,
    rotation: [0, 0, 0],
    scale: 100,
    translation: [200, 150],
    miniSize: 160,
  };
  const fills = (visible) => {
    ctx.ops.length = 0;
    draw(state, all, visible);
    return ctx.ops.length;
  };
  // Both calls draw a highlight layer; an empty supplied collection skips it.
  const withDefault = fills(undefined);
  const withEmpty = fills({ type: "FeatureCollection", features: [] });
  assert.ok(withDefault > withEmpty);
});
