// Lists features that fall back to source geometry at a given level.
// Usage: node scripts/inspect-fallback.mjs [110m|50m] [level]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";
const require = createRequire(import.meta.url);
const d3 = require("d3"),
  topojson = require("topojson-client");
const atlas = process.argv[2] ?? "110m",
  level = Number(process.argv[3] ?? 1.8);
const source = JSON.parse(
  readFileSync(`node_modules/world-atlas/countries-${atlas}.json`, "utf8"),
);
const original = decodeCountries(source, topojson);
const engine = createGlobeGeometry(original, d3);
const f = engine.query(level);
const count = (g) =>
  (g.type === "Polygon" ? [g.coordinates] : g.coordinates).reduce(
    (a, p) => a + p.reduce((b, r) => b + r.length, 0),
    0,
  );
console.log({
  level: f.level,
  vertices: f.vertices,
  source: f.sourceVertices,
  fallbackGroups: f.fallbackGroups,
  invalidGroups: f.invalidGroups,
  reasons: f.reasons,
});
original.features.forEach((o, i) => {
  const a = count(o.geometry),
    b = count(f.geojson.features[i].geometry);
  if (b === a) console.log("UNSIMPLIFIED", i, o.properties?.name, a);
});
