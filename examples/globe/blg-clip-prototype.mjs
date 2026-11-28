// IP4b experiment on a single already-validated ring; not a worker path.
// Positions exclude the closing duplicate. The tree and coordinates must stay
// immutable, and priorities must represent a camera-independent effective LOD.
import { selectBlgPositions } from "../../dist/blg.js";
import { clipRing, ringInfo } from "./clip.mjs";
import { lonLatToVec } from "./cull.mjs";

const EPS = 1e-9;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A box encloses all subtree vertices. Its minimum dot product with the
// normalized midpoint provides an enclosing spherical cap. A cap strictly
// smaller than a hemisphere also encloses every internal minor-arc shortcut.
function boundsFor(tree, coordinates) {
  if (coordinates.length !== tree.count)
    throw new Error("BLG positions and coordinates must match");
  const bounds = new WeakMap(),
    stack = [];
  if (tree.root) stack.push([tree.root, false]);
  while (stack.length) {
    const [node, done] = stack.pop();
    if (!done) {
      stack.push([node, true]);
      if (node.left) stack.push([node.left, false]);
      if (node.right) stack.push([node.right, false]);
      continue;
    }
    const [lon, lat] = coordinates[node.position];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90)
      throw new Error("Invalid spherical coordinate");
    const v = lonLatToVec(lon, lat),
      lo = [...v],
      hi = [...v];
    let size = 1;
    for (const child of [node.left, node.right]) {
      if (!child) continue;
      const b = bounds.get(child);
      size += b.size;
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], b.lo[i]);
        hi[i] = Math.max(hi[i], b.hi[i]);
      }
    }
    const mid = lo.map((x, i) => (x + hi[i]) / 2),
      len = Math.hypot(...mid);
    let cap = null;
    if (len > EPS) {
      const center = mid.map((x) => x / len),
        lower = dot(
          center,
          center.map((x, i) => (x >= 0 ? lo[i] : hi[i])),
        ),
        radius = Math.acos(Math.max(-1, Math.min(1, lower))) + EPS;
      if (radius < Math.PI / 2 - EPS) cap = { center, radius };
    }
    bounds.set(node, { lo, hi, cap, size });
  }
  return bounds;
}

function disjoint(cap, w) {
  if (!cap || !(w.radius >= 0 && w.radius < Math.PI / 2)) return false;
  const d = Math.acos(
    Math.max(-1, Math.min(1, dot(cap.center, [w.cx, w.cy, w.cz]))),
  );
  return d > cap.radius + w.radius + EPS;
}

function selection(maxLevel) {
  if ((!Number.isFinite(maxLevel) && maxLevel !== Infinity) || maxLevel < 0)
    throw new Error("Invalid selection level");
  if (maxLevel === Infinity) maxLevel = Number.MAX_SAFE_INTEGER;
  const whole = Math.floor(maxLevel),
    fraction = maxLevel - whole,
    limit = fraction ? whole + 1 : whole;
  return {
    eligible: (node) => node && node.level <= limit,
    selected: (node) =>
      node.level <= whole ||
      (fraction > 0 && node.level === whole + 1 && node.random >= 1 - fraction),
  };
}

// Extremal selected endpoints may require descent at fractional thresholds.
// Count these visits explicitly; do not assume an O(1) span summary.
function extreme(root, pick, reverse, stats) {
  const stack = [];
  let node = root;
  while (node || stack.length) {
    while (pick.eligible(node)) {
      stats.endpointVisits++;
      stack.push(node);
      node = reverse ? node.right : node.left;
    }
    if (!stack.length) break;
    node = stack.pop();
    if (pick.selected(node)) return node.position;
    node = reverse ? node.left : node.right;
  }
  return null;
}

const closed = (points) => (points.length ? [...points, points[0]] : []);

export function createBlgClipPrototype(tree, coordinates) {
  const bounds = boundsFor(tree, coordinates);
  return (w, level, side = -1, { reverse = false } = {}) => {
    const pick = selection(level),
      positions = [],
      stack = [],
      stats = {
        traversalVisits: 0,
        endpointVisits: 0,
        prunedSubtrees: 0,
        coveredStoredNodes: 0,
        compactedVertices: 0,
        fallback: false,
      };
    const reference = () => {
      stats.fallback = true;
      const all = selectBlgPositions(tree, level);
      if (reverse) all.reverse();
      return clipRing(
        w,
        ringInfo(closed(all.map((i) => coordinates[i]))),
        side,
      );
    };
    if (tree.root) stack.push([tree.root, false]);
    while (stack.length) {
      const [node, emit] = stack.pop();
      if (emit) {
        if (pick.selected(node)) positions.push(node.position);
        continue;
      }
      if (!pick.eligible(node)) continue;
      stats.traversalVisits++;
      const b = bounds.get(node);
      if (b.size > 2 && disjoint(b.cap, w)) {
        const first = extreme(node, pick, reverse, stats),
          last = extreme(node, pick, !reverse, stats);
        if (first !== null) positions.push(first);
        if (last !== null && last !== first) positions.push(last);
        stats.prunedSubtrees++;
        stats.coveredStoredNodes += b.size;
        continue;
      }
      const first = reverse ? node.right : node.left,
        last = reverse ? node.left : node.right;
      if (last) stack.push([last, false]);
      stack.push([node, true]);
      if (first) stack.push([first, false]);
    }
    stats.compactedVertices = positions.length;
    // Joining edges between spans remain real selected edges. Only internal
    // edges of certified exterior spans are replaced by an exterior chord.
    const result = clipRing(
      w,
      ringInfo(closed(positions.map((i) => coordinates[i]))),
      side,
    );
    // No crossing requires the original winding; never infer enclosure from
    // pruned spans. Also recover if compaction collapsed a short ring.
    return {
      result:
        stats.prunedSubtrees &&
        (positions.length < 3 || result.status !== "clipped")
          ? reference()
          : result,
      stats,
    };
  };
}
