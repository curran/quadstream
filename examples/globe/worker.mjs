// Module worker loads pinned local UMD demo bundles via side-effect imports.
import "../../node_modules/d3/dist/d3.min.js";
import "../../node_modules/topojson-client/dist/topojson-client.min.js";
import { createGlobeGeometry, decodeCountries } from "./geometry.mjs";
let engine;
let chain = Promise.resolve();
self.onmessage = ({ data: m }) => {
  chain = chain.then(async () => {
    try {
      if (m.type === "init") {
        const original = decodeCountries(m.source, self.topojson);
        engine = createGlobeGeometry(original, self.d3);
        self.postMessage({
          id: m.id,
          original,
          sourceVertices: engine.sourceVertices,
          buildMs: engine.buildMs,
          unavailable: engine.unavailable,
          reasons: engine.reasons,
        });
      } else if (m.type === "query") {
        if (!engine) throw new Error("Geometry worker not initialized");
        self.postMessage({ id: m.id, frame: engine.query(m.level) });
      }
    } catch (e) {
      self.postMessage({ id: m.id, error: String(e.message ?? e) });
    }
  });
};
