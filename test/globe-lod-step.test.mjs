import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_AUTO_LEVEL,
  MAX_LEVEL,
  levelForScale,
  levelForZoom,
  levelScale,
  scaleLevel,
  quantizeAutoLevel,
} from "../examples/globe/lod.mjs";

test("quantizeAutoLevel produces exact 0.1 multiples", () => {
  for (let i = 40; i <= 190; i++) {
    const level = i / 10 + 0.03;
    const quantized = quantizeAutoLevel(level);
    assert.equal(quantized, Number((i / 10).toFixed(1)));
    assert.equal(String(quantized), quantized.toFixed(1).replace(/\.0$/, ""));
  }
  assert.equal(quantizeAutoLevel(5.64), 5.6);
  assert.equal(quantizeAutoLevel(5.66), 5.7);
});

test("levelForScale + quantizeAutoLevel across zoom scales", () => {
  const scales = [120, 150, 240, 310, 480, 960, 2000, 10000];
  let autoLevel;
  for (const scale of scales) {
    const level = quantizeAutoLevel(levelForScale(scale, autoLevel));
    assert.equal(level, Number((Math.round(level * 10) / 10).toFixed(1)));
    assert.ok(level >= MIN_AUTO_LEVEL && level <= MAX_LEVEL);
    autoLevel = level;
  }
});

test("rendered LOD clamps zoom and slider settings without shifting the zoom curve", () => {
  assert.equal(MIN_AUTO_LEVEL, 4.2);
  for (const base of [0, 4, 4.1, 4.2, 19])
    assert.equal(levelForZoom(base, 2 ** -30), MIN_AUTO_LEVEL);
  assert.equal(levelForZoom(4, 0.6), MIN_AUTO_LEVEL);
  assert.equal(levelForZoom(4, 1), MIN_AUTO_LEVEL);
  assert.equal(levelForZoom(4, 2 ** 0.24), 4.2);
  assert.equal(levelForZoom(4, 2 ** 0.26), 4.3);
  assert.equal(levelForZoom(4, 2), 5);
  assert.equal(levelForZoom(4, 4), 6);
  assert.equal(levelForZoom(7.3, 1), 7.3);
  assert.equal(levelForZoom(19, 8), MAX_LEVEL);
  assert.throws(() => levelForZoom(4, 0));
  assert.throws(() => levelForZoom(4, NaN));
  assert.throws(() => levelForZoom(Infinity, 1));
  assert.equal(levelScale(5), 240);
  assert.equal(scaleLevel(240), 5);
});

test("zooming in and out yields nested quantized targets bounded by the floor", () => {
  const levels = Array.from({ length: 101 }, (_, i) =>
    levelForZoom(4, 2 ** ((i - 30) / 20)),
  );
  assert.equal(levels[0], MIN_AUTO_LEVEL);
  assert.ok(levels.at(-1) > MIN_AUTO_LEVEL);
  for (let i = 1; i < levels.length; i++)
    assert.ok(levels[i] >= levels[i - 1]);
  assert.deepEqual(
    Array.from({ length: 101 }, (_, i) =>
      levelForZoom(4, 2 ** ((70 - i) / 20)),
    ),
    [...levels].reverse(),
  );
});
