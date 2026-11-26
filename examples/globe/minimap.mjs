import { filterVisibleFeatures, orthographicViewCone } from "./cull.mjs";

export function projectedViewportRing(d3, state, samplesPerEdge = 20) {
  const { width, height, rotation, scale, translation } = state;
  if (!width || !height || !(scale > 0)) return null;
  const tx = translation?.[0] ?? width / 2,
    ty = translation?.[1] ?? height / 2,
    proj = d3
      .geoOrthographic()
      .rotate(rotation)
      .scale(scale)
      .translate([tx, ty]),
    maxR = scale * 0.999;

  const sample = (x, y) => {
    const dx = x - tx,
      dy = y - ty,
      dist = Math.hypot(dx, dy);
    const sx = dist > maxR ? tx + (dx * maxR) / dist : x,
      sy = dist > maxR ? ty + (dy * maxR) / dist : y;
    return proj.invert([sx, sy]);
  };

  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const ring = [];
  for (let e = 0; e < 4; e++) {
    const [x0, y0] = corners[e],
      [x1, y1] = corners[(e + 1) % 4];
    for (let s = 0; s < samplesPerEdge; s++) {
      const t = s / samplesPerEdge,
        pt = sample(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) ring.push(pt);
    }
  }
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: ring },
  };
}

export function createMinimapRenderer(d3, ctx) {
  const projection = d3.geoOrthographic(),
    path = d3.geoPath(projection, ctx),
    graticule = d3.geoGraticule()(),
    sphere = { type: "Sphere" },
    capCache = new WeakMap();

  return (state, geojson) => {
    const size = state.miniSize ?? 160,
      dpr = state.dpr ?? 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    projection
      .rotate(state.rotation)
      .scale(size * 0.44)
      .translate([size / 2, size / 2]);

    ctx.save();
    ctx.fillStyle = "#12122c";
    ctx.strokeStyle = "#5c5c96";
    ctx.lineWidth = 1;
    ctx.beginPath();
    path(sphere);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#454275";
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    path(graticule);
    ctx.stroke();

    if (geojson?.features?.length) {
      // Dimmed full globe context so culled/excluded polygons remain visible.
      ctx.fillStyle = "#222044";
      ctx.strokeStyle = "#4c487d";
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      path(geojson);
      ctx.fill();
      ctx.stroke();

      // Highlighted polygons that pass bounding-cap culling.
      const visible = filterVisibleFeatures(geojson, state, capCache);
      if (visible.features.length) {
        ctx.fillStyle = "#3f3880";
        ctx.strokeStyle = "#c4b5fd";
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        path(visible);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Culling cone boundary (dashed sky-blue).
    const cone = orthographicViewCone(state),
      coneFeature = d3
        .geoCircle()
        .center([-state.rotation[0], -state.rotation[1]])
        .radius((cone.viewRadius * 180) / Math.PI)();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    path(coneFeature);
    ctx.stroke();
    ctx.setLineDash([]);

    // Projected screen viewport boundary (solid amber).
    const viewport = projectedViewportRing(d3, state);
    if (viewport) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      path(viewport);
      ctx.stroke();
    }
    ctx.restore();
  };
}
