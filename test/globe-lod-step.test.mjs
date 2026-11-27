import test from "node:test";
import assert from "node:assert/strict";
import { levelForScale, quantizeAutoLevel } from "../examples/globe/lod.mjs";

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
    assert.ok(level >= 4 && level <= 19);
    autoLevel = level;
  }
});
