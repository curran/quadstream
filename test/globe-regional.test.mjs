import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as topojson from "topojson-client";
import { regionalConfig, layerActive, createRegionalLayers } from "../examples/globe/regional.mjs";
import { internalBoundaryMesh } from "../examples/globe/regional-geometry.mjs";

const view = (zoom, rotation = [96, -39, 0]) => ({
  scale: 100 * zoom, initialScale: 100, width: 200, height: 200,
  translation: [100, 100], rotation,
});
test("regional gates use zoom hysteresis and spherical viewport", () => {
  const [states, counties] = regionalConfig();
  assert.equal(layerActive(states, view(2.9), false), false);
  assert.equal(layerActive(states, view(3), false), true);
  assert.equal(layerActive(states, view(2.9), true), true);
  assert.equal(layerActive(states, view(2.6), true), false);
  assert.equal(layerActive(counties, view(5.9), false), false);
  assert.equal(layerActive(counties, view(6), false), true);
  assert.equal(layerActive(states, view(8, [-20, -45, 0]), true), false);
  assert.equal(layerActive(states, view(8, [150, -62, 0]), false), true);
  assert.equal(regionalConfig({ counties: false }).length, 1);
});
test("lazy load, cached frame, stale replies and reset", () => {
  const workers = [];
  const layers = createRegionalLayers({
    configs: regionalConfig(),
    createWorker: () => {
      const worker = { sent: [], postMessage(m) { this.sent.push(m); },
        terminate() { this.terminated = true; } };
      workers.push(worker);
      return worker;
    },
  });
  const options = { enabled: true, original: false, level: 5 };
  assert.deepEqual(layers.update(view(1), options), []);
  assert.equal(workers.length, 0);
  layers.update(view(3), options);
  assert.equal(workers.length, 1);
  const w = workers[0];
  const original = { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] };
  w.onmessage({ data: { type: "ready", original } });
  assert.equal(w.sent.at(-1).type, "query");
  assert.deepEqual(layers.update(view(1), options), []);
  w.onmessage({ data: { type: "frame", level: 8, geometry: original } });
  assert.equal(layers.update(view(3), options)[0].geometry, original);
  assert.equal(workers.length, 1);
  layers.update(view(6), options);
  assert.equal(workers.length, 2);
  layers.reset();
  assert.ok(workers.every((worker) => worker.terminated));
  w.onmessage({ data: { type: "ready", original } });
  assert.ok(layers.status().every((s) => s.phase === "idle"));
});
test("bundled atlas objects and interior-only regional meshes", async () => {
  for (const resolution of ["110m", "50m"]) {
    const atlas = JSON.parse(await readFile(new URL(
      "../node_modules/visionscarto-world-atlas/world/" + resolution + ".json", import.meta.url), "utf8"));
    assert.ok(atlas.objects.countries);
    assert.ok(topojson.feature(atlas, atlas.objects.countries).features.length > 100);
  }
  for (const config of regionalConfig()) {
    const file = config.object === "states" ? "states-10m.json" : "counties-10m.json";
    const atlas = JSON.parse(await readFile(new URL(
      "../node_modules/us-atlas/" + file, import.meta.url), "utf8"));
    const mesh = internalBoundaryMesh(atlas, config, topojson);
    assert.ok(mesh.coordinates.length > 10);
    assert.deepEqual(mesh, topojson.mesh(atlas, atlas.objects[config.object], (a, b) =>
      a !== b && (!config.sameState || String(a.id).slice(0, 2) === String(b.id).slice(0, 2))));
  }
});
