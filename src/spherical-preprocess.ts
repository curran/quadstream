import { buildBlgTree, type BlgTree } from "./blg.js";
import {
  validGreatCirclePath,
  validSphericalPolygon,
  type SphericalPolygonSignature,
} from "./spherical-geometry.js";
import type { Position, Topology } from "./types.js";

interface ValidationGroup {
  paths: number[][];
  signature: SphericalPolygonSignature | undefined;
}

/**
 * Build a nested hierarchy by removing vertices from valid full detail.
 * Batch at conservative tenth-LOD boundaries; when a batch fails, bisect it
 * until we identify individually unsafe removals. Rejected vertices remain
 * at level zero. Every accepted transition is validated in its actual context.
 *
 * The source quadtree priorities and ring visibility thresholds are not
 * changed. A shared vertex has one removal decision across all of its owners.
 * This uses the existing per-polygon/line reference validator, not a global
 * intersection arrangement for unrelated boundaries.
 */
export function buildTopologySafeArcTrees(
  topology: Topology,
  nominalActivation: readonly number[],
  signatures: readonly SphericalPolygonSignature[][],
): {
  trees: BlgTree[];
  activationLevels: number[];
  retainedVertices: number;
} {
  const { vertices, arcs, features } = topology;
  const positions = vertices.map(({ x, y }): Position => [x, y]);
  const anchors = new Uint8Array(vertices.length);
  for (const arc of arcs) {
    anchors[arc.vertexIds[0]!] = 1;
    anchors[arc.vertexIds.at(-1)!] = 1;
  }

  const groups: ValidationGroup[] = [];
  const owners = Array.from({ length: vertices.length }, (): number[] => []);
  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi]!;
    const paths = feature.paths.map((path) => {
      const ids: number[] = [];
      for (const ref of path.arcs) {
        const arc = arcs[Math.abs(ref) - 1]!.vertexIds;
        for (let i = 0; i < arc.length; i++) {
          const id = arc[ref < 0 ? arc.length - 1 - i : i]!;
          if (ids.at(-1) !== id) ids.push(id);
        }
      }
      if (path.closed && ids[0] !== ids.at(-1)) ids.push(ids[0]!);
      return ids;
    });
    for (let gi = 0; gi < feature.groups.length; gi++) {
      const group = feature.groups[gi]!.map((pi) => paths[pi]!);
      const id = groups.length;
      groups.push({ paths: group, signature: signatures[fi]![gi] });
      const unique = new Set<number>();
      for (const path of group)
        for (const vertex of path) if (!anchors[vertex]) unique.add(vertex);
      for (const vertex of unique) owners[vertex]!.push(id);
    }
  }

  const active = new Uint8Array(vertices.length).fill(1);
  const activationLevels = new Array<number>(vertices.length).fill(0);
  const batches = new Map<number, number[]>();
  for (const vertex of vertices) {
    if (anchors[vertex.id]) continue;
    // Round downward: preprocessing may retain detail earlier, never later
    // than the nominal quadtree threshold.
    const tick = Math.floor(nominalActivation[vertex.id]! * 10);
    if (tick === 0) continue;
    if (!batches.has(tick)) batches.set(tick, []);
    batches.get(tick)!.push(vertex.id);
  }
  let retainedVertices = 0;
  function validGroup(id: number): boolean {
    const { paths, signature } = groups[id]!;
    const coordinates = paths.map((path) =>
      path
        .filter((vertex) => active[vertex])
        .map((vertex) => positions[vertex]!),
    );
    return signature
      ? validSphericalPolygon(coordinates, signature)
      : coordinates.every(validGreatCirclePath);
  }
  function remove(batch: number[], tick: number): void {
    const affected = new Set<number>();
    for (const id of batch) {
      active[id] = 0;
      for (const owner of owners[id]!) affected.add(owner);
    }
    let valid = true;
    for (const group of affected)
      if (!validGroup(group)) {
        valid = false;
        break;
      }
    if (valid) {
      for (const id of batch) activationLevels[id] = tick / 10;
      return;
    }
    for (const id of batch) active[id] = 1;
    if (batch.length === 1) {
      retainedVertices++;
      return;
    }
    const middle = Math.floor(batch.length / 2);
    remove(batch.slice(0, middle), tick);
    remove(batch.slice(middle), tick);
  }

  // Independent candidate components avoid revalidating unrelated countries
  // when a local batch needs bisection. Group owners are shared across arcs.
  for (const tick of [...batches.keys()].sort((a, b) => b - a)) {
    const batch = batches.get(tick)!;
    const parent = new Map<number, number>(batch.map((id) => [id, id]));
    const firstByGroup = new Map<number, number>();
    const root = (id: number): number => {
      while (parent.get(id) !== id) {
        const next = parent.get(id)!;
        parent.set(id, parent.get(next)!);
        id = parent.get(id)!;
      }
      return id;
    };
    for (const id of batch)
      for (const owner of owners[id]!) {
        const first = firstByGroup.get(owner);
        if (first === undefined) firstByGroup.set(owner, id);
        else parent.set(root(id), root(first));
      }
    const components = new Map<number, number[]>();
    for (const id of batch) {
      const key = root(id);
      if (!components.has(key)) components.set(key, []);
      components.get(key)!.push(id);
    }
    for (const component of components.values()) remove(component, tick);
  }

  // Encode the corrected threshold in the existing integer-level/fractional
  // BLG representation. Use the same subtraction as selectBlgPositions.
  const levels = activationLevels.map(Math.ceil);
  const random = activationLevels.map((level) =>
    Number.isInteger(level) ? 0 : 1 - (level - Math.floor(level)),
  );
  const trees = arcs.map((arc) =>
    buildBlgTree(
      arc.vertexIds.map((id) => levels[id]!),
      arc.vertexIds.map((id) => random[id]!),
    ),
  );
  return { trees, activationLevels, retainedVertices };
}
