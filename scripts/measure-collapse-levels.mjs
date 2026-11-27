// Spike: when does a polygon appear under the tree-native rule (3 distinct
// quadtree-activated ring vertices), and how big is it when it does?
// Usage: node scripts/measure-collapse-levels.mjs [110m|50m]
import { readFileSync } from "node:fs";
import * as topojson from "topojson-client";
import { buildSphericalQuadstream } from "../dist/index.js";
import { decodeCountries } from "../examples/globe/geometry.mjs";
import { levelScale } from "../examples/globe/lod.mjs";

const atlas = process.argv[2] ?? "50m";
const original = decodeCountries(
  JSON.parse(
    readFileSync(`node_modules/world-atlas/countries-${atlas}.json`, "utf8"),
  ),
  topojson,
);
const options = { maxLevel: 20 };
const buildable = original.features
  .map((f, i) => ({ ...f, id: String(i) }))
  .filter((f) => {
    try {
      buildSphericalQuadstream(
        { type: "FeatureCollection", features: [f] },
        options,
      );
      return true;
    } catch {
      return false;
    }
  });
const engine = buildSphericalQuadstream(
  { type: "FeatureCollection", features: buildable },
  options,
);
const vec = ([lon, lat]) => {
  const l = (lon * Math.PI) / 180,
    p = (lat * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};
// Bounding-cap diameter (radians) and bounding-box aspect ratio of a shell.
function shape(ring) {
  const vs = ring.slice(0, -1).map(vec),
    c = vs.reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0]),
    n = Math.hypot(...c) || 1,
    u = c.map((x) => x / n);
  const d =
    2 *
    Math.max(
      ...vs.map((v) =>
        Math.acos(Math.min(1, v[0] * u[0] + v[1] * u[1] + v[2] * u[2])),
      ),
    );
  const lons = ring.map((p) => p[0]),
    lats = ring.map((p) => p[1]);
  const w =
      (Math.max(...lons) - Math.min(...lons)) *
        Math.cos((lats[0] * Math.PI) / 180) || 1e-9,
    h = Math.max(...lats) - Math.min(...lats) || 1e-9;
  return { d, aspect: Math.max(w / h, h / w), vertices: ring.length - 1 };
}
const rows = [];
buildable.forEach((f, i) => {
  const g = f.geometry,
    polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates,
    topo = engine.topology.features[i];
  polys.forEach((poly, j) => {
    const act = engine.ringActivation[i][topo.groups[j][0]];
    rows.push({ act, ...shape(poly[0]), name: f.properties?.name });
  });
});
console.log(`${atlas}: ${rows.length} polygons`);
for (const L of [4, 5, 6, 7, 8])
  console.log(`L${L}: visible ${rows.filter((r) => r.act <= L).length}`);
const q = (xs, p) => xs[Math.floor(p * (xs.length - 1))];
const stats = (label, xs) => {
  xs = xs.sort((a, b) => a - b);
  console.log(
    `${label}: p10 ${q(xs, 0.1).toFixed(1)} p50 ${q(xs, 0.5).toFixed(1)} p90 ${q(xs, 0.9).toFixed(1)} max ${xs.at(-1).toFixed(1)}`,
  );
};
const appearing = rows.filter((r) => Number.isFinite(r.act));
stats(
  "diameter px at first appearance",
  appearing.map((r) => r.d * levelScale(r.act)),
);
stats(
  "area px^2 at first appearance (cap)",
  appearing.map((r) => Math.PI * ((r.d * levelScale(r.act)) / 2) ** 2),
);
stats(
  "aspect ratio",
  appearing.map((r) => r.aspect),
);
stats(
  "source vertices",
  appearing.map((r) => r.vertices),
);
for (const L of [4, 6]) {
  const hidden = rows.filter((r) => r.act > L).sort((a, b) => b.d - a.d);
  const top = hidden[0];
  console.log(
    `largest hidden at L${L}: ${((top.d * 180) / Math.PI).toFixed(2)} deg (${top.name}), ${(top.d * levelScale(L)).toFixed(1)} px`,
  );
}
