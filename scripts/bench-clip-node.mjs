// Clip benchmark on the real atlas: cold (build ring info) and warm (cached info) per view.
// Usage: node scripts/bench-clip-node.mjs [110m|50m] [repeats]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { decodeCountries } from "../examples/globe/geometry.mjs";
import {
  clipWindow,
  buildFeatureInfo,
  clipFeatureCollection,
} from "../examples/globe/clip.mjs";
import { featureCap } from "../examples/globe/cull.mjs";
import { lonLatToVec } from "../examples/globe/cull.mjs";
const require = createRequire(import.meta.url);
const topojson = require("topojson-client");
const atlas = process.argv[2] ?? "50m",
  repeats = Number(process.argv[3] ?? 7);
const source = decodeCountries(
  JSON.parse(
    readFileSync(`node_modules/world-atlas/countries-${atlas}.json`, "utf8"),
  ),
  topojson,
);
// A new LOD frame: fresh coordinate arrays, shared feature properties.
const freshFrame = () => ({
  type: "FeatureCollection",
  features: source.features.map((f) => ({
    ...f,
    geometry: JSON.parse(JSON.stringify(f.geometry)),
  })),
});
const useSource = process.argv.includes("--source");
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const views = [
  ["wide 60deg Atlantic", -30, 20, 60],
  ["mid 30deg Europe", 10, 50, 30],
  ["close 10deg Alps", 8, 46, 10],
  ["close 6deg Indonesia", 115, -2, 6],
  ["polar 25deg Arctic", 60, 80, 25],
  ["antimeridian 20deg", 179, 0, 20],
];
const rows = [];
for (const [name, lon, lat, deg] of views) {
  const [x, y, z] = lonLatToVec(lon, lat);
  const w = clipWindow(x, y, z, (deg * Math.PI) / 180);
  const cold = [],
    warm = [];
  let stats;
  for (let r = 0; r < repeats; r++) {
    const geojson = freshFrame(),
      infos = [];
    const get = (i, f) =>
      (infos[i] ??= useSource
        ? buildFeatureInfo(f, featureCap(f, i, source))
        : buildFeatureInfo(f));
    let t = performance.now();
    clipFeatureCollection(geojson, w, get);
    cold.push(performance.now() - t);
    t = performance.now();
    stats = clipFeatureCollection(geojson, w, get).stats;
    warm.push(performance.now() - t);
  }
  rows.push({
    view: name,
    coldMs: +med(cold).toFixed(2),
    warmMs: +med(warm).toFixed(2),
    outVertices: stats.vertices,
    rings: stats.rings,
  });
}
console.log(JSON.stringify({ atlas, rows }, null, 1));
