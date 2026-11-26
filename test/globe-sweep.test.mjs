import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as topojson from "topojson-client";
import * as d3 from "d3";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";

test("every 0.1 LOD step on the real atlas is D3-compatible, valid and ordered", async () => {
  const topo = JSON.parse(
    await fs.readFile("node_modules/world-atlas/countries-110m.json", "utf8"),
  );
  const engine = createGlobeGeometry(decodeCountries(topo, topojson), d3);
  let first = 0;
  for (let i = 0; i <= 190; i += 1) {
    const level = i / 10,
      r = engine.query(level);
    assert.equal(r.invalidGroups, 0, `d3 invalid at ${level}`);
    assert.equal(r.validatorInvalidGroups, 0, `strict invalid at ${level}`);
    if (i === 0) first = r.vertices;
    assert.ok(r.vertices >= first * 0.97, `collapse at ${level}`);
    for (const f of r.geojson.features)
      for (const poly of f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates)
        for (const ring of poly)
          assert.ok(new Set(ring.slice(0, -1).map(String)).size >= 3);
  }
});
