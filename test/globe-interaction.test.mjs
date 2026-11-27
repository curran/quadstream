import test from "node:test";
import assert from "node:assert/strict";
import { geoOrthographic } from "d3";
import {
  createGlobeInteraction,
  attachGlobeInteraction,
  createKeyboardControls,
  attachKeyboardControls,
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
const projection = (state) =>
  geoOrthographic()
    .rotate(state.rotation)
    .scale(state.scale)
    .translate(state.translation ?? [state.width / 2, state.height / 2]);
const anchored = (state, point, x, y) => {
  const p = projection(state)(point);
  assert.ok(Math.hypot(p[0] - x, p[1] - y) < 0.001);
  assert.equal(state.rotation[2], 0);
};
test("drag preserves the geographic point through diagonal movement", () => {
  const { g, state, active } = harness();
  const point = projection(state).invert([350, 340]);
  g.down(1, 350, 340);
  for (const [x, y] of [[370, 350], [410, 380], [330, 310], [350, 340]]) {
    g.move(1, x, y);
    anchored(state, point, x, y);
  }
  g.up(1);
  assert.deepEqual(active, [true, false]);
  g.move(1, 200, 200);
  assert.equal(g.pointerCount, 0);
});
test("pinch midpoint anchors and consecutive pinches use fresh scale", () => {
  const { g, state } = harness();
  const point = projection(state).invert([300, 300]);
  g.down(1, 250, 300);
  g.down(2, 350, 300);
  g.move(2, 450, 300);
  close(state.scale, 560);
  anchored(state, point, 350, 300);
  g.up(2);
  const next = projection(state).invert([250, 300]);
  g.move(1, 250, 300);
  anchored(state, next, 250, 300);
  g.move(1, 270, 320);
  anchored(state, next, 270, 320);
  g.up(1);
  g.down(3, 250, 300);
  g.down(4, 350, 300);
  g.move(4, 300, 300);
  close(state.scale, 280);
  g.up(3);
  g.up(4);
});
test("third pointer pauses and the remaining pair rebases", () => {
  const { g, state } = harness();
  g.down(1, 200, 300);
  g.down(2, 300, 300);
  g.down(3, 400, 300);
  g.move(2, 350, 300);
  close(state.scale, 280);
  g.up(1);
  g.move(3, 450, 300);
  close(state.scale, 560);
});
test("coincident pointers establish first nonzero pinch baseline", () => {
  const { g, state } = harness();
  g.down(1, 300, 300);
  g.down(2, 300, 300);
  g.move(2, 310, 300);
  close(state.scale, 280);
  g.move(2, 320, 300);
  close(state.scale, 560);
});
test("pinch and wheel retain zoom bounds", () => {
  const { g, state } = harness();
  g.down(1, 250, 300);
  g.down(2, 350, 300);
  g.move(2, 10000, 300);
  close(state.scale, 17920);
  g.move(2, 251, 300);
  close(state.scale, 168);
  g.up(1);
  g.up(2);
  g.wheel(-1e6, 300, 300);
  close(state.scale, 17920);
  g.wheel(1e6, 300, 300);
  close(state.scale, 168);
});
test("wheel anchors through reversal, cancels timers and rebases active drag", () => {
  const h = harness();
  const { g, state, active, timers } = h;
  const point = projection(state).invert([360, 320]);
  g.wheel(-100, 360, 320);
  close(state.scale, 280 * Math.exp(0.15));
  anchored(state, point, 360, 320);
  g.wheel(100, 360, 320);
  close(state.scale, 280);
  anchored(state, point, 360, 320);
  assert.equal(timers.size, 1);
  g.down(1, 360, 320);
  g.wheel(-100, 360, 320);
  g.move(1, 370, 330);
  anchored(state, point, 370, 330);
  h.flush();
  assert.deepEqual(active, [true]);
  g.up(1);
  assert.deepEqual(active, [true, false]);
  g.dispose();
  assert.equal(timers.size, 0);
});
test("resize preserves relative zoom and rebases the pointer anchor", () => {
  const { g, state } = harness();
  g.down(1, 300, 300);
  Object.assign(state, resizedView(state, 500, 500));
  g.rebase();
  const point = projection(state).invert([300, 300]);
  g.move(1, 310, 310);
  anchored(state, point, 310, 310);
  close(state.scale, 230);
});
test("outside-globe input does not invent an anchor", () => {
  const { g, state } = harness();
  const rotation = [...state.rotation];
  g.down(1, 0, 0);
  g.move(1, 100, 100);
  assert.deepEqual(state.rotation, rotation);
  g.up(1);
  g.wheel(-100, 0, 0);
  assert.deepEqual(state.rotation, rotation);
});
test("listener binding converts client coordinates, handles cancel and cleanup", () => {
  const { g, state } = harness();
  class Canvas extends EventTarget {
    style = {};
    clientHeight = 600;
    ids = new Set();
    getBoundingClientRect() {
      return { left: 40, top: 50 };
    }
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
  const fire = (type, p = {}) =>
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), p));
  const point = projection(state).invert([300, 300]);
  fire("pointerdown", {
    pointerId: 1, pointerType: "touch", clientX: 340, clientY: 350,
  });
  fire("pointermove", { pointerId: 1, clientX: 360, clientY: 370 });
  anchored(state, point, 320, 320);
  fire("wheel", { deltaY: -100, deltaMode: 0, clientX: 360, clientY: 370 });
  anchored(state, point, 320, 320);
  fire("pointercancel", { pointerId: 1 });
  fire("lostpointercapture", { pointerId: 1 });
  assert.equal(g.pointerCount, 0);
  assert.equal(canvas.style.cursor, "grab");
  assert.equal(fire("gesturestart"), false);
  detach();
  fire("pointerdown", { pointerId: 3, pointerType: "touch", clientX: 340, clientY: 350 });
  assert.equal(g.pointerCount, 0);
  assert.equal(canvas.ids.size, 0);
});
test("LOD clamps, follows absolute scale and uses hysteresis in both directions", () => {
  assert.equal(levelForScale(1), 4.2);
  assert.equal(levelForScale(1e12), 19);
  assert.equal(levelForScale(240), 5);
  assert.equal(levelForScale(241, 4), 4.2);
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
function geometryHarness() {
  const requests = [],
    frames = [],
    errors = [],
    pending = [];
  const c = createLatestGeometry({
    request: (level) => {
      requests.push(level);
      const p = deferred();
      pending.push(p);
      return p.promise;
    },
    onFrame: (frame) => frames.push(frame),
    onError: (e) => errors.push(e.message),
  });
  return { c, requests, frames, errors, pending };
}

test("geometry publishes every started query and coalesces pending levels", async () => {
  const { c, requests, frames, pending } = geometryHarness();
  const run = c.select(4);
  for (let i = 1; i <= 30; i++) await c.select(4 + i / 10);
  assert.deepEqual(requests, [4]);
  assert.equal(c.target, 7);
  pending[0].resolve(4);
  await Promise.resolve();
  assert.deepEqual(frames, [4]);
  assert.deepEqual(requests, [4, 7]);
  await c.select(8);
  await c.select(9);
  pending[1].resolve(7);
  await Promise.resolve();
  assert.deepEqual(frames, [4, 7]);
  assert.deepEqual(requests, [4, 7, 9]);
  pending[2].resolve(9);
  await run;
  assert.deepEqual(frames, [4, 7, 9]);
});

test("direction reversal reuses completed cache entries after active work", async () => {
  const { c, requests, frames, pending } = geometryHarness();
  const first = c.select(4);
  pending[0].resolve(4);
  await first;
  const run = c.select(5);
  await c.select(6);
  await c.select(4);
  assert.deepEqual(requests, [4, 5]);
  pending[1].resolve(5);
  await run;
  assert.deepEqual(frames, [4, 5, 4]);
  await c.select(5);
  assert.deepEqual(frames, [4, 5, 4, 5]);
  assert.deepEqual(requests, [4, 5]);
});

test("reselecting the active or rendered level does not start duplicate queries", async () => {
  const { c, requests, frames, pending } = geometryHarness();
  const run = c.select(4);
  await c.select(5);
  await c.select(4);
  await c.select(4);
  pending[0].resolve(4);
  await run;
  await c.select(4);
  assert.deepEqual(requests, [4]);
  assert.deepEqual(frames, [4]);
});

test("geometry errors can retry, obsolete failures and disposed responses are ignored", async () => {
  const { c, requests, frames, errors, pending } = geometryHarness();
  const run = c.select(4);
  await c.select(5);
  pending[0].reject(new Error("obsolete"));
  await Promise.resolve();
  assert.deepEqual(requests, [4, 5]);
  pending[1].reject(new Error("current"));
  await run;
  assert.deepEqual(errors, ["current"]);
  assert.equal(c.target, null);
  const next = c.select(5);
  pending[2].resolve(5);
  await next;
  assert.deepEqual(frames, [5]);
  const last = c.select(6);
  await c.select(7);
  c.dispose();
  pending[3].resolve(6);
  await last;
  await c.select(8);
  assert.deepEqual(frames, [5]);
  assert.deepEqual(requests, [4, 5, 5, 6]);
});

test("invalidation clears the cache and suppresses old-generation results", async () => {
  const { c, requests, frames, pending } = geometryHarness();
  const first = c.select(4);
  pending[0].resolve(4);
  await first;
  const run = c.select(5);
  await c.select(6);
  c.invalidate();
  await c.select(4);
  assert.deepEqual(requests, [4, 5]);
  pending[1].resolve(5);
  await Promise.resolve();
  assert.deepEqual(requests, [4, 5, 4]);
  assert.deepEqual(frames, [4]);
  pending[2].resolve(40);
  await run;
  assert.deepEqual(frames, [4, 40]);
});

test("geometry cache stays bounded to four completed levels", async () => {
  const requests = [],
    frames = [];
  const c = createLatestGeometry({
    request: async (level) => {
      requests.push(level);
      return { level, seq: requests.length };
    },
    onFrame: (frame) => frames.push(frame.level),
  });
  for (const level of [4, 5, 6, 7, 8, 5, 4]) await c.select(level);
  assert.deepEqual(requests, [4, 5, 6, 7, 8, 4]);
  assert.deepEqual(frames, [4, 5, 6, 7, 8, 5, 4]);
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

function keyHarness() {
  const events = [];
  const k = createKeyboardControls({
    onThrust: (t) => events.push(["thrust", t.x, t.y, t.z]),
    onBrake: () => events.push(["brake"]),
    onReset: () => events.push(["reset"]),
  });
  return { k, events };
}
test("keyboard thrust vectors combine, cancel and ignore OS key repeat", () => {
  const { k, events } = keyHarness();
  k.keydown("KeyD");
  k.keydown("KeyD", { repeat: true });
  k.keydown("ArrowRight");
  k.keydown("ArrowUp");
  assert.deepEqual(events, [
    ["thrust", 0, 0, 1],
    ["thrust", 1, 0, 1],
    ["thrust", 1, 1, 1],
  ]);
  events.length = 0;
  k.keydown("ArrowLeft");
  assert.deepEqual(events, [["thrust", 0, 1, 1]]);
  k.keyup("ArrowLeft");
  k.keyup("ArrowRight");
  k.keyup("ArrowRight");
  k.keydown("KeyC");
  assert.deepEqual(k.thrust(), { x: 0, y: 1, z: 0 });
});
test("space brakes and clears held keys; R resets once; unknown keys pass through", () => {
  const { k, events } = keyHarness();
  k.keydown("ArrowDown");
  events.length = 0;
  assert.equal(k.keydown("Space"), true);
  k.keyup("ArrowDown");
  k.keydown("KeyR");
  k.keydown("KeyR", { repeat: true });
  assert.deepEqual(events, [["brake"], ["reset"]]);
  assert.equal(k.keydown("KeyQ"), false);
});
test("window listeners prevent scrolling, ignore editable targets and modifiers, and clear on blur", () => {
  const { k, events } = keyHarness();
  const handlers = {},
    docHandlers = {},
    win = {
      document: {
        hidden: false,
        addEventListener: (t, f) => (docHandlers[t] = f),
        removeEventListener: (t) => delete docHandlers[t],
      },
      addEventListener: (t, f) => (handlers[t] = f),
      removeEventListener: (t) => delete handlers[t],
    };
  const detach = attachKeyboardControls(win, k);
  const ev = (code, extra = {}) => ({
    code,
    target: null,
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  });
  const arrow = ev("ArrowLeft");
  handlers.keydown(arrow);
  assert.equal(arrow.prevented, true);
  const slider = ev("ArrowRight", { target: { closest: () => ({}) } });
  handlers.keydown(slider);
  assert.equal(slider.prevented, undefined);
  const reload = ev("KeyR", { ctrlKey: true });
  handlers.keydown(reload);
  assert.equal(reload.prevented, undefined);
  assert.equal(events.filter((e) => e[0] === "reset").length, 0);
  handlers.blur();
  assert.deepEqual(events.at(-1), ["thrust", 0, 0, 0]);
  handlers.keydown(ev("KeyD"));
  win.document.hidden = true;
  docHandlers.visibilitychange();
  assert.deepEqual(events.at(-1), ["thrust", 0, 0, 0]);
  detach();
  assert.deepEqual(Object.keys(handlers), []);
});
