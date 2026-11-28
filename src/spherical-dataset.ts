import { buildTopologyWithPolicy } from "./topology.js";
import { decodeTopoJSON } from "./adapters.js";
import {
  reconstructFeature,
  type CollapsedRingPolicy,
} from "./reconstruct.js";
import { stableBlgRandom } from "./blg.js";
import { buildTopologySafeArcTrees } from "./spherical-preprocess.js";
import { signedArea } from "./geometry.js";
import {
  canonicalLonLat,
  buildSphericalPriorities,
  projectSpherical,
  validGreatCirclePath,
  sphericalPolygonSignature,
  validSphericalPolygon,
} from "./spherical-geometry.js";
import type {
  SphericalPolygonSignature,
  SphericalPriorities,
} from "./spherical-geometry.js";
import type {
  FeatureCollection,
  Geometry,
  Position,
  QueryResult,
  Topology,
} from "./types.js";
import type { BlgTree } from "./blg.js";

function polygons(g: Geometry): Position[][][] {
  return g.type === "Polygon"
    ? [g.coordinates]
    : g.type === "MultiPolygon"
      ? g.coordinates
      : [];
}
function lines(g: Geometry): Position[][] {
  return g.type === "LineString"
    ? [g.coordinates]
    : g.type === "MultiLineString"
      ? g.coordinates
      : [];
}
function canonicalGeometry(g: Geometry): Geometry {
  switch (g.type) {
    case "LineString":
      return { type: g.type, coordinates: g.coordinates.map(canonicalLonLat) };
    case "MultiLineString":
      return {
        type: g.type,
        coordinates: g.coordinates.map((p) => p.map(canonicalLonLat)),
      };
    case "Polygon":
      return {
        type: g.type,
        coordinates: g.coordinates.map((p) => p.map(canonicalLonLat)),
      };
    case "MultiPolygon":
      return {
        type: g.type,
        coordinates: g.coordinates.map((p) =>
          p.map((r) => r.map(canonicalLonLat)),
        ),
      };
    default:
      throw new Error("Unsupported spherical geometry");
  }
}
function sourceGeometry(input: FeatureCollection): FeatureCollection {
  if (
    input?.type !== "FeatureCollection" ||
    !Array.isArray(input.features) ||
    !input.features.length
  )
    throw new Error("Expected nonempty geographic FeatureCollection");
  return {
    type: "FeatureCollection",
    features: input.features.map((f) => {
      if (f?.type !== "Feature" || !f.geometry)
        throw new Error("Expected geographic feature");
      return {
        ...f,
        properties: f.properties === null ? null : { ...f.properties },
        geometry: canonicalGeometry(f.geometry),
      };
    }),
  };
}
function topology(input: FeatureCollection): Topology {
  return buildTopologyWithPolicy(input, {
    position: canonicalLonLat,
    ring: (r) => validSphericalPolygon([[...r]]),
    polygon: (r) => validSphericalPolygon(r),
    line: validGreatCirclePath,
  });
}
function preserveSphericalValidity(
  topology: Topology,
  source: FeatureCollection,
  signatures: SphericalPolygonSignature[][],
) {
  const vertexByPosition = new Map(
    topology.vertices.map((v) => [
      JSON.stringify(canonicalLonLat([v.x, v.y])),
      v,
    ]),
  );
  source.features.forEach((feature, featureIndex) => {
    polygons(feature.geometry).forEach((rings, polygonIndex) => {
      rings.forEach((ring, ringIndex) => {
        const ids = ring
          .slice(0, -1)
          .map((p) => vertexByPosition.get(JSON.stringify(p))?.id);
        const projected = ring.map((p) =>
            projectSpherical(p, signatures[featureIndex]![polygonIndex]!.chart),
          ),
          area = signedArea(projected),
          sourceSign =
            signatures[featureIndex]![polygonIndex]!.signs[ringIndex]!;
        ids.forEach((id, i) => {
          if (id === undefined) return;
          const previous =
              projected[(i + projected.length - 2) % (projected.length - 1)]!,
            current = projected[i]!,
            next = projected[(i + 1) % (projected.length - 1)]!,
            removed =
              current[0] * next[1] -
              current[1] * next[0] -
              (previous[0] * current[1] - previous[1] * current[0]) +
              (previous[0] * next[1] - previous[1] * next[0]),
            candidateArea = area - removed / 2;
          let invalidCandidate = false;
          if (ring.length <= 32) {
            const points = [...ring.slice(0, i), ...ring.slice(i + 1, -1)],
              candidate = [...points, points[0]!],
              candidateRings = rings.map((r, j) =>
                j === ringIndex ? candidate : r,
              );
            invalidCandidate = !validSphericalPolygon(
              candidateRings,
              signatures[featureIndex]?.[polygonIndex],
            );
          }
          if (
            ring.length <= 4 ||
            Math.sign(candidateArea) !== sourceSign ||
            candidateArea === 0 ||
            invalidCandidate
          )
            topology.vertices[id]!.critical = true;
        });
      });
    });
  });
}
/** Explicit geographic import: decode only the selected object and validate minor arcs. */
export function importSphericalTopoJSON(
  input: unknown,
  objectName: string,
): FeatureCollection {
  const decoded = sourceGeometry(
    decodeTopoJSON(input, objectName, canonicalLonLat),
  );
  for (const f of decoded.features)
    for (const p of polygons(f.geometry)) sphericalPolygonSignature(p);
  topology(decoded);
  return decoded;
}
export interface SphericalQueryOptions {
  level?: number;
  /**
   * "restore" (default) keeps every polygon. "drop" hides each polygon (and
   * hole) whose ring has fewer than 3 distinct quadtree-activated vertices at
   * the query level, except for explicitly retained polygon exteriors.
   */
  collapsedRingPolicy?: CollapsedRingPolicy;
}
export interface SphericalInterruptOptions extends SphericalQueryOptions {
  shouldAbort?: () => boolean;
  yieldTurn?: () => Promise<void>;
  sliceMs?: number;
}
type Run = ReturnType<typeof reconstructFeature>;
/** Per feature: path indices hidden at the nominal level, and the signature of each visible polygon. */
interface Visibility {
  hidden: (Set<number> | undefined)[];
  signatures: SphericalPolygonSignature[][];
  hiddenPolygons: number;
}
const ACTIVATION_EPSILON = 1e-9;
/**
 * Level at which a vertex becomes selected in its arc's BLG tree. Selection at
 * level L is `level <= floor(L)` or, for the next level, `random >= 1 - frac`,
 * i.e. L >= level - random: a stable per-vertex threshold, so selections nest.
 */
