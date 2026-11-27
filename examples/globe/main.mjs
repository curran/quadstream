import {
  createGlobeInteraction,
  attachGlobeInteraction,
  createKeyboardControls,
  attachKeyboardControls,
  resizedView,
} from "./interaction.mjs";
import { createCamera } from "./physics.mjs";
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
const NAV_KEY = "quadstream-globe-nav",
  NAV_DEFAULTS = {
    smooth: true,
    response: 300,
    damping: 1,
    pan: 1,
    zoom: 1,
    flyPan: 600,
    flyZoom: 1,
    drag: 5,
  },
  NAV_SLIDERS = [
    ["response", "nav-response"],
    ["damping", "nav-damping"],
    ["pan", "nav-pan"],
    ["zoom", "nav-zoom"],
    ["flyPan", "nav-fly-pan"],
    ["flyZoom", "nav-fly-zoom"],
    ["drag", "nav-drag"],
  ];
const nav = (() => {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(NAV_KEY) ?? "{}") ?? {};
  } catch (e) {
    void e;
  }
  const params = new URLSearchParams(location.search),
    reduced = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  const merged = {
    ...NAV_DEFAULTS,
    ...(reduced ? { smooth: false } : {}),
    ...stored,
  };
  // ?smooth=0 / ?smooth=1 overrides the stored preference for A/B and tests.
  if (params.has("smooth")) merged.smooth = params.get("smooth") !== "0";
  return merged;
})();
const reducedMotion = Boolean(
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
);
const camera = createCamera({
  limits: { zMin: Math.log(0.6), zMax: Math.log(64) },
  responseMs: nav.response,
  damping: nav.damping,
});
let original,
  minimapFrame,
  frame,
  client,
  latest,
  quadtree = [],
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
    moving: String(moving),
    goalScale: String(goalView(false).scale),
    goalRotation: JSON.stringify(goalView(false).rotation),
    thrusting: String(camera.thrusting),
    initialScale: String(state.initialScale),
    interacting: String(state.interacting),
    requests: String(requests),
    renderedLevel: String(frame?.level ?? ""),
    targetLevel: String(latest?.target ?? ""),
    vertices: String(frame?.vertices ?? ""),
    drawnVertices: String(drawStats?.vertices ?? ""),
    drawMode: drawStats?.mode ?? "cull-only",
    hiddenPolygons: String(frame?.hiddenPolygons ?? 0),
    hiddenRings: String(frame?.hiddenRings ?? 0),
    clipRebuilt: String(drawStats?.rebuilt ?? ""),
    sourceVertices: String(frame?.sourceVertices ?? ""),
    mode: $("mode").value,
  });
}
// Single frame scheduler: at most one rAF is outstanding, each frame advances
// the camera (if moving) and draws once; idle and clean means no frames.
let moving = false,
  lastTime = 0;
