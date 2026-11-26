export function packGeometry(geojson) {
  let metaLen = 0;
  let coordCount = 0;
  const features = geojson.features;
  for (let i = 0; i < features.length; i++) {
    const geom = features[i].geometry;
    const polys =
      geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    metaLen += 1;
    for (let p = 0; p < polys.length; p++) {
      const rings = polys[p];
      metaLen += 1 + rings.length;
      for (let r = 0; r < rings.length; r++) {
        coordCount += rings[r].length * 2;
      }
    }
  }
  const meta = new Int32Array(metaLen);
  const coords = new Float64Array(coordCount);
  let mi = 0;
  let ci = 0;
  for (let i = 0; i < features.length; i++) {
    const geom = features[i].geometry;
    const polys =
      geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    meta[mi++] = polys.length;
    for (let p = 0; p < polys.length; p++) {
      const rings = polys[p];
      meta[mi++] = rings.length;
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        meta[mi++] = ring.length;
        for (let k = 0; k < ring.length; k++) {
          const pt = ring[k];
          coords[ci++] = pt[0];
          coords[ci++] = pt[1];
        }
      }
    }
  }
  return { coords, meta };
}

export function unpackGeometry(original, coords, meta) {
  let mi = 0;
  let ci = 0;
  const features = original.features.map((f) => {
    const polyCount = meta[mi++];
    const polys = new Array(polyCount);
    for (let p = 0; p < polyCount; p++) {
      const ringCount = meta[mi++];
      const rings = new Array(ringCount);
      for (let r = 0; r < ringCount; r++) {
        const pointCount = meta[mi++];
        const ring = new Array(pointCount);
        for (let k = 0; k < pointCount; k++) {
          ring[k] = [coords[ci++], coords[ci++]];
        }
        rings[r] = ring;
      }
      polys[p] = rings;
    }
    const type = f.geometry.type;
    const out = {
      type: "Feature",
      properties: f.properties,
      geometry: {
        type,
        coordinates: type === "Polygon" ? polys[0] : polys,
      },
    };
    if (f.id !== undefined) out.id = f.id;
    return out;
  });
  return { type: "FeatureCollection", features };
}
