/** Planar [x, y] coordinates. Geographic longitude wrapping is not implicit. */
export type Position = readonly [number, number];
export type Bounds = readonly [number, number, number, number];
export type GeometryType = 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString';
export type Properties = Record<string, unknown>;

export type Geometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] };
export interface Feature {
  type: 'Feature'; id?: string | number; properties: Properties | null;
  geometry: Geometry;
}
export interface FeatureCollection { type: 'FeatureCollection'; features: Feature[] }

export interface Vertex {
  id: number; x: number; y: number; critical: boolean;
}
export interface Arc { id: number; vertexIds: number[] }
export interface TopologyPath { closed: boolean; arcs: number[] }
export interface TopologyFeature {
  id: string; properties: Properties; geometryType: GeometryType;
  paths: TopologyPath[];
  /** Each group contains indices into paths: rings of a polygon, or one line. */
  groups: number[][];
  bounds: Bounds;
}
export interface Topology {
  vertices: Vertex[]; arcs: Arc[]; features: TopologyFeature[];
  bounds: Bounds;
}
export interface QuadCell {
  vertexId: number; level: number; i: number; j: number; key: string;
}
export interface SparseQuadtree {
  bounds: Bounds; maxLevel: number;
  cells: QuadCell[];
  levelByVertexId: number[];
}
export interface QueryOptions { bounds?: Bounds; level?: number; validate?: boolean }
export interface QueryResult {
  geojson: FeatureCollection; level: number; usedFallback: boolean;
  selectedFeatures: number; selectedVertices: number;
}
export interface PartitionRecord { id: number; x: number; y: number; level: number }
export interface PartitionInfo {
  key: string; byteLength: number; checksum: string; vertexIds: number[];
  minLevel: number; bounds: Bounds;
}
export interface QuadstreamManifest {
  format: 'quadstream'; version: 1; maxLevel: number; fileDepth: number;
  bounds: Bounds; features: TopologyFeature[]; arcs: Arc[];
  vertices: Array<{ id: number; level: number; critical: boolean }>;
  partitions: PartitionInfo[];
}
export interface PartitionBundle {
  manifest: QuadstreamManifest; partitions: Map<string, Uint8Array>;
}
