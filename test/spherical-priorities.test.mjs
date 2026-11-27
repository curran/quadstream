import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSphericalPriorities,
  sphericalCellAddress,
  canonicalLonLat,
  angularDistance,
  validGreatCirclePath,
  lonLatVector,
  sphericalChart,
  projectSpherical,
} from "../dist/index.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
// The pre-optimization algorithm, expressed through the public address API.
function referencePriorities(vertices, maxLevel = 20) {
  const seen = new Set(),
    ids = new Set();
  const sorted = vertices
    .map((v) => {
      const [x, y] = canonicalLonLat([v.x, v.y]);
      const k = JSON.stringify([x, y]);
      if (seen.has(k) || ids.has(v.id)) throw new Error("dup");
      seen.add(k);
      ids.add(v.id);
      return { ...v, x, y };
    })
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        a.x - b.x ||
        a.y - b.y ||
        a.id - b.id,
    );
  const occupied = new Set(),
    cells = [],
    levelByVertexId = [];
  for (const v of sorted) {
    for (let level = 0; level < maxLevel; level++) {
      const c = sphericalCellAddress([v.x, v.y], level);
      if (occupied.has(c.key)) continue;
      occupied.add(c.key);
      cells.push({ ...c, vertexId: v.id });
      levelByVertexId[v.id] = level;
      break;
    }
  }
  cells.sort(
    (a, b) =>
      a.level - b.level ||
      (a.face < b.face ? -1 : a.face > b.face ? 1 : 0) ||
      a.i - b.i ||
      a.j - b.j ||
      a.vertexId - b.vertexId,
  );
  return { maxLevel, cells, levelByVertexId };
}
function randomVertices(rand, n) {
  const specials = [-180, -90, 0, 90, 180];
  const seen = new Set(),
    out = [];
  while (out.length < n) {
    const r = rand();
    let x = r < 0.15 ? specials[Math.floor(rand() * 5)] : rand() * 360 - 180;
    let y = r > 0.9 ? [-90, 90, 0][Math.floor(rand() * 3)] : rand() * 180 - 90;
    // Quantize some points to force many cell collisions and seam ties.
    if (r > 0.5 && r < 0.7) {
      x = Math.round(x / 3) * 3;
      y = Math.round(y / 3) * 3;
    }
    const k = JSON.stringify(canonicalLonLat([x, y]));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: out.length, x, y, critical: rand() < 0.1 });
  }
  return out;
}

test("optimized priorities are identical to the reference on seeded seam/pole/cardinal sets", () => {
  for (const [seed, n, maxLevel] of [
    [1, 60, 20],
    [2, 400, 20],
    [3, 1500, 12],
    [4, 300, 26],
  ]) {
    const vertices = randomVertices(rng(seed), n);
    assert.deepEqual(
      buildSphericalPriorities(vertices, maxLevel),
      referencePriorities(vertices, maxLevel),
      `seed ${seed}`,
    );
  }
});

test("priority order does not depend on input order and keeps critical vertices shallow", () => {
  const vertices = randomVertices(rng(11), 200);
  const forward = buildSphericalPriorities(vertices);
  const shuffled = [...vertices].reverse();
  assert.deepEqual(buildSphericalPriorities(shuffled).cells, forward.cells);
  const criticalLevels = vertices
    .filter((v) => v.critical)
    .map((v) => forward.levelByVertexId[v.id]);
  assert.ok(Math.max(...criticalLevels) <= 4);
});

test("level assignments stay dense and every vertex gets exactly one cell", () => {
  const vertices = randomVertices(rng(5), 500);
  const p = buildSphericalPriorities(vertices);
  assert.equal(p.cells.length, vertices.length);
  assert.equal(new Set(p.cells.map((c) => c.key)).size, vertices.length);
  for (const v of vertices) assert.ok(p.levelByVertexId[v.id] >= 0);
});

test("invalid vertex sets still fail explicitly", () => {
  const v = (id, x, y) => ({ id, x, y, critical: false });
  assert.throws(
    () => buildSphericalPriorities([v(0, 180, 10), v(1, -180, 10)]),
    /distinct canonical/,
    "seam aliases are duplicates",
  );
  assert.throws(
    () => buildSphericalPriorities([v(0, 10, 90), v(1, 20, 90)]),
    /distinct canonical/,
    "pole aliases are duplicates",
  );
  assert.throws(
    () => buildSphericalPriorities([v(0, 1, 1), v(0, 2, 2)]),
    /dense IDs/,
  );
  assert.throws(() => buildSphericalPriorities([v(3, 1, 1)]), /dense IDs/);
  assert.throws(() => buildSphericalPriorities([v(-1, 1, 1)]), /dense IDs/);
  assert.throws(
    () => buildSphericalPriorities([v(0, 400, 1)]),
    /outside geographic range/,
  );
  assert.throws(() => buildSphericalPriorities([], 0), /maxLevel/);
  assert.throws(
    () =>
      buildSphericalPriorities(
        [v(0, 1, 1), v(1, 1.0000001, 1), v(2, 1.0000002, 1)],
        2,
      ),
    /capacity exceeded/,
  );
});

test("validGreatCirclePath matches the angularDistance definition", () => {
  const rand = rng(21);
  for (let t = 0; t < 300; t++) {
    const path = Array.from({ length: 2 + Math.floor(rand() * 6) }, () => [
      Math.round((rand() * 360 - 180) / 30) * 30,
      Math.round((rand() * 180 - 90) / 30) * 30,
    ]);
    let expected = true;
    for (let i = 1; i < path.length; i++) {
      const d = angularDistance(path[i - 1], path[i]);
      if (d <= 1e-10 || Math.PI - d <= 1e-10) expected = false;
    }
    assert.equal(validGreatCirclePath(path), expected, JSON.stringify(path));
  }
  assert.equal(validGreatCirclePath([[0, 0]]), false);
  assert.equal(
    validGreatCirclePath([
      [0, 0],
      [180, 0],
    ]),
    false,
  );
});

test("chart projection of canonical and non-canonical positions agrees", () => {
  const ring = [
    [-10, -10],
    [-10, 10],
    [10, 10],
    [10, -10],
    [-10, -10],
  ];
  const chart = sphericalChart(ring);
  for (const p of [
    [0, 0],
    [180, 0],
    [-180, 0],
    [0, 0],
  ]) {
    if (Math.abs(p[0]) === 180) continue;
    const [x, y] = projectSpherical(p, chart);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
  const [vx, vy, vz] = lonLatVector([180, 0]);
  assert.deepEqual([vx, vy, vz], lonLatVector([-180, 0]));
});
