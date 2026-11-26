import { validPolygon, simpleClosedRing } from "./geometry.js";
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
export function reconstructFeature(
  f: TopologyFeature,
  arcs: readonly Arc[],
  trees: readonly BlgTree[],
  level: number | ((arcId: number) => number),
  lookup: CoordinateLookup,
  includeMissing = false,
): ReconstructionResult {
  let missing = false,
    selectedVertices = 0;
  const paths: Position[][] = [];
  for (const path of f.paths) {
    const coords: Position[] = [],
      allIds: number[] = [];
    let pathSelectedVertices = 0;
    for (const ref of path.arcs) {
      const arcId = Math.abs(ref) - 1,
        arc = arcs[arcId]!,
        tree = trees[arcId]!;
      const positions = selectBlgPositions(
        tree,
        typeof level === "number" ? level : level(arcId),
      );
      if (ref < 0) positions.reverse();
      const orderedIds = ref < 0 ? [...arc.vertexIds].reverse() : arc.vertexIds;
      for (const id of orderedIds)
        if (!allIds.length || allIds.at(-1) !== id) allIds.push(id);
      for (let i = 0; i < positions.length; i++) {
        const id = arc.vertexIds[positions[i]!]!,
          xy = lookup(id);
        if (!xy) {
          missing = true;
          if (includeMissing) continue;
          else continue;
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
    if (path.closed) {
      const distinct = new Set(coords.slice(0, -1).map((p) => p.join(",")));
      if (distinct.size < 3) {
        coords.length = 0;
        pathSelectedVertices = 0;
        for (const id of allIds) {
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
  switch (f.geometryType) {
    case "Polygon":
      geometry = { type: "Polygon", coordinates: groups[0]! };
      valid = validPolygon(groups[0]!);
      break;
    case "MultiPolygon":
      geometry = { type: "MultiPolygon", coordinates: groups };
      valid = groups.every(validPolygon);
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
  // A closed ring whose last segment collapses must not be accepted by accident.
  if (f.geometryType === "Polygon" && !groups[0]!.every(simpleClosedRing))
    valid = false;
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
