# Quadstream

**Progressive, topology-aware, multiresolution geometry for the web.**

Quadstream revives the 2010–2012 research on spatially distributed vertex priorities, sparse quadtree subdivision, and Binary Line Generalization (BLG) trees. It turns the historical ideas into a small, TypeScript-first library for preparing geographic shapes at multiple levels of detail. No server, map framework, or VizHub account is required.

> **Development preview, not published.** This modernization is intentionally `private: true` and remains pre-release while licensing, large-dataset performance, geographic edge cases, and progressive streaming behavior are reviewed. Do not deploy it for safety-critical geometry or assume it produces cartographically optimal simplifications.

## Why Quadstream?

A conventional simplification algorithm often outputs one static polygon at one tolerance. Quadstream instead assigns every distinct source vertex an importance level in a **sparse quadtree**, then reconstructs each shape in source order using **BLG-style ordered priority trees**. Shared boundary arcs are indexed only once so adjoining polygons can reuse the same simplified coordinates.

| Component                   | Responsibility                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| Exact-coordinate topology   | Deduplicate shared vertices and identify shared arcs and junctions   |
| Sparse quadtree             | Assign reproducible spatial importance levels to all unique vertices |
| BLG hierarchy               | Restore original vertex ordering at any supported detail level       |
| Packed spatial index        | Select candidate features intersecting an axis-aligned viewport      |
| Partitioned binary geometry | Serialize deterministic, checksummed vertex batches                  |
| Progressive session         | Validate and ingest partitions, then query available geometry        |

## Quick start

Requires Node.js 20+ for the package and an installed TypeScript compiler for building from source. The repository uses `npm`; after installing development dependencies:

```sh
npm install
npm run check
npm run lint
node examples/hello.mjs
```

`npm run check` runs the strict TypeScript build and Node's built-in test runner.
`npm run lint` runs ESLint over the maintained TypeScript and JavaScript sources.
`npm run prettier` formats the repository with Prettier. The core has no runtime
dependencies; the globe regression tests use pinned demo development dependencies.

```js
import {
  buildQuadstream,
  exportPartitions,
  QuadstreamSession,
  QuadstreamLoader,
  fetchFromBundle,
} from "@quadstream/core";

const source = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "square",
      properties: { value: 42 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};

const dataset = buildQuadstream(source, { maxLevel: 12 });
const { geojson, usedFallback } = dataset.query({
  level: 4,
  bounds: [0, 0, 10, 10],
});

const { manifest, partitions } = exportPartitions(dataset, { fileDepth: 3 });
const session = new QuadstreamSession(manifest);
for (const [key, bytes] of partitions) session.load(key, bytes);
const recovered = session.query({ level: 11 });

// A transport-agnostic lazy loader is also available for remote partitions:
const lazySession = new QuadstreamSession(manifest);
const loader = new QuadstreamLoader(
  lazySession,
  fetchFromBundle({ manifest, partitions }),
  { concurrency: 4, cacheBytes: 1024 * 1024 },
);
await loader.loadLatest({ level: 11 });
```

**Note:** During local development, run `npm run build` and use `../dist/index.js` from the example rather than a published package name; the public import above illustrates the intended package API.

## API reference

The package exports its public API from `src/index.ts` and ships declarations
with the build. The signatures below describe the stable development-preview
surface; TypeScript is the authoritative source for exact structural types.

### Core planar dataset

```ts
buildQuadstream(
  input: FeatureCollection,
  options?: { maxLevel?: number },
): QuadstreamDataset

dataset.query(options?: {
  level?: number;
  bounds?: Bounds;
  validate?: boolean;
}): QueryResult
```

`QuadstreamDataset` exposes `topology`, `quadtree`, and `arcTrees` for
inspection. `QueryResult` contains `geojson`, the requested `level`, `valid`,
`usedFallback`, `selectedFeatures`, and `selectedVertices`. `level` ranges
from `0` through `maxLevel - 1`; the default is the finest level. `bounds`
selects features by intersecting feature bounds and does not clip geometry.
Set `validate: false` only when the caller accepts unvalidated reconstructed
geometry.