// Keyboard flight keeps continuous control under reduced motion but has no
// acceleration ramp or coasting.
function applyTuning() {
  camera.setTuning({
    pan: nav.flyPan,
    zoom: nav.flyZoom * Math.LN2,
    drag: nav.drag,
    instant: reducedMotion || !nav.smooth,
  });
}
applyTuning();
camera.setGoal({ lat: state.rotation[1] });
camera.snap();
function goalView(advance = true) {
  // Thrust-owned channels track the rendered camera, so bring it up to date.
  if (advance) advanceCamera();
  return {
    ...state,
    rotation: [camera.goal[0], camera.goal[1], state.rotation[2]],
    scale: state.initialScale * Math.exp(camera.goal[2]),
  };
}
function syncState() {
  const scale = state.initialScale * Math.exp(camera.pos[2]),
    scaleChanged = scale !== state.scale;
  state.rotation = [camera.pos[0], camera.pos[1], state.rotation[2]];
  state.scale = scale;
  // LOD follows the rendered camera, never the goal.
  if (scaleChanged) requestLevel();
}
function advanceCamera() {
  if (!moving) return;
  const now = performance.now();
  camera.advance(Math.max(0, now - lastTime) / 1000);
  lastTime = now;
  const degPerPx = 180 / Math.PI / state.scale;
  if (
    camera.isSettled({
      angle: 0.2 * degPerPx,
      angleVel: degPerPx,
      zoom: 0.2 / state.scale,
      zoomVel: 1 / state.scale,
    })
  ) {
    camera.snap();
    moving = false;
  }
  syncState();
}
function schedule() {
  if (raf || disposed) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    advanceCamera();
    render();
    if (moving) schedule();
  });
}
function render() {
  {
    const start = performance.now();
    const activeGeojson =
      ready && $("mode").value === "original"
        ? original
        : ready
          ? frame?.geojson
          : null;
    const minimapGeojson = minimapFrame?.geojson ?? null;
    const drawn = draw(
      {
        ...state,
        // Cheap path (no glow) while the camera is moving or being driven.
        interacting: state.interacting || moving,
        showQuadtree: $("show-quadtree").checked,
        quadtreeLevel:
          $("mode").value === "original"
            ? Number.MAX_SAFE_INTEGER
            : (frame?.level ?? 0),
      },
      activeGeojson,
      original,
      quadtree,
    );
    drawStats = drawn.stats;
    drawMinimap?.(
      {
        ...state,
        miniSize: 160,
      },
      minimapGeojson,
    );
    frameMs = performance.now() - start;
    diagnostics();
  }
}
function requestLevel() {
  if (!ready || !latest || $("mode").value === "original") return;
  const targetLevel = Number($("level").value),
    zoomRatio = state.initialScale > 0 ? state.scale / state.initialScale : 1,
    settled = Math.max(0, Math.min(19, targetLevel + Math.log2(zoomRatio))),
    level = quantizeAutoLevel(settled);
  $("level-value").value = targetLevel;
  $("level-value").textContent = targetLevel;
  if (latest.target !== level) {
    setStatus("Refining geometry…", "loading");
    void latest.select(level);
  }
}
function update(patch, { near = false } = {}) {
  if ("interacting" in patch) state.interacting = patch.interacting;
  if (patch.rotation || patch.scale !== undefined) {
    advanceCamera(); // advance to the event time before moving the goal
    const [lon, lat, roll] = patch.rotation ?? [];
    const z =
      patch.scale !== undefined
        ? Math.log(patch.scale / state.initialScale)
        : undefined;
    if (roll !== undefined)
      state.rotation = [...state.rotation.slice(0, 2), roll];
    if (near && lon !== undefined) camera.setGoalNear(lon, lat, z);
    else camera.setGoal({ lon, lat, z });
    if (nav.smooth) {
      if (!moving) {
        moving = true;
        lastTime = performance.now();
      }
    } else camera.snap();
    syncState();
  }
  schedule();
}
const gesture = createGlobeInteraction({
  getState: goalView,
  update,
  getSensitivity: () => nav,
  onActive: (v) => update({ interacting: v }),
});
const detach = attachGlobeInteraction(canvas, gesture);
function resize() {
  const width = canvas.clientWidth,
    height = canvas.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!width || !height) return;
  Object.assign(state, resizedView(state, width, height), { dpr });
  camera.setInitialScale(state.initialScale);
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
  update({ rotation: [0, -20, 0], scale: state.initialScale }, { near: true });
  gesture.rebase();
}
canvas.addEventListener("keydown", (e) => {
  if (["+", "=", "-"].includes(e.key)) {
    e.preventDefault();
    gesture.wheel(e.key === "-" ? 120 : -120);
  }
});
function startMoving() {
  if (!moving) {
    moving = true;
    lastTime = performance.now();
  }
  schedule();
}
const keyboard = createKeyboardControls({
  onThrust(thrust) {
    advanceCamera(); // advance to the event time before changing thrust
    camera.setThrust(thrust);
    startMoving();
  },
  onBrake() {
    camera.brake();
    moving = false;
    syncState();
    schedule();
  },
  onReset: reset,
});
const detachKeyboard = attachKeyboardControls(window, keyboard);
// Deterministic hook for browser tests: jump the camera without animation.
globalThis.globeDebug = {
  setView({ rotation, scale }) {
    camera.brake();
    moving = false;
    camera.setGoal({
      lon: rotation[0],
      lat: rotation[1],
      z: Math.log(scale / state.initialScale),
    });
    camera.snap();
    syncState();
    schedule();
  },
};
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
  quadtree = [];
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
    quadtree = result.quadtree ?? [];
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
function applyNav() {
  nav.smooth = $("smooth").checked;
  for (const [key, id] of NAV_SLIDERS) {
    nav[key] = Number($(id).value);
    $(id + "-value").textContent = $(id).value;
  }
  camera.setParams({ responseMs: nav.response, damping: nav.damping });
  applyTuning();
  if (!nav.smooth && moving && !camera.thrusting) {
    camera.snap();
    moving = false;
    syncState();
  }
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify(nav));
  } catch (e) {
    void e;
  }
  schedule();
}
$("smooth").checked = nav.smooth;
for (const [key, id] of NAV_SLIDERS) {
  $(id).value = nav[key];
  $(id + "-value").textContent = String(nav[key]);
  $(id).addEventListener("input", applyNav);
}
$("smooth").addEventListener("change", applyNav);
$("show-quadtree").addEventListener("change", schedule);
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
    detachKeyboard();
    observer.disconnect();
    if (raf) cancelAnimationFrame(raf);
  },
  { once: true },
);
void init();
