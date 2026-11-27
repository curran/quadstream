import { validPolygon } from "./geometry.js";
import {
  buildBlgTree,
  selectBlgPositions,
  stableBlgRandom,
  type BlgTree,
} from "./blg.js";
import type { Arc, Feature, Position, TopologyFeature } from "./types.js";

export interface CoordinateLookup {
  (id: number): Position | undefined;
}
export interface ReconstructionResult {
  feature: Feature;
  missing: boolean;
  valid: boolean;
  selectedVertices: number;
}
export function buildArcTrees(
  arcs: readonly Arc[],
  levels: readonly number[],
  critical: readonly boolean[] = [],
): BlgTree[] {
  return arcs.map((arc) =>
    buildBlgTree(
      arc.vertexIds.map((id, i) =>
        i === 0 || i === arc.vertexIds.length - 1 ? 0 : levels[id]!,
      ),
      arc.vertexIds.map((id) => (critical[id] ? 1 : stableBlgRandom(id))),
    ),
  );
}
/** True when fewer than 3 distinct positions precede the closing vertex. */
function distinctBelow3(coords: readonly Position[]): boolean {
  const n = coords.length - 1;
  let first: Position | undefined, second: Position | undefined;
  for (let i = 0; i < n; i++) {
    const p = coords[i]!;
    if (!first) first = p;
    else if (p[0] !== first[0] || p[1] !== first[1]) {
      if (!second) second = p;
      else if (
        (p[0] !== second[0] || p[1] !== second[1]) &&
        (first[0] !== second[0] || first[1] !== second[1])
      )
        return false;
    }
  }
  return true;
}
export function reconstructFeature(
  f: TopologyFeature,
  arcs: readonly Arc[],
  trees: readonly BlgTree[],
  level: number | ((arcId: number) => number),
  lookup: CoordinateLookup,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _includeMissing = false,
  planarValidity = true,
): ReconstructionResult {
  let missing = false,
    selectedVertices = 0;
  const paths: Position[][] = [];
  for (const path of f.paths) {
    const coords: Position[] = [];
    let pathSelectedVertices = 0;
    for (const ref of path.arcs) {
      const arcId = Math.abs(ref) - 1,
        arc = arcs[arcId]!,
        tree = trees[arcId]!;
      const positions = selectBlgPositions(
        tree,
        typeof level === "number" ? level : level(arcId),
      );
      const last = positions.length - 1;
      for (let i = 0; i < positions.length; i++) {
        const id = arc.vertexIds[positions[ref < 0 ? last - i : i]!]!,
          xy = lookup(id);
        if (!xy) {
          missing = true;
          continue;
        }
        if (
          coords.length &&
          i === 0 &&
          xy[0] === coords.at(-1)![0] &&
          xy[1] === coords.at(-1)![1]
        )
          continue;
        coords.push(xy);
        pathSelectedVertices++;
      }
    }
    if (path.closed && distinctBelow3(coords)) {
      // Collapsed ring: restore every original vertex. Only this rare path
      // pays for walking all arc positions.
      coords.length = 0;
      pathSelectedVertices = 0;
      let lastId = -1;
      for (const ref of path.arcs) {
        const ids = arcs[Math.abs(ref) - 1]!.vertexIds;
        for (let k = 0; k < ids.length; k++) {
          const id = ids[ref < 0 ? ids.length - 1 - k : k]!;
          if (id === lastId) continue;
          lastId = id;
          const xy = lookup(id);
          if (
            xy &&
            (!coords.length ||
              xy[0] !== coords.at(-1)![0] ||
              xy[1] !== coords.at(-1)![1])
          ) {
            coords.push(xy);
            pathSelectedVertices++;
          }
        }
      }
    }
    // Coordinate identity is maintained; close polygons explicitly if needed.
    if (
      path.closed &&
      coords.length &&
      (coords[0]![0] !== coords.at(-1)![0] ||
        coords[0]![1] !== coords.at(-1)![1])
    )
      coords.push(coords[0]!);
    selectedVertices += pathSelectedVertices;
    paths.push(coords);
  }
  const groups = f.groups.map((group) => group.map((i) => paths[i]!));
  let geometry: Feature["geometry"];
  let valid = true;
  const checkPolygon = planarValidity ? validPolygon : () => true;
  switch (f.geometryType) {
    case "Polygon":
      geometry = { type: "Polygon", coordinates: groups[0]! };
      valid = checkPolygon(groups[0]!);
      break;
    case "MultiPolygon":
      geometry = { type: "MultiPolygon", coordinates: groups };
      valid = groups.every(checkPolygon);
      break;
    case "LineString":
      geometry = { type: "LineString", coordinates: groups[0]![0]! };
      valid = groups[0]![0]!.length >= 2;
      break;
    case "MultiLineString":
      geometry = {
        type: "MultiLineString",
        coordinates: groups.map((g) => g[0]!),
      };
      valid = groups.every((g) => g[0]!.length >= 2);
      break;
  }
  return {
    feature: {
      type: "Feature",
      id: f.id,
      properties: { ...f.properties },
      geometry,
    },
    missing,
    valid,
    selectedVertices,
  };
}
