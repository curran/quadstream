import type { Bounds, Position } from "./types.js";

export function assertPosition(value: unknown): Position {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    throw new Error("Coordinates must be finite planar [x, y] pairs");
  }
  return [
    Object.is(value[0], -0) ? 0 : value[0],
    Object.is(value[1], -0) ? 0 : value[1],
  ];
}
export function boundsOf(points: readonly Position[]): Bounds {
  if (!points.length)
    throw new Error("Cannot construct bounds of empty coordinates");
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}
export function intersects(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export function assertBounds(b: Bounds): Bounds {
  if (
    !Array.isArray(b) ||
    b.length !== 4 ||
    !b.every(Number.isFinite) ||
    b[0] > b[2] ||
    b[1] > b[3]
  )
    throw new Error("Invalid [xmin,ymin,xmax,ymax] bounds");
  return b;
}
export function signedArea(ring: readonly Position[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i]!,
      q = ring[i + 1]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function orientation(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function within(a: Position, b: Position, p: Position): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}
/** Includes touching endpoints; callers skip adjacent polygon edges. */
export function segmentsIntersect(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  // Inclusive AABB rejection: disjoint boxes cannot touch or cross.
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false;
  const abC = orientation(a, b, c),
    abD = orientation(a, b, d),
    cdA = orientation(c, d, a),
    cdB = orientation(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  )
    return true;
  return (
    (abC === 0 && within(a, b, c)) ||
    (abD === 0 && within(a, b, d)) ||
    (cdA === 0 && within(c, d, a)) ||
    (cdB === 0 && within(c, d, b))
  );
}
function same(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
/** O(n^2) reference predicate; retained as the oracle for the indexed validator. */
export function simpleClosedRingReference(ring: readonly Position[]): boolean {
  const n = ring.length - 1;
  if (n < 3 || !same(ring[0]!, ring[n]!) || signedArea(ring) === 0)
    return false;
  for (let i = 0; i < n; i++) {
    if (same(ring[i]!, ring[i + 1]!)) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!))
        return false;
    }
  }
  return true;
}
/** Rings below this many segments use the quadratic loops directly. */
const INDEX_MIN_SEGMENTS = 24;
/** Segment bounding boxes plus segment ids sorted by minimum x for sweeps. */
interface SegmentBoxes {
  count: number;
  minX: Float64Array;
  maxX: Float64Array;
  minY: Float64Array;
  maxY: Float64Array;
  order: Uint32Array;
}
function segmentBoxes(ring: readonly Position[]): SegmentBoxes | null {
  const count = ring.length - 1,
    minX = new Float64Array(count),
    maxX = new Float64Array(count),
    minY = new Float64Array(count),
    maxY = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = ring[i]!,
      b = ring[i + 1]!;
    if (
      !Number.isFinite(a[0] + a[1] + b[0] + b[1]) ||
      a.length !== 2 ||
      b.length !== 2
    )
      return null;
    minX[i] = Math.min(a[0], b[0]);
    maxX[i] = Math.max(a[0], b[0]);
    minY[i] = Math.min(a[1], b[1]);
    maxY[i] = Math.max(a[1], b[1]);
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((p, q) => minX[p]! - minX[q]! || p - q);
  return { count, minX, maxX, minY, maxY, order };
}
/** Each unordered segment pair with overlapping boxes is visited once; true stops. */
function sweepSelf(
  s: SegmentBoxes,
  visit: (i: number, j: number) => boolean,
): boolean {
  const { count, minX, maxX, minY, maxY, order } = s;
  for (let a = 0; a < count; a++) {
    const i = order[a]!,
      reach = maxX[i]!;
    for (let b = a + 1; b < count; b++) {
      const j = order[b]!;
      if (minX[j]! > reach) break;
      if (minY[j]! > maxY[i]! || maxY[j]! < minY[i]!) continue;
      if (visit(i, j)) return true;
    }
  }
  return false;
}
function sweepBetween(
  A: SegmentBoxes,
  B: SegmentBoxes,
  visit: (i: number, j: number) => boolean,
): boolean {
  let ia = 0,
    ib = 0;
  while (ia < A.count && ib < B.count) {
    const i = A.order[ia]!,
      j = B.order[ib]!;
    if (A.minX[i]! <= B.minX[j]!) {
      for (let k = ib; k < B.count; k++) {
        const m = B.order[k]!;
        if (B.minX[m]! > A.maxX[i]!) break;
        if (B.minY[m]! > A.maxY[i]! || B.maxY[m]! < A.minY[i]!) continue;
        if (visit(i, m)) return true;
      }
      ia++;
    } else {
      for (let k = ia; k < A.count; k++) {
        const m = A.order[k]!;
        if (A.minX[m]! > B.maxX[j]!) break;
        if (A.minY[m]! > B.maxY[j]! || A.maxY[m]! < B.minY[j]!) continue;
        if (visit(m, j)) return true;
      }
      ib++;
    }
  }
  return false;
}
/** Sweep-and-prune over segment boxes; exact predicates only on overlapping candidates. */
export function simpleClosedRing(ring: readonly Position[]): boolean {
  const n = ring.length - 1;
  if (n < INDEX_MIN_SEGMENTS) return simpleClosedRingReference(ring);
  if (!same(ring[0]!, ring[n]!) || signedArea(ring) === 0) return false;
  for (let i = 0; i < n; i++) if (same(ring[i]!, ring[i + 1]!)) return false;
  const boxes = segmentBoxes(ring);
  if (!boxes) return simpleClosedRingReference(ring);
  return !sweepSelf(boxes, (p, q) => {
    const i = Math.min(p, q),
      j = Math.max(p, q);
    if (j === i + 1 || (i === 0 && j === n - 1)) return false;
    return segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!);
  });
}
export function pointInRing(p: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (orientation(a, b, p) === 0 && within(a, b, p)) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function ringsIntersectReference(
  a: readonly Position[],
  b: readonly Position[],
): boolean {
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++)
      if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
  return false;
}
/** Touching counts as intersecting. Boxes are cached per validPolygon call. */
function ringsIntersect(
  a: readonly Position[],
  b: readonly Position[],
  cache: Map<readonly Position[], SegmentBoxes | null>,
): boolean {
  if (a.length - 1 < INDEX_MIN_SEGMENTS && b.length - 1 < INDEX_MIN_SEGMENTS)
    return ringsIntersectReference(a, b);
  const boxesOf = (r: readonly Position[]) => {
    if (!cache.has(r)) cache.set(r, segmentBoxes(r));
    return cache.get(r)!;
  };
  const A = boxesOf(a),
    B = boxesOf(b);
  if (!A || !B) return ringsIntersectReference(a, b);
  return sweepBetween(A, B, (i, j) =>
    segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!),
  );
}
export function validPolygon(rings: readonly Position[][]): boolean {
  if (!rings.length || rings.some((r) => !simpleClosedRing(r))) return false;
  const cache = new Map<readonly Position[], SegmentBoxes | null>();
  for (let i = 1; i < rings.length; i++) {
    if (
      !pointInRing(rings[i]![0]!, rings[0]!) ||
      ringsIntersect(rings[0]!, rings[i]!, cache)
    )
      return false;
    for (let j = 1; j < i; j++) {
      if (
        ringsIntersect(rings[j]!, rings[i]!, cache) ||
        pointInRing(rings[i]![0]!, rings[j]!) ||
        pointInRing(rings[j]![0]!, rings[i]!)
      )
        return false;
    }
  }
  return true;
}
