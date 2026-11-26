import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuadstream,
  exportPartitions,
  QuadstreamSession,
  QuadstreamLoader,
  ProgressiveMap,
  attachMapLibre,
  mapLibreBounds,
  fetchFromBundle,
} from "../dist/index.js";
import { schematic } from "../examples/progressive/fixture.mjs";
import { WorkerMapClient } from "../examples/progressive/client.mjs";
const bundle = exportPartitions(buildQuadstream(schematic, { maxLevel: 16 }), {
  fileDepth: 2,
});
const engine = (fetcher = fetchFromBundle(bundle), options = {}) =>
  new ProgressiveMap(
    new QuadstreamLoader(new QuadstreamSession(bundle.manifest), fetcher, {
      cacheBytes: 128,
    }),
    { retryDelayMs: 1, ...options },
  );
test("schematic fixture stages valid full and intermediate geometry", async () => {
  const e = engine(),
    frames = [];
  await e.request({ level: 15 }, (f) => frames.push(f));
  assert.deepEqual(
    frames.map((f) => f.result.level),
    [0, 7, 15],
  );
  assert.deepEqual(
    frames.map((f) => f.final),
    [false, false, true],
  );
  assert.equal(
    frames.at(-1).result.geojson.features.length,
    schematic.features.length,
  );
  assert.equal(frames.at(-1).result.complete, true);
  assert.ok(frames.every((f) => f.loadedPartitions <= f.totalPartitions));
  assert.ok(e.loader.cacheSizeBytes <= 128);
});
test("viewport selection and cached partitions", async () => {
  let fetches = 0;
  const e = engine(async (k) => {
    fetches++;
    return bundle.partitions.get(k);
  });
  await e.request({ level: 15 }, () => {});
  const count = fetches,
    frames = [];
  await e.request({ level: 15, bounds: [100, -40, 160, -5] }, (f) =>
    frames.push(f),
  );
  assert.equal(fetches, count);
  assert.deepEqual(
    frames.at(-1).result.geojson.features.map((f) => f.id),
    ["Australia"],
  );
});
test("empty viewport is complete", async () => {
  const frames = [];
  await engine().request({ level: 15, bounds: [500, 500, 600, 600] }, (f) =>
    frames.push(f),
  );
  assert.equal(frames.at(-1).result.complete, true);
  assert.equal(frames.at(-1).result.geojson.features.length, 0);
});
test("low level converges globally, even when viewport excludes invalid shapes", async () => {
  const e = engine(),
    frames = [];
  await e.request({ level: 0, bounds: [500, 500, 600, 600] }, (f) =>
    frames.push(f),
  );
  assert.equal(frames.at(-1).final, true);
  assert.equal(e.loader.session.query({ level: 0 }).complete, true);
});
test("transient failure retries, persistent failure rejects", async () => {
  let calls = 0;
  const e = engine(async (k) => {
    if (++calls === 1) throw new Error("transient");
    return bundle.partitions.get(k);
  });
  await e.request({ level: 4 }, () => {});
  const broken = engine(
    async () => {
      throw new Error("offline");
    },
    { retries: 1 },
  );
  await assert.rejects(
    broken.request({ level: 4 }, () => {}),
    /offline/,
  );
});
test("new viewport cancels previous result even when fetcher ignores signal", async () => {
  let release;
  const blocked = new Promise((r) => (release = r));
  let first = true;
  const e = engine(async (k) => {
    if (first) {
      first = false;
      await blocked;
    }
    return bundle.partitions.get(k);
  });
  const a = [],
    b = [],
    old = e.request({ level: 15 }, (f) => a.push(f));
  const rejection = assert.rejects(old, { name: "AbortError" });
  await e.request({ level: 2 }, (f) => b.push(f));
  release();
  await rejection;
  assert.equal(a.length, 0);
  assert.equal(b.at(-1).targetLevel, 2);
  assert.equal(b.at(-1).final, true);
});
test("explicit cancellation during retry delay", async () => {
  let failed;
  const reached = new Promise((r) => (failed = r));
  const e = engine(
    async () => {
      failed();
      throw new Error("offline");
    },
    { retryDelayMs: 1000 },
  );
  const p = e.request({ level: 2 }, () => assert.fail("unexpected frame"));
  await reached;
  e.cancel();
  await assert.rejects(p, { name: "AbortError" });
});
test("invalid options and viewport fail before partition requests", async () => {
  let calls = 0;
  const e = engine(async () => {
    calls++;
    throw new Error("unexpected");
  });
  await assert.rejects(e.request({ level: 99 }, () => {}));
  await assert.rejects(e.request({ bounds: [4, 0, 1, 1] }, () => {}));
  assert.equal(calls, 0);
  assert.throws(() => engine(undefined, { retries: 99 }));
});
const bbox = (w, s, e, n) => ({
  getWest: () => w,
  getSouth: () => s,
  getEast: () => e,
  getNorth: () => n,
});
test("MapLibre bounds use conservative global fallback for wrapping", () => {
  assert.deepEqual(
    mapLibreBounds(bbox(-10, -100, 10, 100)),
    [-10, -90, 10, 90],
  );
  for (const b of [
    bbox(170, -10, -170, 10),
    bbox(170, -10, 190, 10),
    bbox(-180, -10, 180, 10),
    bbox(NaN, 0, 1, 1),
    bbox(1, 100, 2, 110),
  ])
    assert.equal(mapLibreBounds(b), undefined);
});
function fakeMap() {
  const listeners = new Map(),
    data = [];
  let zoom = 3;
  return {
    data,
    listeners,
    getZoom: () => zoom,
    setZoom: (z) => (zoom = z),
    getBounds: () => bbox(-20, -10, 20, 10),
    getSource: () => ({ setData: (d) => data.push(d) }),
    on: (e, f) => listeners.set(e, f),
    off: (e, f) => {
      if (listeners.get(e) === f) listeners.delete(e);
    },
    emit: (e) => listeners.get(e)?.(),
  };
}
function fakeClient() {
  const requests = [];
  let cancels = 0;
  return {
    requests,
    get cancels() {
      return cancels;
    },
    cancel() {
      cancels++;
    },
    request(query, cb) {
      requests.push({ query, cb });
      return Promise.resolve();
    },
  };
}
const fakeFrame = (label) => ({
  result: { geojson: { type: "FeatureCollection", features: [label] } },
  final: true,
});
test("adapter clears during movement, suppresses stale responses, updates source and disposes", async () => {
  const map = fakeMap(),
    client = fakeClient(),
    frames = [];
  const a = attachMapLibre(map, client, {
    sourceId: "x",
    maxLevel: 8,
    onFrame: (f) => frames.push(f),
  });
  assert.equal(client.requests[0].query.level, 5);
  map.emit("movestart");
  client.requests[0].cb(fakeFrame("old"));
  assert.equal(frames.length, 0);
  map.setZoom(20);
  map.emit("moveend");
  assert.equal(client.requests[1].query.level, 7);
  client.requests[1].cb(fakeFrame("new"));
  assert.deepEqual(map.data.at(-1).features, ["new"]);
  a.dispose();
  client.requests[1].cb(fakeFrame("late"));
  assert.equal(frames.length, 1);
  assert.equal(map.listeners.size, 0);
  await a.refresh();
  assert.equal(client.requests.length, 2);
});
test("adapter errors and missing source", async () => {
  const map = fakeMap(),
    errors = [],
    client = fakeClient();
  client.request = async () => {
    throw new Error("offline");
  };
  const a = attachMapLibre(map, client, {
    sourceId: "x",
    maxLevel: 8,
    onError: (e) => errors.push(e),
  });
  await a.refresh();
  assert.equal(errors.at(-1).message, "offline");
  a.dispose();
  map.getSource = () => undefined;
  assert.throws(
    () => attachMapLibre(map, client, { sourceId: "x", maxLevel: 8 }),
    /missing/,
  );
});
test("worker bridge rejects superseded requests and ignores old messages", async () => {
  const handlers = {},
    messages = [];
  const worker = {
    addEventListener: (e, f) => (handlers[e] = f),
    postMessage: (m) => messages.push(m),
    terminate: () => {},
  };
  const c = new WorkerMapClient(worker),
    frames = [];
  const old = c.request({ level: 4 }, (f) => frames.push(f)),
    rejected = assert.rejects(old, { name: "AbortError" }),
    oldId = messages.at(-1).id;
  const next = c.request({ level: 5 }, (f) => frames.push(f)),
    newId = messages.at(-1).id;
  handlers.message({ data: { type: "frame", id: oldId, frame: "old" } });
  handlers.message({ data: { type: "frame", id: newId, frame: "new" } });
  handlers.message({ data: { type: "done", id: newId } });
  await next;
  await rejected;
  assert.deepEqual(frames, ["new"]);
  c.dispose();
});
