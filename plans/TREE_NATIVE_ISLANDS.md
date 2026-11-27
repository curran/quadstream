# Tree-native island hiding (smallest visible object = a collapsed ring)

## Why refine

Vertices are thinned by the sparse quadtree (one vertex per cell per level, cells
about 8-15 px wide at the matching LOD), but islands are hidden by a separate
pixel rule (`minPx`, about 1 px). The two scales disagree by roughly four
levels, so the map shows tiny islands drawn with full-resolution outlines next to
coarsely simplified coastlines. Worse, the engine itself keeps islands alive:
when a ring collapses below 3 distinct vertices, `reconstructFeature` restores
every original vertex ("Collapsed ring: restore every original vertex"). That is
why almost every polygon survives at every level.

## Idea (Li-Openshaw's smallest visible object, using the tree we already have)

Li-Openshaw says a feature smaller than the resolution cell should be removed,
and a cell's content collapsed to a representative. The sparse quadtree already
does the second half for vertices. The first half follows directly: **a polygon
is visible at level L exactly when its ring still has at least 3 distinct
selected vertices.** A ring that collapses to fewer is, by the tree's own
definition, smaller than the resolution at L and is hidden rather than restored.
No second threshold, no pixel parameter, no cap radius.

## Spike (`node scripts/measure-collapse-levels.mjs 50m`, 1488 polygons)

Polygons visible per LOD under the tree rule (third-smallest vertex level of the
ring <= L), against diameter thresholds at the level's nominal scale:

| LOD | tree rule | diameter >= 1 px | >= 3 px | >= 8 px |
| --- | --------- | ---------------- | ------- | ------- |
| 4   | 131       | 552              | 262     | 155     |
| 5   | 286       | 965              | 397     | 221     |
| 6   | 542       | 1391             | 705     | 337     |
| 7   | 894       | 1474             | 1166    | 552     |
| 8   | 1265      | 1485             | 1450    | 965     |

The tree rule tracks an 8 px cut, not the current 1 px one: the median polygon
enters the tree at about 9 px diameter. This confirms the observation that
islands currently survive far below the detail of the vertices. 110m behaves the
same (131 polygons at LOD 4 versus 272 at 1 px).

## Plan

1. **Engine: drop collapsed rings instead of restoring them.**
   - Add a `collapsed: "restore" | "drop"` option to `reconstructFeature`
     (default `restore`, so existing behavior and tests are unchanged). Drop
     returns an empty path when fewer than 3 distinct vertices are selected.
   - `SphericalQuadstreamDataset.query` / `queryInterruptible` take
     `dropCollapsed`. Validity `check` strips rings with fewer than 3 distinct
     vertices (outer ring collapsed means the whole polygon is skipped, a
     collapsed hole is skipped) before `validSphericalPolygon`, and still
     requires an unchanged polygon count. Hidden polygons therefore never force
     neighbour arcs to be promoted.
   - Neighbours and holes stay consistent because they share vertex ids, so an
     enclave and the matching hole collapse together.
2. **Precompute `collapseLevel` per polygon, once.** At construction, take the
   ring's distinct vertex ids and store the third-smallest `levelByVertexId`
   (one `Uint8Array`, O(V)). A query at level L can skip reconstructing any
   polygon with `collapseLevel > floor(L) + 1`: conservatively hidden, exact
   decisions still come from the selected vertex count at fractional levels.
   This gives the output-sensitive win the pixel cull could not: hidden polygons
   are never reconstructed, packed, transferred, clipped or drawn.
3. **Remove the pixel machinery.** Delete `minPx`, `?minpx`, `#min-px`,
   `small.mjs`, the renderer and minimap `dropSmallPolygons` passes, the worker
   and client `minPx` plumbing, `smallCulled/smallDropped` data attributes and
   their tests. Original mode is untouched because it never queries the tree.
4. **Fallback groups** (features the engine cannot build, e.g. 50m Vatican, 6
   vertices) have no tree: leave them as they are.
5. **Optional policy, off by default:** never hide a feature's last polygon, so
   Monaco-sized nations remain as one dot. Decide after seeing the result.
6. **Li-Openshaw follow-up (separate work):** the tree could also supply the
   collapsed representative (midpoint of cell entry and exit) instead of the
   selected original vertex, and a view-dependent traversal could stop at nodes
   projecting to about one pixel. Out of scope here; the island rule is the
   minimum step in that direction.

## Tests

