import { isCapVisible, lonLatToVec, orthographicViewCone } from "./cull.mjs";
import { improvesLod } from "./lod.mjs";

const cap = (lon, lat, radius) => {
  const [cx, cy, cz] = lonLatToVec(lon, lat);
  return { cx, cy, cz, radiusRad: (radius * Math.PI) / 180 };
};
// Conservative activation envelopes, not a clipping boundary.
const usCaps = [
  cap(-96, 39, 31),
  cap(-155, 61, 32),
  cap(-157, 20, 25),
  cap(-66, 18, 5),
  cap(145, 15, 5),
  cap(-170, -14, 5),
];

export function regionalConfig({ counties = true, catalog = [] } = {}) {
  const states = {
    id: "us-states",
    url: "../../node_modules/us-atlas/states-10m.json",
    object: "states",
    caps: usCaps,
    enter: 3,
    exit: 2.7,
    includeExternal: true,
    offset: 3,
    color: "#aca4ee",
    width: 0.65,
  };
  const us = counties
    ? [
        states,
        {
          ...states,
          id: "us-counties",
          url: "../../node_modules/us-atlas/counties-10m.json",
          object: "counties",
          sameState: true,
          includeExternal: false,
          enter: 6,
          exit: 5.4,
          color: "#766fae",
          width: 0.35,
        },
      ]
    : [states];
  return [
    ...us,
    ...catalog
      .filter((r) => counties || r.level === "ADM1")
      .map((r) => ({
        id: r.id,
        url: new URL("./regional-data/" + r.file, import.meta.url).href,
        object: r.object,
        caps: r.caps,
        enter: r.level === "ADM1" ? 3 : 6,
        exit: r.level === "ADM1" ? 2.7 : 5.4,
        offset: 3,
        color: r.level === "ADM1" ? "#aca4ee" : "#766fae",
        width: r.level === "ADM1" ? 0.65 : 0.35,
        international: true,
      })),
  ].sort((a, b) => a.enter - b.enter);
}

export async function loadRegionalCatalog(fetcher = globalThis.fetch) {
  const response = await fetcher(
    new URL("./regional-data/catalog.json", import.meta.url),
  );
  if (!response.ok) throw new Error("Regional catalog HTTP " + response.status);
  const catalog = await response.json();
  if (catalog.version !== "gb80" || !Array.isArray(catalog.records))
    throw new Error("Unsupported regional catalog");
  const ids = new Set();
  for (const r of catalog.records) {
    if (
      !/^[A-Z]{3}$/.test(r.iso) ||
      r.iso === "USA" ||
      !["ADM1", "ADM2"].includes(r.level) ||
      r.id !== r.iso.toLowerCase() + "-" + r.level.toLowerCase() ||
      ids.has(r.id) ||
      !/^[a-z]{3}-adm[12]-[a-f0-9]{16}\.json$/.test(r.file) ||
      !r.file.startsWith(r.id + "-") ||
      typeof r.object !== "string" ||
      !Array.isArray(r.caps) ||
      !r.caps.length ||
      !r.caps.every(
        (c) =>
          [c.cx, c.cy, c.cz, c.radiusRad].every(Number.isFinite) &&
          Math.abs(Math.hypot(c.cx, c.cy, c.cz) - 1) < 1e-6 &&
          c.radiusRad >= 0 &&
          c.radiusRad <= Math.PI,
      )
    )
      throw new Error("Invalid regional catalog entry");
    ids.add(r.id);
  }
  return catalog.records;
}

export function layerActive(config, state, active) {
  if (!(state.initialScale > 0)) return false;
  return (
    state.scale / state.initialScale >= (active ? config.exit : config.enter) &&
    config.caps.some((c) => isCapVisible(c, orthographicViewCone(state)))
  );
}

