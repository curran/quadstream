export { buildQuadstream, QuadstreamDataset } from "./dataset.js";
export { buildTopology } from "./topology.js";
export { buildSparseQuadtree, cellKey, cellAddress } from "./quadtree.js";
export {
  buildBlgTree,
  selectBlgPositions,
  stableBlgRandom,
  assertBlgInvariants,
} from "./blg.js";
export { createSpatialIndex } from "./spatial-index.js";
export {
  exportPartitions,
  encodePartition,
  decodePartition,
  checksum,
  requiredPartitionKeys,
  partitionsWithVerticesInBounds,
} from "./partition.js";
export { QuadstreamSession } from "./session.js";
export { QuadstreamLoader, fetchFromBundle } from "./loader.js";
export type { PartitionFetcher, LoaderOptions } from "./loader.js";
export {
  validPolygon,
  simpleClosedRing,
  simpleClosedRingReference,
  segmentsIntersect,
  pointInRing,
  intersects,
  boundsOf,
} from "./geometry.js";
export type * from "./types.js";
export {
  importGeoJSON,
  exportGeoJSON,
  importTopoJSON,
  exportTopoJSON,
} from "./adapters.js";
export type { TopoJSONTopology } from "./adapters.js";
export { validateManifest, MANIFEST_VERSION } from "./manifest-schema.js";

export { ProgressiveMap } from "./progressive-map.js";
export type {
  MapQuery,
  MapFrame,
  ProgressiveMapClient,
} from "./progressive-map.js";
export { attachMapLibre, mapLibreBounds } from "./maplibre-adapter.js";
export type {
  MapLibreLike,
  MapLibreAdapterOptions,
} from "./maplibre-adapter.js";

export {
  canonicalLonLat,
  lonLatVector,
  angularDistance,
  validGreatCirclePath,
  sphericalCellAddress,
  buildSphericalPriorities,
  sphericalChart,
  projectSpherical,
  sphericalPolygonSignature,
  validSphericalPolygon,
} from "./spherical-geometry.js";
export type {
  UnitVector,
  CubeFace,
  SphericalCell,
  SphericalPriorities,
  SphericalChart,
  SphericalPolygonSignature,
} from "./spherical-geometry.js";
export {
  SphericalQuadstreamDataset,
  buildSphericalQuadstream,
  importSphericalTopoJSON,
} from "./spherical-dataset.js";
export type { SphericalQueryOptions } from "./spherical-dataset.js";

export {
  computeFeatureCap,
  computeFeatureCaps,
  isCapVisible,
  filterSphericalFeatures,
} from "./spherical-cull.js";
export type { SphericalCap, SphericalViewCone } from "./spherical-cull.js";
export { clipWindow, clipToWindow } from "./spherical-clip.js";
export type { SphericalClipWindow, SphericalClipStats, SphericalClipResult } from "./spherical-clip.js";

export { sphericalConnectedComponents, buildRobustSphericalGroups } from "./spherical-robust-dataset.js";
export type { SphericalBuildGroup, RobustSphericalOptions } from "./spherical-robust-dataset.js";