The public planar model includes `Position`, `Bounds`, `Geometry`, `Feature`,
`FeatureCollection`, `Topology`, `TopologyFeature`, `Arc`, `TopologyPath`,
`Vertex`, `SparseQuadtree`, `QueryOptions`, and `QueryResult`. Supported
geometries are `Polygon`, `MultiPolygon`, `LineString`, and
`MultiLineString`.

### Topology, priorities, and geometry helpers

- `buildTopology(collection)` deduplicates exact coordinates, shared arcs, and
  feature metadata.
- `buildSparseQuadtree(vertices, bounds, maxLevel)`, `cellKey(level, i, j)`,
  and `cellAddress(key)` expose deterministic sparse spatial priorities.
- `buildBlgTree(levels)`, `selectBlgPositions(tree, maxLevel)`, and
  `assertBlgInvariants(tree)` expose the ordered vertex-selection structure.
- `createSpatialIndex(items)` builds a packed bounds index whose `query(bounds)`
  returns matching values.
- `boundsOf(points)`, `intersects(a, b)`, `simpleClosedRing(ring)`,
  `segmentsIntersect(a, b, c, d)`, `pointInRing(point, ring)`, and
  `validPolygon(rings)` provide the reference planar predicates.

These lower-level functions are useful for diagnostics, custom pipelines, and
tests. They enforce the same finite-coordinate and exact-coordinate policies as
the dataset builder.

### GeoJSON and TopoJSON

- `importGeoJSON(input)` validates and normalizes a GeoJSON
  `FeatureCollection` or `Feature`.
- `exportGeoJSON(collection)` returns a serializable GeoJSON collection.
- `importTopoJSON(input)` decodes unquantized or quantized TopoJSON into a
  feature collection.
- `exportTopoJSON(collection)` writes unquantized TopoJSON with shared arcs.
- `decodeTopoJSON(input, objectName, position?)` decodes one named TopoJSON
  object with an optional coordinate normalizer.

`TopoJSONTopology` is exported for typed adapter integration. TopoJSON arc
references use standard zero-based indices and bitwise-complement reversal.
Feature IDs and properties are preserved by the adapters; the core normalizes
missing IDs and null properties during topology construction.

### Partitioned artifacts and progressive loading

```ts
exportPartitions(dataset, options?: { fileDepth?: number }): PartitionBundle
encodePartition(records): Uint8Array
decodePartition(bytes, maxRecords?): PartitionRecord[]
validateManifest(input): QuadstreamManifest
```

`exportPartitions` returns a manifest and `Map<string, Uint8Array>` containing
deterministic QSTR v1 partitions. `checksum(bytes)` computes the non-authenticating
FNV-1a corruption check. `requiredPartitionKeys(manifest, level)` returns all
partitions needed for a level, while `partitionsWithVerticesInBounds(manifest,
bounds)` is diagnostic vertex coverage and is not a safe request planner.
`MANIFEST_VERSION` is the current artifact version.

`QuadstreamSession` validates a manifest in its constructor, then accepts
partitions with `load(key, bytes)`. Its `loadedKeys`, `missingKeys(level)`, and
`query(options)` APIs report partial results through `complete`, `missingKeys`,
`omittedFeatures`, and `usedFallback`.

`QuadstreamLoader` wraps a session with an injected `PartitionFetcher`:

```ts
type PartitionFetcher = (
  key: string,
  context: { signal: AbortSignal },
) => Promise<Uint8Array>;

loader.ensureLevel(level, { signal? }): Promise<void>
loader.loadLatest(query?): Promise<SessionQueryResult>
loader.cancelLatest(): void
```

`LoaderOptions` limits per-request concurrency (default `4`, maximum `32`) and
the optional raw-byte LRU cache (default 16 MiB). `fetchFromBundle(bundle)`
provides an in-memory fetcher for tests and demos. Fetching, HTTP, retries,
persistent caching, and authentication remain application responsibilities.

