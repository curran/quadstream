import { buildTopology } from "./topology.js";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  Position,
} from "./types.js";

type Obj = Record<string, unknown>;
function obj(v: unknown, label: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid " + label);
  return v as Obj;
}
function arr(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new Error("Invalid " + label);
  return v;
}
function pos(v: unknown): Position {
  const a = arr(v, "position");
  if (
    a.length !== 2 ||
    a.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    throw new Error("Expected finite planar 2D position");
  return [a[0] as number, a[1] as number];
}
function same(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
function path(v: unknown, closed: boolean): Position[] {
  const p = arr(v, "coordinate path").map(pos);
  if (p.length < (closed ? 4 : 2) || (closed && !same(p[0]!, p.at(-1)!)))
    throw new Error("Invalid or unclosed coordinate path");
  return p;
}
function nonempty<T>(a: T[]): T[] {
  if (!a.length) throw new Error("Empty geometry");
  return a;
}
function geom(v: unknown): Geometry {
  const g = obj(v, "geometry"),
    c = g.coordinates;
  switch (g.type) {
    case "LineString":
      return { type: g.type, coordinates: path(c, false) };
    case "MultiLineString":
      return {
        type: g.type,
        coordinates: nonempty(arr(c, "lines").map((x) => path(x, false))),
      };
    case "Polygon":
      return {
        type: g.type,
        coordinates: nonempty(arr(c, "rings").map((x) => path(x, true))),
      };
    case "MultiPolygon":
      return {
        type: g.type,
        coordinates: nonempty(
          arr(c, "polygons").map((x) =>
            nonempty(arr(x, "rings").map((y) => path(y, true))),
          ),
        ),
      };
    default:
      throw new Error("Unsupported geometry: " + String(g.type));
  }
}
function feature(g: Geometry, metadata: Obj): Feature {
  const id = metadata.id;
  if (
    id !== undefined &&
    typeof id !== "string" &&
    !(typeof id === "number" && Number.isFinite(id))
  )
    throw new Error("Invalid feature id");
  const properties =
    metadata.properties == null
      ? null
      : { ...obj(metadata.properties, "properties") };
  return {
    type: "Feature",
    ...(id === undefined ? {} : { id: id as string | number }),
    properties,
    geometry: g,
  };
}
function collection(
  features: Feature[],
  allowEmpty = false,
): FeatureCollection {
  const fc: FeatureCollection = { type: "FeatureCollection", features };
  if (features.length || !allowEmpty) buildTopology(fc);
  return fc;
}
/** Strict planar GeoJSON subset. No CRS transformation, longitude wrapping or snapping. */
export function importGeoJSON(input: unknown): FeatureCollection {
  const root = obj(input, "GeoJSON");
  if ("crs" in root)
    throw new Error("Explicit CRS is unsupported; reproject before import");
  const values =
    root.type === "FeatureCollection" ? arr(root.features, "features") : [root];
  return collection(
    values.map((value) => {
      const f = obj(value, "feature");
      if (f.type !== "Feature" || "crs" in f)
        throw new Error("Expected GeoJSON Feature without CRS");
      return feature(geom(f.geometry), f);
    }),
  );
}
/** Output accepts an empty query result, unlike the build input. */
export function exportGeoJSON(input: FeatureCollection): FeatureCollection {
  if (input.type !== "FeatureCollection" || !Array.isArray(input.features))
    throw new Error("Expected FeatureCollection");
  if (!input.features.length)
    return { type: "FeatureCollection", features: [] };
  return importGeoJSON(input);
}

type TopoGeometry = {
  type: Geometry["type"];
  arcs: unknown;
  id?: string | number;
  properties?: Feature["properties"];
};
export interface TopoJSONTopology {
  type: "Topology";
  objects: Record<
    string,
    { type: "GeometryCollection"; geometries: TopoGeometry[] }
  >;
  arcs: Position[][];
}
/** Decode signed zero-based TopoJSON arcs; transformed arcs are delta-encoded per arc. */
export function importTopoJSON(input: unknown): FeatureCollection {
  const decoded = decodeTopoJSON(input);
  return collection(decoded.features);
}
/** Internal decoder: caller must apply the appropriate coordinate validation. */
export function decodeTopoJSON(
  input: unknown,
  objectName?: string,
  normalize?: (p: Position) => Position,
): FeatureCollection {
  const root = obj(input, "TopoJSON");
  if (root.type !== "Topology" || "crs" in root)
    throw new Error("Expected Topology without explicit CRS");
  let scale: Position | undefined, translate: Position | undefined;
  if (root.transform !== undefined) {
    const t = obj(root.transform, "transform");
    scale = pos(t.scale);
    translate = pos(t.translate);
    if (scale.some((n) => n === 0)) throw new Error("Invalid transform scale");
  }
  const arcs = arr(root.arcs, "arcs").map((raw) => {
    let x = 0,
      y = 0;
    const points = arr(raw, "arc").map((v) => {
      const p = pos(v);
      if (!scale || !translate) return normalize ? normalize(p) : p;
      if (!p.every(Number.isSafeInteger))
        throw new Error("Expected integer transformed delta");
      x += p[0];
      y += p[1];
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))
        throw new Error("Unsafe accumulated delta");
      const decoded = pos([
        x * scale[0] + translate[0],
        y * scale[1] + translate[1],
      ]);
      return normalize ? normalize(decoded) : decoded;
    });
    if (points.length < 2)
      throw new Error("Arc requires at least two positions");
    return points;
  });
  function stitch(v: unknown, closed: boolean): Position[] {
    const out: Position[] = [];
    for (const ref of nonempty(arr(v, "arc references"))) {
      if (typeof ref !== "number" || !Number.isSafeInteger(ref))
        throw new Error("Invalid arc reference");
      const index = ref < 0 ? -ref - 1 : ref,
        a = arcs[index];
      if (!a) throw new Error("Arc reference out of range");
      const oriented = ref < 0 ? [...a].reverse() : a;
      if (out.length && !same(out.at(-1)!, oriented[0]!))
        throw new Error("Disconnected arcs");
      for (let i = out.length ? 1 : 0; i < oriented.length; i++)
        out.push(oriented[i]!);
    }
    return path(out, closed);
  }
  function decode(value: unknown): Feature {
    const g = obj(value, "TopoJSON geometry"),
      a = g.arcs;
    switch (g.type) {
      case "LineString":
        return feature({ type: g.type, coordinates: stitch(a, false) }, g);
      case "MultiLineString":
        return feature(
          {
            type: g.type,
            coordinates: nonempty(arr(a, "lines").map((v) => stitch(v, false))),
          },
          g,
        );
      case "Polygon":
        return feature(
          {
            type: g.type,
            coordinates: nonempty(arr(a, "rings").map((v) => stitch(v, true))),
          },
          g,
        );
      case "MultiPolygon":
        return feature(
          {
            type: g.type,
            coordinates: nonempty(
              arr(a, "polygons").map((v) =>
                nonempty(arr(v, "rings").map((w) => stitch(w, true))),
              ),
            ),
          },
          g,
        );
      default:
        throw new Error("Unsupported TopoJSON geometry: " + String(g.type));
    }
  }
  const features: Feature[] = [];
  const objects = obj(root.objects, "objects");
  if (
    objectName !== undefined &&
    !Object.prototype.hasOwnProperty.call(objects, objectName)
  )
    throw new Error("Unknown TopoJSON object: " + objectName);
  for (const value of objectName === undefined
    ? Object.values(objects)
    : [objects[objectName]]) {
    const g = obj(value, "named object");
    if (g.type === "GeometryCollection")
      for (const child of arr(g.geometries, "geometries"))
        features.push(decode(child));
    else features.push(decode(g));
  }
  return { type: "FeatureCollection", features };
}
/** Export unquantized absolute-coordinate TopoJSON, with shared arcs stored once. */
export function exportTopoJSON(input: FeatureCollection): TopoJSONTopology {
  const fc = exportGeoJSON(input);
  if (!fc.features.length)
    return {
      type: "Topology",
      objects: { data: { type: "GeometryCollection", geometries: [] } },
      arcs: [],
    };
  const t = buildTopology(fc);
  const geometries = t.features.map((f, i): TopoGeometry => {
    const groups = f.groups.map((group) =>
      group.map((p) =>
        f.paths[p]!.arcs.map((ref) => (ref > 0 ? ref - 1 : ref)),
      ),
    );
    const arcs =
      f.geometryType === "LineString"
        ? groups[0]![0]
        : f.geometryType === "MultiLineString"
          ? groups.map((g) => g[0])
          : f.geometryType === "Polygon"
            ? groups[0]
            : groups;
    const original = fc.features[i]!;
    return {
      type: f.geometryType,
      arcs,
      ...(original.id === undefined ? {} : { id: original.id }),
      properties: original.properties,
    };
  });
  return {
    type: "Topology",
    objects: { data: { type: "GeometryCollection", geometries } },
    arcs: t.arcs.map((a) =>
      a.vertexIds.map((id) => [t.vertices[id]!.x, t.vertices[id]!.y]),
    ),
  };
}
