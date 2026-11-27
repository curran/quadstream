// Module worker loads pinned local UMD demo bundles via side-effect imports.
import "../../node_modules/d3/dist/d3.min.js";
import "../../node_modules/topojson-client/dist/topojson-client.min.js";
import { createGlobeGeometry, decodeCountries } from "./geometry.mjs";
import { packGeometry } from "./wire.mjs";
let engine;
let queue = [];
let running = false;
const channel = new MessageChannel();
const waiters = [];
channel.port1.onmessage = () => {
  const resolve = waiters.shift();
  if (resolve) resolve();
};
const yieldTurn = () =>
  new Promise((resolve) => {
    waiters.push(resolve);
    channel.port2.postMessage(null);
  });
async function respond(m, work) {
  try {
    const payload = await work();
    const transfer =
      payload.coords && payload.meta
        ? [payload.coords.buffer, payload.meta.buffer]
        : undefined;
    if (transfer) self.postMessage({ id: m.id, ...payload }, transfer);
    else self.postMessage({ id: m.id, ...payload });
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e.message ?? e) });
  }
}
// The main-thread scheduler coalesces LOD targets before sending them.
// Process admitted queries serially to completion, including the minimap.
async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const m = queue.shift();
      if (m.type === "init")
        await respond(m, () => {
          const original = decodeCountries(m.source, self.topojson);
          engine = createGlobeGeometry(original, self.d3);
          return {
            original,
            quadtree: engine.quadtree,
            sourceVertices: engine.sourceVertices,
            buildMs: engine.buildMs,
            unavailable: engine.unavailable,
            reasons: engine.reasons,
          };
        });
      else
        await respond(m, async () => {
          if (!engine) throw new Error("Geometry worker not initialized");
          const frame = await engine.queryInterruptible(m.level, { yieldTurn });
          const { geojson, ...rest } = frame;
          const { coords, meta } = packGeometry(geojson);
          return { frame: { ...rest, seq: m.id }, coords, meta };
        });
    }
  } finally {
    running = false;
  }
}
self.onmessage = ({ data }) => {
  queue.push(data);
  void drain();
};