### Progressive map client and MapLibre adapter

`ProgressiveMap` stages requests at coarse, intermediate, and target levels.
Implement `ProgressiveMapClient` with `request(query, onFrame)` and `cancel()`
when integrating another renderer. Each `MapFrame` reports the session result,
target level, whether it is final, and loaded/total partition counts.

`attachMapLibre(map, loader, options?)` connects the loader to a MapLibre-like
map interface, and `mapLibreBounds(bounds)` converts the current map bounds to
the planar query bounds. The adapter intentionally has no MapLibre runtime
dependency; `MapLibreLike` and `MapLibreAdapterOptions` describe the minimal
integration surface. See [the progressive map guide](docs/PROGRESSIVE-MAP.md).

### Spherical geographic API

```ts
importSphericalTopoJSON(input, objectName): FeatureCollection
buildSphericalQuadstream(
  input: FeatureCollection,
  options?: { maxLevel?: number },
): SphericalQuadstreamDataset
dataset.query(options?: { level?: number }): QueryResult
```

The spherical API uses longitude/latitude degrees, D3's clockwise-small-interior
winding convention, minor great-circle arcs, and six cube-face sparse
priorities. It is intentionally separate from planar partitions and viewport
culling. Exported helpers include `canonicalLonLat`, `lonLatVector`,
`angularDistance`, `validGreatCirclePath`, `sphericalCellAddress`,
`buildSphericalPriorities`, `sphericalChart`, `projectSpherical`,
`sphericalPolygonSignature`, and `validSphericalPolygon`. Supporting types are
`UnitVector`, `CubeFace`, `SphericalCell`, `SphericalPriorities`,
`SphericalChart`, `SphericalPolygonSignature`, and `SphericalQueryOptions`.
Spherical queries return the requested level directly; `valid` reports whether
the reference checks accepted that reconstruction, and no full-detail safety
fallback is applied. See [spherical semantics](docs/SPHERICAL.md) for winding,
poles, seams, charts, and topology junctions.

Spherical reconstruction applies three additional safeguards:

- vertices shared by three or more feature IDs are critical, preserving
  multi-shape junctions and shared topology;
- a vertex is promoted to critical when its removal would reverse a ring's
  projected winding, collapse its area, or make a small ring fail the spherical
  validity predicate;
- closed rings that would reconstruct with fewer than three distinct vertices
  are restored from their source path rather than emitted as degenerate rings.

These safeguards preserve the requested level's geometry; they do not promote
the entire query to a finer level. The globe demo separately isolates malformed
source features, so one invalid atlas feature does not force its whole
coordinate-connected component to full detail.

## Geometry support and semantics

Supported: GeoJSON `Polygon`, `MultiPolygon`, `LineString`, and `MultiLineString` features with finite planar `[x, y]` coordinates. Feature properties and IDs are retained. Polygons are returned with closed rings and may have a cyclically rotated starting point.

Coordinates are **planar**, not automatically projected; caller-provided longitude/latitude is interpreted numerically. The current implementation does **not** wrap the antimeridian, transform coordinate reference systems, snap approximately matching vertices, infer shared borders from differently digitized edges, or support `Point`/`GeometryCollection`/3D coordinates. Invalid input rings are rejected. Polygon holes are validated for containment. Geometry validation uses an O(n²) reference implementation and is not yet scalable to very large rings.

A detail level is an integer from `0` (coarsest) through `maxLevel - 1` (finest). More detailed levels form nested vertex subsets _in the BLG hierarchy_. Planar queries retain their existing dataset-wide validity fallback so shared boundaries remain consistent. Spherical queries expose coarse invalidity through `valid: false` and return the requested reconstruction without promotion to full detail. Spherical closed rings always retain at least three distinct vertices, and vertices shared by three or more shapes remain critical topology junctions. The globe demo's D3 oracle additionally checks that each rendered ring preserves its source interior/winding interpretation at every tested LOD.

