# Quadstream architecture (development v0)

## Data flow

```text
GeoJSON FeatureCollection
      |
      v
Exact-coordinate topology normalization
  - stable IDs for this input order
  - shared undirected edges and adjacency signatures
  - critical junction and ring anchor preservation
      |
      +----------------------------+
      |                            |
      v                            v
Sparse quadtree                 Shared arcs
  - occupied cell map             - canonical orientation
  - progressive priorities        - ring/line references
      |                            |
      +-----------> BLG <----------+
                     |
              ordered min-priority
              Cartesian hierarchy
                     |
              spatial index query
                     |
              valid geometry?
              /             \
             yes             no
              |              |
          simplified     full-data fallback
              \             /
                FeatureCollection
                     |
              partition exporter
              -> manifest + binary vertex partitions
              -> validated progressive session
```

## Coordinate and topology contract

Supported inputs are finite, planar, two-dimensional GeoJSON polygon and line geometries. `feature.id ?? inputIndex` is the stable feature identity; duplicates are rejected. Coordinates are hashed using exact normalized numeric pairs. Values that differ by a small rounding error are **not** assumed identical. Shared endpoints are interned by coordinate and arcs are interned by forward/reverse sequences. Ring starting points may rotate; direction and coordinate order are otherwise retained.

For each source path, incident edges are tracked by path ownership. Vertices are marked critical when incident edge ownership changes, when their graph degree differs from two, or when they are open-line endpoints or mandatory ring anchors. Splitting paths at those vertices yields arc fragments. Each unique arc is stored once, with signed 1-based orientation references for its uses.

This is a constrained topology normalization algorithm, **not** full map topology construction from independently digitized borders. It does not snap or reconcile mismatched edges, split at arbitrary geometric crossings, or wrap the antimeridian. Its ring-validator/reference geometry predicates are quadratic; follow-on work must replace them for large datasets while retaining a slow reference oracle for tests.

## Sparse quadtree

For each distinct vertex, compute a normalized cell `(level, i, j)` at successively finer levels. The first unoccupied cell is claimed and determines its priority. All critical vertices are visited before other vertices. Within each priority group vertices are sorted by x, then y, then ID. Cell addresses are strings `level_i_j`; they are **not** materialized as four-pointer nodes. Boundaries are inclusive and clamped so a maximum-coordinate point remains in the final cell.

Memory and build time are O(V * L) in the worst case for V unique vertices and L configured levels. If no cell is available before `maxLevel`, construction fails explicitly; no points are silently dropped. `maxLevel` is bounded to 26 (levels 0..25) to avoid unsafe indexing. Priorities are stable for identical input. Reordered inputs are not currently guaranteed to yield byte-identical manifests because source-order IDs are retained.

## BLG reconstruction

For each arc, the endpoints have effective priority zero. Other nodes inherit their quadtree priority. A monotone stack constructs an ordered min-Cartesian tree in O(n) time. The inorder sequence is the arc's exact original coordinate sequence. The parent priority never exceeds a child's priority. Query traversal emits positions with `priority <= requestedLevel`; output is a nested set as the threshold increases. Construction and traversal avoid recursive calls and handle deeply skewed trees.

Multiple features sharing an arc reference the same BLG tree; an opposite orientation simply reverses the emitted sequence. Ring reconstruction merges arc endpoints and closes the ring. Resulting polygons are validated. If **any source feature** is invalid at a requested coarse level, **all selected features in any viewport** use full source vertices so one side of a shared boundary is not simplified differently. This is a conservative safety policy and may increase payload dramatically. Because an invalid coarse level can fall back to full detail while a finer one does not, the final rendered feature sets are not necessarily monotonic even though raw BLG selections are.

## Spatial index

A deterministic static packed bounding-volume hierarchy provides R-tree-like pruning over feature bounds. It is not a dynamic R-tree and it is not an index of individual line segments. Bounding-box intersection is inclusive, and returned feature order follows input order. A viewport query filters features that intersect the view but does not clip geometry to the view. A cached dataset-wide validity decision is applied per level, independent of which features a viewport selects, to prevent cross-viewport shared-border discrepancies. It is a correctness-first baseline; bulk-load performance and large-data alternatives belong in later benchmarking.

## Binary partition format v1

- Header: 4 ASCII bytes `QSTR`, little-endian uint16 version `1`, little-endian uint32 record count.
- Record (22 bytes): little-endian uint32 vertex ID, float64 x, float64 y, uint16 assigned level.
- Manifest (JSON): format and version, tree depth, fileDepth, bounds, feature and shared-arc references, per-vertex level/critical flag, and partition metadata.
- Partition metadata: key, byte length, FNV-1a 32-bit hexadecimal checksum, vertex IDs, minimum level, record bounds.

A mandatory `base` partition contains all critical vertices plus low-depth levels. Remaining vertices are grouped under coarser ancestor cells at `fileDepth` intervals. Partition creation sorts record IDs and keys, resulting in deterministic bytes for identical input.

`QuadstreamSession.load(key, bytes)` first verifies length, checksum, encoding, IDs, uniqueness and levels, *then* commits records atomically to in-memory state. Repeated identical loads are idempotent. Checksum is an **accidental corruption detector, not an authentication or integrity signature against an adversary**. Manifests must arrive from a trusted, authorized transport; production deployment needs cryptographic signatures/hashes, explicit content-length limits, and standard access controls.

`requiredPartitionKeys(manifest, level)` is a conservative global priority-based planner. The partition-bounds inspection helper is diagnostic only: vertices outside the view may describe a line crossing it. The session can answer partial queries but omits invalid or incomplete features and reports `complete`, `missingKeys`, and `omittedFeatures`. After all partitions load it uses the same geometry-validation fallback as the synchronous engine. There is no network-fetch queue, cancellation, eviction, CDNs, or MapLibre adapter in this PR.

## Correctness expectations and limitations

Hard invariants covered by tests: unique occupancy, full source vertex accounting, deterministic assignments, correct BLG inorder traversal, heap priority invariants, nested BLG vertex selection, exact-coordinate shared-arc reuse, full-detail reconstruction, viewport scan equivalence, binary round-trip, partition idempotence, and full-session convergence.

Known limitations: projected/planar input only; no automatic anti-meridian splitting; no mismatched border reconciliation; polygon validity checks are O(n²); simplified geometry can globally fall back; no hole-aware point-in-polygon spatial indexing; no production data-size limits on overall feature collection; no cryptographic partition integrity; no network streaming; no guarantee of cartographic quality or maximum simplification rate. See the roadmap for hardening gates and benchmark plans.
