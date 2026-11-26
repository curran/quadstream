import {
  createGlobeInteraction,
  attachGlobeInteraction,
  resizedView,
} from "./interaction.mjs";
import { levelForScale, createLatestGeometry } from "./lod.mjs";
import { createGlobeRenderer } from "./map.mjs";
import { GlobeWorkerClient } from "./client.mjs";
import { fixture } from "./fixture.mjs";
const $ = (id) => document.getElementById(id),
  canvas = $("globe"),
  status = $("status"),
  ctx = canvas.getContext("2d");
const draw = createGlobeRenderer(globalThis.d3, ctx);
const state = {
  rotation: [0, -20, 0],
  interacting: false,
  ...resizedView({}, canvas.clientWidth, canvas.clientHeight),
};
let original,
  frame,
  client,
  latest,
  epoch = 0,
  raf = 0,
  autoLevel,
  ready = false,
  sourceName = "110m",
  selectedFile = null,
  abort,
  disposed = false;
let requests = 0,
  frameMs = 0,
  atlasBytes = 0;
function setStatus(text, phase) {
  status.textContent = text;
  status.dataset.phase = phase;
}
function diagnostics() {
  const reduction = frame?.sourceVertices
    ? 100 * (1 - frame.vertices / frame.sourceVertices)
    : 0;
  $("diagnostics").textContent = [
    "Requested LOD: " +
      (latest?.target ?? "—") +
      " | rendered: " +
      (frame?.level ?? "—"),
    "Effective LOD(s): " + (frame?.effectiveLevels?.join(", ") || "—"),
    "Vertices: " +
      (frame ? frame.vertices + " / " + frame.sourceVertices : "—") +
      " (" +
      reduction.toFixed(1) +
      "% reduction)",
    "Source fallback features: " +
      (frame?.unavailable ?? "—") +
      " | fallback groups: " +
      (frame?.fallbackGroups ?? "—") +
      " | refined groups: " +
      (frame?.refinedGroups ?? "—"),
    "Build: " +
      (frame?.buildMs?.toFixed(1) ?? "—") +
      " ms | query: " +
      (frame?.queryMs?.toFixed(1) ?? "—") +
      " ms",
    "Last draw: " +
      frameMs.toFixed(1) +
      " ms | draw-only FPS estimate: " +
      (frameMs > 0 ? (1000 / frameMs).toFixed(1) : "—"),
    "Atlas payload: " + atlasBytes + " bytes | geometry queries: " + requests,
    ...(frame?.reasons ?? []),
  ].join("\n");
  // Inspectable state for accessibility diagnostics and deterministic browser tests.
  Object.assign(canvas.dataset, {
    rotation: JSON.stringify(state.rotation),
    scale: String(state.scale),
    initialScale: String(state.initialScale),
    interacting: String(state.interacting),
    requests: String(requests),
    renderedLevel: String(frame?.level ?? ""),
    vertices: String(frame?.vertices ?? ""),
    sourceVertices: String(frame?.sourceVertices ?? ""),
    mode: $("mode").value,
  });
}
function schedule() {
  if (raf || disposed) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const start = performance.now();
    draw(
      state,
      $("mode").value === "original" ? original : (frame?.geojson ?? original),
    );
    frameMs = performance.now() - start;
    diagnostics();
  });
}
function requestLevel() {
  if (!ready || !latest || $("mode").value === "original") return;
  const level = $("auto").checked
    ? (autoLevel = levelForScale(state.scale, autoLevel))
    : Number($("level").value);
  $("level").value = String(level);
  $("level-value").value = String(level);
  if (latest.target !== level) {
    setStatus("Refining geometry…", "loading");
    void latest.select(level);
  }
}
function update(patch) {
  Object.assign(state, patch);
  schedule();
  if ("scale" in patch) requestLevel();
}
const gesture = createGlobeInteraction({
  getState: () => state,
  update,
  onActive: (v) => update({ interacting: v }),
});
const detach = attachGlobeInteraction(canvas, gesture);
function resize() {
  const width = canvas.clientWidth,
    height = canvas.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!width || !height) return;
  Object.assign(state, resizedView(state, width, height), { dpr });
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  gesture.rebase();
  schedule();
  requestLevel();
}
const observer = new ResizeObserver(resize);
observer.observe(canvas);
resize();
function reset() {
  update({ rotation: [0, -20, 0], scale: state.initialScale });
  gesture.rebase();
}
canvas.addEventListener("keydown", (e) => {
  const directions = {
    ArrowLeft: [-12, 0],
    ArrowRight: [12, 0],
    ArrowUp: [0, -12],
    ArrowDown: [0, 12],
  };
  if (directions[e.key]) {
    e.preventDefault();
    const [x, y] = directions[e.key];
    update({
      rotation: [
        state.rotation[0] + x,
        state.rotation[1] + y,
        state.rotation[2],
      ],
    });
  } else if (["+", "=", "-"].includes(e.key)) {
    e.preventDefault();
    gesture.wheel(e.key === "-" ? 120 : -120);
  }
});
function error(e) {
  setStatus("Geometry error: " + (e.message ?? e), "error");
  schedule();
}
async function init() {
  const id = ++epoch;
  ready = false;
  frame = undefined;
  original = undefined;
  requests = 0;
  autoLevel = undefined;
  atlasBytes = 0;
  latest?.dispose();
  client?.dispose();
  abort?.abort();
  abort = new AbortController();
  setStatus("Loading geometry…", "loading");
  schedule();
  try {
    let source;
    if (selectedFile) {
      const text = await selectedFile.text();
      atlasBytes = new TextEncoder().encode(text).length;
      source = JSON.parse(text);
    } else if (sourceName === "fixture") {
      source = fixture;
      atlasBytes = 0;
    } else {
      const r = await fetch(
        "../../node_modules/world-atlas/countries-" + sourceName + ".json",
        { signal: abort.signal },
      );
      if (!r.ok) throw new Error("Atlas HTTP " + r.status);
      const text = await r.text();
      atlasBytes = new TextEncoder().encode(text).length;
      source = JSON.parse(text);
    }
    if (id !== epoch || disposed) return;
    original =
      source.type === "Topology"
        ? globalThis.topojson.feature(source, source.objects.countries)
        : source;
    if (
      original?.type !== "FeatureCollection" ||
      !original.features.length ||
      original.features.some(
        (f) => !["Polygon", "MultiPolygon"].includes(f.geometry?.type),
      )
    ) {
      original = undefined;
      throw new Error("Expected polygon countries");
    }
    schedule();
    setStatus("Preparing spherical geometry…", "loading");
    const current = new GlobeWorkerClient(
      new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" }),
    );
    client = current;
    const result = await current.init(original);
    if (id !== epoch || disposed) return;
    original = result.original;
    ready = true;
    latest = createLatestGeometry({
      request: (l) => {
        requests++;
        schedule();
        return current.query(l);
      },
      onFrame: (f) => {
        frame = f;
        if ($("mode").value === "quadstream")
          setStatus(
            "Ready · LOD " +
              f.level +
              " · " +
              f.vertices +
              " / " +
              f.sourceVertices +
              " vertices" +
              (f.fallbackGroups || f.refinedGroups
                ? " · conservative fallback/refinement"
                : ""),
            "ready",
          );
        schedule();
      },
      onError: (e) => {
        if ($("mode").value === "quadstream") error(e);
      },
    });
    if ($("mode").value === "original") setStatus("Original geometry", "ready");
    else requestLevel();
    schedule();
  } catch (e) {
    if (id === epoch && !disposed && e.name !== "AbortError") error(e);
  }
}
$("mode").addEventListener("change", () => {
  if ($("mode").value === "original") {
    setStatus(
      original ? "Original geometry" : "Loading geometry…",
      original ? "ready" : "loading",
    );
  } else {
    if (frame)
      setStatus(
        "Ready · LOD " +
          frame.level +
          " · " +
          frame.vertices +
          " / " +
          frame.sourceVertices +
          " vertices" +
          (frame.fallbackGroups || frame.refinedGroups
            ? " · conservative fallback/refinement"
            : ""),
        "ready",
      );
    requestLevel();
  }
  schedule();
});
$("auto").addEventListener("change", () => {
  $("level").disabled = $("auto").checked;
  autoLevel = undefined;
  requestLevel();
});
$("level").addEventListener("input", () => {
  $("level-value").value = $("level").value;
  requestLevel();
});
$("reset").addEventListener("click", reset);
$("retry").addEventListener("click", () => void init());
$("atlas").addEventListener("change", () => {
  selectedFile = null;
  $("file").value = "";
  sourceName = $("atlas").value;
  void init();
});
$("file").addEventListener("change", () => {
  selectedFile = $("file").files[0] ?? null;
  void init();
});
if (new URLSearchParams(location.search).get("fixture") === "1") {
  $("atlas").value = "fixture";
  sourceName = "fixture";
}
window.addEventListener(
  "pagehide",
  (e) => {
    if (e.persisted) return;
    disposed = true;
    epoch++;
    abort?.abort();
    latest?.dispose();
    client?.dispose();
    detach();
    observer.disconnect();
    if (raf) cancelAnimationFrame(raf);
  },
  { once: true },
);
void init();
