# PR9: progressive map demo

Run from a checkout with Node 20+:

```sh
npm install
npm run build
npm run demo:map
```

Open http://127.0.0.1:4173/ . Choose Canvas or MapLibre, change detail level,
pan, zoom, inspect shared segments (Canvas), and enable simulated slow partitions.
The default fixture is original schematic land, not authoritative world geometry.
Local GeoJSON/TopoJSON files can replace it for experimentation if compatible
with the current planar geometry contract. Files stay in the browser. No VizHub
services, third-party tile servers, cookies, telemetry or network fetch of user data.

The worker preprocesses input, constructs a bundle, and reconstructs query
results. The renderer receives structured-cloned frames and renders on the main
thread (Canvas or MapLibre GeoJSON source). Intermediate frames show valid
individual features only and explicitly report omissions, level, partition
counts and fallback; final frames require complete reconstruction globally.
The current global fallback can require all partitions. This is not a proof of
spherical topology or validity of arbitrary input. New views cancel old work,
and generation checks at both worker and renderer boundaries reject stale
results even if a fetcher ignores cancellation. Worker initialization itself
is synchronous; the UI replaces the worker when switching datasets.

The demo uses simulated in-memory partition delivery with bounded retry/backoff
and the core raw-byte LRU. It does not evict parsed session vertices or implement
real network transport; those are PR11 concerns. Viewport selection is the
existing conservative feature-bounds filter, not clipping. MapLibre wrapped or
dateline viewports use a global query; source geometries must still satisfy the
planar constraints. MapLibre uses a local empty style with no external basemap.
The Canvas renderer's shared-segment overlay is diagnostic, not an additional
topology validator.

For self-hosting, serve the demo, dist, and MapLibre distribution assets at the
same relative paths as the local server (or rewrite the URLs). Serve modules
with JavaScript MIME types and use same-origin assets; cross-origin modules
need appropriate CORS headers. Local development disables caching. Version
static assets together and avoid caching mutable HTML indefinitely. Production
HTTP partition fetching, ETags, offline caching and deployment are deferred.

CI runs Node.js validation and Chromium/WebKit globe browser tests. The separate progressive map browser suite can be run locally:

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Browser tests exercise keyboard controls, deterministic Canvas pixel
round-trips, simulated latency, stale requests and MapLibre source updates.
The browser test is not a cross-platform golden-image suite; establish reviewed
goldens in a pinned local environment. Accessibility checks cover
labels, keyboard controls and live status, not a comprehensive audit.

See [the implemented D3 orthographic globe](GLOBE.md).
