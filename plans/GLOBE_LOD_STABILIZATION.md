# Globe LOD Stabilization

## Current goals

- Render genuinely coarse globe geometry at low BLG levels without silently
  promoting requests to finer levels.
- Preserve topology junctions, shared borders, ring winding, and D3 spherical
  interiors at every requested level.
- Keep every reconstructed closed ring at least three distinct vertices.
- Keep invalid source features isolated instead of allowing one bad feature to
  force an entire connected atlas component to full detail.
- Make diagnostics distinguish source-data limitations from invalid generated
  coarse geometry.
- Validate the behavior with focused unit tests, real-atlas regression tests,
  Chromium interaction tests, and screenshots at boundary levels.

## Where we stand

- LOD 0 of the 110m atlas renders about 2,037 of 10,587 vertices, an 80.8%
  reduction.
- LOD 7 renders about 9,517 vertices; LOD 8 renders about 10,516 vertices.
- Playwright screenshots showed LOD 8 was correct while LOD 7 rendered the
  Bahamas incorrectly.
- The defect was isolated to Bahamas (feature `044`): one omitted vertex made
  a small island ring switch to the nearly-full-sphere D3 complement.
- LOD 7 now retains that vertex and passes the D3 compatibility oracle.
- Two malformed source features remain isolated as source fallbacks. Their
  errors are reported as `Degenerate or self-intersecting spherical ring` and
  `Ambiguous spherical direction`.
- The current diagnostics can still report one invalid group at LOD 7 even
  when the D3 oracle accepts every rendered feature. This likely reflects the
  stricter internal spherical validator rather than a visible globe defect.

## What we tried

1. Removed spherical full-detail fallback and finer-level promotion so queries
   render the requested BLG level directly and expose `valid: false`.
2. Preserved vertices incident to three or more feature IDs, in addition to
   structural anchors and graph junctions.
3. Isolated individually invalid atlas features instead of falling back an
   entire connected component.
4. Added D3 compatibility checks and tested LOD 7/8 screenshots.
5. Added spherical critical-vertex preservation:
   - fast projected-area checks detect winding changes;
   - small rings use the full spherical validity predicate to catch
     self-intersection and complement changes.
6. Added a reconstruction guard that restores source ring vertices if a closed
   ring would otherwise contain fewer than three distinct vertices.

## Next experiments

1. Expand the real-atlas regression test across every requested LOD, checking:
   - feature count and IDs;
   - D3 ring orientation/interior compatibility;
   - minimum ring cardinality;
   - shared-border identity where source topology provides shared arcs;
   - monotonic vertex selection across levels.
2. Separate “D3-compatible” from “strict spherical-validator-invalid” in globe
   diagnostics, so source fallback and genuine rendered defects are not
   conflated.
3. Measure whether spherical critical preservation over-retains vertices,
   especially at LOD 7/8, and keep the preservation rule limited to rings
   whose omission demonstrably changes validity or winding.
4. Add targeted synthetic cases for:
   - winding/complement inversion after one vertex is removed;
   - a ring collapsing below three vertices;
   - a hole whose shell/hole relationship changes after simplification;
   - shared three-feature junctions at coarse levels.
5. Re-run screenshots at LOD 0, 7, 8, and full detail after each change.

## Completion criteria

- All focused and full tests pass.
- Every real-atlas LOD passes the D3 compatibility matrix.
- No generated polygon ring has fewer than three distinct vertices.
- LOD 7 and LOD 8 screenshots show the expected geographic silhouettes.
- Low LOD remains materially coarser than full detail.
- Diagnostics identify source fallback features separately from generated
  invalid geometry.
