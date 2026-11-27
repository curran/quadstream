# Unsimplified geometry (Sudan at 110m)

## Symptom

At 110m and LOD 1.8 one country (Sudan) keeps its full source outline while
its neighbours are simplified. The status line reads
`2330 / 10583 vertices · source fallback/invalid coarse geometry`.
See `docs/images/unsimplified-before.png` and `unsimplified-after.png`.

## Reproduction

`node scripts/inspect-fallback.mjs 110m 1.8` lists features whose output equals
the source. Before the fix it reported `fallbackGroups: 1`, reason
`Degenerate or self-intersecting spherical ring`, and `UNSIMPLIFIED 14 Sudan 81`.
`node scripts/screenshot-globe.mjs out.png 110m 1.8` regenerates the screenshot.

## Root cause

Natural Earth's 110m Sudan ring is not simple. Projected to its gnomonic chart it
has two proper self-crossings on the South Sudan border, at edges 0/78 near
(24.2E, 8.7N) and 46/48 near (33.96E, 9.5N), each a tiny loop. This is
a source-data defect (the indexed and the reference O(n^2) validators agree), not a
regression. `createGlobeGeometry` builds every feature, falls back to per-feature
builds when the global build fails, and keeps any feature that still fails as raw
source geometry at every level. One bad sliver therefore disabled simplification
for the whole country.

## Fix

- `examples/globe/repair.mjs`: `repairRing` / `repairGeometry` find proper
  crossings in the ring's chart, cut at the intersection point and discard the
  loop with fewer vertices, repeating until the ring is simple (capped at 16
  passes and 5000 vertices). Unrepairable rings are left untouched.
- `examples/globe/geometry.mjs`: only features that fail the singleton build are
  repaired. The repaired copy (`work[i]`) is used for building, the full-detail
  d3 oracle and per-group compatibility checks. The original source is still what
  Original mode shows.
- Result: Sudan is simplified at every level (2330 -> 2272 vertices at LOD 1.8),
  full-detail area differs from the source by under 1e-5 sr.

## Tests

`test/globe-repair.test.mjs`: loop removal keeps the corners, valid rings are
returned untouched, `changed` is only reported when something was fixed, and
the 110m Sudan regression (no fallback, fewer vertices, area within 1e-5 sr).

## Remaining

- 50m still keeps Vatican (6 vertices) as source because its ring is a
  complement with holes ("Complement polygons with holes are unsupported"). The
  cost is negligible; fixing it needs a winding normalisation for enclaves.
- Cutting at a crossing changes Sudan's shared border vertices relative to South
  Sudan by a sub-pixel sliver. If gaps ever matter, apply the same cut to the
  neighbour.
