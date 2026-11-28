import test from "node:test";
import assert from "node:assert/strict";
import { buildBlgTree, selectBlgPositions } from "../dist/blg.js";
import {
  clipRing,
  clipRingReference,
  clipWindow,
  ringInfo,
} from "../dist/spherical-clip.js";
import { lonLatToVec } from "../dist/spherical-cull.js";
import { createBlgClipPrototype } from "../examples/globe/blg-clip-prototype.mjs";

const windowAt = (lon, lat, radius) =>
  clipWindow(...lonLatToVec(lon, lat), (radius * Math.PI) / 180);
const close = (points) => [...points, points[0]];
const square = (x, y, r) => [
  [x - r, y - r],
  [x - r, y + r],
  [x + r, y + r],
  [x + r, y - r],
];

function ellipse(lon, lat, rx, ry, count) {
  return Array.from({ length: count }, (_, i) => {
    const a = (-2 * Math.PI * i) / count;
    return [lon + rx * Math.cos(a), lat + ry * Math.sin(a)];
  });
}

function balancedTree(n) {
  const levels = new Array(n);
  const visit = (a, b, depth) => {
    if (a >= b) return;
    const mid = (a + b) >> 1;
    levels[mid] = depth;
    visit(a, mid, depth + 1);
    visit(mid + 1, b, depth + 1);
  };
  visit(0, n, 0);
  return buildBlgTree(levels);
}

test("streaming clip matches bitmap reference and classifies once", () => {
  const rings = [
    square(0, 0, 3),
    square(8, 0, 6),
    square(0, 0, 40),
    square(50, 0, 5),
    [
      [-40, 3],
      [-40, 40],
      [40, 40],
      [40, 3],
    ],
    [
      [8, -30],
      [8, 5],
      [14, 5],
      [14, -2],
      [10.2, -2],
      [10.2, -30],
    ],
    ellipse(179, 0, 25, 15, 500),
    ellipse(25, 0, 16, 12, 1000),
    ellipse(0, 75, 40, 10, 300),
    [
      [0, 0],
      [0, 0],
      [10, 0],
      [20, 20],
    ],
  ];
  for (const [lon, lat] of [
    [0, 0],
    [179, 0],
    [0, 80],
    [20, -10],
  ])
    for (const radius of [1, 10, 30, 60])
      for (const ring of rings)
        for (const side of [-1, 1]) {
          const info = ringInfo(close(side === 1 ? [...ring].reverse() : ring)),
            w = windowAt(lon, lat, radius),
            work = { classified: 0, inside: 0, outside: 0 };
          assert.deepEqual(
            clipRing(w, info, side, work),
            clipRingReference(w, info, side),
          );
          assert.equal(work.classified, info.n);
          assert.equal(work.inside + work.outside, info.n);
        }
});

test("fused BLG prototype prunes exterior spans with exact clipped parity", () => {
  const coordinates = ellipse(25, 0, 23, 8, 4096),
    tree = balancedTree(coordinates.length),
    query = createBlgClipPrototype(tree, coordinates);
  let pruned = false;
  for (const level of [5, 7.4, 9, Infinity])
    for (const reverse of [false, true])
      for (const [lon, lat, radius] of [
        [0, 0, 10],
        [25, 0, 4],
        [80, 0, 5],
        [20, 0, 50],
      ]) {
        const w = windowAt(lon, lat, radius),
          selected = selectBlgPositions(tree, level);
        if (reverse) selected.reverse();
        const side = reverse ? 1 : -1,
          expected = clipRingReference(
            w,
            ringInfo(close(selected.map((i) => coordinates[i]))),
            side,
          ),
          { result, stats } = query(w, level, side, { reverse });
        assert.deepEqual(result, expected);
        if (level === Infinity && lon === 0 && !stats.fallback) {
          assert.ok(stats.compactedVertices < coordinates.length / 2);
          assert.ok(
            stats.traversalVisits + stats.endpointVisits < coordinates.length,
          );
          pruned = true;
        }
        if (lon === 80 && stats.prunedSubtrees)
          assert.equal(stats.fallback, true);
      }
  assert.ok(pruned);
});

test("outside-to-outside crossings and enclosed windows preserve reference", () => {
  const w = windowAt(0, 0, 10);
  for (const coordinates of [
    square(0, 0, 40),
    [
      [-40, 3],
      [-40, 40],
      [40, 40],
      [40, 3],
    ],
  ]) {
    const tree = balancedTree(coordinates.length),
      query = createBlgClipPrototype(tree, coordinates);
    assert.deepEqual(
      query(w, Infinity).result,
      clipRingReference(w, ringInfo(close(coordinates))),
    );
  }
});
