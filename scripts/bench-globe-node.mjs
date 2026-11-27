// Deterministic worker-side benchmark: init (build+validate) and cold queries.
// Usage: node scripts/bench-globe-node.mjs [110m|50m] [repeats]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  createGlobeGeometry,
  decodeCountries,
} from "../examples/globe/geometry.mjs";
const require = createRequire(import.meta.url);
const d3 = require("d3");
const topojson = require("topojson-client");
const atlas = process.argv[2] ?? "50m";
const repeats = Number(process.argv[3] ?? 3);
const source = JSON.parse(
  readFileSync(`node_modules/world-atlas/countries-${atlas}.json`, "utf8"),
);
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const out = { atlas, repeats, init: [], queries: {} };
for (let r = 0; r < repeats; r++) {
  const original = decodeCountries(source, topojson);
  const t = performance.now();
  const engine = createGlobeGeometry(original, d3);
  out.init.push(performance.now() - t);
  out.sourceVertices = engine.sourceVertices;
  for (const level of [2, 4, 6, 8, 10, 12.5]) {
    const q = performance.now();
    const f = engine.query(level);
    (out.queries[level] ??= []).push(performance.now() - q);
    out.vertices ??= {};
    out.vertices[level] = f.vertices;
  }
}
const round = (x) => Math.round(x * 10) / 10;
console.log(
  JSON.stringify({
    atlas,
    sourceVertices: out.sourceVertices,
    initMedianMs: round(median(out.init)),
    initAllMs: out.init.map(round),
    queryMedianMs: Object.fromEntries(
      Object.entries(out.queries).map(([k, v]) => [k, round(median(v))]),
    ),
    vertices: out.vertices,
  }),
);
