import assert from "node:assert/strict";
import test from "node:test";
import { pairPieces, pairPiecesReference } from "../examples/globe/clip.mjs";

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("sorted pairing equals the O(c^2) reference on random pieces", () => {
  const rand = rng(7);
  for (let trial = 0; trial < 400; trial++) {
    const c = 12 + Math.floor(rand() * 60);
    const pieces = Array.from({ length: c }, () => ({
      from: (rand() - 0.2) * TAU * 1.4,
      to: (rand() - 0.2) * TAU * 1.4,
    }));
    for (const side of [-1, 1])
      assert.deepEqual(
        pairPieces(pieces, side),
        pairPiecesReference(pieces, side),
        `trial ${trial} side ${side}`,
      );
  }
});

test("sorted pairing keeps ties, wraparound and epsilon clusters", () => {
  const rand = rng(11);
  for (let trial = 0; trial < 300; trial++) {
    const c = 12 + Math.floor(rand() * 20);
    const base = Array.from({ length: 4 }, () => rand() * TAU);
    const jitter = [0, 0, 1e-12, -1e-12, 1e-9, -1e-9, 3e-9, TAU, -TAU];
    const pick = () =>
      base[Math.floor(rand() * 4)] + jitter[Math.floor(rand() * jitter.length)];
    const pieces = Array.from({ length: c }, () => ({
      from: pick(),
      to: pick(),
    }));
    for (const side of [-1, 1])
      assert.deepEqual(
        pairPieces(pieces, side),
        pairPiecesReference(pieces, side),
        `trial ${trial} side ${side}`,
      );
  }
});

test("small piece lists use the reference directly", () => {
  const pieces = [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 1 },
  ];
  assert.deepEqual(pairPieces(pieces, -1), pairPiecesReference(pieces, -1));
});
