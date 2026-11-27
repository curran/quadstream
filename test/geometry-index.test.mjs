import test from "node:test";
import assert from "node:assert/strict";
import {
  simpleClosedRing,
  simpleClosedRingReference,
  segmentsIntersect,
  validPolygon,
  pointInRing,
} from "../dist/index.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const closed = (pts) => [...pts, pts[0]];
// Star-shaped polygon: simple by construction.
function star(rand, n, cx = 0, cy = 0, r = 100) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2,
      rr = r * (0.4 + 0.6 * rand());
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return closed(pts);
}
const circle = (n, cx, cy, r, dir = 1) =>
  closed(
    Array.from({ length: n }, (_, i) => {
      const a = (dir * i * Math.PI * 2) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
// Reference validPolygon built only from the quadratic predicates.
function validPolygonReference(rings) {
  const hit = (a, b) => {
    for (let i = 0; i < a.length - 1; i++)
      for (let j = 0; j < b.length - 1; j++)
        if (segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true;
    return false;
  };
  if (!rings.length || rings.some((r) => !simpleClosedRingReference(r)))
    return false;
  for (let i = 1; i < rings.length; i++) {
    if (!pointInRing(rings[i][0], rings[0]) || hit(rings[0], rings[i]))
      return false;
    for (let j = 1; j < i; j++)
      if (
        hit(rings[j], rings[i]) ||
        pointInRing(rings[i][0], rings[j]) ||
        pointInRing(rings[j][0], rings[i])
      )
        return false;
  }
  return true;
}

test("segment AABB rejection keeps touching, collinear and crossing semantics", () => {
  assert.equal(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [1, 1], [1, 1], [2, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [2, 0], [1, 0], [3, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [1, 0], [2, 0], [3, 0]), false);
  assert.equal(segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 3]), false);
  assert.equal(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1]), false);
  assert.equal(segmentsIntersect([0, 0], [4, 0], [2, 0], [2, 5]), true);
  assert.equal(
    segmentsIntersect([0, 0], [1, 1], [NaN, 0], [1, 0]),
    false,
    "NaN is never rejected by the box test and never intersects",
  );
});

test("indexed simpleClosedRing matches the quadratic oracle on 600 random rings", () => {
  const rand = rng(7);
  let simple = 0,
    complex = 0;
  for (let t = 0; t < 600; t++) {
    const n = 3 + Math.floor(rand() * 90);
    let ring;
    if (t % 3 === 0) ring = star(rand, n);
    else if (t % 3 === 1) {
      // Random points on a small integer grid: many touches, collinear runs and repeats.
      ring = closed(
        Array.from({ length: n }, () => [
          Math.floor(rand() * 12),
          Math.floor(rand() * 12),
        ]),
      );
    } else {
      ring = star(rand, n);
      // Move one vertex far away to usually create a crossing.
      ring[Math.floor(rand() * n)] = [rand() * 300 - 150, rand() * 300 - 150];
      ring[n] = ring[0];
    }
    const expected = simpleClosedRingReference(ring);
    assert.equal(simpleClosedRing(ring), expected, `ring ${t} (n=${n})`);
    if (expected) simple++;
    else complex++;
  }
  assert.ok(simple > 100 && complex > 100, `${simple}/${complex} mix`);
});

test("indexed ring check rejects tails, touches, duplicates and unclosed rings of every size", () => {
  for (const n of [4, 23, 24, 25, 200]) {
    const base = circle(n, 0, 0, 50);
    assert.equal(simpleClosedRing(base), true, `circle ${n}`);
    const dup = [...base];
    dup.splice(2, 0, dup[2]);
    assert.equal(simpleClosedRing(dup), false, `duplicate vertex ${n}`);
    assert.equal(simpleClosedRing(base.slice(0, -1)), false, `unclosed ${n}`);
    // Bow-tie: swap two non-adjacent vertices.
    const bow = [...base];
    [bow[1], bow[Math.floor(n / 2)]] = [bow[Math.floor(n / 2)], bow[1]];
    assert.equal(
      simpleClosedRing(bow),
      simpleClosedRingReference(bow),
      `bow-tie ${n}`,
    );
    assert.equal(simpleClosedRing(bow), false, `bow-tie rejected ${n}`);
    // Vertex touching a non-adjacent edge.
    const touch = [...base];
    touch[Math.floor(n / 2)] = [
      (base[0][0] + base[1][0]) / 2,
      (base[0][1] + base[1][1]) / 2,
    ];
    assert.equal(
      simpleClosedRing(touch),
      simpleClosedRingReference(touch),
      `touch ${n}`,
    );
  }
  const zero = closed(Array.from({ length: 40 }, (_, i) => [i, 0]));
  assert.equal(simpleClosedRing(zero), false, "zero-area collinear ring");
});

test("non-finite coordinates fall back to the reference validator", () => {
  const ring = circle(40, 0, 0, 10);
  const bad = ring.map((p) => [...p]);
  bad[5] = [NaN, 1];
  assert.equal(simpleClosedRing(bad), simpleClosedRingReference(bad));
  bad[5] = [Infinity, 1];
  assert.equal(simpleClosedRing(bad), simpleClosedRingReference(bad));
});

test("indexed validPolygon matches the quadratic oracle with holes", () => {
  const rand = rng(99);
  let valid = 0,
    invalid = 0;
  for (let t = 0; t < 250; t++) {
    const shell = circle(30 + Math.floor(rand() * 60), 0, 0, 100);
    const rings = [shell];
    const holes = 1 + Math.floor(rand() * 4);
    for (let h = 0; h < holes; h++) {
      const r = 3 + rand() * 40,
        cx = (rand() - 0.5) * 160,
        cy = (rand() - 0.5) * 160;
      rings.push(circle(26 + Math.floor(rand() * 40), cx, cy, r, -1));
    }
    const expected = validPolygonReference(rings);
    assert.equal(validPolygon(rings), expected, `polygon ${t}`);
    if (expected) valid++;
    else invalid++;
  }
  assert.ok(valid > 20 && invalid > 20, `${valid}/${invalid} mix`);
});

test("hole sweeps handle disjoint, touching, crossing, nested and enclosing holes", () => {
  const shell = circle(60, 0, 0, 100);
  const hole = (cx, cy, r) => circle(32, cx, cy, r, -1);
  assert.equal(validPolygon([shell, hole(0, 0, 10)]), true);
  assert.equal(validPolygon([shell, hole(0, 0, 10), hole(40, 0, 10)]), true);
  assert.equal(validPolygon([shell, hole(0, 0, 10), hole(15, 0, 10)]), false);
  assert.equal(validPolygon([shell, hole(95, 0, 20)]), false);
  assert.equal(validPolygon([shell, hole(0, 0, 40), hole(0, 0, 10)]), false);
  assert.equal(validPolygon([shell, hole(0, 0, 150)]), false);
});

test("indexed validation scales: 100k-vertex ring completes quickly", () => {
  const rand = rng(1);
  // Wiggly coastline-like simple ring.
  const n = 100_000;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2,
      r = 1000 + 30 * Math.sin(a * 200) + 5 * rand();
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const ring = closed(pts);
  const t = performance.now();
  assert.equal(simpleClosedRing(ring), true);
  const ms = performance.now() - t;
  // The quadratic loop needs ~5e9 pair checks here; a generous bound only guards against regressions to it.
  assert.ok(ms < 10_000, `took ${ms.toFixed(0)}ms`);
});
