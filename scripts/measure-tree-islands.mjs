// Before/after of the tree-native island rule on the engine: restore (all
// polygons) versus drop (hidden polygons never reconstructed).
// Usage: node scripts/measure-tree-islands.mjs [110m|50m]
import { readFileSync } from "node:fs";
import * as topojson from "topojson-client";
import { buildSphericalQuadstream } from "../dist/index.js";
import { decodeCountries } from "../examples/globe/geometry.mjs";

const atlas = process.argv[2] ?? "50m";
const original = decodeCountries(
  JSON.parse(
    readFileSync(`node_modules/world-atlas/countries-${atlas}.json`, "utf8"),
  ),
  topojson,
);
const buildable = original.features
  .map((f, i) => ({ ...f, id: String(i) }))
  .filter((f) => {
    try {
      buildSphericalQuadstream({ type: "FeatureCollection", features: [f] });
      return true;
    } catch {
      return false;
    }
  });
const engine = buildSphericalQuadstream({
  type: "FeatureCollection",
  features: buildable,
});
const polys = (fc) =>
  fc.features.reduce(
    (n, f) =>
      n +
      (f.geometry.type === "Polygon"
        ? f.geometry.coordinates.length
          ? 1
          : 0
        : f.geometry.coordinates.length),
    0,
  );
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const time = (opts) =>
  median(
    Array.from({ length: 5 }, () => {
      const t = performance.now();
      engine.query(opts);
      return performance.now() - t;
    }),
  );
console.log(
  "level | polys restore->drop | vertices restore->drop | ms restore->drop | hiddenRings | promotedArcs",
);
for (const level of [4, 5, 6, 7, 8]) {
  const a = engine.query({ level }),
    b = engine.query({ level, collapsedRingPolicy: "drop" });
  console.log(
    `${level} | ${polys(a.geojson)} -> ${polys(b.geojson)} | ${a.selectedVertices} -> ${b.selectedVertices} | ${time({ level }).toFixed(1)} -> ${time({ level, collapsedRingPolicy: "drop" }).toFixed(1)} | ${b.hiddenRings} | ${a.promotedArcs} -> ${b.promotedArcs}`,
  );
}
