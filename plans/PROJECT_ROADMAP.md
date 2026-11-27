# Quadstream project roadmap

**Status:** proposed follow-on work after the combined TypeScript modernization PR. This document does not authorize merges, releases or VizHub deployment. Every follow-on PR targets the repository's default branch directly (no stacked PRs). Update scope and acceptance criteria when benchmarks or correctness findings require it.

## Current combined modernization (historical PR1–PR7 scopes)

The accompanying large PR introduces the following components as a **development-preview implementation**:

| Original planned scope            | Delivered by this PR                                                                                                                                               | Important limits                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| PR1: TypeScript groundwork        | Strict ESM source, declarations, build, tests, documentation, preservation of original code                                                                        | npm install and CI status must be independently verified; MIT selected; provenance review pending |
| PR2: geometry primitives/topology | Exact-coordinate shared arcs, stable IDs, line/polygon/multipolygon paths, critical junctions                                                                      | No snapped edges or geographic wrap; quadratic validity reference                                 |
| PR3: sparse quadtree              | Deterministic occupancy/priorities, bounded levels, explicit overflow                                                                                              | Not optimized for tens of millions of vertices                                                    |
| PR4: BLG hierarchy                | Ordered min-Cartesian tree, iterative multiresolution traversal, invariant checker                                                                                 | Batch construction only; no online BLG mutations                                                  |
| PR5: combined engine              | Shared arc multiresolution reconstruction, validation and full-geometry fallback                                                                                   | Invalid simplifications fall back globally, harming compression and monotonicity                  |
| PR6: viewport index               | Deterministic packed static bounding-box index                                                                                                                     | No segment clipping or dynamic updates                                                            |
| PR7: binary/partition foundation  | Versioned manifest and partitions, length/checksum/ID checks, idempotent partial session, optional cancellable lazy loader with bounded concurrency and memory LRU | No HTTP-specific CDN/persistent caching or cryptographic authentication                           |

### Mandatory sign-off before PR8

Run a fresh checkout `npm ci`, `npm run check` and the demo on supported Node versions. Verify the committed lockfile and dependency pinning. The modern MIT license decision is recorded; confirm ownership/provenance and preserve all historical third-party notices before a public npm release. Confirm algorithm behavior with the UDCVis Vietnam, Africa and Florida regression examples and capture realistic country-boundary benchmarks before claiming production-ready topology preservation. Record reproducible commands and actual measurements.

## Interactive algorithmic performance work

The [interactive algorithmic performance roadmap](INTERACTIVE_ALGORITHMIC_PERFORMANCE.md) decomposes the performance portions of PR10, PR11 and PR12 into independently mergeable waves. It prioritizes output-sensitive reconstruction and indexed validation, followed by shared-arc caching, incremental spherical repair and validity-aware spatial retrieval. The [fused spherical BLG clipping design](FUSED_SPHERICAL_BLG_CLIPPING.md) proposes an isolated early prototype and correctness-gated integration; neither document claims the optimizations are implemented.

## Follow-on standalone PRs

### PR8 — CLI and standards-based geographic adapters

**Goal:** make Quadstream useful from the terminal and interoperable with common web cartographic tools.

- Add `quadstream build`, `validate`, `inspect`, `query`, and `benchmark` commands with streaming-friendly file IO, documented exit codes, size caps and meaningful error messages.
- Support GeoJSON and TopoJSON import/export in separate adapters; preserve shared arcs, holes and feature properties. Define precise coordinate reference system and antimeridian policies.
- Add explicit schemas for manifests and protocol compatibility across versions; optional standard Mapbox Vector Tile export must be tested against independent decoders.
- Expose examples of staging static output in ordinary object storage. No VizHub-only API or credentials.
- Add fixtures for malformed formats, oversized inputs, empty geometries, degenerate rings and round trips. Validate a clean install and CLI help in Node 20 and 22.

**Acceptance:** a fresh contributor can convert a representative public GeoJSON file, inspect the manifest, and query or export a reproducible simplified map. Exact reconstruction and shared boundaries remain valid.

### PR9 — Interactive progressive map examples and MapLibre adapter

**Goal:** demonstrate the algorithm visually and verify real map behavior.

- Build standalone world-map demo (Canvas) showing hierarchy levels, shared arcs, vertex count and fallback indicators.
- Implement a MapLibre adapter via GeoJSON source updates first; consider tile/protocol adapters only after benchmarks.
- Add worker-based preprocessing and rendering boundaries, viewport request cancellation, cache eviction, retries/backoff, partial update status, and stale-result suppression.
- Build a small, self-hostable demo page; document CORS/caching behavior, no cookies or analytics by default.
- Add Playwright end-to-end, accessibility, pixel regression and network-throttling tests.

**Acceptance:** panning/zooming while partitions arrive never silently displays invalid topology or allows older viewport responses to replace the current view; demo runs without VizHub services.

### PR9b — Spherical D3 orthographic globe (PR9b-1 and PR9b-2 merged)

