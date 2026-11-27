import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";

const load = async (resolution) =>
  decodeCountries(
    JSON.parse(await readFile(new URL(
      "../node_modules/visionscarto-world-atlas/world/" + resolution + ".json",
      import.meta.url,
    ), "utf8")),
    topojson,
  );
const rings = (geometry) =>
  geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flat();
const vertices = (feature) => new Set(
  rings(feature.geometry).flat().map((p) => JSON.stringify(p)),
);
const japanIndex = (source) => {
  const index = source.features.findIndex((f) =>
    f.properties?.name === "Japan" || String(f.id) === "392",
  );
  assert.ok(index >= 0, "pinned atlas must contain Japan");
  return index;
};
function nested(before, after, label) {
  for (const vertex of before)
    assert.ok(after.has(vertex), label + " lost vertex " + vertex);
}
const levels = [4.2, 4.9, 5, 5.1, 5.8, 5.9, 6, 6.1, 6.2, 6.9, 7, 7.1, 8, 10, 15, 19];

test("real Japan 50m: 5.9 -> 6.0 -> 6.1 retains every vertex, independent of query order", async () => {
  const source = await load("50m");
  const japan = source.features[japanIndex(source)];
  const engine = createGlobeGeometry({ type: "FeatureCollection", features: [japan] }, d3);
  assert.equal(engine.unavailable, 0);
  const snapshots = new Map();
  for (const level of [6.1, 5.9, 6, 5.9, 6.1]) {
    const f = engine.query(level);
    assert.equal(f.validatorInvalidGroups, 0);
    assert.equal(f.fallbackGroups, 0);
    const geometry = f.geojson.features[0].geometry;
    if (snapshots.has(level)) assert.deepEqual(geometry, snapshots.get(level));
    snapshots.set(level, geometry);
  }
  const [low, middle, high] = [5.9, 6, 6.1].map((level) =>
    vertices({ geometry: snapshots.get(level) }),
  );
  nested(low, middle, "Japan 5.9 -> 6.0");
  nested(middle, high, "Japan 6.0 -> 6.1");
  assert.ok(low.size > 0);
  assert.ok(high.size < vertices(japan).size, "must not merely use full source");
  const asyncEngine = createGlobeGeometry({ type: "FeatureCollection", features: [japan] }, d3);
  const asyncFrame = await asyncEngine.queryInterruptible(6.1, { yieldTurn: async () => {}, sliceMs: 0 });
  assert.deepEqual(asyncFrame.geojson.features[0].geometry, snapshots.get(6.1));
});

for (const resolution of ["110m", "50m"]) {
  test("real " + resolution + " world atlas: nested per-feature vertex sets", async (t) => {
    const source = await load(resolution);
    const engine = createGlobeGeometry(source, d3);
    const japan = japanIndex(source);
    let previous = source.features.map(() => new Set());
    let priorLevel = 0;
    for (const level of levels) {
      const frame = engine.query(level);
      assert.equal(frame.validatorInvalidGroups, 0, "LOD " + level);
      assert.equal(frame.invalidGroups, 0, "LOD " + level);
      assert.equal(frame.geojson.features.length, source.features.length);
      const next = frame.geojson.features.map(vertices);
      next.forEach((set, i) => nested(previous[i], set,
        (source.features[i].properties?.name ?? i) + " " + priorLevel + " -> " + level));
      if ([5.9, 6, 6.1].includes(level)) {
        t.diagnostic("Japan LOD " + level + ": " + next[japan].size + " distinct vertices");
        assert.ok(next[japan].size > 0);
        if (resolution === "50m") assert.ok(next[japan].size < vertices(source.features[japan]).size);
      }
      previous = next;
      priorLevel = level;
    }
  });
}
