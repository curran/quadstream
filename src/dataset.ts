import { assertBounds } from "./geometry.js";
import { buildTopology } from "./topology.js";
import { buildSparseQuadtree } from "./quadtree.js";
import { createSpatialIndex } from "./spatial-index.js";
import { buildArcTrees, reconstructFeature } from "./reconstruct.js";
import type {
  FeatureCollection,
  QueryOptions,
  QueryResult,
  SparseQuadtree,
  Topology,
} from "./types.js";
import type { BlgTree } from "./blg.js";

export class QuadstreamDataset {
  readonly topology: Topology;
  readonly quadtree: SparseQuadtree;
  readonly arcTrees: readonly BlgTree[];
  private readonly featureIndex: ReturnType<typeof createSpatialIndex<number>>;
  private readonly validityCache = new Map<number, boolean>();
  constructor(
    input: FeatureCollection,
    { maxLevel = 20 }: { maxLevel?: number } = {},
  ) {
    this.topology = buildTopology(input);
    this.quadtree = buildSparseQuadtree(
      this.topology.vertices,
      this.topology.bounds,
      maxLevel,
    );
    this.arcTrees = buildArcTrees(
      this.topology.arcs,
      this.quadtree.levelByVertexId,
      this.topology.vertices.map((v) => v.critical),
    );
    this.featureIndex = createSpatialIndex(
      this.topology.features.map((f, i) => ({ bounds: f.bounds, value: i })),
    );
  }
  query(options: QueryOptions = {}): QueryResult {
    const level = options.level ?? this.quadtree.maxLevel - 1;
    if (!Number.isFinite(level) || level < 0 || level >= this.quadtree.maxLevel)
      throw new Error("Invalid query level");
    if (options.bounds) assertBounds(options.bounds);
    const selected = options.bounds
      ? this.featureIndex.query(options.bounds)
      : this.topology.features.map((_, i) => i);
    const coords = (id: number) => {
      const v = this.topology.vertices[id];
      return v ? ([v.x, v.y] as const) : undefined;
    };
    let globallyInvalid = false;
    if (options.validate !== false) {
      const cached = this.validityCache.get(level);
      if (cached !== undefined) globallyInvalid = !cached;
      else {
        // Viewport-independent decision: shared boundaries must render consistently
        // even when two viewports select different subsets of features.
        globallyInvalid = this.topology.features.some(
          (f) =>
            !reconstructFeature(
              f,
              this.topology.arcs,
              this.arcTrees,
              level,
              coords,
            ).valid,
        );
        this.validityCache.set(level, !globallyInvalid);
      }
    }
    let total = 0;
    const results = selected.map((i) => {
      const r = reconstructFeature(
        this.topology.features[i]!,
        this.topology.arcs,
        this.arcTrees,
        globallyInvalid ? Infinity : level,
        coords,
      );
      total += r.selectedVertices;
      return r.feature;
    });
    return {
      geojson: { type: "FeatureCollection", features: results },
      level,
      valid: !globallyInvalid,
      usedFallback: globallyInvalid,
      selectedFeatures: results.length,
      selectedVertices: total,
    };
  }
}
export function buildQuadstream(
  input: FeatureCollection,
  options?: { maxLevel?: number },
): QuadstreamDataset {
  return new QuadstreamDataset(input, options);
}