PR9b-1 established the opt-in spherical reference engine and cube-face priorities. PR9b-2 uses the maintainer's simpler MIT-licensed VizHub pointer-driven globe, preserving Canvas rotation and pinch behavior while removing all data overlays. It adds an in-memory worker, real atlas comparison, conservative fallback, and Node 26/Chromium/WebKit regression tests. See [globe documentation](../docs/GLOBE.md). PR9b-3 remains responsible for scalable spherical validation, measured screen-space error, conservative visibility, and versioned progressive artifacts; physical-device acceptance and performance benchmarking remain outstanding.

See also [fractional LOD topology](FRACTIONAL_LOD_TOPOLOGY_PLAN.md) and [globe LOD stabilization](GLOBE_LOD_STABILIZATION.md). The merged globe supports fractional LOD and shared-arc repair; production-scale validation remains outstanding.

### Release preparation — README, MIT scope and npm package

The maintainer selected MIT for the modern implementation; historical licensing
is unchanged. Prepare version 0.1.0, npm metadata, consumer docs and CI
clean-install checks on Node 20 and 26. Keep `private: true` until provenance,
package scope/version availability, reproducible install and benchmark/release
sign-off are confirmed. This PR does not publish to npm or change algorithms.

### PR10 — Algorithm hardening, production benchmarks and v0.1.0 release

**Goal:** quantify whether Quadstream offers differentiated value compared with modern alternatives.

- Add historical Vietnam/Africa/Florida fixtures with expected topology outcomes, adversarial near-coincident borders, dateline cases, junctions and complex nested holes.
- Replace quadratic validation in production path with a scalable, well-tested geometric validator while retaining the reference oracle.
- Design and verify safe simplification refinements rather than whole-view fallback; ensure adjacency, ring containment and intersection invariants across zoom levels.
- Measure simplification quality and compare against Tippecanoe, TopoJSON simplification and unsimplified GeoJSON at 10k / 100k / 1M / 10M vertices, using measured memory, time, bytes and topology validity.
- Audit malformed manifest and binary inputs; add crypto integrity for remote transport, quotas, OOM prevention, fuzzing and corpus coverage.
- Complete provenance review, lockfile verification, npm provenance/release verification, package API compatibility policy, changelog, docs website and benchmark publication.

**Acceptance:** public v0.1.0 is only released after signed-off license, reproducible installs, all relevant tests passing and published benchmark results. State limitations prominently if reference performance targets are not met.

### PR11 — Progressive network transport and server-side artifacts

**Goal:** operationalize partition retrieval without forcing a custom mapping platform.

- Introduce optional async partition loaders with AbortSignal, deduped concurrent fetches, bounded in-flight work, LRU cache with byte budgets, ETags and integrity verification.
- Support manifest version negotiation, immutable/content-addressed objects and CDN-friendly hosting.
- Implement viewport-aware conservative dependency planning that includes polygons/segments crossing a view even when no vertices fall inside it.
- Test out-of-order arrivals, offline recovery, 404/5xx, stale manifests, low bandwidth and incomplete data.

**Acceptance:** every data access is explicit, recoverable and cancellation-safe; no silent missing geometry or unbounded memory growth.

### PR12 — Advanced geometry algorithms (experimental)

**Goal:** revisit research differentiation beyond a basic simplifier.

- Investigate priority metrics combining cell occupancy, curvature, shared-boundary constraints and measured error; preserve determinism.
- Compare partial vs entire-ring fallback and globally consistent arc-level refinements.
- Add topology graph validation for many-to-many border relationships and independently digitized boundaries, with explicit snapping tolerance policy.
- Explore binary geometry encoding variants, typed-array/compact Morton index and optional WASM worker execution.

**Acceptance:** improvement demonstrated through repeatable quality/performance results; do not replace the stable core with experimental approaches without migration/versioning plan.

## Separate VizHub integration workstream

**V1 — Geospatial dataset profiling and authorization:** extend VizHub's dataset registry to profile geographic formats with feature counts, bounds, geometry type, CRS assumptions and safe summary projection. Revalidate project/visualization read access before accessing any dataset. Avoid persisting duplicate raw data.

**V2 — Feature-flagged preprocessing and mapping adapter:** add a bounded, cancellable background preprocessing job that consumes authorized geographic datasets and caches version-pinned artifacts. Run MapLibre/Canvas pilot behind a flag. Existing D3/MapLibre user code and Tippecanoe/Martin infrastructure remain viable and are not replaced.

**V3 — Dynamic choropleth user workflow:** join geography identifiers to semantically described data measures, scaffold interactive maps from a VizHub template, enable published/private visibility rules, and record activation, load latency, bytes transferred and renderer errors.

**V4 — Production readiness decision:** compare real-world performance and maintenance cost with standard vector-tile workflows before enabling Quadstream by default. Explicit rollback, error budgets, authorization and source lineage requirements apply.

## Governance

- Continue using direct-to-main PRs with serial dependency-aware implementation, unless a planned PR is truly independent.
- Keep Quadstream core free of VizHub-specific imports, accounts, databases and API endpoints.
- Publish accurate local validation commands/logs; GitHub CI being unavailable is neither a passing nor a failing result.
- Do not infer npm publication or production deployment from a merged source PR.
