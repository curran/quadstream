import test from "node:test";
import assert from "node:assert/strict";
import { geoOrthographic } from "d3";
import { anchorRotation, globeAnchor } from "../examples/globe/north-up.mjs";

const make = (rotation, scale = 400) => ({
  rotation,
  scale,
  translation: [450, 350],
});
const project = (v) =>
  geoOrthographic().rotate(v.rotation).scale(v.scale).translate(v.translation);
const error = (v, point, target) => {
  const p = project(v)(point);
  return Math.hypot(p[0] - target[0], p[1] - target[1]);
};

test("inverse agrees with D3 across orientations, scales and seam crossings", () => {
  for (const rotation of [[0, -20, 0], [179, 70, 0], [-540, -85, 0]]) {
    for (const scale of [100, 400, 10000]) {
      const view = make(rotation, scale);
      for (const [u, v] of [[0, 0], [0.6, -0.3], [-0.7, 0.5]]) {
        const xy = [450 + u * scale, 350 + v * scale];
        const point = globeAnchor(view, ...xy).map((a) => a * 180 / Math.PI);
        assert.ok(error(view, point, xy) < 1e-8);
      }
    }
  }
});

test("reachable targets remain subpixel across zoom, seams and high latitudes", () => {
  for (const rotation of [[0, 0, 0], [179, -20, 0], [-540, 70, 0], [70, -80, 0]]) {
    for (const scale of [100, 400, 10000]) {
      const view = make(rotation, scale);
      const point = project(view).invert([450 + scale * 0.12, 350 + scale * 0.1]);
      const anchor = point.map((a) => a * Math.PI / 180);
      const wanted = make([rotation[0] + 3, rotation[1] + 2, 0], scale * 1.4);
      const xy = project(wanted)(point);
      const result = anchorRotation(view, anchor, ...xy, wanted.scale);
      assert.equal(result[2], 0);
      assert.ok(Math.abs(result[0] - rotation[0]) < 180);
      assert.ok(error({ ...wanted, rotation: result }, point, xy) < 0.001);
    }
  }
});

test("unreachable and outside-limb targets remain finite, visible and north-up", () => {
  const view = make([0, -75, 0]);
  const point = [0, 85];
  const anchor = point.map((a) => a * Math.PI / 180);
  for (const xy of [[850, 350], [1000, 200], [450, 900]]) {
    const rotation = anchorRotation(view, anchor, ...xy);
    assert.ok(rotation.every(Number.isFinite));
    assert.equal(rotation[2], 0);
    assert.ok(Math.abs(rotation[1]) <= 90);
    const [l, p] = rotation.map((a) => a * Math.PI / 180);
    const depth = Math.cos(anchor[1]) * Math.cos(anchor[0] + l) * Math.cos(p)
      - Math.sin(anchor[1]) * Math.sin(p);
    assert.ok(depth >= -1e-12);
    assert.ok(error({ ...view, rotation }, point, xy) <= error(view, point, xy) + 1e-8);
  }
  assert.equal(globeAnchor(view, 1000, 350), null);
});
