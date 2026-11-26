# Globe Trace Optimization Report

## Scope

This report summarizes findings from
`docs/Trace-20261126T142716.json.gz` and proposes prioritized remediations for
the interactive globe. The trace contains 10,856 trace events and was captured
from DevTools on a wide viewport (approximately 1920 by 553 CSS pixels) at
DPR 1.

The trace includes CPU-profiler and debugger instrumentation. Consequently,
absolute JavaScript timings are inflated, but the relative hotspots identify
the work that should be optimized first.

## Executive summary

The dominant interactive cost is Canvas/D3 path rendering. Six animation-frame
callbacks accounted for approximately 2.14 seconds of sampled JavaScript, with
individual callbacks reaching roughly 386 ms. The dominant sampled operations
were Canvas `closePath` and D3 projection/path functions.

The dominant startup cost is geometry validation in the worker. Samples
attributed approximately 1.73 seconds to `orientation`, 535 ms to
`simpleClosedRing`, and 338 ms to `segmentsIntersect`. These functions are
part of quadratic polygon self-intersection and ring-validity checks.

The recommended order is:

1. Reduce the amount of geometry sent through D3 and Canvas during interaction.
2. Replace or bypass quadratic validation for trusted globe atlas inputs.
3. Cache spherical coordinate math and replace string-heavy cell addressing.
4. Reduce per-query allocations and transferred object graphs.
5. Re-profile without DevTools CPU instrumentation and compare frame/startup
   budgets.

## Findings

### 1. Full globe redraws dominate interaction time

The renderer's animation-frame callback in
`examples/globe/main.mjs:126-140` calls the globe renderer and minimap on each
scheduled frame. The globe renderer in `examples/globe/map.mjs:60-78` redraws
the sphere, graticule, and visible land paths. The trace shows:

- Six sampled animation-frame callbacks.
- Approximately 2.14 seconds of aggregate callback time.
- Maximum sampled callback duration of approximately 386 ms.
- Approximately 674 ms in Canvas `closePath`.
- Several D3 projection/path functions contributing approximately another
  900 ms combined.

This indicates that projection and path traversal, rather than DOM layout, is
the primary live interaction bottleneck.

#### Suggested remediations

- Render a coarser geometry while `state.interacting` is true, then request and
  render the selected target LOD after interaction settles.
- Add an interaction-frame budget or throttle so expensive land-path rebuilds
  cannot consume every animation frame.
- Keep the sphere, ocean, and graticule on a cached background layer or
  `Path2D` where projection state permits it. Redraw only the land layer when
  rotation, scale, or geometry changes.
- Update the minimap only when the camera or active geometry changes. Avoid
  invoking it for diagnostics-only or redundant schedules.
- Benchmark clipping versus culling at representative zoom levels. The
  cheapest mode may differ between wide views and close-up views.
- Consider skipping the land stroke during active interaction if visual
  testing confirms that fill-only rendering is acceptable.

### 2. Polygon validation is the main worker startup hotspot

The CPU profile attributes most worker time to planar validity predicates:

- `orientation`: approximately 1.73 seconds.
- `simpleClosedRing`: approximately 535 ms.
- `segmentsIntersect`: approximately 338 ms.

`src/geometry.ts:99-112` documents and implements an O(n^2) ring
self-intersection check. `validPolygon` at `src/geometry.ts:137-155` performs
additional pairwise ring intersection and containment checks. The spherical
topology policy invokes spherical validity checks through
`src/spherical-dataset.ts:85-90`, and globe initialization builds and validates
the full dataset in `examples/globe/geometry.mjs:175-195`.

#### Suggested remediations

- Add a segment bounding-box index, sweep-line test, or spatial bucketing
  before exact orientation tests. Most segment pairs can be rejected without
  four orientation calculations.
- Add a clearly named trusted-atlas mode for bundled world-atlas inputs. Keep
  strict validation as the default library behavior, but use cheaper structural
  checks for known-valid demo data.
- Cache source validity results by immutable geometry identity so repeated
  builds and fallback grouping do not revalidate unchanged rings.
- Split validation into cheap checks and exact checks. Run closure, cardinality,
  finite-coordinate, and signed-area checks first; invoke intersection tests
  only when required.
- Measure whether the full-detail D3 oracle in
  `examples/globe/geometry.mjs:184-189` duplicates guarantees already provided
  by spherical reconstruction. If it does, retain it only in a diagnostic or
  test mode.

