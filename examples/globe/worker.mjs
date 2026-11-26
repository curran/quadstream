// Module worker loads pinned local UMD demo bundles via side-effect imports.
import "../../node_modules/d3/dist/d3.min.js";
import "../../node_modules/topojson-client/dist/topojson-client.min.js";
import { createGlobeGeometry, decodeCountries } from "./geometry.mjs";
import { packGeometry } from "./wire.mjs";
let engine;
let queue = [];
let running = false;
let latestQueryId = 0;
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
    if (!payload) {
      self.postMessage({ id: m.id, superseded: true });
      return;
    }
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
// Latest-wins with cooperative mid-run cancellation: incoming messages update
// latestQueryId immediately, and queryInterruptible yields via MessageChannel
// between ~8ms slices so superseded queries abort mid-flight.
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    await yieldTurn();
    const batch = queue;
    queue = [];
    const last = batch.findLastIndex((m) => m.type === "query");
    for (const [i, m] of batch.entries()) {
      if (m.type === "init")
        await respond(m, () => {
          const original = decodeCountries(m.source, self.topojson);
          engine = createGlobeGeometry(original, self.d3);
          return {
            original,
            sourceVertices: engine.sourceVertices,
            buildMs: engine.buildMs,
            unavailable: engine.unavailable,
            reasons: engine.reasons,
          };
        });
      else if (i !== last || m.id !== latestQueryId)
        self.postMessage({ id: m.id, superseded: true });
      else
        await respond(m, async () => {
          if (!engine) throw new Error("Geometry worker not initialized");
          const frame = await engine.queryInterruptible(m.level, {
            shouldAbort: () => m.id !== latestQueryId,
            yieldTurn,
          });
          if (!frame || m.id !== latestQueryId) return null;
          const { geojson, ...rest } = frame;
          const { coords, meta } = packGeometry(geojson);
          return { frame: { ...rest, seq: m.id }, coords, meta };
        });
    }
  }
  running = false;
}
self.onmessage = ({ data }) => {
  if (data.type === "query") latestQueryId = data.id;
  queue.push(data);
  drain();
};