Viewport queries perform **feature-bounds filtering**, not line clipping. Geometry can extend beyond the requested viewport. The lazy loader supports an injected async fetcher, AbortSignal cancellation, bounded concurrency, a raw-byte LRU cache, and newest-view suppression. It does not provide an HTTP client or persistent cache. The partition planner conservatively requests every partition with potentially relevant priority, even when its bounding box is outside the viewport, because a long line may cross the view without any vertices inside it.

## What is implemented in this revival?

This combined modernization covers the foundation, topology, sparse quadtree, BLG, combined engine, viewport index and versioned progressive artifact scopes. It also includes deterministic fuzz/property-style tests, API declarations, a runnable example, and architecture documentation.

It does **not** claim that progressive loading is network-integrated or that a production map renderer is available. The following are deliberately deferred: production-grade HTTP transport/CDN/persistent caching, robust high-scale topology validation, production map deployment, benchmarking against Tippecanoe, npm release.

See [the architecture](docs/ARCHITECTURE.md), [historical provenance](docs/HISTORY.md), [contributing](CONTRIBUTING.md), and [project roadmap](plans/PROJECT_ROADMAP.md).

## Design principles

1. **Accuracy before throughput.** Never silently return an invalid simplified polygon as if valid.
2. **Deterministic builds.** No stochastic vertex priorities or network-dependent results.
3. **Shared topology.** Exact shared boundaries use one coordinate sequence with reversible references.
4. **Transport-independent core.** No coupling to React, MapLibre, cloud hosting, or VizHub.
5. **Unambiguous status.** Partial results and fallback are explicit return fields.
6. **Reproducibility.** Fixed fixtures, seeded fuzz tests, and recorded performance baselines.

## History and license status

The original standalone repository dates to December 2010 and includes Java, Dojo, Processing.js, and experimental R-tree/BLG code. The later 2012 UDCVis work includes sparse-quadtree and progressive geometry prototypes. The old implementation is preserved in this repository's existing paths; it is **not** silently deleted or rewritten. [HISTORY.md](docs/HISTORY.md) documents source references.

The historical README declares the GNU Lesser General Public License without a version. This modernization does **not** presume that declaration authorizes relicensing and is not published on npm until licensing and bundled third-party provenance are resolved. See [LICENSE-NOTICE.md](LICENSE-NOTICE.md). A root SPDX identifier and license file should be selected only after that review.

## Collaboration

Bugs, failing geometry examples, and benchmarks against standard geographic tooling are especially welcome. Please attach a minimal GeoJSON fixture, describe the expected behavior and actual level, and avoid uploading confidential geographic data.

## Command line and geographic adapters

The development CLI supports `build`, `validate`, `inspect`, `query`, and `benchmark`; the public adapters support planar GeoJSON and unquantized/quantized TopoJSON interchange. Build first, then run `node bin/quadstream.mjs --help`. See [CLI usage and format policy](docs/CLI.md) for static bundle staging, limitations, and exit codes.

## Progressive map demo

Run `npm run build` and `npm run demo:map` after installing dependencies. See [the progressive Canvas/MapLibre demo](docs/PROGRESSIVE-MAP.md) and [the proposed spherical D3 globe integration](plans/D3_ORTHOGRAPHIC_GLOBE.md).

## Experimental spherical geometry

The separate `buildSphericalQuadstream` and `importSphericalTopoJSON` APIs provide a geographic, in-memory reference path for D3 globes. See [spherical coordinate semantics and limitations](docs/SPHERICAL.md). All existing planar APIs and v1 partitions are unchanged.

## Orthographic globe demo

Run `npm run build` and `npm run demo:globe`. This geometry-only D3 Canvas demo includes touch rotation and repeated pinch zoom, real atlas inputs, Quadstream/original comparison, and render-time view culling and spherical clipping (`?clip=0` to disable; the engine query itself is not viewport-aware). See [globe controls, provenance and limitations](docs/GLOBE.md).
