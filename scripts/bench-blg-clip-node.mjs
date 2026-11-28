// Build first: npm run build && node scripts/bench-blg-clip-node.mjs
import { buildBlgTree, selectBlgPositions } from "../dist/blg.js";
import {
  clipWindow,
  clipRingReference,
  ringInfo,
} from "../examples/globe/clip.mjs";
import { createBlgClipPrototype } from "../examples/globe/blg-clip-prototype.mjs";
import { lonLatToVec } from "../examples/globe/cull.mjs";
import assert from "node:assert/strict";

const count = 32768,
  levels = new Array(count);
function assign(a, b, d) {
  if (a >= b) return;
  const m = (a + b) >> 1;
  levels[m] = d;
  assign(a, m, d + 1);
  assign(m + 1, b, d + 1);
}
assign(0, count, 0);
const coordinates = Array.from({ length: count }, (_, i) => {
  const a = (-2 * Math.PI * i) / count;
  return [25 + 23 * Math.cos(a), 8 * Math.sin(a)];
});
const tree = buildBlgTree(levels),
  t0 = performance.now(),
  query = createBlgClipPrototype(tree, coordinates),
  buildMs = performance.now() - t0;
const rows = [];
const percentile = (a, p) =>
  [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
for (const [lon, radius] of [
  [0, 10],
  [25, 4],
  [25, 55],
  [80, 5],
]) {
  const w = clipWindow(...lonLatToVec(lon, 0), (radius * Math.PI) / 180);
  const baseline = [],
    fused = [];
  let stats;
  for (let i = 0; i < 15; i++) {
    let t = performance.now();
    const points = selectBlgPositions(tree, Infinity).map(
      (j) => coordinates[j],
    );
    const expected = clipRingReference(w, ringInfo([...points, points[0]]));
    baseline.push(performance.now() - t);
    t = performance.now();
    const out = query(w, Infinity);
    fused.push(performance.now() - t);
    assert.deepEqual(out.result, expected);
    stats = out.stats;
  }
  rows.push({
    lon,
    radius,
    baselineP50: percentile(baseline, 0.5),
    baselineP95: percentile(baseline, 0.95),
    fusedP50: percentile(fused, 0.5),
    fusedP95: percentile(fused, 0.95),
    stats,
  });
}
console.log(JSON.stringify({ count, buildMs, rows }, null, 2));
