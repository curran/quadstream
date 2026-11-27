import {
  createGlobeInteraction,
  attachGlobeInteraction,
  resizedView,
} from "./interaction.mjs";
import { quantizeAutoLevel, createLatestGeometry } from "./lod.mjs";
import { createGlobeRenderer } from "./map.mjs";
import { createMinimapRenderer } from "./minimap.mjs";
import { GlobeWorkerClient } from "./client.mjs";
import { fixture } from "./fixture.mjs";
const $ = (id) => document.getElementById(id),
  MINIMAP_LEVEL = 4,
  canvas = $("globe"),
  miniCanvas = $("minimap"),
  status = $("status"),
  ctx = canvas.getContext("2d"),
  miniCtx = miniCanvas?.getContext("2d");
// ?clip=0 restores whole-feature culling only, for A/B comparison.
const clipEnabled = new URLSearchParams(location.search).get("clip") !== "0";
const draw = createGlobeRenderer(globalThis.d3, ctx, {
  cull: true,
  clip: clipEnabled,
});
const drawMinimap = miniCtx
  ? createMinimapRenderer(globalThis.d3, miniCtx)
  : null;
const state = {
  rotation: [0, -20, 0],
  interacting: false,
  ...resizedView({}, canvas.clientWidth, canvas.clientHeight),
};
let original,
  minimapFrame,
  frame,
  client,
  latest,
  epoch = 0,
  raf = 0,
  ready = false,
  sourceName = "50m",
  selectedFile = null,
  abort,
  disposed = false;
let drawStats = null;
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
      " | invalid groups: " +
      (frame?.invalidGroups ?? "—") +
      " | strict-validator groups: " +
      (frame?.validatorInvalidGroups ?? "—"),
    "Build: " +
      (frame?.buildMs?.toFixed(1) ?? "—") +
      " ms | query: " +
      (frame?.queryMs?.toFixed(1) ?? "—") +
      " ms",
    "Last draw: " +
      frameMs.toFixed(1) +
      " ms | draw-only FPS estimate: " +
      (frameMs > 0 ? (1000 / frameMs).toFixed(1) : "—"),
    "Drawn: " +
      (drawStats
        ? drawStats.vertices +
          " / " +
          drawStats.sourceVertices +
          " vertices, " +
          drawStats.features +
          " / " +
          drawStats.sourceFeatures +
          " features (" +
          drawStats.mode +
          "; rings kept " +
          drawStats.rings.kept +
          ", clipped " +
          drawStats.rings.clipped +
          ", wrapped " +
          drawStats.rings.wrapped +
          ", dropped " +
          drawStats.rings.dropped +
          ")"
        : "—"),
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
    targetLevel: String(latest?.target ?? ""),
    vertices: String(frame?.vertices ?? ""),
    drawnVertices: String(drawStats?.vertices ?? ""),
    drawMode: drawStats?.mode ?? "cull-only",
    clipRebuilt: String(drawStats?.rebuilt ?? ""),
    sourceVertices: String(frame?.sourceVertices ?? ""),
    mode: $("mode").value,
  });
}
function schedule() {
  if (raf || disposed) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const start = performance.now();
    const activeGeojson =
      $("mode").value === "original" ? original : (frame?.geojson ?? original);
    // Until the coarse minimap level arrives, show the decoded source.
    const minimapGeojson = minimapFrame?.geojson ?? original ?? null;
    const drawn = draw(state, activeGeojson, original);
    drawStats = drawn.stats;
    drawMinimap?.({ ...state, miniSize: 160 }, minimapGeojson);
    frameMs = performance.now() - start;
    diagnostics();
  });
}
function requestLevel() {
  if (!ready || !latest || $("mode").value === "original") return;
  const targetLevel = Number($("level").value),
    interactiveCap = Number($("interactive-level").value),
    zoomRatio = state.initialScale > 0 ? state.scale / state.initialScale : 1,
    settled = Math.max(0, Math.min(19, targetLevel + Math.log2(zoomRatio))),
    effective = state.interacting ? Math.min(interactiveCap, settled) : settled,
    level = quantizeAutoLevel(effective, state.interacting);
  $("level-value").value = targetLevel;
  $("level-value").textContent = targetLevel;
  $("interactive-level-value").value = interactiveCap;
  $("interactive-level-value").textContent = interactiveCap;
  if (latest.target !== level) {
    setStatus("Refining geometry…", "loading");
    void latest.select(level);
  }
}
function update(patch) {
  Object.assign(state, patch);
  schedule();
  if ("scale" in patch || "interacting" in patch) requestLevel();
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
  if (miniCanvas) {
    miniCanvas.width = Math.max(1, Math.round(160 * dpr));
    miniCanvas.height = Math.max(1, Math.round(160 * dpr));
  }
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
  minimapFrame = undefined;
  original = undefined;
  requests = 0;
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
              (f.fallbackGroups || f.invalidGroups
                ? " · source fallback/invalid coarse geometry"
                : ""),
            "ready",
          );
        schedule();
      },
      onError: (e) => {
        if ($("mode").value === "quadstream") error(e);
      },
    });
    minimapFrame = await current.query(MINIMAP_LEVEL);
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
          (frame.fallbackGroups || frame.invalidGroups
            ? " · source fallback/invalid coarse geometry"
            : ""),
        "ready",
      );
    requestLevel();
  }
  schedule();
});
$("level").addEventListener("input", () => {
  $("level-value").value = $("level").value;
  $("level-value").textContent = $("level").value;
  requestLevel();
});
$("interactive-level").addEventListener("input", () => {
  $("interactive-level-value").value = $("interactive-level").value;
  $("interactive-level-value").textContent = $("interactive-level").value;
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
{
  const params = new URLSearchParams(location.search),
    requested = params.get("fixture") === "1" ? "fixture" : params.get("atlas");
  if ([...$("atlas").options].some((o) => o.value === requested)) {
    $("atlas").value = requested;
    sourceName = requested;
  }
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