function activationLevel(level: number, random: number): number {
  return level === 0
    ? 0
    : level - random + (random === 1 ? ACTIVATION_EPSILON : 0);
}
/** Optional preprocessing policy for explicitly retained polygon exteriors. */
export interface SphericalBuildOptions {
  maxLevel?: number;
  /** Feature ID to source polygon index; only the selected exterior is visible at level zero. */
  alwaysVisiblePolygons?: ReadonlyMap<string, number>;
}
/** Geographic in-memory dataset. No planar viewport index or v1 partition serialization. */
export class SphericalQuadstreamDataset {
  readonly coordinateMode = "spherical-d3" as const;
  readonly topology: Topology;
  readonly priorities: SphericalPriorities;
  readonly arcTrees: readonly BlgTree[];
  /** Corrected global vertex thresholds, independent of query order. */
  readonly activationLevels: readonly number[];
  /** Vertices retained at all levels because a removal failed validation. */
  readonly retainedVertices: number;
  /**
   * Per feature and path: the lowest level at which the closed ring has 3
   * distinct vertices activated by the sparse quadtree (the third-smallest
   * vertex activation level), or Infinity when it never does. Open paths and
   * explicitly retained exteriors are 0.
   */
  readonly ringActivation: readonly (readonly number[])[];
  private readonly source: FeatureCollection;
  private readonly signatures: SphericalPolygonSignature[][];
  constructor(
    input: FeatureCollection,
    { maxLevel = 20, alwaysVisiblePolygons }: SphericalBuildOptions = {},
  ) {
    this.source = sourceGeometry(input);
    this.signatures = this.source.features.map((f) =>
      polygons(f.geometry).map((p) => sphericalPolygonSignature(p)),
    );
    this.topology = topology(this.source);
    preserveSphericalValidity(this.topology, this.source, this.signatures);
    this.priorities = buildSphericalPriorities(
      this.topology.vertices,
      maxLevel,
    );
    const prepared = buildTopologySafeArcTrees(
      this.topology,
      this.topology.vertices.map((v) =>
        activationLevel(
          this.priorities.levelByVertexId[v.id]!,
          v.critical ? 1 : stableBlgRandom(v.id),
        ),
      ),
      this.signatures,
    );
    this.arcTrees = prepared.trees;
    this.activationLevels = prepared.activationLevels;
    this.retainedVertices = prepared.retainedVertices;
    this.ringActivation = this.topology.features.map((f) => {
      const polygon = alwaysVisiblePolygons?.get(f.id);
      const exterior =
        polygon !== undefined &&
        (f.geometryType === "Polygon" || f.geometryType === "MultiPolygon")
          ? f.groups[polygon]?.[0]
          : undefined;
      return f.paths.map((path, i) =>
        i === exterior ? 0 : this.pathActivation(path),
      );
    });
  }
  private pathActivation(path: Topology["features"][number]["paths"][number]) {
    if (!path.closed) return 0;
    // Arc endpoints are always selected (topology anchors, three per closed
    // ring), so they cannot define visibility: use each vertex's own priority.
    const best = new Map<number, number>();
    for (const ref of path.arcs)
      for (const id of this.topology.arcs[Math.abs(ref) - 1]!.vertexIds) {
        const a = activationLevel(
          this.priorities.levelByVertexId[id]!,
          this.topology.vertices[id]!.critical ? 1 : stableBlgRandom(id),
        );
        if (a < (best.get(id) ?? Infinity)) best.set(id, a);
      }
    let m1 = Infinity,
      m2 = Infinity,
      m3 = Infinity;
    for (const a of best.values()) {
      if (a < m1) [m1, m2, m3] = [a, m1, m2];
      else if (a < m2) [m2, m3] = [a, m2];
      else if (a < m3) m3 = a;
    }
    return m3;
  }
  /** Nominal-level polygon eligibility, independent of corrected vertex thresholds. */
  private visibility(level: number): Visibility {
    let hiddenPolygons = 0;
    const hidden: (Set<number> | undefined)[] = [],
      signatures: SphericalPolygonSignature[][] = [];
    this.topology.features.forEach((f, i) => {
      const act = this.ringActivation[i]!,
        source = this.signatures[i]!;
      let set: Set<number> | undefined;
      const sigs: SphericalPolygonSignature[] = [];
      if (f.geometryType === "Polygon" || f.geometryType === "MultiPolygon")
        f.groups.forEach((group, j) => {
          if (act[group[0]!]! > level) {
            (set ??= new Set()).add(group[0]!);
            hiddenPolygons++;
            return;
          }
          const shown = group.filter((p) => act[p]! <= level);
          for (const p of group)
            if (!shown.includes(p)) (set ??= new Set()).add(p);
          const sig = source[j]!;
          sigs.push(
            shown.length === group.length
              ? sig
              : {
                  chart: sig.chart,
                  signs: sig.signs.filter((_, k) => act[group[k]!]! <= level),
                },
          );
        });
      hidden.push(set);
      signatures.push(sigs);
    });
    return { hidden, signatures, hiddenPolygons };
  }
  private session(options: SphericalQueryOptions) {
    if ("bounds" in options || "validate" in options)
      throw new Error("Spherical queries require global validated retrieval");
    const level = options.level ?? this.priorities.maxLevel - 1;
    if (
      !Number.isFinite(level) ||
      level < 0 ||
      level >= this.priorities.maxLevel
    )
      throw new Error("Invalid spherical query level");
    const drop = options.collapsedRingPolicy === "drop",
      vis = drop ? this.visibility(level) : undefined,
      lookup = (id: number): Position | undefined => {
        const v = this.topology.vertices[id];
        return v ? [v.x, v.y] : undefined;
      },
      check = (i: number, r: Run) => {
        const p = polygons(r.feature.geometry).filter((g) => g.length),
          s = vis ? vis.signatures[i]! : this.signatures[i]!;
        return (
          !r.missing &&
          p.length === s.length &&
          p.every((g, j) => validSphericalPolygon(g, s[j]!)) &&
          lines(r.feature.geometry).every(validGreatCirclePath)
        );
      },
      run = (f: Topology["features"][number], i: number) =>
        reconstructFeature(
          f,
          this.topology.arcs,
          this.arcTrees,
          level,
          lookup,
          false,
          false,
          drop ? { collapsed: "drop", hiddenPaths: vis!.hidden[i] } : { collapsed: "drop" },
        );
    return { level, check, run, vis };
  }
  query(options: SphericalQueryOptions = {}): QueryResult {
    const s = this.session(options);
    const results = this.topology.features.map(s.run);
    const valid = results.every((r, i) => s.check(i, r));
    return this.formatResult(s, results, valid);
  }
  private formatResult(
    s: ReturnType<SphericalQuadstreamDataset["session"]>,
    results: Run[],
    valid: boolean,
  ): QueryResult {
    return {
      geojson: {
        type: "FeatureCollection",
        features: results.map((r, i) => {
          const f = this.source.features[i]!;
          return {
            type: "Feature",
            ...(f.id === undefined ? {} : { id: f.id }),
            properties: f.properties === null ? null : { ...f.properties },
            geometry: r.feature.geometry,
          };
        }),
      },
      level: s.level,
      valid,
      promotedArcs: 0,
      ...(s.vis
        ? {
            hiddenPolygons: s.vis.hiddenPolygons,
            hiddenRings: results.reduce((n, r) => n + r.hiddenRings, 0),
          }
        : {}),
      usedFallback: false,
      selectedFeatures: results.length,
      selectedVertices: results.reduce((n, r) => n + r.selectedVertices, 0),
    };
  }
  async queryInterruptible(
    options: SphericalInterruptOptions = {},
  ): Promise<QueryResult | null> {
    const { shouldAbort, yieldTurn, sliceMs = 8 } = options;
    const s = this.session(options);
    if (shouldAbort?.()) return null;
    const results: Run[] = [];
    const ok: boolean[] = [];
    let sliceStart = performance.now();
    const tick = async () => {
      if (yieldTurn && performance.now() - sliceStart >= sliceMs) {
        await yieldTurn();
        if (shouldAbort?.()) return false;
        sliceStart = performance.now();
      }
      return true;
    };
    for (let i = 0; i < this.topology.features.length; i++) {
      const r = s.run(this.topology.features[i]!, i);
      results.push(r);
      ok.push(s.check(i, r));
      if (!(await tick())) return null;
    }
    if (shouldAbort?.()) return null;
    return this.formatResult(s, results, ok.every(Boolean));
  }
}
export function buildSphericalQuadstream(
  input: FeatureCollection,
  options?: SphericalBuildOptions,
): SphericalQuadstreamDataset {
  return new SphericalQuadstreamDataset(input, options);
}
