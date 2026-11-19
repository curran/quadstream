# Contributing to Quadstream

Quadstream is a research-oriented geometry engine. Please supply a minimal reproducer for algorithmic issues, ideally a small GeoJSON FeatureCollection and exact query level/bounds. Do not submit confidential or personally identifying geographic datasets.

## Build and test

```sh
npm install
npm run check
node examples/hello.mjs
```

All proposed changes must include deterministic tests for their invariants. Spatial indexing changes should compare against a brute-force reference query. BLG changes should assert the inorder and parent-priority invariants and exercise long skewed trees. Simplification changes should exercise polygon validity, shared boundaries, holes, and level nesting with documented fallback semantics. Binary format changes require round-trip, corrupt-length, corrupt-checksum, version-rejection and reordering tests.

The TypeScript code intentionally has no runtime dependencies. Keep adapters, transport and UI separate from the geometry core. Do not modify historical source or licensing notices as part of unrelated refactoring.

## PR checklist

- [ ] Tests, strict TypeScript build, and standalone example pass locally.
- [ ] Geometry or wire-format changes include regression fixtures.
- [ ] Input validation and resource bounds are reviewed.
- [ ] Public API and binary format documentation are updated.
- [ ] Benchmark changes include comparable baseline measurements.
- [ ] Actual CI status is stated; missing CI results are not reported as passing.

See `plans/PROJECT_ROADMAP.md` before proposing features that expand supported geometry or serialization protocols.