- `reconstructFeature` with `collapsed: "drop"`: empty path for collapsed rings,
  default behavior unchanged, restore still exact.
- Dataset: hidden polygons do not cause arc promotion; polygon count and feature
  order preserved; level 19 identical to source; monotonic (a polygon visible at
  L stays visible at any higher level, including fractional steps).
- Property test on 110m and 50m: every output polygon has at least 3 distinct
  vertices; `collapseLevel` agrees with the selected vertex count at integer
  levels; the set of visible polygons grows with level.
- Enclaves/holes (Lesotho in South Africa): hole and island vanish together.
- Worker and browser: vertex counts at 50m drop by roughly the amounts measured
  here; pixel parity at full detail and the existing Chromium suite pass without
  `?minpx=0`.

## Risks

- Polygons appear at about 8-9 px, so they pop in larger than today; fractional
  levels and the BLG partial-level randomization smooth this to tenths of a
  level but not to zero.
- Countries made only of small islands (Maldives, Kiribati) vanish until zoomed
  in; item 5 mitigates.
- A ring with 3 nearly collinear vertices counts as visible. Acceptable: the
  tree has already merged cells, and slivers are cheap to draw.

## Metrics to report after implementing

Polygons and vertices per level at 50m, cold query time, packed bytes, browser
profile of a 10-step wheel zoom, and screenshots at LOD 4 and 6 before and after.

## Implementation status (done)

Delivered as one change: `collapsedRingPolicy: "drop"` on
`SphericalQuadstreamDataset.query` / `queryInterruptible` (default `"restore"`,
unchanged), used by the globe example. The pixel machinery (`minPx`, `?minpx`,
`#min-px`, `small.mjs`, renderer and minimap drops, worker and client
plumbing) is deleted; `plans/ISLAND_CULL_TREE.md` is superseded.

Corrections to the plan above, found while implementing:

- **Rings never collapse on their own.** Topology adds three critical anchors
  per closed ring and arcs end at critical vertices, so every ring always has
  at least 3 selected vertices and `distinctBelow3` almost never fires. The
  restore branch was not what kept islands alive. Visibility therefore uses the
  vertices' own tree priority, not the arc selection: `ringActivation[feature]
[path]` is the third-smallest vertex activation level, where a vertex with
  priority `l` and stable random `r` activates at `l - r` (critical vertices
  `r = 1`, i.e. `l - 1`). This is exact at fractional levels (verified against
  BLG selection), selections nest, so visibility is monotone in level.
- **Visibility is frozen before validity repair** (`visibility(level)`), from
  the nominal level. Promotion never resurrects a hidden polygon, hidden
  polygons are never reconstructed, a hole is hidden with its exterior, and the
  validity check compares against the visible polygons' signatures (identity,
  not just count; hidden holes drop their sign).
- **The last-polygon exception was not implemented** (restoring unrepresentable
  geometry would undo the point of the change). Microstates and tiny island
  nations disappear until zoomed in; a point layer is the right later fix.
- Deferred: bucketing polygons by activation (the query still scans O(P)
  numbers), Li-Openshaw representative vertices, view-dependent traversal.

Representability, not size: priorities are assigned in x order per cell, so a
tiny island's third vertex can activate early and a mid-size polygon late
(`node scripts/measure-collapse-levels.mjs 50m`: diameter at first appearance
p10 0.8 px, p50 4.7, p90 15.7, max 69.7; largest hidden at LOD 4 is a 20 degree
Myanmar mainland at 42 px, which appears at 4.1). Fractional LODs smooth this
but outliers exist.

Measured (`node scripts/measure-tree-islands.mjs 50m`, engine only, median of
5, restore -> drop):

| LOD | polygons     | vertices       | query ms       | promoted arcs |
| --- | ------------ | -------------- | -------------- | ------------- |
| 4   | 1488 -> 131  | 27155 -> 3522  | 60.6 -> 11.9   | 2271 -> 531   |
| 5   | 1488 -> 286  | 27235 -> 9318  | 55.7 -> 23.5   | 1993 -> 1677  |
| 6   | 1488 -> 542  | 30877 -> 22307 | 56.8 -> 44.4   | 1372 -> 1211  |
| 7   | 1488 -> 894  | 48809 -> 43454 | 102.3 -> 99.5  | 1724 -> 1687  |
| 8   | 1488 -> 1265 | 65593 -> 63971 | 127.6 -> 120.9 | 1985 -> 1985  |

Screenshots: `docs/images/tree-islands-lod{4,6}.png`.
