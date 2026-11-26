import test from "node:test";
import assert from "node:assert/strict";
import {
  createGlobeInteraction,
  attachGlobeInteraction,
  resizedView,
} from "../examples/globe/interaction.mjs";
import { levelForScale, createLatestGeometry } from "../examples/globe/lod.mjs";
import { GlobeWorkerClient } from "../examples/globe/client.mjs";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);
function harness() {
  const state = {
      width: 600,
      height: 600,
      initialScale: 280,
      scale: 280,
      rotation: [0, -20, 0],
    },
    active = [];
  let timerId = 0;
  const timers = new Map();
  const g = createGlobeInteraction({
    getState: () => state,
    update: (p) => Object.assign(state, p),
    onActive: (v) => active.push(v),
    setTimer: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    state,
    g,
    active,
    timers,
    flush() {
      for (const [id, f] of timers) {
        timers.delete(id);
        f();
      }
    },
  };
}
test("single pointer rotates with original scale-dependent sensitivity", () => {
  const { g, state, active } = harness();
  g.down(1, 10, 20);
  g.move(1, 110, 70);
  close(state.rotation[0], (100 * 58) / 280);
  close(state.rotation[1], -20 - (50 * 58) / 280);
  assert.equal(state.scale, 280);
  g.up(1);
  assert.deepEqual(active, [true, false]);
  g.move(1, 200, 200);
  assert.equal(g.pointerCount, 0);
});
test("consecutive pinch-out and pinch-in use fresh on-screen scale", () => {
  const { g, state } = harness();
  g.down(1, 0, 0);
  g.down(2, 100, 0);
  g.move(2, 200, 0);
  close(state.scale, 560);
  g.up(1);
  g.up(2);
  g.down(3, 0, 0);
  g.down(4, 100, 0);
  g.move(4, 150, 0);
  close(state.scale, 840);
  // The entire second gesture is relative to its initial scale (560)
  // and distance (100), not the preceding move's scale (840).
  g.move(4, 50, 0);
  close(state.scale, 280);
  g.move(4, 100, 0);
  close(state.scale, 560);
  g.move(4, 75, 0);
  close(state.scale, 420);
  g.up(3);
  g.up(4);
  // A third gesture must now start from the last committed scale.
  g.down(5, 0, 0);
  g.down(6, 100, 0);
  g.move(6, 200, 0);
  close(state.scale, 840);
  g.up(5);
  g.up(6);
});
test("one-two-one transition preserves rotation and does not jump", () => {
  const { g, state } = harness();
  g.down(1, 10, 10);
  g.move(1, 30, 10);
  const r = state.rotation.slice();
  g.down(2, 130, 10);
  g.move(2, 230, 10);
  assert.deepEqual(state.rotation, r);
  close(state.scale, 560);
  g.up(2);
  g.move(1, 30, 10);
  assert.deepEqual(state.rotation, r);
  g.move(1, 40, 10);
  close(state.rotation[0], r[0] + (10 * 58) / 560);
});
test("third pointer pauses and remaining pair rebases", () => {
  const { g, state } = harness();
  g.down(1, 0, 0);
  g.down(2, 100, 0);
  g.move(2, 200, 0);
  close(state.scale, 560);
  g.down(3, 300, 0);
  g.move(2, 250, 0);
  close(state.scale, 560);
  g.up(1);
  g.move(3, 300, 0);
  close(state.scale, 560);
  g.move(3, 350, 0);
  close(state.scale, 1120);
});
test("coincident pointers establish first nonzero pinch baseline", () => {
  const { g, state } = harness();
  g.down(1, 0, 0);
  g.down(2, 0, 0);
  g.move(2, 10, 0);
  close(state.scale, 280);
  g.move(2, 20, 0);
  close(state.scale, 560);
  assert.ok(Number.isFinite(state.scale));
});
test("pinch and wheel respect both original zoom bounds", () => {
  const { g, state } = harness();
  g.down(1, 0, 0);
  g.down(2, 100, 0);
  g.move(2, 10000, 0);
  close(state.scale, 2240);
  g.move(2, 1, 0);
  close(state.scale, 168);
  g.up(1);
  g.up(2);
  g.wheel(-1e6);
  close(state.scale, 2240);
  g.wheel(1e6);
  close(state.scale, 168);
});
test("wheel is exponential, cancels earlier timers and does not end active drag", () => {
  const h = harness(),
    { g, state, active, timers } = h;
  g.wheel(-100);
  close(state.scale, 280 * Math.exp(0.15));
  g.wheel(100);
  close(state.scale, 280);
  assert.equal(timers.size, 1);
  g.down(1, 0, 0);
  h.flush();
  assert.deepEqual(active, [true]);
  g.up(1);
  assert.deepEqual(active, [true, false]);
  g.dispose();
  assert.equal(timers.size, 0);
});
test("resize preserves relative zoom and refreshes gesture sensitivity and pinch baseline", () => {
  const { g, state } = harness();
  g.down(1, 0, 0);
  g.down(2, 100, 0);
  g.move(2, 200, 0);
  Object.assign(state, resizedView(state, 300, 500));
  g.rebase();
  close(state.scale, 260);
  assert.deepEqual(state.translation, [150, 250]);
  g.move(2, 200, 0);
  close(state.scale, 260);
  g.move(2, 300, 0);
  close(state.scale, 390);
  g.up(2);
  g.move(1, 10, 0);
  close(state.rotation[0], (10 * 29) / 390);
});
test("listener binding handles cancel, lost capture and cleanup", () => {
  const { g, state } = harness();
  class Canvas extends EventTarget {
    style = {};
    clientHeight = 600;
    ids = new Set();
    setPointerCapture(i) {
      this.ids.add(i);
    }
    hasPointerCapture(i) {
      return this.ids.has(i);
    }
    releasePointerCapture(i) {
      this.ids.delete(i);
    }
  }
  const canvas = new Canvas();
  const detach = attachGlobeInteraction(canvas, g);
  const fire = (type, p = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), p);
    canvas.dispatchEvent(e);
    return e;
  };
  fire("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
  });
  fire("pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 100,
    clientY: 0,
  });
  fire("pointercancel", { pointerId: 2 });
  fire("pointermove", { pointerId: 1, clientX: 10, clientY: 0 });
  assert.ok(state.rotation[0] > 0);
  fire("lostpointercapture", { pointerId: 1 });
  assert.equal(g.pointerCount, 0);
  assert.equal(canvas.style.cursor, "grab");
  assert.equal(fire("gesturestart").defaultPrevented, true);
  assert.equal(
    fire("wheel", { deltaY: 0, deltaMode: 0 }).defaultPrevented,
    true,
  );
  detach();
  fire("pointerdown", {
    pointerId: 3,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
  });
  assert.equal(g.pointerCount, 0);
  assert.equal(canvas.ids.size, 0);
});
test("LOD clamps, follows absolute scale and uses hysteresis in both directions", () => {
  assert.equal(levelForScale(1), 4);
  assert.equal(levelForScale(1e12), 19);
  assert.equal(levelForScale(240), 5);
  assert.equal(levelForScale(241, 4), 4);
  assert.equal(levelForScale(270, 4), 5.169925001442312);
  assert.equal(levelForScale(235, 5), 5);
  assert.equal(levelForScale(210, 5), 4.807354922057604);
  // Fractional boundary crossing must not snap backward to Math.floor(previous).
  assert.ok(levelForScale(120 * Math.pow(2, 3.05), 6.8) >= 6.8);
  assert.ok(levelForScale(120 * Math.pow(2, 1.9), 6.2) >= 5.9);
  assert.throws(() => levelForScale(0));
});
test("createLatestGeometry drops out-of-order seq frames even if generation matches", async () => {
  const frames = [];
  let seq = 0;
  const c = createLatestGeometry({
    request: async (l) => ({ level: l, seq: l === 5 ? 10 : 5 }),
    onFrame: (f) => frames.push(f),
  });
  await c.select(5);
  await c.select(4);
  assert.deepEqual(
    frames.map((f) => f.level),
    [5],
  );
  void seq;
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
};
test("latest geometry suppresses stale response and reuses cached levels", async () => {
  const requests = [],
    frames = [],
    pending = new Map();
  const c = createLatestGeometry({
    request: (l) => {
      requests.push(l);
      const p = deferred();
      pending.set(l, p);
      return p.promise;
    },
    onFrame: (f) => frames.push(f),
  });
  const a = c.select(4),
    b = c.select(5);
  pending.get(5).resolve(5);
  await b;
  pending.get(4).resolve(4);
  await a;
  assert.deepEqual(frames, [5]);
  const x = c.select(4);
  pending.get(4).resolve(4);
  await x;
  await c.select(5);
  assert.deepEqual(frames, [5, 4, 5]);
  assert.deepEqual(requests, [4, 5, 4]);
});
test("geometry errors can retry, stale failures and disposed responses are ignored", async () => {
  const errors = [],
    frames = [],
    pending = [];
  const c = createLatestGeometry({
    request: () => {
      const p = deferred();
      pending.push(p);
      return p.promise;
    },
    onFrame: (f) => frames.push(f),
    onError: (e) => errors.push(e.message),
  });
  const a = c.select(4),
    b = c.select(5);
  pending[0].reject(new Error("stale"));
  await a;
  pending[1].reject(new Error("current"));
  await b;
  assert.deepEqual(errors, ["current"]);
  const next = c.select(5);
  pending[2].resolve(5);
  await next;
  assert.deepEqual(frames, [5]);
  const last = c.select(6);
  c.dispose();
  pending[3].resolve(6);
  await last;
  assert.deepEqual(frames, [5]);
});
test("worker bridge matches IDs, rejects failures and terminates pending requests", async () => {
  class Worker extends EventTarget {
    sent = [];
    postMessage(x) {
      this.sent.push(x);
    }
    terminate() {
      this.terminated = true;
    }
    reply(data) {
      this.dispatchEvent(Object.assign(new Event("message"), { data }));
    }
  }
  const w = new Worker(),
    c = new GlobeWorkerClient(w);
  const a = c.query(4),
    b = c.query(5);
  w.reply({ id: w.sent[1].id, frame: { level: 5 } });
  assert.equal((await b).level, 5);
  w.reply({ id: w.sent[0].id, error: "bad" });
  await assert.rejects(a, /bad/);
  const p = c.query(6);
  c.dispose();
  await assert.rejects(p, /Cancelled/);
  assert.equal(w.terminated, true);
  await assert.rejects(c.query(7), /closed/);
});

test("globe queries quantize levels to tenths for cache reuse", async () => {
  const { createGlobeGeometry } =
    await import("../examples/globe/geometry.mjs");
  const feature = {
    type: "Feature",
    id: "a",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  };
  const engine = createGlobeGeometry(
    { type: "FeatureCollection", features: [feature] },
    globalThis.d3,
  );
  const a = engine.query(7.3);
  const b = engine.query(7.300000000001);
  assert.equal(b.cached, true);
  assert.equal(b.level, 7.3);
  assert.equal(a.vertices, b.vertices);
});
