# Quadstream

**Progressive, topology-aware, multiresolution geometry for the web.**

Quadstream prepares geographic shapes at multiple levels of detail while
sharing exactly matching boundaries. Build once, query a simpler representation
for a map or globe, or serialize planar geometry into independently loadable
binary partitions. The TypeScript-first core is ESM with no runtime dependencies,
and requires no VizHub account, map framework or server.

> **Experimental 0.1.0.** Reference validation can be expensive; do not use it
> for safety-critical geometry.

## Features

- Deterministic spatial vertex priorities and BLG-style ordered reconstruction.
- Exact shared arcs, reversible references and explicit validity fallback.
- Planar viewport queries, GeoJSON/TopoJSON adapters and versioned binary partitions.
- Transport-independent progressive loading with cancellation and a bounded raw-byte cache.
- Experimental spherical geometry for D3 globes, including seam and pole aliases.
- Standalone CLI and local Canvas, MapLibre and D3 globe demos.

## Install

Install from npm when version 0.1.0 is available (Node.js 20+, ESM):

```sh
npm install @vizhub/quadstream
```

Alternatively, build from a checkout:

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
import { buildQuadstream } from "@vizhub/quadstream";

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
  exportPartitions,
  QuadstreamSession,
  QuadstreamLoader,
  fetchFromBundle,
} from "@vizhub/quadstream";

