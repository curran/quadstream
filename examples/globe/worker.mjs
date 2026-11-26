// Module worker loads pinned local UMD demo bundles via side-effect imports.
import "../../node_modules/d3/dist/d3.min.js";
import "../../node_modules/topojson-client/dist/topojson-client.min.js";
import { createGlobeGeometry, decodeCountries } from "./geometry.mjs";
let engine;
let queue = [];
let running = false;
function respond(m, work) {
  try {
    self.postMessage({ id: m.id, ...work() });
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e.message ?? e) });
  }
}
// Latest-wins: queries that arrive while another is computing are dropped
// except for the newest, so continuous zoom/slider input never builds a backlog.
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    // Yield a task so messages already posted are received before choosing.
    await new Promise((r) => setTimeout(r, 0));
    const batch = queue;
    queue = [];
    const last = batch.findLastIndex((m) => m.type === "query");
    for (const [i, m] of batch.entries()) {
      if (m.type === "init")
        respond(m, () => {
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
      else if (i !== last) self.postMessage({ id: m.id, superseded: true });
      else
        respond(m, () => {
          if (!engine) throw new Error("Geometry worker not initialized");
          return { frame: engine.query(m.level) };
        });
    }
  }
  running = false;
}
self.onmessage = ({ data }) => {
  queue.push(data);
  drain();
};
