import type { Position, Vertex } from "./types.js";
import { simpleClosedRing, validPolygon, signedArea } from "./geometry.js";

export type UnitVector = readonly [number, number, number];
const rad = Math.PI / 180;
const eps = 1e-10;
const dot = (a: UnitVector, b: UnitVector) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: UnitVector, b: UnitVector): UnitVector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: UnitVector) => Math.hypot(...a);
function unit(a: UnitVector): UnitVector {
  const n = norm(a);
  if (n < eps) throw new Error("Ambiguous spherical direction");
  return [a[0] / n, a[1] / n, a[2] / n];
}
/** Exact seam aliases only; no near-coordinate snapping. */
export function canonicalLonLat(value: unknown): Position {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((x) => typeof x === "number" && Number.isFinite(x))
  )
    throw new Error("Expected finite longitude/latitude pair");
  const [lon, lat] = value as [number, number];
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
    throw new Error("Longitude/latitude outside geographic range");
  return [
    Math.abs(lat) === 90 ? 0 : lon === 180 ? -180 : lon === 0 ? 0 : lon,
    lat === 0 ? 0 : lat,
  ];
}
/** Vector of an already canonical (validated, seam-aliased) longitude/latitude. */
function canonicalVector(lon: number, lat: number): UnitVector {
  if (Math.abs(lat) === 90) return [0, 0, Math.sign(lat)];
  const c = Math.cos(lat * rad),
    z = Math.sin(lat * rad);
  // Exact cardinal meridians lie on cube-cell boundaries. Avoid trig
  // residuals such as sin(-pi), without snapping nearby longitudes.
  switch (lon) {
    case -180:
      return [-c, 0, z];
    case -90:
      return [0, -c, z];
    case 0:
      return [c, 0, z];
    case 90:
      return [0, c, z];
    default:
      return [c * Math.cos(lon * rad), c * Math.sin(lon * rad), z];
  }
}
export function lonLatVector(p: Position): UnitVector {
  const [lon, lat] = canonicalLonLat(p);
  return canonicalVector(lon, lat);
}
export function angularDistance(a: Position, b: Position): number {
  const u = lonLatVector(a),
    v = lonLatVector(b);
  return Math.atan2(norm(cross(u, v)), dot(u, v));
}
function validVectorPath(vectors: readonly UnitVector[]): boolean {
  if (vectors.length < 2) return false;
  for (let i = 1; i < vectors.length; i++) {
    const u = vectors[i - 1]!,
      v = vectors[i]!,
      d = Math.atan2(norm(cross(u, v)), dot(u, v));
    if (d <= eps || Math.PI - d <= eps) return false;
  }
  return true;
}
export function validGreatCirclePath(path: readonly Position[]): boolean {
  if (path.length < 2) return false;
  return validVectorPath(path.map(lonLatVector));
}
export type CubeFace = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export interface SphericalCell {
  vertexId: number;
  face: CubeFace;
  level: number;
  i: number;
  j: number;
  key: string;
}
export interface SphericalPriorities {
  maxLevel: number;
  cells: SphericalCell[];
  levelByVertexId: number[];
}
const FACES: readonly CubeFace[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
/** Face index into FACES plus face coordinates; computed once per vertex. */
interface FaceCoords {
  face: number;
  u: number;
  v: number;
}
function faceCoords([x, y, z]: UnitVector): FaceCoords {
  // Fixed axis order breaks exact and roundoff-sized seam ties.
  const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (m - Math.abs(x) <= 1e-15)
    return { face: x >= 0 ? 0 : 1, u: y / Math.abs(x), v: z / Math.abs(x) };
  if (m - Math.abs(y) <= 1e-15)
    return { face: y >= 0 ? 2 : 3, u: x / Math.abs(y), v: z / Math.abs(y) };
  return { face: z >= 0 ? 4 : 5, u: x / Math.abs(z), v: y / Math.abs(z) };
}
function cellIndex(t: number, side: number): number {
  return Math.max(0, Math.min(side - 1, Math.floor(((t + 1) * side) / 2)));
}
function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 25)
    throw new Error("Spherical level must be 0..25");
}
export function sphericalCellAddress(
  p: Position,
  level: number,
): Omit<SphericalCell, "vertexId"> {
  assertLevel(level);
  const { face, u, v } = faceCoords(lonLatVector(p)),
    side = 2 ** level,
    i = cellIndex(u, side),
    j = cellIndex(v, side),
    name = FACES[face]!;
  return {
    face: name,
    level,
    i,
    j,
    key: name + ":" + level + ":" + i + ":" + j,
  };
}
// Face and indices pack into one exact double: 6 * 2^50 < 2^53.
const SIDE_MAX = 2 ** 25;
const packCell = (face: number, i: number, j: number) =>
  (face * SIDE_MAX + i) * SIDE_MAX + j;