This is primarily a startup optimization. It should not be traded for weaker
geometry guarantees without an explicit mode and regression coverage.

### 3. Spherical priority construction repeats math and string allocation

The worker profile also shows:

- Approximately 308 ms in `buildSphericalPriorities`.
- Approximately 260 ms in `lonLatVector`.
- Approximately 229 ms in `canonicalLonLat`.

`src/spherical-geometry.ts:83-111` recalculates the unit vector and cube-face
coordinates for each vertex/level attempt. It also constructs string keys such
as `face:level:i:j`. Canonicalization and vector conversion are repeated in
several paths.

#### Suggested remediations

- Canonicalize each source vertex once and retain its normalized longitude,
  latitude, and unit vector in the topology vertex record.
- Compute the cube face and normalized face coordinates once per vertex, then
  derive the integer cell coordinates for each level from those cached values.
- Use a packed numeric key or a face-specific integer encoding for occupied
  cells instead of allocating delimiter-separated strings.
- Use typed arrays for `levelByVertexId` and other dense per-vertex data.
- Benchmark whether a direct level search or bit-shift-based cell calculation
  is faster than repeatedly computing `2 ** level` and flooring floating-point
  coordinates.

These changes should preserve the existing seam and cardinal-meridian rules;
the exact tie behavior in `sphericalCellAddress` needs dedicated regression
tests.

### 4. Allocation and garbage collection are measurable secondary costs

The trace includes approximately 59 ms of minor collection and an
approximately 18 ms major collection. Likely allocation sources include:

- Feature and geometry cloning in `examples/globe/geometry.mjs:175-185`.
- Per-query lookup arrays and reconstructed feature objects in
  `src/spherical-dataset.ts:211-240`.
- String keys and temporary coordinate arrays in spherical geometry code.

#### Suggested remediations

- Keep immutable feature metadata separate from changing coordinate buffers.
- Reuse feature wrappers and output arrays between queries where safe.
- Prefer packed coordinate/meta buffers for worker responses and defer
  GeoJSON object materialization until the renderer or compatibility checks
  require it.
- Avoid repeated `JSON.stringify` keys when a numeric vertex ID or canonical
  coordinate index is available.
- Track allocation size and GC pauses before and after each change; reducing
  object count is more important than micro-optimizing individual arithmetic.

### 5. Worker/query scheduling should remain latest-wins

The worker already uses cooperative cancellation and latest-query semantics in
`examples/globe/worker.mjs`. Any rendering optimization should preserve these
properties. In particular:

- Do not block the main thread with geometry validation or reconstruction.
- Do not allow a stale query to replace a newer frame.
- Keep transfer-buffer ownership explicit when changing response formats.
- Prefer reducing obsolete queries over making every obsolete query faster.

## Proposed implementation phases

### Phase 1: interaction responsiveness

1. Add an interaction-specific coarse render target.
2. Skip redundant minimap work.
3. Measure frame time, input latency, and final settled-frame quality.

Success criteria: no sustained multi-hundred-millisecond frame callbacks during
drag or wheel interaction on the representative atlas and viewport.

### Phase 2: startup validation

1. Add instrumentation around topology construction, spherical validity,
   priority construction, and full-detail compatibility checks.
2. Prototype indexed segment rejection.
3. Add a guarded trusted-atlas path only if strict validation remains available.

Success criteria: materially lower worker initialization time with unchanged
strict-mode validity results.

### Phase 3: spherical data representation

1. Cache canonical vectors and cube-face coordinates.
2. Replace string cell keys with packed numeric keys.
3. Compare typed-array and object representations.

Success criteria: lower initialization CPU time and allocation volume without
changing priority ordering, seam behavior, or query results.

### Phase 4: validation and regression coverage

For each optimization, run:

- Existing globe unit and browser tests.
- Spherical seam, pole, winding, hole, and shared-border tests.
- A representative 110m and 50m atlas startup benchmark.
- Interaction traces with and without clipping.
- A performance capture without DevTools CPU-profiler instrumentation.

Record median and p95 startup time, settled query latency, animation-frame
duration, rendered vertex count, and pixel-difference results.

## Measurement caveat and next trace

The current trace contains `CpuProfiler::StartProfiling` and V8 debugger
events, so it should not be used as an absolute production performance
baseline. After Phase 1, capture two comparable runs:

1. Performance panel recording without JavaScript CPU profiling.
2. A CPU profile focused on worker initialization only.

Keep viewport size, atlas, DPR, browser build, and interaction script fixed so
the before/after results remain comparable.