// One worker per dataset; one outstanding query per worker. Cache the last
// frame across activation changes; never draw a late response offscreen.
export function createRegionalLayers({
  configs,
  createWorker,
  onChange = () => {},
  maxInternationalWorkers = 6,
}) {
  if (!Number.isInteger(maxInternationalWorkers) || maxInternationalWorkers < 1)
    throw new Error("Invalid worker limit");
  const layers = configs.map((config) => ({
    config,
    active: false,
    phase: "idle",
  }));
  function fail(layer, error) {
    layer.worker?.terminate();
    layer.worker = null;
    layer.busy = false;
    layer.phase = "error";
    layer.error = String(error);
    onChange();
  }
  function query(layer) {
    if (
      !layer.active ||
      layer.busy ||
      !layer.worker ||
      !layer.original ||
      layer.originalMode ||
      layer.target === layer.rendered
    )
      return;
    layer.busy = true;
    try {
      layer.worker.postMessage({ type: "query", level: layer.target });
    } catch (error) {
      fail(layer, error);
    }
  }
  function start(layer) {
    try {
      const worker = createWorker();
      layer.worker = worker;
      layer.phase = "loading";
      worker.onmessage = ({ data }) => {
        if (layer.worker !== worker) return;
        if (data.error) {
          fail(layer, data.error);
          return;
        }
        if (data.type === "ready") {
          layer.original = data.original;
          layer.phase = data.warning ? "fallback" : "ready";
          layer.warning = data.warning;
          layer.frame = data.original;
        } else if (data.type === "frame") {
          layer.busy = false;
          if (improvesLod(data.level, layer.rendered, layer.target)) {
            layer.rendered = data.level;
            layer.frame = data.geometry;
            layer.phase = data.warning ? "fallback" : "ready";
            layer.warning = data.warning;
          }
        }
        query(layer);
        onChange();
      };
      worker.onerror = (event) => {
        if (layer.worker === worker)
          fail(layer, event.message || "Regional worker failed");
      };
      worker.postMessage({ type: "init", config: layer.config });
    } catch (error) {
      fail(layer, error);
    }
  }
  function release(layer) {
    layer.worker?.terminate();
    Object.assign(layer, {
      active: false,
      phase: "idle",
      worker: null,
      original: null,
      frame: null,
      busy: false,
      target: undefined,
      rendered: undefined,
      error: undefined,
      warning: undefined,
    });
  }
  function reset() {
    for (const layer of layers) release(layer);
  }
  return {
    addConfigs(configs) {
      for (const config of configs)
        if (!layers.some((layer) => layer.config.id === config.id))
          layers.push({ config, active: false, phase: "idle" });
      layers.sort((a, b) => a.config.enter - b.config.enter);
      onChange();
    },
    reset,
    status: () =>
      layers.map(({ config, active, phase, error, warning, rendered }) => ({
        id: config.id,
        active,
        phase,
        error,
        warning,
        rendered,
      })),
    update(state, { enabled, original, level }) {
      const overlays = [];
      const cone = orthographicViewCone(state);
      const candidates = layers.filter((layer) => {
        layer.active =
          enabled && layerActive(layer.config, state, layer.active);
        return layer.active && layer.config.international;
      });
      const distance = (layer) =>
        Math.min(
          ...layer.config.caps.map((c) =>
            Math.acos(
              Math.max(
                -1,
                Math.min(1, c.cx * cone.vx + c.cy * cone.vy + c.cz * cone.vz),
              ),
            ),
          ),
        );
      candidates.sort(
        (a, b) => distance(a) - distance(b) || a.config.enter - b.config.enter,
      );
      const admitted = new Set(candidates.slice(0, maxInternationalWorkers));
      for (const layer of layers) {
        if (layer.config.international && !admitted.has(layer)) release(layer);
      }
      for (const layer of layers) {
        const { config } = layer;
        layer.originalMode = original;
        layer.target =
          Math.round(Math.max(0, Math.min(19, level + config.offset)) * 10) /
          10;
        if (!layer.active) continue;
        if (layer.phase === "idle") start(layer);
        query(layer);
        const geometry = original ? layer.original : layer.frame;
        if (geometry)
          overlays.push({ geometry, color: config.color, width: config.width });
      }
      return overlays.reverse(); // Draw state boundaries above county lines.
    },
  };
}
