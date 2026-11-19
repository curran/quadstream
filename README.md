# Quadstream

**Progressive, topology-aware, multiresolution geometry for the web.**

Quadstream revives the 2010–2012 research on spatially distributed vertex priorities, sparse quadtree subdivision, and Binary Line Generalization (BLG) trees. It turns the historical ideas into a small, TypeScript-first library for preparing geographic shapes at multiple levels of detail. No server, map framework, or VizHub account is required.

> **Development preview, not published.** This modernization is intentionally `private: true` and remains pre-release while licensing, large-dataset performance, geographic edge cases, and progressive streaming behavior are reviewed. Do not deploy it for safety-critical geometry or assume it produces cartographically optimal simplifications.

## Why Quadstream?

A conventional simplification algorithm often outputs one static polygon at one tolerance. Quadstream instead assigns every distinct source vertex an importance level in a **sparse quadtree**, then reconstructs each shape in source order using **BLG-style ordered priority trees**. Shared boundary arcs are indexed only once so adjoining polygons can reuse the same simplified coordinates.

| Component | Responsibility |
| --- | --- |
| Exact-coordinate topology | Deduplicate shared vertices and identify shared arcs and junctions |
| Sparse quadtree | Assign reproducible spatial importance levels to all unique vertices |
| BLG hierarchy | Restore original vertex ordering at any supported detail level |
| Packed spatial index | Select candidate features intersecting an axis-aligned viewport |
| Partitioned binary geometry | Serialize deterministic, checksummed vertex batches |
| Progressive session | Validate and ingest partitions, then query available geometry |

## Quick start

Requires Node.js 20+ for the package and an installed TypeScript compiler for building from source. The repository uses `npm`; after installing development dependencies:

```sh
npm install
npm run check
node examples/hello.mjs
```

`npm run check` runs the strict TypeScript build and Node's built-in test runner. No external test framework or runtime dependency is required. If dependency installation is unavailable, a compatible globally installed `tsc` can run the same checks.

```js
import { buildQuadstream, exportPartitions, QuadstreamSession } from '@quadstream/core';

const source = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', id: 'square', properties: { value: 42 },
    geometry: { type: 'Polygon', coordinates: [[
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]
    ]] }
  }]
};

const dataset = buildQuadstream(source, { maxLevel: 12 });
const { geojson, usedFallback } = dataset.query({ level: 4, bounds: [0, 0, 10, 10] });

const { manifest, partitions } = exportPartitions(dataset, { fileDepth: 3 });
const session = new QuadstreamSession(manifest);
for (const [key, bytes] of partitions) session.load(key, bytes);
const recovered = session.query({ level: 11 });
```

**Note:** During local development, run `npm run build` and use `../dist/index.js` from the example rather than a published package name; the public import above illustrates the intended package API.

## Geometry support and semantics

Supported: GeoJSON `Polygon`, `MultiPolygon`, `LineString`, and `MultiLineString` features with finite planar `[x, y]` coordinates. Feature properties and IDs are retained. Polygons are returned with closed rings and may have a cyclically rotated starting point.

Coordinates are **planar**, not automatically projected; caller-provided longitude/latitude is interpreted numerically. The current implementation does **not** wrap the antimeridian, transform coordinate reference systems, snap approximately matching vertices, infer shared borders from differently digitized edges, or support `Point`/`GeometryCollection`/3D coordinates. Invalid input rings are rejected. Polygon holes are validated for containment. Geometry validation uses an O(n²) reference implementation and is not yet scalable to very large rings.

A detail level is an integer from `0` (coarsest) through `maxLevel - 1` (finest). More detailed levels form nested vertex subsets *in the BLG hierarchy*. A coarse simplification can be invalid even if the original is valid; the synchronous dataset query makes a **dataset-wide validity decision** and conservatively falls back to **full original geometry for every selected feature, regardless of viewport** so shared boundaries remain consistent. The level-wise result is therefore **not guaranteed to be monotonic when fallback occurs**. The progressive session reports incomplete or omitted features until required partitions arrive and uses the same global fallback when all partitions are available.

Viewport queries perform **feature-bounds filtering**, not line clipping. Geometry can extend beyond the requested viewport. The partition planner conservatively requests every partition with potentially relevant priority, even when its bounding box is outside the viewport, because a long line may cross the view without any vertices inside it.

## What is implemented in this revival?

This combined modernization covers the foundation, topology, sparse quadtree, BLG, combined engine, viewport index and versioned progressive artifact scopes. It also includes deterministic fuzz/property-style tests, API declarations, a runnable example, and architecture documentation.

It does **not** claim that progressive loading is network-integrated or that a production map renderer is available. The following are deliberately deferred: full streaming fetch/cache/cancel transport, robust high-scale topology validation, CLI and format adapters, MapLibre integration, visual demo, benchmarking against Tippecanoe, npm release.

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