export function buildSphericalPriorities(
  vertices: readonly Vertex[],
  maxLevel = 20,
): SphericalPriorities {
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 26)
    throw new Error("maxLevel must be 1..26");
  interface Prepared {
    id: number;
    critical: boolean;
    x: number;
    y: number;
    face: FaceCoords;
  }
  const seen = new Set<string>(),
    ids = new Uint8Array(vertices.length);
  const sorted: Prepared[] = vertices
    .map((v) => {
      const [x, y] = canonicalLonLat([v.x, v.y]);
      const k = x + "," + y;
      if (
        seen.has(k) ||
        !Number.isSafeInteger(v.id) ||
        v.id < 0 ||
        v.id >= vertices.length ||
        ids[v.id]
      )
        throw new Error("Expected distinct canonical vertices and dense IDs");
      seen.add(k);
      ids[v.id] = 1;
      return {
        id: v.id,
        critical: v.critical,
        x,
        y,
        face: faceCoords(canonicalVector(x, y)),
      };
    })
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        a.x - b.x ||
        a.y - b.y ||
        a.id - b.id,
    );
  const occupied: Set<number>[] = Array.from(
      { length: maxLevel },
      () => new Set<number>(),
    ),
    sides = Array.from({ length: maxLevel }, (_, level) => 2 ** level),
    cells: SphericalCell[] = [],
    levelByVertexId: number[] = [];
  for (const v of sorted) {
    let found = false;
    for (let level = 0; level < maxLevel; level++) {
      const side = sides[level]!,
        i = cellIndex(v.face.u, side),
        j = cellIndex(v.face.v, side),
        packed = packCell(v.face.face, i, j);
      if (occupied[level]!.has(packed)) continue;
      occupied[level]!.add(packed);
      const face = FACES[v.face.face]!;
      cells.push({
        vertexId: v.id,
        face,
        level,
        i,
        j,
        key: face + ":" + level + ":" + i + ":" + j,
      });
      levelByVertexId[v.id] = level;
      found = true;
      break;
    }
    if (!found)
      throw new Error("Spherical quadtree capacity exceeded at vertex " + v.id);
  }
  cells.sort(
    (a, b) =>
      a.level - b.level ||
      (a.face < b.face ? -1 : a.face > b.face ? 1 : 0) ||
      a.i - b.i ||
      a.j - b.j ||
      a.vertexId - b.vertexId,
  );
  return { maxLevel, cells, levelByVertexId };
}

/** Conservative reference chart: minor geodesics become straight segments in an open hemisphere. */
export interface SphericalChart {
  center: UnitVector;
  east: UnitVector;
  north: UnitVector;
}
export function sphericalChart(ring: readonly Position[]): SphericalChart {
  const points = ring.slice(0, -1).map(lonLatVector);
  let sum: UnitVector = [0, 0, 0];
  for (const p of points) sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
  const center = unit(sum);
  if (points.some((p) => dot(p, center) <= eps))
    throw new Error("Ring outside supported open-hemisphere chart");
  const ref: UnitVector = Math.abs(center[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const east = unit(cross(ref, center)),
    north = cross(center, east);
  return { center, east, north };
}
export function projectSpherical(p: Position, chart: SphericalChart): Position {
  return projectVector(lonLatVector(p), chart);
}
function projectVector(v: UnitVector, chart: SphericalChart): Position {
  const d = dot(v, chart.center);
  if (d <= eps)
    throw new Error("Position outside supported open-hemisphere chart");
  return [dot(v, chart.east) / d, dot(v, chart.north) / d];
}
function ringOnChart(
  ring: readonly Position[],
  chart: SphericalChart,
): Position[] {
  const p = ring.map(canonicalLonLat),
    vectors = p.map(([lon, lat]) => canonicalVector(lon, lat));
  if (
    p.length < 4 ||
    p[0]![0] !== p[p.length - 1]![0] ||
    p[0]![1] !== p[p.length - 1]![1] ||
    !validVectorPath(vectors)
  )
    throw new Error("Invalid spherical ring");
  const xy = vectors.map((v) => projectVector(v, chart));
  if (!simpleClosedRing(xy) || Math.abs(signedArea(xy)) <= eps * eps)
    throw new Error("Degenerate or self-intersecting spherical ring");
  // Reject overlapping adjacent great-circle edges (including numerical near-overlap).
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[(i + xy.length - 2) % (xy.length - 1)]!,
      b = xy[i]!,
      c = xy[i + 1]!;
    const ux = a[0] - b[0],
      uy = a[1] - b[1],
      vx = c[0] - b[0],
      vy = c[1] - b[1];
    if (
      ux * vx + uy * vy > 0 &&
      Math.abs(ux * vy - uy * vx) <=
        eps * Math.hypot(ux, uy) * Math.hypot(vx, vy)
    )
      throw new Error("Overlapping adjacent spherical edges");
  }
  return xy;
}
export interface SphericalPolygonSignature {
  chart: SphericalChart;
  signs: number[];
}
/** D3 convention: clockwise shell denotes the small interior. Counterclockwise
 * shells denote the complement; complement polygons with holes are not supported. */
export function sphericalPolygonSignature(
  rings: readonly Position[][],
  chart?: SphericalChart,
): SphericalPolygonSignature {
  if (!rings.length) throw new Error("Empty spherical polygon");
  const c = chart ?? sphericalChart(rings[0]!);
  const xy = rings.map((r) => ringOnChart(r, c)),
    signs = xy.map((r) => Math.sign(signedArea(r)));
  if (signs[0] === 1 && rings.length > 1)
    throw new Error("Complement polygons with holes are unsupported");
  if (signs.slice(1).some((s) => s === signs[0]) || !validPolygon(xy))
    throw new Error("Invalid spherical hole winding or containment");
  return { chart: c, signs };
}
export function validSphericalPolygon(
  rings: readonly Position[][],
  source?: SphericalPolygonSignature,
): boolean {
  try {
    const result = sphericalPolygonSignature(rings, source?.chart);
    return (
      !source ||
      (result.signs.length === source.signs.length &&
        result.signs.every((s, i) => s === source.signs[i]))
    );
  } catch {
    return false;
  }
}
