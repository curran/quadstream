# International administrative boundaries

The globe can load a local, versioned geoBoundaries gbOpen catalog in addition
to the existing US Census atlas. No external browser requests are necessary.
The empty checked-in catalog keeps ordinary installs and CI independent of
network downloads.

## Generate and try

```sh
npm ci
node scripts/download-regional-atlas.mjs CAN BRA IND DEU FRA
npm run demo:globe
```

Run the downloader without country arguments to request all available ADM1 and
ADM2 layers other than USA. Each successful invocation replaces the catalog
with the selected set. Assets are content-hashed and ignored by Git; do not
commit the generated catalog or data. Restore the empty catalog with
`git restore examples/globe/regional-data/catalog.json` if necessary.
The script records source, version, boundary ID, SHA-256, byte size, license
and attribution metadata. Failed downloads leave the old catalog intact.
The pinned gb80 API endpoint and data format need a live smoke test; do not
silently switch to a moving current release if the endpoint is unavailable.

ADM1 enters at 3x and ADM2 at 6x (exit 2.7x/5.4x). The catalog bounds each
layer conservatively, and only the six nearest eligible international layers
are admitted at once. Offscreen or unadmitted workers and their cached frames
are discarded. This caps worker count, not bytes; broad caps can cause
unneeded loads or omit visible neighbors under the admission limit.
US workers and geometry remain independent. Use `?international=0` to disable
the extension, or `?counties=0` to disable both US counties and ADM2.

International meshes draw internal shared arcs only. Separately sourced ADM1
and ADM2 layers may have duplicate or mismatched parent borders; the existing
US FIPS-based filtering does not apply. Cross-source snapping and general
parent reconciliation are deferred. GeoBoundaries gbOpen data requires
attribution; inspect the catalog license and source fields before distribution.

## Merge gates

- Run the sample downloader, confirm it resolves the pinned release and that
  data is valid TopoJSON, and inspect catalog coverage, file sizes and license fields.
- Run npm run check, npm run lint and npm run test:globe:browser.
- Visually inspect Canada, Brazil, India and Europe at both thresholds,
  including reverse zoom, panning across countries and original mode.
- Measure cold download, worker build, query and peak memory on mobile; verify
  no unexpected boundary fallback, missing visible layers, or distracting overlap.
- Confirm existing US rendering is unchanged.

Global data generation, distribution via npm/CDN, per-country attribution
display, memory-byte budgets and validated global coverage remain follow-ups.
