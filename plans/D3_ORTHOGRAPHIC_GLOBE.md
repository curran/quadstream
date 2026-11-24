# Follow-up: Quadstream + D3 orthographic globe (PR9b, proposed)

This is a distinct, direct-to-default-branch follow-up to PR9. Graft Quadstream
onto the existing React/D3 orthographic globe supplied by the maintainer in
the project conversation (2026-11-23); retain its UI and rendering architecture.
Do not replace it with the equirectangular Canvas or MapLibre example.

## Existing baseline to preserve

- index.jsx / App.jsx: React root, config loading, state and postMessage visual editor.
- index.js: high-DPI Canvas geography and SVG city-label overlay.
- map.js: geoOrthographic, geoPath, sphere gradient, graticule, country fill/stroke and outline.
- projection.js, rotation.js, dragBehavior.js, zoomBehavior.js: fit Sphere, rotate on drag, scale on zoom.
- labels.js: population filtering, hemisphere clipping, RBush collision detection, SVG paint-order.
- constants.js, config.json, styles.css: existing styling and visual-editor controls.
- dataLoader.js: current atlas URL and city CSV URL remain configurable. Baseline uses
  visionscarto-world-atlas@0.1.0/world/110m.json, object countries, and the
  existing pinned worldcitiesReduced.csv gist. Evaluate source licenses and
  pin versions/checksums before redistributing datasets; use generated fixtures in CI.
  The supplied config.json is truncated; recover the full original before copying.
  Preserve the existing example's styling; do not infer missing config fields.

## Critical spherical geometry distinction

D3 projects longitude/latitude onto a sphere and draws geodesic segments; the
current Quadstream quadtree, ring predicates and bounding-box index are planar.
Feeding world-atlas directly into the current engine is NOT a correct spherical
implementation. In particular, changing ring winding can turn a country into
its spherical complement in D3 (D3's spherical convention differs from RFC 7946).
An antimeridian-spanning edge, pole-enclosing polygon or horizon-crossing arc
cannot be safely culled using an ordinary longitude/latitude bounding box.

### Phase A: geographic compatibility and correctness gate

1. Decode the named countries object, preserving IDs, properties, shared arcs and
   holes. Handle quantized TopoJSON transforms and signed arc references; avoid
   independent per-country simplification. Keep the original data for a
   correctness oracle.
2. Define a spherical geometry API, e.g. explicit geographic coordinate mode,
   rather than silently altering the planar contract. Canonicalize +/-180 and
   poles for topology identity without merging distinct paths; preserve winding
   and ring interior intent. Handle antipodal edges explicitly (reject ambiguous
   cases with diagnostics). Use robust spherical predicates for ring validity,
   containment, arc crossings, shared-boundary consistency and area/orientation.
   Compare against D3 geoArea/geoContains and independent spherical fixtures.
3. Investigate deterministic spherical vertex priorities: a cube-face hierarchy
   or another sphere-aware spatial subdivision with seam ownership and stable
   tie-breaking. Preserve BLG arc ordering and endpoints. Compare angular/
   great-circle error and projected pixel error across rotations and zooms.
   Merely changing the projection is not a spherical simplifier.
4. Start with conservative global retrieval, then design a spherical cap or
   conservative spherical index with geodesic arc extents, pole and antimeridian
   handling. Do not cull solely by projected vertices or viewport corners:
   polygons can cover the view with no visible vertices, and arcs can cross the
   horizon. Allow global fallback until the culling oracle is established.
5. If spherical output cannot be validated, keep the original full geometry
   (or explicitly flag an unavailable feature); never silently display invalid
   or complementary polygons. If artifact semantics change, version the
   manifest and negotiate explicitly; retain existing planar v1 compatibility.

### Phase B: graft onto the existing globe

- Replace only the atlas-loading branch of dataLoader.js with a manifest-backed
  worker/client; retain city CSV loading. Build static bundles from higher-detail
  atlas sources (e.g. 50m/10m after checking availability and provenance). Keep
  110m as a baseline and original-geometry fallback, not the only performance test.
  Select countries by named object, not all named TopoJSON objects.
- Extend React state with country geometry, loading/error state, level, counts,
  omitted features and request generation. Keep source configuration and
  city loading independent. Move async initialization to effects, use refs for
  stable worker lifecycle, cancel on dataset changes/unmount, and use one
  animation-frame render scheduler rather than recreating behavior every frame.
- Preserve map.js and labels.js projection semantics. Draw the last valid
  **global** geometry immediately during rotation; progressively refine it
  without blanking the globe. With future viewport-specific data, only reuse
  frames with known coverage or an explicit partial status. Keep the sphere,
  graticule and labels responsive while countries load.
- Compute LOD from absolute projection scale in CSS pixels (optionally DPR
  adjusted), using measured projected error and hysteresis; rotation may
  change coverage but should not force reload of an unchanged global LOD.
  Use D3 geoPath for horizon clipping and adaptive resampling.
- Keep the existing SVG labels and RBush behavior; city data is independent of
  country simplification. Use one shared projection setup for both layers;
  preserve zoom/drag semantics and visual-editor config, and clean up listeners
  correctly. Resize handling should preserve user zoom ratio and recenter.
- Add optional diagnostics: current/target level, vertices vs original, bytes
  received, cache hits, request latency, fallback, and an original/Quadstream
  comparison toggle. Keep controls unobtrusive and accessible.
- Provide a self-hostable build and a VizHub-compatible example once artifacts
  can be served from immutable URLs. Do not rely on an unpublished npm package
  or implicitly publish it. Use local builds until the license/release gate
  is met; demo network transport can depend on PR11 if needed.

## Tests and acceptance

- Deterministic fixtures: countries sharing opposite-directed arcs, islands and
  holes, dateline crossings, poles, near-antipodal arcs, complement/winding,
  hemisphere boundaries and narrow slivers. Exact full-detail reconstruction
  modulo permitted cyclic ring starts and documented seam normalization.
- Compare every LOD against independent spherical predicates: valid interiors,
  identical shared borders, no newly introduced crossings, preserved winding,
  explicit fallback. Validate across globe rotations and projection scales.
- Visibility oracle: exhaustive global D3 rendering compared with culled
  rendering across randomized rotations, zooms, poles and horizon crossings.
  No false-negative features or visible arcs.
- React/worker tests: cancelled or out-of-order frames, source config change,
  unmount, resize, level hysteresis, rotation within cached global LOD, no
  stale replacement, city label independence and visual editor updates.
- Playwright: drag-to-rotate, zoom, slow/offline/retry, original comparison,
  pixel regressions at fixed rotations/zoom and DPR, labels stay aligned,
  accessible controls. Add measured frame-time, initial/total bytes and
  projected angular/pixel error comparisons with original atlas; no
  unsupported performance claims.
- Acceptance: the existing globe remains visually and interactively equivalent
  at full detail, while low-detail geometry arrives progressively without
  seam cracks, complement fills, missing visible geometry or stale responses.

Split if needed into PR9b-1 spherical geometry/priority contract and tests,
PR9b-2 globe integration, and PR9b-3 spherical visibility/performance. Each PR
targets the default branch after dependencies merge; no stacked PRs.
