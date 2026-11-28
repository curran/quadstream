# React and Vite globe demo migration

## Goal and constraints

Create a React + TypeScript + Vite version of the existing Quadstream globe demo, then add the city-label overlay from the VizHub reference. Preserve the existing demo's behavior and performance; the city labels are the intentional new feature. This is a plan, not authorization to replace the working demo.

Begin in `quadstream-globe/` with a self-contained package, lockfile, Vite configuration, HTML entry point, source, tests, and build output. Keep the existing root npm package, its exports, TypeScript build, CLI, development server, progressive map demo, globe demo, and existing CI workflows intact during parallel development. The React app may consume the local Quadstream package through an explicit development alias or a local package dependency with a documented build prerequisite; verify that its worker bundle resolves the same library code and that production bundles have no dev-server assumptions. Do not add React, D3, Vite, or RBush to the core library's runtime dependencies.

All implementation PRs target main independently, are small enough to review, and contain tests for their own behavior. The five core extraction PRs (#31–#35) have merged and are foundations for subsequent implementation. Reconcile the actual public APIs before implementation.

## Reference visualization and coding style

[Zoomable Globe with Cities Template](https://vizhub.com/viz/b1836e28c5be4ee897f32eedf6c5ec88) is the explicit reference. Inspect and pin its source revision before porting; confirm the applicable code and dataset licenses and attribution requirements.

The inspected reference has React 19 application state and lifecycle in App.jsx, a main D3 rendering function in index.js, separate map.js, labels.js, projection.js, interaction.js, dataLoader.js, constants.js and JSON configuration. It uses a high-DPI Canvas for geography and an absolutely positioned, pointer-transparent SVG for labels. Favor this modular, function-oriented style, explicit state/configuration inputs, named exports, focused modules, and straightforward React composition. Avoid unnecessary abstractions or a UI framework beyond React.

Do not copy the reference's per-state-update imperative rendering loop or its camera interaction behavior. Quadstream's existing frame scheduler and camera physics are authoritative. React owns lifecycle, controls, accessible markup, configuration, and coarse application state. Mutable camera state, projection, frame scheduling, and geometry caches remain outside React reconciliation; expose only appropriate snapshots to React. Use one imperative owner for each Canvas or SVG subtree, with stable refs and symmetric effect cleanup. Account for StrictMode mount/unmount/remount.

## Proposed application layout

- `quadstream-globe/package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- `src/main.tsx`, `App.tsx`, `components/Globe.tsx`, `Minimap.tsx`, `Controls.tsx`, `Diagnostics.tsx`, `CityLabels.tsx`
- `src/hooks/`: explicit lifecycle adapters for camera, worker, frame scheduling, resizing and interaction
- `src/globe/`: rendering and orchestration adapters; prefer existing tested library/demo modules over divergent copies
- `src/labels/`: data loading, configuration, layout and SVG rendering, following the reference's module boundaries
- `test/`: unit, integration, browser and benchmark fixtures

These filenames are proposed, not a mandatory abstraction hierarchy. Use ESM imports for D3 and TopoJSON rather than global UMD scripts. Vite module workers should use statically analyzable new Worker(new URL(..., import.meta.url), { type: "module" }) entry points. Retain transfer lists and stale-result handling. Manage geographic assets via explicit local URLs/manifest imports, preserving lazy loading and avoiding unbounded eager JSON bundles. Test deployment under a non-root base path. Keep the app's Vite dist separate from the root library dist.

## Existing globe behavior: mandatory parity

Baseline against the current legacy demo, capturing fixtures, interactions, screenshots and performance before implementing. Preserve its visual style, controls, default options, status/diagnostics, file upload, fixture and geographic data selection, responsive sizing and device-pixel-ratio handling, keyboard flight, pointer dragging, touch/pinch and wheel, spring/inertial camera behavior, settling and bounds, progressive fractional LOD and country retention rules, worker cancellation/disposal and transfer protocol, minimap/viewport footprint, clipping and culling (including clipping-disabled mode), regional administrative and county layers, URL parameters, idle scheduling, moving frame-budget logic and settled-frame rendering. Do not trade existing behavior for the reference's simpler interaction code.

Reuse stable public core APIs after the extraction work merges. If sharing a legacy adapter requires touching legacy files, defer that extraction to a separately reviewed PR with parity tests; do not replace or silently alter legacy functionality. No algorithmic changes to core are required for this migration.

## City-label overlay: faithful port

Port the actual reference algorithms, data normalization, settings and appearance, not merely a similar-looking layer. Use the same configured city dataset and population semantics after license verification; preserve the original stable IDs and coordinate fields. Preserve the reference defaults as defined in its config.json, including its styling and maximum label count, and its fallback values (500,000 population, 30 px maximum base font, 0.2 outline ratio, 2 px base padding, 50 maximum candidates).

At each rendered camera snapshot:

1. Use exactly the geography's orthographic rotation, scale and translation, in CSS pixels. Compute zoom factor from scale / initialScale.
2. Population threshold = basePopulationThreshold / zoomFactor^1.5. Apply the strict greater-than comparison. Filter to the visible hemisphere using D3 geoPath point visibility, then to the inclusive viewport bounds.
3. Sort visible cities by descending population, maintaining source order on ties, and take the configured maximum candidate count *before* collision rejection.
4. Use D3 scaleSqrt with domain zero to the maximum population of the full dataset, range zero to maxFontSize * sqrt(zoomFactor). Padding = baseLabelPadding / sqrt(zoomFactor).
5. Measure each candidate's text with the reference sans-serif font metrics. Build centered padded screen-space bounding boxes. Greedily accept in population order when RBush reports no overlap; insert accepted boxes only. Preserve reference edge-touch semantics. Do not refill the candidate cap after rejection.
6. Render keyed SVG text by stable ID with centered anchor/baseline, font size, configured fill and outline colors, round stroke join, paint-order stroke, and outline width = fontSize * strokeWidthScalingFactor. Overlay is pointer-transparent and follows the same viewport as the Canvas.

Keep the map geometry independent of labels. Do not add city labeling to the core geometry library. Preserve output parity even if text measurement is later cached or optimized; any optimization must pass oracle tests before adoption. Handle empty/loading/failed city data without blocking the map. Test label toggling if a control is added; the new layer must not change navigation behavior. Do not add a separate animation loop for labels.

## Test strategy and promotion gates

Extensive automated coverage is a deliverable of every phase, not a final cleanup task. Keep current root test/check/package/browser commands green. Establish app-specific scripts for type checking, linting, unit and integration tests, browser tests, coverage and Vite production build/preview. Initial app validation can run separately without changing legacy CI; add a dedicated app CI job/workflow before promotion. Use deterministic inputs, fixed viewport/DPR/font/clock where appropriate, checked-in small fixtures, and no network dependency in CI. Pin dependencies and ensure lockfile-based installs.

### Unit and algorithm tests

- Test app adapters and state transitions, camera/scheduler integration, configuration, resize/DPR and projection consistency, input validation and data loading failure/retry/abort.
- City layout: exact threshold equality, zoom exponents, full-dataset maximum, population order and ties, top-N before collision rejection, padding, font and outline scaling, center coordinates, hemisphere horizon and back side, viewport edges, overlapping and touching boxes, stable IDs, duplicates, empty inputs and invalid rows. Test RBush outcomes against a simple bounding-box oracle.
- Build golden outputs from the pinned VizHub reference for fixed city fixtures, text metrics and camera snapshots spanning zoom, rotation, horizon, crowded and sparse views. Compare selected IDs, ordering, positions, font sizes and styles with explicit numeric tolerances. Add browser-level parity using actual font metrics; do not substitute mock text dimensions for the entire suite.
- Preserve and run the existing core test suite, including spherical repair/recovery, clipping, LOD scheduling, geometry wire format and package compatibility; add integration tests for the actual consumed APIs rather than duplicating their core tests.

### Lifecycle and integration tests

- Mount/unmount/remount including React StrictMode, repeated resize, pointer/listener cleanup, animation cancellation, worker termination, pending request rejection, transferred buffer decoding and stale-generation response rejection.
- Rapid LOD changes, cancellation and latest-target coalescing, worker errors and recovery, data source changes and regional load races. Verify no stale layers, duplicate requests or duplicate animation loops.
- Verify map and SVG projection alignment during movement, zoom, resize and DPR changes, pointer transparency, city load failure isolation and absence of React commits per camera frame. Confirm idle stops drawing and a settled frame is rendered.

### End-to-end browser parity

Use Playwright with Chromium and WebKit (including touch/mobile viewports); add Firefox where supported and document any platform limitation. Run equivalent scripted scenarios against the legacy and React demos: initial defaults, drag/pinch/wheel, keyboard motion, settling, rapid zoom/LOD changes, uploaded data, source switches, clipping on/off, minimap, regional overlays, diagnostics, resize, URL parameters, and error states. Add screenshot baselines for representative camera states, compare observable state and geometry counts, and use tolerances for antialiasing/platform differences rather than masking meaningful changes. For pure migration comparison disable labels; test the enabled overlay separately against the pinned reference. Exercise the built Vite app served from its real output with no dev server, including worker loading and asset URLs under a subpath. Retain existing browser coverage unchanged until deliberate cutover.

### Performance and reliability

Record reproducible legacy baselines and React results on the same browser, hardware, dataset and camera trace. Measure cold startup, worker build/query time, input-to-frame latency, median and p95 draw/frame time, dropped frames, idle draw count, LOD convergence, memory/worker count over repeated loads, React commits, and bundle size. Benchmark labels off (migration parity) and on (explicit feature cost) separately. Record sample sizes, variance and test conditions. Propose an initial labels-off p95 frame-time/latency tolerance of 10% relative to baseline; ratify thresholds after measuring noise rather than claiming a performance guarantee now. Require no idle redraw loop, no leaked workers/listeners and no persistent geometry backlog. Treat flaky or noisy hardware timing as a documented benchmark gate, not a falsely deterministic unit assertion. Keep benchmark results and known exceptions reviewable.

### Coverage policy

Track statement, line, function and branch coverage for app-owned logic; proposed initial gates are 90% lines/statements/functions and 85% branches for application logic, with at least 95% branch coverage for deterministic label layout and state/worker orchestration where feasible. Exclude only generated files and explicit thin platform adapters with documented browser coverage. Ratify exact thresholds when scaffolding coverage; never lower a gate to hide untested regressions. Critical error, race and cleanup paths must be exercised regardless of aggregate percentage. Review coverage diffs in every implementation PR and report browser and performance coverage separately. No claim of coverage until actual reports exist.

## Phased implementation PR roadmap

1. **Isolated scaffold and baseline harness:** subdirectory package, React/Vite/TypeScript setup, lockfile, minimal entry point, app-specific test/coverage scripts, legacy fixtures and parity benchmark methodology. No change to root demo behavior.
2. **Parallel globe parity:** React UI and lifecycle adapters around existing engine, Canvas, workers, minimap, regional layers and camera. Split into independently mergeable slices targeting main as needed, with working intermediate states and tests. Verify all legacy scenarios with labels absent.
3. **City overlay:** faithful reference layout and SVG layer, pinned data/config/reference revision, golden/oracle and end-to-end tests, performance measurement. Default visibility/style decisions follow the reference unless explicitly approved otherwise.
4. **Validation and hardening:** complete parity matrix, coverage gates, dedicated app CI, production-build deployment smoke tests, performance report and documented known exceptions. Resolve regressions before considering replacement.
5. **Explicit promotion PR, only after approval:** move the proven React/Vite app to the repository root and replace the legacy globe entry point. Preserve independent root library build/publish/CLI and progressive map demo, using separate scripts and outputs. Plan redirects/entry point compatibility, test migration and rollback to the previous working demo. Do not remove the old implementation until cutover acceptance and rollback are verified. No automatic promotion.

## Definition of done

Parallel demo builds and runs independently; legacy behavior, tests and package remain intact; city label output matches the VizHub reference; all coverage and browser gates pass; performance parity is demonstrated with measured data; production assets and workers function; lifecycle cleanup is verified; and the user explicitly approves the separate root-level promotion. Until then the working legacy demo remains authoritative.

## Open decisions

Pin the reference revision and dataset licenses, choose compatible pinned React/Vite/RBush versions that respect the repository's Node support, confirm asset packaging, ratify coverage/performance gates after baseline collection, and obtain explicit approval for promotion. The original planning PR changed no executable code, configuration, dependencies or CI.
