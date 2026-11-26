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

The local pinned demo dependencies are D3 7.8.2, topojson-client 3.1.0, and
world-atlas 2.0.2 (Natural Earth country data). Unlike the reference's
visionscarto-world-atlas 110m URL, these assets are served from the installed
package; 110m is the default and 50m is optional. Review dependency and dataset
licenses/provenance before distributing a public standalone bundle. The core
has no new runtime dependencies. The original-geometry mode uses the same
source as the Quadstream mode. Local GeoJSON must use D3 spherical winding;
TopoJSON must contain the named countries object.

## Geometry and limits

Render the original global geometry while preprocessing in a worker. The
spherical engine reuses shared topology and BLG, with D3 geoArea and sampled
geoContains comparisons as an independent reference. Exact consecutive
duplicate coordinates introduced by source quantization or seam aliases are
removed for the engine only. Original source geometry remains untouched.
If a global build fails, the demo attempts exact-coordinate-connected groups;
a rejected group remains entirely original, preserving shared vertices with
neighbors in that group. This is not independent per-country simplification.
The requested LOD is rendered directly, even when the spherical validity
diagnostic rejects a coarse reconstruction; the demo reports invalid coarse
groups instead of silently promoting them to finer levels. No arbitrary
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
downloaded up front. No spherical binary artifacts, network partition streaming,
or hemisphere culling are implemented here; no claim of bandwidth savings.
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
cancellation, resizing, original-vs-full pixel comparison, real-atlas loading,
and local-file recovery. Chromium has CDP touch injection in addition to
synthetic PointerEvents; WebKit exercises the pointer events. These are not
physical iOS/Android hardware tests. CI uses Node 26 only. Before declaring
mobile parity, manually verify on iPhone Safari and Android Chrome, including
consecutive pinches, interruptions, orientation changes and rotation at zoom.
