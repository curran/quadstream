# Spherical geometry development preview (PR9b-1)

Use `buildSphericalQuadstream(collection, {maxLevel: 20})` for explicit
longitude/latitude in degrees, using D3's clockwise-small-interior winding
convention. This is a separate in-memory API: existing `buildQuadstream`,
planar adapters, and v1 binary partitions retain their original semantics.

```js
import { buildSphericalQuadstream, importSphericalTopoJSON } from '@quadstream/core';
const countries = importSphericalTopoJSON(atlas, 'countries');
const globe = buildSphericalQuadstream(countries);
const {geojson, usedFallback} = globe.query({level: 4});
```

The named TopoJSON decoder supports signed arcs, quantized transforms, feature
IDs and properties. Only the selected object is decoded into features; the
shared arc table is validated. Longitude +180 aliases -180; at exact poles all
longitudes alias zero. No near-coordinate snapping or mismatched edge
reconciliation is performed. Edges are interpreted as minor great-circle arcs.
Coincident and near-antipodal endpoints are rejected; no implicit resampling.

Six cube faces have independently sparse hierarchical occupancy. Dominant
Cartesian axis chooses the face with fixed X/Y/Z tie precedence. Vertex ordering
is critical-first, then canonical longitude/latitude and ID. Occupancy is
deterministic for fixed input and IDs, and overflow is explicit. Cube faces are
not equal-area; this is a reference priority metric, not a claim of optimal
cartographic or projected error. Shared arcs reuse the existing BLG trees.

Polygon validation projects into an explicit open-hemisphere gnomonic chart.
Minor great-circle segments become straight lines there, so the reference
planar predicates can check intersections and holes without treating longitude
and latitude as Cartesian. The chart center is the normalized shell vertex
sum; a valid geographic polygon can be rejected when this particular chart
does not contain the boundary. The source chart is reused at every LOD to
compare winding and reject spherical complement changes. A small clockwise
shell may contain counterclockwise holes; a counterclockwise shell denotes
its large complement, currently supported only without holes. Rings must be
closed. The validator is floating-point and quadratic, not a robust arbitrary
spherical arrangement solver; near-degenerate geometry is not a production
correctness claim. Cross-feature intersections between unrelated arcs and
multipolygon component overlaps are not yet checked globally.

All features are reconstructed globally. If any simplified path fails the
spherical reference checks, every feature uses its original full-detail
coordinates (modulo cyclic ring starts and exact seam aliases). Raw BLG
selections are nested, but validated output need not be monotonic after a
fallback. No geographic viewport culling is permitted yet; topology bounds
are diagnostic only. The spherical dataset intentionally does not implement
the planar partition/session interface. A versioned spherical artifact format,
independent D3/robust spherical predicate comparison, real atlas benchmarks,
globe integration, and visibility optimization remain separate work. Do not
serialize spherical results through the planar v1 partition API.

The Node test suite includes exact seam and pole aliases, six faces, boundary
tie handling, seeded occupancy, winding, holes, crossing and ambiguous rings,
reverse arcs, nested BLG selections, global fallback, named transformed
TopoJSON, and planar v1 round trips. Run `npm run check` on Node 20 and 22.
