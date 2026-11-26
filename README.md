# Quadstream

**Progressive, topology-aware, multiresolution geometry for the web.**

Quadstream prepares geographic shapes at multiple levels of detail while
sharing exactly matching boundaries. Build once, query a simpler representation
for a map or globe, or serialize planar geometry into independently loadable
binary partitions. The TypeScript-first core is ESM with no runtime dependencies,
and requires no VizHub account, map framework or server.

> **Experimental 0.1.0 release preparation.** The package is not yet published
> and remains private pending release sign-off. Reference validation can be
> expensive; do not use it for safety-critical geometry.

## Features

- Deterministic spatial vertex priorities and BLG-style ordered reconstruction.
- Exact shared arcs, reversible references and explicit validity fallback.
- Planar viewport queries, GeoJSON/TopoJSON adapters and versioned binary partitions.
- Transport-independent progressive loading with cancellation and a bounded raw-byte cache.
- Experimental spherical geometry for D3 globes, including seam and pole aliases.
- Standalone CLI and local Canvas, MapLibre and D3 globe demos.

## Install

Once the public package is released (Node.js 20+, ESM):

```sh
npm install @vizhub/quadstream
```

Until then, use a checkout and build the package:

```sh
git clone https://github.com/vizhub-studio/quadstream.git
cd quadstream
npm ci
npm run build
node examples/hello.mjs
npm pack
```

The generated tarball can be installed into a separate project. The following
examples use the package's public import path. From a checkout, examples in
`examples/` instead import `../dist/index.js`.

## Quick start: planar geometry

```js
import { buildQuadstream } from '@vizhub/quadstream';

const source = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'square',
    properties: { value: 42 },
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
    }
  }]
};

const dataset = buildQuadstream(source, { maxLevel: 12 });
const result = dataset.query({ level: 4, bounds: [0, 0, 10, 10] });
console.log(result.geojson, result.usedFallback);
```

Detail levels run from 0 (coarsest) to `maxLevel - 1` (finest).
The returned feature collection can be rendered with your preferred renderer.
TypeScript users can annotate the source with the exported `FeatureCollection`
type.

The planar engine interprets coordinates as Cartesian numbers. Project or
split dateline-crossing geography upstream; use the spherical API for
great-circle globe geometry.

## Progressive planar loading

```js
import {
  exportPartitions, QuadstreamSession, QuadstreamLoader, fetchFromBundle
} from '@vizhub/quadstream';

const bundle = exportPartitions(dataset, { fileDepth: 3 });
const session = new QuadstreamSession(bundle.manifest);
const loader = new QuadstreamLoader(session, fetchFromBundle(bundle), {
  concurrency: 4,
  cacheBytes: 1024 * 1024
});

const frame = await loader.loadLatest({ level: 4 });
console.log(frame.geojson, frame.complete, frame.usedFallback);
```

Replace `fetchFromBundle` with an async function accepting a partition key and
`{ signal }` to retrieve bytes from your own transport. The session validates
partition checksums, sizes and records before ingestion. A new latest-view
request cancels the preceding one. Partial session queries report incomplete
or omitted features until required partitions arrive.

The raw-byte cache does not evict parsed session vertices. The planner is
conservative: it may request partitions outside the viewport to reconstruct
segments that cross it. No production HTTP/CDN client is bundled.

## Spherical geometry and D3

Use the distinct spherical engine for longitude/latitude coordinates in
degrees with D3 spherical winding (clockwise small polygon interiors).
The following example assumes a TopoJSON atlas is already loaded:

```js
import { buildSphericalQuadstream, importSphericalTopoJSON } from '@vizhub/quadstream';

const countries = importSphericalTopoJSON(atlas, 'countries');
const globe = buildSphericalQuadstream(countries, { maxLevel: 20 });
const { geojson, valid, promotedArcs } = globe.query({ level: 8.5 });
// Supply geojson to your D3 geoPath renderer.
```