const bundle = exportPartitions(dataset, { fileDepth: 3 });
const session = new QuadstreamSession(bundle.manifest);
const loader = new QuadstreamLoader(session, fetchFromBundle(bundle), {
  concurrency: 4,
  cacheBytes: 1024 * 1024,
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
import {
  buildSphericalQuadstream,
  importSphericalTopoJSON,
} from "@vizhub/quadstream";

const countries = importSphericalTopoJSON(atlas, "countries");
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

| Demo               | Command              | What it demonstrates                                                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Progressive map    | `npm run demo:map`   | Canvas/MapLibre, detail levels, shared arcs, simulated partition latency                                            |
| Orthographic globe | `npm run demo:globe` | D3 Canvas, real 110m/50m atlas inputs, pinch zoom, rotation, worker-based LOD and original/reconstructed comparison |

Open the local URL printed by the server (normally http://127.0.0.1:4173/).
The demos are not included in the npm artifact. The globe downloads the full
atlas up front; its LOD reduction is not a bandwidth-saving streaming protocol.
See [map demo](https://github.com/vizhub-studio/quadstream/blob/master/docs/PROGRESSIVE-MAP.md)
and [globe demo](https://github.com/vizhub-studio/quadstream/blob/master/docs/GLOBE.md).

## CLI

After installing the package, run its executable with
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

| API                                                                                 | Purpose                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `buildQuadstream`, `QuadstreamDataset`                                              | Build planar multiresolution geometry and query by detail/bounds |
| `buildSphericalQuadstream`, `SphericalQuadstreamDataset`, `importSphericalTopoJSON` | In-memory D3-style geographic reconstruction                     |
| `importGeoJSON`, `exportGeoJSON`, `importTopoJSON`, `exportTopoJSON`                | Planar geographic interchange                                    |
| `exportPartitions`, `validateManifest`, `MANIFEST_VERSION`                          | Versioned planar artifacts                                       |
| `QuadstreamSession`, `QuadstreamLoader`, `fetchFromBundle`                          | Partial reconstruction and injected async delivery               |
| `ProgressiveMap`, `attachMapLibre`, `mapLibreBounds`                                | Renderer-independent orchestration and MapLibre integration      |
| `buildTopology`, `buildSparseQuadtree`, `buildBlgTree`, `createSpatialIndex`        | Lower-level algorithm building blocks                            |

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

## Algorithmic complexity and computational geometry

These are analytical bounds for the current implementation, not performance
measurements or guarantees about an idealized Quadstream algorithm. We count
fixed-width numeric operations and assume expected constant-time Map/Set
operations and conventional comparison sorting. Space bounds include working
data and results unless described as auxiliary. Add the size of feature
properties, identifiers and other metadata when these are not constant-sized.

### Notation

- N: input coordinate occurrences, including repeated shared boundaries;
  V: distinct vertices; F: features.
- A: distinct arcs; M: total vertex positions stored across distinct arcs
  (including repeated endpoints); R: arc references across feature paths.
- For a query, T is the sum of the full arc lengths across the selected
  references, K is the reconstructed coordinate count, and J is the number
  of selected features. A subscript "all" denotes the whole dataset.
- L: number of detail levels (currently at most 26); P: partitions;
  B: bytes processed; U: distinct cached query levels.
- Q: sum of squared vertex counts of individual polygon components being
  validated, counting all rings of each component. For K coordinates,
  Q is at most K². Line validation contributes linear work instead.

Shared boundaries make V, M and N different quantities. In particular,
repeated arc references may make T much larger than the number of distinct
vertices selected by BLG. For topology built from ordinary supported input,
V, M, R and F are O(N); a serialized manifest can describe a different
reference workload.

### Geometry predicates and preprocessing

| Algorithm                                                                                                                            | Time                                   | Space and explanation                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Coordinate normalization, bounding boxes, signed area (shoelace), ray-cast point-in-ring, great-circle path checks                   | O(n) for n positions                   | O(1) auxiliary for scans; O(n) if materializing normalized coordinates                                                |
| Orientation, segment intersection, bounds intersection/union, cell addressing, angular distance and individual spherical projections | O(1)                                   | O(1); fixed-dimensional arithmetic                                                                                    |
| Simple-ring validation                                                                                                               | O(n²) worst case                       | O(1) auxiliary; tests nonadjacent segment pairs                                                                       |
| Polygon validation (shell and holes)                                                                                                 | O(n²) worst case                       | O(1) auxiliary planar space; ring simplicity, edge-pair intersection and containment tests                            |
| Exact-coordinate topology and reversible shared-arc interning                                                                        | O(N + sum(d_e log d_e) + Q)            | O(N); hash interning and adjacency scans, sorting the owner set of each edge e with d_e distinct owning paths         |
| Sparse planar quadtree and six-face spherical priorities                                                                             | O(V log V + VL)                        | O(V); deterministic sorting, at most L probes per vertex, one stored occupied cell per vertex                         |
| BLG min-Cartesian tree construction                                                                                                  | O(m) per arc of length m; O(M) overall | O(m) per arc; each node is pushed and popped at most once on the monotone stack                                       |
| BLG invariant checking                                                                                                               | O(m)                                   | O(m) visited set and traversal                                                                                        |
| Packed static bounding-volume hierarchy                                                                                              | O(F log F)                             | O(F) for fixed bucket size; sorting and packing progressively smaller groups                                          |
| Spherical hemisphere chart construction                                                                                              | O(n)                                   | O(n) vector arrays; individual gnomonic projection is O(1)                                                            |
| Spherical polygon signature and validation                                                                                           | O(n²)                                  | O(n) projected working arrays; minor great-circle edges map to straight segments within the supported open hemisphere |

The topology owner-set sorting term is bounded by O(N log N) in the
fixed-width model. Without source validity checking, topology construction
would be expected near-linear for ordinary bounded edge ownership. It is not
a planar arrangement or a general-purpose noding algorithm: crossings and
differently digitized edges are not split or snapped to infer shared borders.

The planar quadtree computes cell addresses directly at each level, rather
than materializing the complete 4^L grid or descending a pointer tree. The
spherical variant chooses the dominant Cartesian axis of a unit vector to
select a cube face, then uses the analogous sparse occupancy test. Neither
guarantees logarithmic insertion independent of the configured depth and
coordinate distribution. Dense clusters can exhaust the available levels.

Spherical preprocessing also tests whether removing a vertex would reverse
projected winding or collapse a ring. After a linear projection and area
pass, each signed-area update takes O(1). For rings with at most 32 stored
coordinates, it additionally validates the entire candidate polygon.
For polygon p with n_p coordinates and s_p candidates in these short rings,
this adds O(sum_p(s_p n_p²)) time in the worst case, with O(N) peak working
geometry. A polygon with many short holes can therefore incur superquadratic
preprocessing (a loose O(N³) dataset-wide bound); the short-ring threshold
does not bound the size of its containing polygon.

Combining the phases, planar build time is
O(N + sum(d_e log d_e) + Q + V log V + VL + M + F log F),
with O(N + V + M + F) geometry storage. The spherical build substitutes
spherical predicates, adds the short-ring candidate term above and retains
the canonical source and signatures, but does not build a planar spatial index.

### Level-of-detail selection and query complexity

| Algorithm                                            | Time                                                                    | Space and explanation                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| BLG threshold traversal                              | O(t + 1), with t nodes passing the traversal threshold; O(m) worst case | O(h + k) for tree height h and k emitted positions; h can be m                                                   |
| Fractional BLG selection                             | Same traversal bound                                                    | Stable vertex-ID hash is O(1); rejected fractional-level candidates are still visited                            |
| Viewport feature lookup                              | O(w + J log(J + 1))                                                     | O(w + J) conservative auxiliary bound; w counts visited nodes and tested entries; O(F + J log(J + 1)) worst case |
| Arc/path reconstruction before polygon validation    | O(T + K + J)                                                            | O(T + K + J) conservative bound for full-ID scans, reversed copies, temporary paths and output                   |
| Planar feature reconstruction with validity checking | O(T + K + J + Q)                                                        | Same linear working storage; quadratic time does not imply quadratic storage                                     |
| Spherical shared-arc repair                          | O(L(T_all + F + Q_full)) worst case                                     | O(T_all + F + A) working geometry, plus retained source and trees                                                |

BLG is a min-heap on detail priority and an inorder sequence on path
position. An entire subtree can be skipped when its root exceeds the
traversal threshold. For integer levels, t equals k; fractional levels
also visit next-level candidates that fail their stable hash threshold.
Selection does not require a balanced tree, and no O(log m) worst-case tree
height is promised. The iterative traversal avoids call-stack overflow.

Importantly, current feature reconstruction collects all original arc IDs
for potential collapsed-ring restoration, even when BLG emits very few
vertices. It also repeats selection for each arc reference rather than
memoizing a shared arc's selected sequence across features. Consequently,
end-to-end reconstruction is not yet an O(K)-only algorithm. Exact shared
arcs ensure that both traversal directions refer to the same priority
sequence; arc reversal and stitching preserve shared coordinate identity.

The packed spatial index prunes disjoint bounding volumes, tests candidates
in intersecting leaves, then sorts results by original ordinal. There is
no guaranteed O(log F + J) query bound for heavily overlapping boxes.
Viewport lookup selects whole features rather than clipping their edges.

A cold validated planar query first reconstructs features globally to
determine whether the level is valid (up to O(T_all + F + Q_level)), then
reconstructs the selected features, possibly at full detail. Its cost is
therefore the global check plus the index lookup and selected reconstruction
terms above. The global Boolean decision is cached by exact numeric level,
using O(U) storage; a warm query avoids that global check but still runs
per-feature polygon validation during reconstruction. Setting
`validate: false` bypasses the global decision, not the internal planar
polygon predicates. A global fallback can raise K and Q to their
full-resolution values. Fractional levels mean U is not generally bounded
by L in the in-memory planar engine.

Spherical queries always reconstruct the global collection. Each repair pass
scans feature/arc references, promotes shared arcs of invalid features by
one level and reconstructs affected features. The implementation explicitly
caps the number of passes at O(L), so the worst case is O(L) times global
reconstruction and validation, with Q_full computed from full-detail
polygon sizes. It can finish earlier, or report invalid geometry after the
cap; it does not prove global convergence or absence of unrelated
cross-feature intersections. The cooperative interruptible variant has the
same asymptotic work, yielding between features rather than inside expensive
polygon predicates.

### Adapters, serialization and progressive loading

| Algorithm                                                        | Time                                                     | Space and explanation                                                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GeoJSON normalization / export                                   | O(N) plus planar topology validation                     | O(N); export validates nonempty results again                                                                                                    |
| TopoJSON delta decode, signed arc reversal and stitching         | O(D + T_all)                                             | O(D + T_all); D counts positions in all encoded arcs, including unselected named objects                                                         |
| Planar TopoJSON import/export                                    | Decode or encode linear work plus topology construction  | O(N + M + R + D) as applicable; export rebuilds topology after GeoJSON validation                                                                |
| Spherical TopoJSON import                                        | Decode plus spherical signatures and topology validation | Linear geometry storage; includes quadratic polygon checks                                                                                       |
| Partition assignment and export                                  | O(V + P log P + sum_p(v_p log v_p))                      | O(V + P) new records, metadata and binary bytes, sharing existing topology; v_p records in partition p                                           |
| QSTR encoding/decoding and FNV-1a checksum                       | O(B)                                                     | O(B) output for encoding/decoding, O(1) auxiliary checksum space                                                                                 |
| Manifest schema and reference validation                         | O(V + M + R + F + P)                                     | O(V + M + R + F + P) conservative working space for IDs, arc copies and path accounting                                                          |
| Required/missing partition planning and diagnostic bounds filter | O(P)                                                     | O(P) worst-case key output; loaded membership is expected O(1)                                                                                   |
| Session construction                                             | O(V + M + P + F log F)                                   | O(V + M + F + P), including global manifest/tree/index data                                                                                      |
| Session partition ingestion                                      | O(B)                                                     | O(B) temporary records and sets, plus retained parsed vertices; repeat loads still checksum the bytes                                            |
| Loader ensure-level                                              | O(P + B + e) local work                                  | O(P + C b_max + H + V_loaded) excluding manifest/tree data; e cache evictions, C concurrency, b_max max partition bytes, H raw-byte cache budget |
| Sorted loaded-key enumeration                                    | O(P_loaded log(P_loaded + 1))                            | O(P_loaded) output                                                                                                                               |

QSTR v1 stores 10 header bytes plus 22 bytes per vertex record, so total
binary payload is exactly 10P + 22V bytes, separate from JSON metadata.
Partition export sorts keys and the records within each partition, and does
not perform another geometric simplification. The manifest stores global
topology, arc sequences, partition membership and vertex priorities, so even
a coarse client starts with O(V + M + R + F + P) structural information
before fetching all coordinate bytes.

Session queries combine the O(P) missing-key scan with the planar index and
reconstruction bounds. They perform global validity checks only once all
partitions are loaded; incomplete or invalid features can be omitted.
The session constructor performs its own structural/accounting checks;
`validateManifest` is the separate full schema validator.

The loader uses expected O(1) Map operations for LRU bookkeeping, amortized
constant eviction work per insertion, and O(B) copying/checksumming/decoding.
Its raw-byte budget does not evict parsed vertices or global topology.
Concurrency bounds active workers per request, not network latency or all
overlapping transport activity; a fetcher ignoring cancellation can keep
external work alive. Network time depends on request latency, throughput
and application transport. A conservative planner scans all partitions by
minimum level, not only those inside the viewport.

ProgressiveMap has at most three distinct normal stages (coarse, intermediate,
target), a bounded retry loop and optional full-detail rescue. Its total work
is the sum of loader and session-query costs over those stages, including
global completeness queries and sorted loaded-key diagnostics. It can fetch
all V records even for a coarse viewport. The MapLibre adapter adds O(1)
bounds/zoom and generation bookkeeping per event, excluding user callbacks
and renderer-side processing. There is no production spherical partition
protocol yet.

The CLI parses/serializes JSON in O(B) time and O(B) memory in the usual
input-size model, then delegates to the above algorithms. Its chunked reader
still buffers entire input files. Bundle inspect validates the manifest and
scans partitions; bundle query/validate load every partition, and query
export can revalidate or rebuild topology. The benchmark repeats build,
partition export and coarse/full query for each requested iteration; it is
not a separate simplification algorithm.

### Globe and map rendering algorithms

The demos add computational geometry and scheduling that are not part of the
dependency-free core. Let n be the number of input positions in a frame,
c the number of clipping pieces from an individual ring, z the number of
generated boundary samples, and s the number of minimap samples per edge.

| Algorithm                                                                   | Time                                         | Space and explanation                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Atlas cleanup and degenerate-ring filtering                                 | O(n)                                         | O(n) for cleaned paths                                                                    |
| Exact-coordinate-connected feature groups                                   | O((n + F)F) conservative worst-case bound    | O(n + F); union-find with path halving but no rank/size balancing                         |
| D3 area/containment compatibility checks                                    | O(n) coordinate visits for fixed probe count | Excludes D3 internals; compares source and candidate                                      |
| Feature/ring spherical cap and unit-vector preprocessing                    | O(n)                                         | O(F) for feature caps; O(n) for cached per-ring vectors                                   |
| Cached feature-cap visibility filtering                                     | O(F)                                         | O(F) worst-case result; dot-product cone test is O(1) per cap                             |
| Minor-arc/cone crossings and winding scan                                   | O(n) per ring                                | O(n) flags and retained pieces; crossing of one minor arc is O(1)                         |
| Ring clipping and boundary walk                                             | O(n + c² + z)                                | O(n + c + z); each exit scans all entry azimuths                                          |
| Padded-window clipping cache hit                                            | O(1)                                         | Reuses existing output; drawing still costs work                                          |
| Geometry worker packing/unpacking                                           | O(n + F)                                     | O(n + F) typed buffers and reconstructed arrays                                           |
| Zoom hysteresis, quantization, gesture updates and latest-generation checks | O(1) per ordinary update                     | O(active pointers) gesture state; worker queue coalescing scans pending messages linearly |
| Minimap viewport sampling                                                   | O(s)                                         | O(s) projected boundary samples                                                           |
| Planar Canvas path/segment diagnostics                                      | O(n) expected                                | O(n) shared-segment map; excludes Canvas rasterization                                    |

Ring clipping scans original edges for crossings, then pairs each exit with
the next entry in the required winding direction by exhaustive search.
For a collection the quadratic term is the sum of c² across processed rings.
Each piece has at most a fixed number of boundary samples at the current
four-degree step, so z is O(n) at that setting. A finer configurable step
would increase the output term. The cached padded cone avoids recomputing
clipping on every small camera movement; it does not accelerate the global
spherical engine query or change the original topology.

The globe's fallback preprocessing can attempt a whole collection, individual
features, a valid subset, and connected components. A constant number of
dataset-wide build attempts (some divided into disjoint groups) plus
component grouping and compatibility checks bounds that path; it can still
be costly. The component algorithm's loose bound above does not claim the
inverse-Ackermann guarantee of union-by-rank plus path compression.

The demo caches up to 48 worker geometry frames and four client frames.
With K_max maximum frame size their geometry can occupy O((48 + 4)K_max)
space, in addition to source data, topology, in-flight messages and
per-frame clipping caches. Worker wire encoding stores two Float64 values
per coordinate plus Int32 counts for features/polygons/rings; transfer avoids
an extra buffer copy where supported but not packing/unpacking work.
Cancellation is cooperative, and one expensive feature can exceed a nominal
time slice.

D3 projection, adaptive resampling and clipping, Canvas rasterization,
MapLibre triangulation and GPU rendering are external to these bounds.
Geometry traversal is linear in supplied coordinates before adaptive
resampling; projected sample count, pixel area and renderer internals
determine actual rendering work. The minimap also draws full-globe context
even when the main view is culled.

### What these bounds imply

- The principal asymptotic bottleneck is pairwise geometric validation, not
  Cartesian-tree construction. Spherical candidate checks and repeated
  shared-arc repair can multiply that cost.
- The sparse hierarchy reduces stored grid cells from a potential O(4^L)
  per face to O(V), and shared topology stores each distinct arc once.
  Neither fact makes all feature queries output-sensitive.
- Reducing validation complexity with robust sweep-line or spatially indexed
  intersection tests is a candidate improvement, not an implemented
  O(n log n) guarantee. Any replacement must preserve the required
  intersection, containment, winding and shared-boundary semantics.
- Avoiding unconditional full-ID scans, memoizing shared-arc selections,
  indexing arc-to-feature dependencies, and sorting clipping events instead
  of pairing them exhaustively are possible future optimizations. They must
  retain deterministic output and existing validity/fallback behavior.
- A fair benchmark should separately measure input topology, priority
  construction, BLG, validation, cold/warm queries, repair passes,
  partition metadata and payload bytes, peak memory, and rendering. Compare
  datasets with different vertex counts, feature overlap, hole counts and
  shared-boundary ratios; vertex count alone does not characterize cost.

These bounds do not establish topological equivalence for arbitrary
overlapping geographic features, a screen-space error bound, or a production
latency guarantee. See the implementation in [src/](src/), the
[globe demo](examples/globe/) and [roadmap](plans/PROJECT_ROADMAP.md).

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
