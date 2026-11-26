import { attachMapLibre } from "../../dist/index.js";
import { WorkerMapClient } from "./client.mjs";
import * as maplibregl from "../../node_modules/maplibre-gl/dist/maplibre-gl.mjs";
const $ = (id) => document.getElementById(id),
  canvas = $("canvas"),
  ctx = canvas.getContext("2d");
const empty = { type: "FeatureCollection", features: [] };
let client,
  map,
  adapter,
  source,
  ready = false,
  epoch = 0,
  initId = 0,
  center = [0, 0],
  frame,
  drag;
const level = () => Number($("level").value),
  zoom = () => Number($("zoom").value);
const status = (s) => {
  $("status").textContent = s;
};
const bounds = () => {
  const x = 180 / zoom(),
    y = 90 / zoom();
  return [center[0] - x, center[1] - y, center[0] + x, center[1] + y];
};
function paths(data) {
  return data.features.flatMap((f) => {
    const g = f.geometry;
    switch (g.type) {
      case "Polygon":
        return [{ rings: g.coordinates, closed: true }];
      case "MultiPolygon":
        return g.coordinates.map((rings) => ({ rings, closed: true }));
      case "LineString":
        return [{ rings: [g.coordinates], closed: false }];
      case "MultiLineString":
        return g.coordinates.map((r) => ({ rings: [r], closed: false }));
      default:
        return [];
    }
  });
}
function draw() {
  const [w, s, e, n] = bounds(),
    project = ([x, y]) => [
      ((x - w) / (e - w)) * canvas.width,
      ((n - y) / (n - s)) * canvas.height,
    ];
  ctx.fillStyle = "#e4edf5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const data = frame?.result.geojson ?? empty,
    segments = new Map();
  for (const { rings, closed } of paths(data)) {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const [x, y] = project(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        if (i) {
          const a = ring[i - 1],
            key = [a.join(","), p.join(",")].sort().join("|"),
            entry = segments.get(key);
          if (entry) entry.count++;
          else segments.set(key, { a, b: p, count: 1 });
        }
      });
      if (closed) ctx.closePath();
    }
    ctx.fillStyle = "#8ab39c";
    if (closed) ctx.fill("evenodd");
    ctx.strokeStyle = "#36594c";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if ($("shared").checked) {
    ctx.strokeStyle = "#ad421d";
    ctx.lineWidth = 3;
    for (const { a, b, count } of segments.values())
      if (count > 1) {
        ctx.beginPath();
        ctx.moveTo(...project(a));
        ctx.lineTo(...project(b));
        ctx.stroke();
      }
  }
}
function show(f) {
  frame = f;
  draw();
  const r = f.result;
  status(
    (f.final ? "Ready" : "Refining") +
      " · level " +
      r.level +
      "/" +
      f.targetLevel +
      " · " +
      r.selectedVertices +
      " vertices · " +
      f.loadedPartitions +
      "/" +
      f.totalPartitions +
      " partitions · " +
      r.omittedFeatures +
      " omitted features" +
      (r.usedFallback ? " · full-detail fallback" : "") +
      (!r.complete ? " · partial geometry" : ""),
  );
  $("status").dataset.final = String(f.final);
}
function loading() {
  frame = undefined;
  draw();
  $("status").dataset.final = "false";
  status("Loading geometry…");
}
function error(e) {
  if (e.name !== "AbortError") {
    status("Error: " + e.message);
    $("status").dataset.final = "false";
  }
}
async function refresh() {
  if (!ready) return;
  if (adapter) {
    await adapter.refresh();
    return;
  }
  if ($("renderer").value === "maplibre") return;
  const id = ++epoch;
  loading();
  try {
    await client.request({ level: level(), bounds: bounds() }, (f) => {
      if (id === epoch) show(f);
    });
  } catch (e) {
    if (id === epoch) error(e);
  }
}
function teardownMap() {
  adapter?.dispose();
  adapter = undefined;
  map?.remove();
  map = undefined;
}
async function switchRenderer() {
  ++epoch;
  client?.cancel();
  teardownMap();
  const gl = $("renderer").value === "maplibre";
  canvas.hidden = gl;
  $("map").hidden = !gl;
  $("zoom").disabled = gl;
  if (!ready) return;
  if (!gl) {
    void refresh();
    return;
  }
  loading();
  try {
    const current = new maplibregl.Map({
      container: $("map"),
      style: { version: 8, sources: {}, layers: [] },
      center,
      zoom: Math.log2(zoom()),
      renderWorldCopies: false,
      attributionControl: false,
    });
    map = current;
    current.once("load", () => {
      if (map !== current || !ready) return;
      try {
        current.addSource("quadstream", { type: "geojson", data: empty });
        current.addLayer({
          id: "fill",
          type: "fill",
          source: "quadstream",
          paint: { "fill-color": "#8ab39c", "fill-opacity": 0.8 },
        });
        current.addLayer({
          id: "outline",
          type: "line",
          source: "quadstream",
          paint: { "line-color": "#36594c", "line-width": 1 },
        });
        adapter = attachMapLibre(current, client, {
          sourceId: "quadstream",
          maxLevel: 16,
          levelForZoom: (z) => Math.max(level(), Math.floor(z + 2)),
          onFrame: show,
          onLoading: loading,
          onError: error,
        });
      } catch (e) {
        error(e);
      }
    });
    current.on("error", (e) => {
      if (map === current) error(e.error ?? new Error("MapLibre failed"));
    });
  } catch (e) {
    error(e);
  }
}
async function init() {
  const id = ++initId;
  ready = false;
  ++epoch;
  teardownMap();
  client?.dispose();
  loading();
  status("Preparing geometry…");
  const current = new WorkerMapClient(
    new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" }),
  );
  client = current;
  try {
    await current.initialize(source, $("slow").checked ? 180 : 0);
    if (id !== initId) return;
    ready = true;
    await switchRenderer();
  } catch (e) {
    if (id === initId) error(e);
  }
}
function clampCenter() {
  const x = 180 / zoom(),
    y = 90 / zoom();
  center = [
    Math.max(-180 + x, Math.min(180 - x, center[0])),
    Math.max(-90 + y, Math.min(90 - y, center[1])),
  ];
}
function pan(dx, dy) {
  center = [center[0] + dx, center[1] + dy];
  clampCenter();
  ++epoch;
  client?.cancel();
  loading();
}
canvas.addEventListener("pointerdown", (e) => {
  drag = [e.clientX, e.clientY];
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  pan(
    (-(e.clientX - drag[0]) * 360) / (zoom() * rect.width),
    ((e.clientY - drag[1]) * 180) / (zoom() * rect.height),
  );
  drag = [e.clientX, e.clientY];
});
for (const event of ["pointerup", "pointercancel"])
  canvas.addEventListener(event, () => {
    if (drag) {
      drag = undefined;
      void refresh();
    }
  });
canvas.addEventListener("keydown", (e) => {
  const moves = {
    ArrowLeft: [-15, 0],
    ArrowRight: [15, 0],
    ArrowUp: [0, 10],
    ArrowDown: [0, -10],
  };
  if (moves[e.key]) {
    e.preventDefault();
    pan(...moves[e.key]);
    void refresh();
  }
});
$("level").addEventListener("input", () => {
  $("level-value").value = String(level());
  void refresh();
});
$("zoom").addEventListener("input", () => {
  clampCenter();
  void refresh();
});
$("shared").addEventListener("change", draw);
$("slow").addEventListener("change", () => void init());
$("renderer").addEventListener("change", () => void switchRenderer());
$("retry").addEventListener("click", () =>
  ready ? void refresh() : void init(),
);
$("reset").addEventListener("click", () => {
  center = [0, 0];
  $("zoom").value = "1";
  if (map) map.jumpTo({ center, zoom: 0 });
  else void refresh();
});
$("file").addEventListener("change", async () => {
  try {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) throw new Error("Demo input exceeds 16 MiB");
    source = JSON.parse(await f.text());
    await init();
  } catch (e) {
    error(e);
  }
});
window.addEventListener("pagehide", () => {
  teardownMap();
  client?.dispose();
});
void init();
