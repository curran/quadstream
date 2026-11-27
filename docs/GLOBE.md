# Quadstream globe demo

From a checkout with Node 26:

```sh
npm install
npm run build
npm run demo:globe
```

Open http://127.0.0.1:4173/ (redirects to the globe). The existing map demo
remains available with `npm run demo:map`. The shared local server exposes
only allowlisted assets. No VizHub account, external CDN requests, cable data,
city labels, or analytics are needed. Local file inputs stay in the browser.

## Reference and controls

Adapted from the MIT-licensed [Submarine cable globe](https://vizhub.com/viz/rPa9vFJ0kEvpjaJn-280C)
(`index.js`, `map.js`, README, and package.json inspected 2026-11-25).
Preserve pointer-driven rotation, scale-dependent sensitivity, wheel zoom,
0.6–8x relative zoom limits, fresh pinch baselines, pointer capture, and native
gesture suppression. The new controller has explicit lifecycle cleanup,
third-pointer pause/rebase, cancellation, zero-distance pinch handling, and
wheel/drag overlap handling. Two fingers zoom; one finger rotates. A two-finger
centroid translation does not rotate the globe, matching the source example.
Keyboard arrows rotate; plus/minus zoom. Resize retains relative zoom and
rotation. Canvas is device-pixel-ratio aware. Idle ocean glow is disabled
while interacting. The renderer intentionally omits the cable overlay.

The local pinned demo dependencies are D3 7.9.2, topojson-client 3.1.0, and
visionscarto-world-atlas 1.0.0 (Natural Earth-derived data) and us-atlas
3.0.1 (US Census cartographic boundaries). These assets are served from the
installed packages; 50m is the default and 110m is optional. The old
world-atlas 2.0.2 remains a regression fixture. Review dependency and dataset
licenses/provenance before distributing a public standalone bundle. The core
has no new runtime dependencies. The original-geometry mode uses the same
source as the Quadstream mode. Local GeoJSON must use D3 spherical winding;
TopoJSON must contain the named countries object.

## Regional boundary layers

Internal US state boundaries activate when a conservative regional cap
intersects the view cone and relative zoom reaches 3x (exit below 2.7x).
County boundaries within each state activate at 6x (exit below 5.4x); use
`?counties=0` to disable them. Configuration in `examples/globe/regional.mjs`
defines the source, object, geographic caps, zoom gates, LOD offset and style.
Caps include Alaska, Hawaii and territories; they can overselect near edges.
Thresholds are provisional, not measured screen-space error bounds.

Each layer lazily loads unprojected 10m TopoJSON and builds a spherical
Quadstream hierarchy from its internal shared-arc mesh in its own worker.
County lines exclude interstate arcs. Visionscarto remains the only source
of coastlines and international borders. D3 clips line overlays during drawing;
the polygon-only padded clipper is not used for lines. Cross-atlas junctions
may not align exactly. Original mode draws original meshes; source fallback
is reported when regional preprocessing or reconstruction fails. The worker
and last frame stay cached per layer; inactive layers do not start new queries.
Source changes and page teardown terminate workers. Custom files and test
fixtures never activate regional overlays.

## Geometry and limits

Render the original global geometry while preprocessing in a worker. The
spherical engine reuses shared topology and BLG, with D3 geoArea and sampled
geoContains comparisons as an independent reference. Exact consecutive
duplicate coordinates introduced by source quantization or seam aliases are
removed for the engine only. Original source geometry remains untouched.
If a global build fails, the demo attempts exact-coordinate-connected groups;
a rejected group remains entirely original, preserving shared vertices with
neighbors in that group. This is not independent per-country simplification.
Fractional LOD candidates are repaired by promoting shared arcs of invalid
features, as described below. The demo reports remaining invalid groups. No arbitrary
feature dropping or ring rewinding. Vertices shared by three or more shapes
remain critical topology junctions at every LOD.
Cross-feature intersection checking and differently digitized boundaries are
still limitations; D3 samples do not prove global spherical validity.

Rotation changes only the D3 projection. Geometry requests depend on zoom
or the manual LOD control, not rotation. Scale thresholds use absolute CSS
pixels and hysteresis; thresholds are provisional, not a measured pixel-error
guarantee. A bounded cache, latest-request suppression and worker replacement
on source changes keep stale geometry out of the view. Last valid global
geometry remains visible while a level is computed.

Diagnostics distinguish requested/rendered levels, vertex counts, source
fallback, D3-incompatible coarse groups, strict-validator warnings,
build/query latency, atlas payload bytes, and last draw duration. Draw-only FPS
is an estimate, not measured sustained animation FPS. The full atlas is
downloaded up front. No spherical binary artifacts or network partition
streaming are implemented here, and the engine query is never viewport-aware;
there is no claim of bandwidth savings. Render-time culling and clipping are
described below.
High-detail sources may be slow with quadratic reference validation.

## Tests

```sh
npm run check
npx playwright install --with-deps chromium webkit
npm run test:globe:browser
```

The Node suite exercises pointer state, resize, cancellation, timer overlap,
LOD and stale responses; spherical fixtures and a real local 110m atlas
exercise D3 winding, area, containment, projected clipping, shared boundaries,
full reconstruction, and meaningful reduction. Browser scenarios cover mouse,
wheel, keyboard, repeated pinch, drag-to-pinch-to-drag, third pointers,
cancellation, resizing, original-vs-full pixel comparison (fixture and 110m real
atlas at four orientations and two zoom levels), real-atlas loading,
and local-file recovery. Chromium has CDP touch injection in addition to
synthetic PointerEvents; WebKit exercises the pointer events. These are not
physical iOS/Android hardware tests. Globe browser CI uses Node 26. Before declaring
mobile parity, manually verify on iPhone Safari and Android Chrome, including
consecutive pinches, interruptions, orientation changes and rotation at zoom.

## View culling and clipping

The renderer never changes the Quadstream query. After a frame is received,
`clip.mjs` trims it to the visible cone per animation frame:

1. Features whose bounding cap misses the view cone are dropped.
2. Rings entirely inside the clip window keep their identity (no copy).
3. A ring crossing the window boundary keeps only its inside vertices plus the
   exact great-circle/boundary crossings. Each outside run collapses to a walk
   along the boundary in the winding direction that preserves the polygon
   interior (clockwise for exterior rings, counter-clockwise for the region a
   hole encloses). Each exit pairs with the first entry met along the
   boundary, so a ring dipping in and out splits into separate rings.
4. A ring with no crossing is classified by azimuth winding around the window
   centre: a covering exterior becomes the window circle, an exterior that does
   not cover the window drops the polygon, and a hole that contains the window
   drops the polygon.

The window is the view cone plus a margin and extra padding, and its result is
reused until the live cone leaves it, so dragging rarely re-clips. Crossings are
computed from a canonical edge orientation so neighbours share bit-identical
points. Views whose cone (plus margin) approaches a hemisphere fall back to
whole-feature culling. The minimap highlights the geometry actually drawn.
`?clip=0` restores whole-feature culling for A/B comparison; diagnostics report
vertices and rings drawn, clipped, wrapped and dropped.

Tests compare clipped geometry with the original via `d3.geoContains` on random
views of the 110m and 50m atlases (including poles, the antimeridian and holes)
and compare canvas pixels in Chromium and WebKit. The boundary walk is sampled
every 4 degrees, so shapes right at the window edge are approximate; the margin
keeps that edge outside the viewport.

## Performance notes

Measured on the 50m atlas (`scripts/bench-globe-node.mjs 50m 3`, Node):

| Stage                                               | Worker init | Cold query (median) |
| --------------------------------------------------- | ----------- | ------------------- |
| Original                                            | 26.1 s      | ~1.5-3.9 s          |
| Indexed (sweep-and-prune) planar validation         | 5.4 s       | 0.12-0.25 s         |
| Numeric spherical priority keys                     | 4.2 s       | 0.10-0.23 s         |
| Lazy reconstruction (no eager id lists or key sets) | 4.1 s       | 0.05-0.12 s         |

In a headed Chromium (`scripts/profile-globe-browser.mjs`), the 50m globe is
ready in about 7 s (the original did not finish within 590 s) and ten wheel
zooms plus pans keep a 16.7 ms median frame.

Clipping reuses caps computed once from the full-detail source, builds ring
vectors lazily for visible features only, and pairs exits to entries by sorted
azimuth (`pairPieces`, identical to the O(c^2) reference). Cold clip time at
50m dropped from 46-63 ms to 1-22 ms per view with identical output. Use
`?atlas=110m|50m|fixture` to pick the initial atlas.

## Fractional LOD and repair

The slider accepts tenth-level values and auto detail derives a continuous
level from projection scale. Level `n.f` keeps every vertex with priority
`<= n` plus the fraction `f` of priority `n + 1` vertices whose stable random
value (a hash of the global vertex ID, never `Math.random()`) is at least
`1 - f`. Selections are nested and deterministic, and shared arcs make
identical choices on both sides of a border. Critical vertices and arc
endpoints are never thinned.

Thinning is only a candidate. `SphericalQuadstreamDataset.query` validates each
feature and promotes every arc of an invalid feature to the next integer level
until it is valid. Arcs are shared, so neighbours stay identical.
`promotedArcs` reports how many arcs were promoted. Features that remain
invalid at full detail (malformed source) are isolated by the globe layer.
Small (<30 vertex) dips in vertex count can occur at a fractional level where
repair promotes arcs.

## Tiny polygons and repaired source rings

- **Tree-native islands** (`collapsedRingPolicy: "drop"`): a polygon is shown
  at level L only when its ring has at least 3 distinct vertices activated by
  the sparse quadtree (the third-smallest vertex activation level, cached per
  ring as `ringActivation`). There is no pixel threshold. Visibility is decided
  at the nominal level before validity repair and is frozen: arc promotion
  improves visible polygons but never resurrects hidden ones, and hidden
  polygons are never reconstructed, packed, transferred, clipped or drawn. A
  hole is hidden with its exterior, and a hole and the matching enclave share
  vertex ids, so they appear together. Features without a tree (source
  fallback) are not hidden. Frames report `hiddenPolygons` and `hiddenRings`
  (`data-hidden-polygons`). Original mode is unaffected. This is a
  representability rule, not a size rule: see `plans/TREE_NATIVE_ISLANDS.md`.
- **Self-crossing source rings** (e.g. 110m Sudan) used to force a full-detail
  source fallback. `examples/globe/repair.mjs` now cuts the loops so the feature
  simplifies normally. See `plans/UNSIMPLIFIED_GEOMETRY.md`.
