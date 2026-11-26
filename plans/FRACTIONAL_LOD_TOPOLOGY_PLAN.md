# Fractional LOD and Topology-Stable Globe Rendering

## Objectives

The globe should support genuinely fine-grained LOD changes instead of only
switching between integer BLG levels. The target behavior is:

- The LOD slider spans the available control width and supports tenth-level
  values.
- A fractional level produces a deterministic intermediate vertex set.
- Repeated renders, reloads, workers, and shared-arc consumers make the same
  selection.
- Auto detail produces fractional levels from projection scale.
- Vertex counts change monotonically as detail increases.
- Shared borders remain identical on both sides of every feature boundary.
- Spherical winding, complements, holes, minimum ring cardinality, and feature
  validity remain correct while zooming and changing LOD.
- Pending asynchronous requests never blank or replace a newer valid frame.
- Diagnostics and tests make invalid geometry and fallback behavior explicit.

## Current implementation

The globe UI now has a dedicated full-width LOD row. The slider uses a `0.1`
step, preserves the displayed fractional value, and sends fractional levels
through the worker and geometry query path. Auto LOD computes a continuous
scale-derived level, rounded to one decimal for the UI and request cache.

BLG nodes now carry a deterministic random value. Fractional selection is
interpolated monotonically: an integer level includes all vertices through
that level, while a value such as `5.5` includes all vertices through level 5
plus approximately half of level-6 vertices. Critical vertices are protected.
The selection uses global vertex IDs when constructing arc-tree random values,
so shared arcs make identical decisions.

The existing globe work also includes:

- Three-or-more-feature topology junction preservation.
- Spherical winding and complement preservation.
- Minimum-three-distinct-vertex ring reconstruction.
- Isolated malformed-source fallback groups.
- D3 compatibility diagnostics and stricter spherical-validator diagnostics.
- Degenerate atlas ring normalization.
- Zoom and asynchronous-frame regression coverage.

## Important design decisions

### Stable randomness

Random values must not come from `Math.random()` at runtime. They must be a
deterministic function of the global vertex identity, or be persisted in
serialized metadata. Global identity is required because a vertex can occur in
multiple arcs; per-arc or per-position randomness would produce mismatched
shared borders.

Critical topology vertices, arc endpoints, and spherical-preservation vertices
must bypass fractional thinning. Their protection cannot depend on the random
threshold.

### Fractional semantics

Use interpolation between adjacent integer levels rather than removing
vertices from the already-rendered integer level:

```text
LOD n.0: all vertices with priority <= n
LOD n.f: all vertices with priority <= n
        plus vertices with priority n + 1 whose random value >= 1 - f
LOD n+1: all vertices with priority <= n + 1
```

This keeps detail monotonic. Applying the threshold to level `n` itself would
make `n.9` less detailed than `n.0`, followed by a jump at `n+1.0`.

### Correctness before density

Independent random thinning is not sufficient to guarantee valid polygons.
The implementation must treat the random selection as a candidate and then
validate the reconstructed topology. If a candidate is invalid, the system
must deterministically promote the minimum necessary vertices or use a
documented conservative fallback. It must not silently publish malformed
geometry.

Shared arcs make promotion a global decision: promoting a vertex for one
feature must promote it on every feature that references the same arc.

## Known risks and unresolved questions

1. **Combined removals can fail where individual removals pass.** A spherical
   ring may remain valid when each vertex is removed separately but fail when a
   particular subset is removed together.
2. **Criticality may be insufficient by itself.** Small rings, holes, winding
   anchors, and vertices near spherical ambiguity boundaries may need stronger
   preservation rules.
3. **Promotion must preserve shared-border identity.** Per-feature repair is
   not safe unless it operates on shared vertex or arc IDs.
4. **Fallback semantics need to remain observable.** A repaired fractional
   result should report which vertices or groups were promoted, rather than
   appearing to be an unexplained full-detail result.
5. **Auto hysteresis must not suppress useful fractional motion.** Hysteresis
   should prevent request thrashing at integer boundaries while still allowing
   continuous changes within a stable band.
6. **Cache keys must distinguish fractional levels.** Integer-only caches would
   incorrectly reuse geometry for nearby slider values.
7. **Browser tests can be timing-sensitive.** Worker startup and concurrent
   demo servers can make initial-ready assertions flaky; the tests should
   wait on semantic frame state rather than fixed delays.

## Next implementation sequence

1. Add a global fractional-selection test matrix for planar and spherical
   datasets:
   - integer levels equal the existing selections;
   - fractional selections are deterministic;
   - selections are nested and vertex counts are monotonic;
   - shared-arc selections are byte-for-byte identical;
   - protected vertices are present at every fractional level.
2. Add a fractional real-atlas matrix at values around every integer boundary,
   checking D3 compatibility, strict spherical validity, ring cardinality,
   IDs, winding, holes, and vertex-count monotonicity.
3. Instrument fractional queries with selected global vertex IDs and identify
   the exact first invalid candidate for every failing level.
4. Implement shared topology repair:
   - start with the candidate fractional selection;
   - validate all affected features;
   - promote excluded vertices by deterministic priority;
   - revalidate until all affected features pass or the integer upper-level
     selection is reached;
   - apply promotions globally to shared arcs.
5. Preserve minimum ring cardinality and spherical critical vertices during
   repair, not only after reconstruction.
6. Add diagnostics for candidate count, promoted count, repaired groups, and
   unrepaired invalid groups.
7. Exercise manual slider sweeps and repeated zoom-in/zoom-out transitions in
   headed Chromium, capturing screenshots at every integer boundary and
   representative fractional values.
8. Update README and globe documentation with the final interpolation,
   deterministic randomness, repair, fallback, and diagnostic semantics.
9. Run the complete validation set:

   ```text
   npm run prettier
   npm run lint
   npm run typecheck
   npm test
   npx playwright test test/browser/globe.spec.mjs --project=chromium
   ```

## Completion criteria

The work is complete only when all of the following hold:

- Every supported fractional value produces deterministic output.
- Detail increases monotonically from slider minimum to maximum.
- No shared border differs across adjacent features.
- No D3-incompatible or strict-validator-invalid geometry is published for
  supported globe levels.
- No closed ring has fewer than three distinct vertices.
- Zoom transitions preserve the last valid frame while requests are pending.
- Manual and auto LOD both produce fractional values.
- Focused unit, atlas, and browser tests pass repeatedly, not only once.
- Documentation describes the actual algorithm and its conservative repair
  behavior.
