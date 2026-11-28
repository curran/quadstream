import { canonicalLonLat } from "./spherical-geometry.js";
import type { Feature, Geometry, FeatureCollection } from "./types.js";

const paths = (g: Geometry) =>
  g.type === "Polygon"
    ? g.coordinates
    : g.type === "MultiPolygon"
      ? g.coordinates.flat()
      : g.type === "LineString"
        ? [g.coordinates]
        : g.coordinates;
/** Group exact-coordinate-connected features, including shared line vertices. */
export function sphericalConnectedComponents(
  features: readonly Feature[],
): number[][] {
  const parent = features.map((_, i) => i),
    owner = new Map<string, number>();
  const root = (index: number): number => {
    let i = index;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const [i, feature] of features.entries()) {
    for (const ring of paths(feature.geometry))
      for (const vertex of ring) {
        const key = JSON.stringify(canonicalLonLat(vertex));
        const previous = owner.get(key);
        if (previous === undefined) owner.set(key, i);
        else {
          const a = root(i),
            b = root(previous);
          if (a !== b) parent[a] = b;
        }
      }
  }
  const groups = new Map<number, number[]>();
  for (const i of features.keys()) {
    const k = root(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  return [...groups.values()];
}
export type SphericalBuildGroup<T> =
  | { indices: number[]; engine: T; error?: never }
  | { indices: number[]; engine?: never; error: string };
export interface RobustSphericalOptions<T> {
  build: (
    indices: number[],
    working: readonly Feature[],
  ) => SphericalBuildGroup<T>;
  repair?: (geometry: Geometry) => { geometry: Geometry; changed: boolean };
}
/** Recover independently connected components after a failed global build.
 * Failed groups retain their source geometry at the caller; no implicit repair. */
export function buildRobustSphericalGroups<T>(
  source: FeatureCollection,
  options: RobustSphericalOptions<T>,
) {
  const features = source.features,
    work = [...features],
    all = features.map((_, i) => i);
  const build = (indices: number[]) => options.build(indices, work);
  let groups = [build(all)];
  if (groups[0]?.error && features.length > 1) {
    try {
      const singletonGroups = all.map((i) => {
        let g = build([i]);
        if (g.error && options.repair) {
          const original = features[i]!,
            fixed = options.repair(original.geometry);
          if (fixed.changed) {
            work[i] = { ...original, geometry: fixed.geometry };
            const retry = build([i]);
            if (retry.error) work[i] = original;
            else g = retry;
          }
        }
        return g;
      });
      const invalid = singletonGroups.filter((g) => g.error);
      const valid = all.filter((i) => !singletonGroups[i]!.error);
      groups = [...(valid.length ? [build(valid)] : []), ...invalid];
      // Regroup when a rejected singleton shares a vertex with a valid group.
      const connected = sphericalConnectedComponents(features);
      const failed = new Set(invalid.flatMap((g) => g.indices));
      if (
        groups.some((g) => g.error && g.indices.length > 1) ||
        connected.some(
          (c) => c.some((i) => failed.has(i)) && c.some((i) => !failed.has(i)),
        )
      ) {
        groups = connected.map(build);
      }
    } catch {
      /* Keep the last complete grouping if recovery fails. */
    }
  }
  return {
    groups,
    working: work,
    unavailable: groups
      .filter((g) => g.error)
      .reduce((n, g) => n + g.indices.length, 0),
    reasons: [...new Set(groups.flatMap((g) => (g.error ? [g.error] : [])))],
  };
}
