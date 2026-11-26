import { buildTopologyWithPolicy } from "./topology.js";
import { decodeTopoJSON } from "./adapters.js";
import { buildArcTrees, reconstructFeature } from "./reconstruct.js";
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
}
/** Geographic in-memory dataset. No planar viewport index or v1 partition serialization. */
export class SphericalQuadstreamDataset {
  readonly coordinateMode = "spherical-d3" as const;
  readonly topology: Topology;
  readonly priorities: SphericalPriorities;
  readonly arcTrees: readonly BlgTree[];
  private readonly source: FeatureCollection;
  private readonly signatures: SphericalPolygonSignature[][];
  constructor(
    input: FeatureCollection,
    { maxLevel = 20 }: { maxLevel?: number } = {},
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
    this.arcTrees = buildArcTrees(
      this.topology.arcs,
      this.priorities.levelByVertexId,
    );
  }
  query(options: SphericalQueryOptions = {}): QueryResult {
    if ("bounds" in options || "validate" in options)
      throw new Error("Spherical queries require global validated retrieval");
    const level = options.level ?? this.priorities.maxLevel - 1;
    if (
      !Number.isInteger(level) ||
      level < 0 ||
      level >= this.priorities.maxLevel
    )
      throw new Error("Invalid spherical query level");
    const lookup = (id: number): Position | undefined => {
      const v = this.topology.vertices[id];
      return v ? [v.x, v.y] : undefined;
    };
    const reconstruct = (detail: number) =>
      this.topology.features.map((f) =>
        reconstructFeature(
          f,
          this.topology.arcs,
          this.arcTrees,
          detail,
          lookup,
        ),
      );
    const results = reconstruct(level);
    // The reconstruction helper's planar validity flag is deliberately ignored;
    // evaluate every feature against its original spherical chart and orientation.
    const valid = results.every((r, i) => {
      const p = polygons(r.feature.geometry),
        s = this.signatures[i]!;
      return (
        !r.missing &&
        p.length === s.length &&
        p.every((g, j) => validSphericalPolygon(g, s[j]!)) &&
        lines(r.feature.geometry).every(validGreatCirclePath)
      );
    });
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
      level,
      valid,
      usedFallback: false,
      selectedFeatures: results.length,
      selectedVertices: results.reduce((n, r) => n + r.selectedVertices, 0),
    };
  }
}
export function buildSphericalQuadstream(
  input: FeatureCollection,
  options?: { maxLevel?: number },
): SphericalQuadstreamDataset {
  return new SphericalQuadstreamDataset(input, options);
}
