> Superseded by `TREE_NATIVE_ISLANDS.md`: the pixel-based island cull was removed.

# Hiding islands via quadtree depth ("disappear level")

## Spike results (50m, 1616 polygons, 96,819 vertices)

Run `node scripts/measure-islands.mjs 50m`. Level L is the auto LOD
(`L = 4 + log2(scale/120)`); a level-(L+4) cell is about 1 px wide at that scale.

| LOD | current px²<1  | all vertices in one level-(L+4) cell | angular extent < one cell | straddlers missed by cell test |
| --- | -------------- | ------------------------------------ | ------------------------- | ------------------------------ |
| 4   | 1250 / 15.6k v | 304 / 2.9k v                         | 999 / 10.7k v             | 695 (70%)                      |
| 5   | 1046 / 11.1k v | 81 / 0.7k v                          | 506 / 4.7k v              | 427                            |
| 6   | 600 / 5.3k v   | 14 / 0.1k v                          | 72 / 1.0k v               | 59                             |
| 7   | 103 / 0.9k v   | 5 / 39 v                             | 14 / 377 v                | 10                             |

Other findings:

- The current per-frame filter costs only 0.12-0.18 ms per call at 50m, so
  the check itself is not the bottleneck. Savings must come from not
  _producing_ hidden polygons.
- The engine still emits all 1616 polygons at every level: at LOD 4, 916 of
  them are rings with at most 3 vertices; at LOD 8 still 212. They are
  reconstructed, packed, transferred, clipped and drawn for nothing.
- Strict "all vertices in one node" misses about 70% of what it should hide,
  because tiny polygons often straddle a cell edge (and 41 polygons span cube
  faces, which can never share a node). A tiny island on the level-1 seam is
  never in one cell at any depth.
- A level-L cell is 8-15 px wide at LOD L, so the node test must use depth
  L+k (k = 4 gives about 1 px), not L.

## Proposal: per-polygon `disappearLevel`, computed once, filtered by LOD

1. **Measure extent without cell membership.** For each polygon's outer ring
   compute a bounding cap (unit-vector centroid and max angle), O(vertices)
   once at build time. This replaces the cell test, so straddlers and
   multi-face polygons are handled the same as everything else. It also drops
   the equirectangular approximation, the 30 degree and polar guards in
   `small.mjs`.
2. **Convert to a tree depth.** `disappearLevel = log2(2 / diameter) - k`,
   continuous, in the same units as the LOD. The polygon is visible when
   `level <= disappearLevel`. `k` encodes the pixel threshold (`minPx`): a
   cut of N px shifts the level by `log2(sqrt(N))`.
3. **Sort once.** In the engine, order polygons by `disappearLevel` descending
   and keep per-feature polygon lists in that order. A query at `level` takes
   a prefix and stops at the first polygon below `level` (binary search over
   the global order, early exit per feature). Hidden polygons skip
   `reconstructFeature`, packing, the worker transfer, clipping and drawing.
4. **Cache.** `disappearLevel` is stored beside the cell-level array in the
   engine (one `Float32Array` per polygon). No per-frame math remains besides
   the prefix cut.
5. **Keep the renderer check as the exact backstop.** With a manual level
   slider the LOD and zoom decouple. The engine culls conservatively
   (threshold halved), and `dropSmallPolygons` stays as the precise per-frame
   pass using the same cap diameter, so both agree.
6. **Stability.** The level is quantised to tenths and the rule is monotone,
   so a polygon appears once as you zoom in and never flickers. No hysteresis
   needed.

## Trade-offs

- Extent hides thin, long slivers less than area does. They are visible as
  strokes, so keeping them is arguably right. Mean area stays available if
  needed.
- Cap diameter over-estimates elongated polygons (conservative, keeps more).
- Cutoff is smooth (tenths of a level), not quantised to powers of two.

## Steps

1. Add `polygonCap` and `disappearLevel` to the engine build; unit-test
   against the current `polygonAreaSr` rule on 110m and 50m (hidden set
   should be a superset on tiny polygons, near-identical counts overall).
2. Add the sorted prefix query in `createGlobeGeometry.query` and skip hidden
   polygons in reconstruction; test seams, antimeridian, poles and the
   multi-face polygons.
3. Re-point `small.mjs` at the cap diameter, keep `?minpx`.
4. Re-run `scripts/bench-globe-node.mjs` and the browser profile; expect fewer
   vertices produced and lower query/clip time at 50m. Run the Chromium
   suite.

## Implementation status

Implemented in `examples/globe/small.mjs`, `lod.mjs`, `geometry.mjs`, `worker.mjs`,
`client.mjs` and `main.mjs`:

- `polygonDiameterRad` (bounding-cap diameter, cached per ring) replaces the
  equirectangular area estimate. The renderer backstop and the engine share
  it, so the two always agree.
- Direction correction: the tree depth shrinks as polygons vanish, but the LOD
  level grows with zoom, so the stored value is an **appear level**
  (`appearLevel(d, minPx) = 4 + log2(sqrt(minPx) / (120 d))`). A polygon is
  visible at levels at or above it. The engine does not store it; it keeps the
  per-polygon diameters and each feature's min/max, so a query compares
  `diameter * levelScale(level)` with `sqrt(minPx)`. Features whose smallest
  polygon passes are returned untouched without scanning.
- `engine.query(level, { minPx })` and `queryInterruptible` cull after
  reconstruction; cache keys include `minPx`; frames report `smallCulled`.
  Changing `#min-px` invalidates cached frames and re-queries.
- Not done: skipping reconstruction of hidden polygons. Engine validity checks
  and arc promotion are per feature (a hidden polygon can still force a shared
  arc to be promoted), so skipping it would change what neighbours see.
  Measured effect at 50m: query time is unchanged, but vertices produced and
  transferred drop 28% at LOD 4 (32,166 -> 23,022), 18% at LOD 5, 9% at LOD 6;
  clipping and drawing shrink with them.
- Manual LOD: the engine cull uses the level's nominal scale, so a low manual
  level hides more islands than the pixel rule alone; the renderer backstop
  still applies at the true scale.
