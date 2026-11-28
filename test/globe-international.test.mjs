import test from "node:test";
import assert from "node:assert/strict";
import {
  regionalConfig,
  loadRegionalCatalog,
  createRegionalLayers,
} from "../examples/globe/regional.mjs";

const record = (iso, level = "ADM1", cx = 1) => {
  const id = iso.toLowerCase() + "-" + level.toLowerCase();
  return {
    iso,
    level,
    id,
    file: id + "-0123456789abcdef.json",
    object: "regions",
    caps: [{ cx, cy: 0, cz: 0, radiusRad: 0.1 }],
  };
};
const load = (records) =>
  loadRegionalCatalog(async () => ({
    ok: true,
    json: async () => ({ version: "gb80", records }),
  }));
test("catalog accepts valid entries and rejects unsafe paths, duplicate IDs and USA", async () => {
  const r = record("CAN");
  assert.deepEqual(await load([r]), [r]);
  await assert.rejects(load([{ ...r, file: "../bad.json" }]));
  await assert.rejects(load([r, r]));
  await assert.rejects(load([record("USA")]));
  await assert.rejects(
    load([{ ...r, caps: [{ cx: 2, cy: 0, cz: 0, radiusRad: 0 }] }]),
  );
});
test("international configuration uses existing ADM zoom thresholds", () => {
  const catalog = [record("CAN"), record("CAN", "ADM2")];
  const all = regionalConfig({ catalog });
  assert.equal(all.length, 4);
  assert.deepEqual(
    all.filter((x) => x.international).map((x) => x.enter),
    [3, 6],
  );
  assert.equal(regionalConfig({ catalog, counties: false }).length, 2);
  assert.match(all.find((x) => x.international).url, /can-adm1-/);
});
test("international workers are admitted, evicted and stale replies ignored", () => {
  const workers = [];
  const configs = regionalConfig({
    catalog: [record("CAN"), record("BRA"), record("IND")],
  }).filter((x) => x.international);
  const layers = createRegionalLayers({
    configs,
    maxInternationalWorkers: 2,
    createWorker: () => {
      const w = {
        postMessage() {},
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(w);
      return w;
    },
  });
  const view = {
    initialScale: 100,
    scale: 600,
    width: 200,
    height: 200,
    rotation: [0, 0, 0],
  };
  const options = { enabled: true, original: false, level: 6 };
  layers.update(view, options);
  assert.equal(workers.length, 2);
  layers.update({ ...view, rotation: [180, 0, 0] }, options);
  assert.ok(workers.every((w) => w.terminated));
  workers[0].onmessage({ data: { type: "ready", original: {} } });
  assert.ok(layers.status().every((s) => s.phase === "idle"));
  layers.update(view, options);
  assert.equal(workers.length, 4);
  layers.reset();
  assert.ok(workers.every((w) => w.terminated));
});

test("international ADM1 and ADM2 layers reject obsolete LOD frames", () => {
  const workers = [];
  const configs = regionalConfig({
    catalog: [record("CAN"), record("CAN", "ADM2")],
  }).filter((config) => config.international);
  const layers = createRegionalLayers({
    configs,
    createWorker: () => {
      const worker = {
        sent: [],
        postMessage(message) {
          this.sent.push(message);
        },
        terminate() {},
      };
      workers.push(worker);
      return worker;
    },
  });
  const view = {
    initialScale: 100,
    scale: 800,
    width: 200,
    height: 200,
    rotation: [0, 0, 0],
  };
  const update = (level) =>
    layers.update(view, {
      enabled: true,
      original: false,
      level,
    });
  const send = (worker, level) =>
    worker.onmessage({
      data: { type: "frame", level, geometry: { level } },
    });
  const rendered = () => layers.status().map((layer) => layer.rendered);
  update(6);
  assert.equal(workers.length, 2);
  for (const worker of workers) {
    worker.onmessage({ data: { type: "ready", original: {} } });
    assert.equal(worker.sent.at(-1).level, 9);
    send(worker, 9);
  }
  assert.deepEqual(rendered(), [9, 9]);
  update(10);
  update(7);
  for (const worker of workers) {
    assert.equal(worker.sent.at(-1).level, 13);
    send(worker, 13);
    assert.equal(worker.sent.at(-1).level, 10);
  }
  assert.deepEqual(rendered(), [9, 9]);
  assert.deepEqual(
    update(7).map((overlay) => overlay.geometry.level),
    [9, 9],
  );
  for (const worker of workers) send(worker, 10);
  assert.deepEqual(rendered(), [10, 10]);
  layers.reset();
});
