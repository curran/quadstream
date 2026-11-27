// Adapted from VizHub rPa9vFJ0kEvpjaJn-280C (MIT). Geometry only.
import { filterVisibleFeatures } from "./cull.mjs";
import { createViewClipper } from "./clip.mjs";

export function createGlobeRenderer(
  d3,
  ctx,
  { cull = false, clip = false } = {},
) {
  const projection = d3.geoOrthographic(),
    path = d3.geoPath(projection, ctx),
    graticule = d3.geoGraticule()();
  const sphere = { type: "Sphere" };
  const capCache = cull || clip ? new WeakMap() : null;
  const clipper = clip ? createViewClipper() : null;
  let oceanKey;
  let ocean;
  function drawShape(g, fill, stroke) {
    ctx.beginPath();
    path(g);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
  return (state, geojson, source) => {
    const {
      width,
      height,
      rotation,
      scale,
      translation,
      interacting,
      dpr = 1,
    } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    projection.rotate(rotation).scale(scale).translate(translation);
    ctx.save();
    if (!interacting) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#8b7cf6";
    }
    const key = `${width}x${height}`;
    if (key !== oceanKey) {
      oceanKey = key;
      ocean = ctx.createRadialGradient(
        width * 0.35,
        height * 0.3,
        0,
        width * 0.35,
        height * 0.3,
        Math.max(width, height) * 0.75,
      );
      ocean.addColorStop(0, "#2e2a5c");
      ocean.addColorStop(0.6, "#1e1c46");
      ocean.addColorStop(1, "#12122c");
    }
    ctx.fillStyle = ocean;
    ctx.strokeStyle = "#b7a9f5";
    ctx.lineWidth = 1.5;
    drawShape(sphere, true, true);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#5c5c96";
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.5;
    drawShape(graticule, false, true);
    ctx.fillStyle = "#2b2856";
    ctx.strokeStyle = "#8f86d9";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.5;
    let target = geojson,
      stats = null;
    if (clipper) {
      const res = clipper(geojson, state, source);
      target = res.geojson;
      stats = res.stats;
    } else if (cull)
      target = filterVisibleFeatures(geojson, state, capCache, source);
    if (target?.features?.length) {
      ctx.beginPath();
      path(target);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // `visible` is exactly what was handed to d3 for the land layer.
    return { visible: target, stats };
  };
}