Spherical queries reconstruct global geometry in memory. Fractional detail uses
stable vertex-ID hashing; shared-arc promotion repairs invalid features without
a global full-detail fallback. They do not support
planar viewport bounds, v1 partition serialization or network streaming.
They may reject inputs that cannot be validated in the reference hemisphere
chart. See [spherical semantics](https://github.com/vizhub-studio/quadstream/blob/master/docs/SPHERICAL.md).

## Interactive demos

From a checkout, install dependencies and build, then run either command:

| Demo | Command | What it demonstrates |
| --- | --- | --- |
| Progressive map | `npm run demo:map` | Canvas/MapLibre, detail levels, shared arcs, simulated partition latency |
| Orthographic globe | `npm run demo:globe` | D3 Canvas, real 110m/50m atlas inputs, pinch zoom, rotation, worker-based LOD and original/reconstructed comparison |

Open the local URL printed by the server (normally http://127.0.0.1:4173/).
The demos are not included in the npm artifact. The globe downloads the full
atlas up front; its LOD reduction is not a bandwidth-saving streaming protocol.
See [map demo](https://github.com/vizhub-studio/quadstream/blob/master/docs/PROGRESSIVE-MAP.md)
and [globe demo](https://github.com/vizhub-studio/quadstream/blob/master/docs/GLOBE.md).

## CLI

After installing the released package, run its executable with
`npx --no-install quadstream` (or use `node bin/quadstream.mjs` from a built checkout):

```sh
npx --no-install quadstream build countries.geojson countries.bundle --max-level 20 --file-depth 4
npx --no-install quadstream inspect countries.bundle
npx --no-install quadstream validate countries.bundle
npx --no-install quadstream query countries.bundle --level 10 --output simplified.geojson
npx --no-install quadstream benchmark countries.geojson --iterations 3
```

The CLI currently operates on planar coordinates. Query output and build
directories must not already exist. See [CLI and format policy](https://github.com/vizhub-studio/quadstream/blob/master/docs/CLI.md)
for input restrictions, bounds, exit codes and static staging.

## Public API guide

| API | Purpose |
| --- | --- |
| `buildQuadstream`, `QuadstreamDataset` | Build planar multiresolution geometry and query by detail/bounds |
| `buildSphericalQuadstream`, `SphericalQuadstreamDataset`, `importSphericalTopoJSON` | In-memory D3-style geographic reconstruction |
| `importGeoJSON`, `exportGeoJSON`, `importTopoJSON`, `exportTopoJSON` | Planar geographic interchange |
| `exportPartitions`, `validateManifest`, `MANIFEST_VERSION` | Versioned planar artifacts |
| `QuadstreamSession`, `QuadstreamLoader`, `fetchFromBundle` | Partial reconstruction and injected async delivery |
| `ProgressiveMap`, `attachMapLibre`, `mapLibreBounds` | Renderer-independent orchestration and MapLibre integration |
| `buildTopology`, `buildSparseQuadtree`, `buildBlgTree`, `createSpatialIndex` | Lower-level algorithm building blocks |

See the [export list](https://github.com/vizhub-studio/quadstream/blob/master/src/index.ts)
and included TypeScript declarations for complete signatures and utilities.

## Detailed API reference

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
Spherical queries support fractional levels. Invalid features are repaired by
promoting shared arcs to finer levels; `promotedArcs` reports the number of
promoted arcs. `valid: false` indicates geometry that remains invalid at full
detail. No global full-detail fallback is applied. See [spherical semantics](docs/SPHERICAL.md) for winding,
poles, seams, charts, and topology junctions.

Spherical reconstruction applies three additional safeguards:

- vertices shared by three or more feature IDs are critical, preserving
  multi-shape junctions and shared topology;
- a vertex is promoted to critical when its removal would reverse a ring's
  projected winding, collapse its area, or make a small ring fail the spherical
  validity predicate;
- closed rings that would reconstruct with fewer than three distinct vertices
  are restored from their source path rather than emitted as degenerate rings.

These safeguards and shared-arc repair preserve shared topology without promoting
the entire query to a finer level. The globe demo separately isolates malformed
source features, so one invalid atlas feature does not force its whole
coordinate-connected component to full detail.


## How it works

Quadstream deduplicates exact shared vertices and arcs, assigns deterministic
spatial importance using a sparse hierarchy, and reconstructs source order
through Binary Line Generalization (BLG)-style priority trees. Planar geometry
uses a sparse quadtree, while spherical geometry uses hierarchical occupancy
on six cube faces. A packed planar spatial index selects viewport candidates.
The versioned planar binary format stores checksummed vertex batches separately
from topology metadata.

## Geometry semantics and limitations

- Supported shapes: Polygon, MultiPolygon, LineString and MultiLineString.
  No points, nested geometry collections, 3D coordinates or nonfinite positions.
- Only exact coordinate matches establish shared borders; no approximate
  snapping or differently digitized boundary reconciliation.
- Planar bounds filter whole features; they do not clip geometry. Planar IDs
  are normalized to strings, and null properties become empty objects.
- Full-detail reconstruction retains coordinates and order subject to documented
  normalization and cyclic ring starts. Coarse BLG subsets are nested, but
  validated output may not be monotonic when a fallback occurs.
- By default, invalid planar simplified geometry triggers a global full-detail
  fallback, not independent per-feature simplification. Partial results are
  explicit; validation does not prove global cross-feature topology.
- Reference polygon validity checks are quadratic; large-scale performance,
  measured screen-space error, robust global spherical predicates and
  production resource hardening remain future work.
- Binary checksums detect accidental corruption, not malicious changes.

See the [architecture](https://github.com/vizhub-studio/quadstream/blob/master/docs/ARCHITECTURE.md)
and [roadmap](https://github.com/vizhub-studio/quadstream/blob/master/plans/PROJECT_ROADMAP.md)
for implementation details and planned work.

## Development

```sh
npm ci
npm run check
npm run lint
npm run test:package
npx playwright install --with-deps chromium webkit
npm run test:globe:browser
```

Use `npm run prettier` to format maintained sources. CI retains Node 26 and Chromium/WebKit globe regression tests and adds
packed-package verification for Node 20 and 26. The real-atlas globe tests
compare original and full-resolution reconstruction across multiple views and
zoom levels. Physical mobile-device validation and production benchmarks remain
outstanding. See [contributing](https://github.com/vizhub-studio/quadstream/blob/master/CONTRIBUTING.md).

## History and license

Quadstream revives research and prototypes from 2010–2012 in a self-contained
modern TypeScript implementation. See [historical provenance](https://github.com/vizhub-studio/quadstream/blob/master/docs/HISTORY.md).

Run `npm run build` and `npm run demo:globe`. This geometry-only D3 Canvas demo includes touch rotation and repeated pinch zoom, real atlas inputs, Quadstream/original comparison, and render-time view culling and spherical clipping (`?clip=0` to disable; the engine query itself is not viewport-aware). See [globe controls, provenance and limitations](docs/GLOBE.md).
The modern implementation is MIT-licensed. Historical Java/browser code
retains its existing license terms.
See [LICENSE](https://github.com/vizhub-studio/quadstream/blob/master/LICENSE).
