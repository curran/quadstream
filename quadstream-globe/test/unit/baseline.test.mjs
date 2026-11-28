import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraTrace, summarizeSamples } from "../support/baseline.mjs";

test("camera trace has stable unique identifiers and finite views", () => {
  assert.equal(
    new Set(cameraTrace.map(({ id }) => id)).size,
    cameraTrace.length,
  );
  for (const { rotation, zoom } of cameraTrace) {
    assert.equal(rotation.length, 3);
    assert.ok(rotation.every(Number.isFinite));
    assert.ok(Number.isFinite(zoom) && zoom > 0);
  }
});

test("summary is deterministic and does not mutate samples", () => {
  const input = [4, 0, 1, 3, 2];
  assert.deepEqual(summarizeSamples(input), { count: 5, median: 2, p95: 4 });
  assert.deepEqual(input, [4, 0, 1, 3, 2]);
  assert.deepEqual(summarizeSamples([3, 1]), { count: 2, median: 2, p95: 3 });
  assert.deepEqual(summarizeSamples([0]), { count: 1, median: 0, p95: 0 });
  assert.equal(
    summarizeSamples(Array.from({ length: 20 }, (_, i) => i + 1)).p95,
    19,
  );
});

test("invalid samples are rejected", () => {
  for (const samples of [[], [-1], [NaN], [Infinity]]) {
    assert.throws(() => summarizeSamples(samples), RangeError);
  }
});
