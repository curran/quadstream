import test from "node:test";
import assert from "node:assert/strict";
import { levelForScale, quantizeAutoLevel } from "../examples/globe/lod.mjs";

test("quantizeAutoLevel with interacting=true produces exact 0.2 multiples across [4.0, 19.0]", () => {
  for (let i = 40; i <= 190; i++) {
    const level = i / 10;
    const quantized = quantizeAutoLevel(level, true);
    const tenths = Math.round(quantized * 10);
    assert.equal(tenths % 2, 0, `${quantized} is not a 0.2 multiple`);
    assert.equal(String(quantized), quantized.toFixed(1).replace(/\.0$/, ""));
    assert.ok(quantized >= 4.0 && quantized <= 19.0);
  }
  assert.equal(quantizeAutoLevel(5.61, true), 5.6);
  assert.equal(String(quantizeAutoLevel(5.61, true)), "5.6");
  assert.equal(quantizeAutoLevel(5.69, true), 5.6);
  assert.equal(quantizeAutoLevel(5.71, true), 5.8);
});

test("quantizeAutoLevel with interacting=false produces exact 0.1 multiples", () => {
  for (let i = 40; i <= 190; i++) {
    const level = i / 10 + 0.03;
    const quantized = quantizeAutoLevel(level, false);
    assert.equal(quantized, Number((i / 10).toFixed(1)));
    assert.equal(String(quantized), quantized.toFixed(1).replace(/\.0$/, ""));
  }
  assert.equal(quantizeAutoLevel(5.64), 5.6);
  assert.equal(String(quantizeAutoLevel(5.64)), "5.6");
  assert.equal(quantizeAutoLevel(5.66, false), 5.7);
});

test("levelForScale + quantizeAutoLevel across zoom scales", () => {
  const scales = [120, 150, 240, 310, 480, 960, 2000, 10000];
  let autoLevel;
  for (const scale of scales) {
    const interactingLevel = quantizeAutoLevel(
      levelForScale(scale, autoLevel),
      true,
    );
    assert.equal(Math.round(interactingLevel * 10) % 2, 0);
    autoLevel = interactingLevel;

    const settledLevel = quantizeAutoLevel(
      levelForScale(scale, autoLevel),
      false,
    );
    assert.equal(
      settledLevel,
      Number((Math.round(settledLevel * 10) / 10).toFixed(1)),
    );
    assert.ok(settledLevel >= 4 && settledLevel <= 19);
    autoLevel = settledLevel;
  }
});
