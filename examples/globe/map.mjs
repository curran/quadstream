// Adapted from VizHub rPa9vFJ0kEvpjaJn-280C (MIT). Geometry only.
import {
  computeFeatureCap,
  filterVisibleFeatures,
  isCapVisible,
  orthographicViewCone,
} from "./cull.mjs";
import { createViewClipper } from "./clip.mjs";

const faceAxes = {
  "+X": [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  "-X": [
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  "+Y": [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  "-Y": [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  "+Z": [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  "-Z": [
    [0, 0, -1],
    [1, 0, 0],
    [0, 1, 0],
  ],
};
function cellPoint(cell, u, v) {
  const [normal, uAxis, vAxis] = faceAxes[cell.face],
    x = normal[0] + u * uAxis[0] + v * vAxis[0],
    y = normal[1] + u * uAxis[1] + v * vAxis[1],
    z = normal[2] + u * uAxis[2] + v * vAxis[2],
    length = Math.hypot(x, y, z);
  return [
    (Math.atan2(y, x) * 180) / Math.PI,
    (Math.asin(z / length) * 180) / Math.PI,
  ];
}
function quadtreeGeometry(cells, level, state, capCache) {
  const cone = orthographicViewCone(state);
  const features = [];
  for (const cell of cells) {
    if (cell.level > level) continue;
    const side = 2 ** cell.level,
      min = -1 + (2 * cell.i) / side,
      max = -1 + (2 * (cell.i + 1)) / side,
      low = -1 + (2 * cell.j) / side,
      high = -1 + (2 * (cell.j + 1)) / side;
    let feature = {
      type: "Feature",
      properties: null,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            cellPoint(cell, min, low),
            cellPoint(cell, max, low),
            cellPoint(cell, max, high),
            cellPoint(cell, min, high),
            cellPoint(cell, min, low),
          ],
        ],
      },
    };
    let cap = capCache.get(cell);
    if (!cap) {
      cap = computeFeatureCap(feature);
      capCache.set(cell, cap);
    }
    if (isCapVisible(cap, cone)) features.push(feature);
  }
  return { type: "FeatureCollection", features };
}

function geometryRings(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates;
  if (geometry?.type === "MultiPolygon")
    return geometry.coordinates.flatMap((polygon) => polygon);
  return [];
}

function coordinateKey(point) {
  return `${Object.is(point[0], -0) ? 0 : point[0]},${Object.is(point[1], -0) ? 0 : point[1]}`;
}

function meshGeometry(geojson) {
  const edges = new Map();
  for (const feature of geojson?.features ?? []) {
    for (const ring of geometryRings(feature.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i],
          aKey = coordinateKey(a),
          bKey = coordinateKey(b);
        if (aKey === bKey) continue;
        const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        if (!edges.has(key)) edges.set(key, [a, b]);
      }
    }
  }
  return {
    type: "MultiLineString",
    coordinates: [...edges.values()],
  };
}

export function createGlobeRenderer(
  d3,
  ctx,
  { cull = false, clip = false } = {},
) {
  const projection = d3.geoOrthographic(),
    path = d3.geoPath(projection, ctx),
    graticule = d3.geoGraticule()(),
    finePrecision = projection.precision(),
    motionPrecision = 0.5;
  const sphere = { type: "Sphere" };
  const capCache = cull || clip ? new WeakMap() : null;
  const quadtreeCapCache = new WeakMap();
  const clipper = clip ? createViewClipper() : null;
  const meshCache = new WeakMap();
  let oceanKey;
  let ocean;
  function drawShape(g, fill, stroke) {
    ctx.beginPath();
    path(g);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
  return (state, geojson, source, quadtree = [], overlays = []) => {
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
      // While moving, land is resampled more coarsely and drawn without its
      // outline; the settled frame restores full precision and stroke.
      projection.precision(interacting ? motionPrecision : finePrecision);
      ctx.beginPath();
      path(target);
      ctx.fill();
      if (interacting) {
        let mesh = meshCache.get(target);
        if (!mesh) {
          mesh = meshGeometry(target);
          meshCache.set(target, mesh);
        }
        ctx.beginPath();
        path(mesh);
        ctx.stroke();
      } else ctx.stroke();
      projection.precision(finePrecision);
    }
    for (const { geometry, color, width } of overlays) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      drawShape(geometry, false, true);
    }
    if (state.showQuadtree && quadtree.length) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      path(
        quadtreeGeometry(
          quadtree,
          state.quadtreeLevel,
          state,
          quadtreeCapCache,
        ),
      );
      ctx.stroke();
    }
    ctx.restore();
    // `visible` is exactly what was handed to d3 for the land layer.
    return { visible: target, stats };
  };
}
