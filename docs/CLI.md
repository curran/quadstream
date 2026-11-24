# Quadstream command line and geographic formats

Development preview: install dependencies and run `npm run build` before invoking
`node bin/quadstream.mjs` from a checkout. The package declares a `quadstream`
executable for eventual installation, but remains private pending release and license review.

```sh
node bin/quadstream.mjs --help
node bin/quadstream.mjs validate countries.geojson
node bin/quadstream.mjs build countries.geojson countries.bundle --max-level 20 --file-depth 4
node bin/quadstream.mjs inspect countries.bundle
node bin/quadstream.mjs validate countries.bundle
node bin/quadstream.mjs query countries.bundle --level 19 --format topojson --output countries.topojson
node bin/quadstream.mjs query countries.bundle --level 4 --bounds -10,-10,10,10
node bin/quadstream.mjs benchmark countries.geojson --iterations 3
```

For the bounds command, supply the option and its value as separate arguments:
`--bounds -10,-10,10,10` (the CLI does not accept equals syntax).

Build accepts GeoJSON FeatureCollection/Feature or TopoJSON Topology with named
objects; validate accepts the same sources or a bundle directory. Inspect checks
manifest metadata only. Validate on a bundle checks every partition, then verifies
complete full-detail reconstruction. Query loads all partitions conservatively,
filters by feature bounds (not clipping), and returns complete GeoJSON or TopoJSON.
Query output and build directories must not exist. Use stdout redirection or
`--output FILE` for query output. Exit codes: 0 success, 1 input/data/IO failure,
2 invalid command or option. Errors go to stderr, JSON to stdout.

## Format and coordinate policy

- Supported geometry types: Polygon, MultiPolygon, LineString, MultiLineString.
  Null/empty geometry, points, nested geometry collections, nonfinite/3D
  coordinates, open rings, invalid rings and duplicate normalized IDs are rejected.
- Coordinates are exactly two finite planar numbers. Standard longitude/latitude
  inputs are interpreted as planar numbers without automatic reprojection or
  antimeridian wrapping; project and split dateline-crossing features upstream
  when needed. Explicit legacy CRS objects are rejected, not silently interpreted.
- TopoJSON imports absolute coordinates or quantized integer delta arcs with
  scale/translate. Arc references use standard zero-based indices and bitwise
  complement reversal; disconnected arcs are rejected. Named objects are flattened
  in object order into one feature collection (object names are not retained).
  Exports are unquantized absolute coordinates with shared arcs stored once.
- The adapters preserve explicit string/numeric IDs and null/object properties;
  the core build/query path normalizes IDs to strings (generates missing IDs)
  and null properties to empty objects, as in its existing API. Cyclic ring
  start positions can change; coordinate order and orientation are retained.
- Empty query exports are valid; empty input builds are rejected.
- MVT export is intentionally deferred: no independent decoder validation yet.

## Manifest and static staging

A bundle contains `manifest.json` and one `KEY.qstr` file per partition.
The v1 runtime schema (`validateManifest` in `src/manifest-schema.ts`) checks
format/version, levels, bounds, contiguous IDs, signed arc references, path
connectivity and closure, geometry groups, partition key syntax, checksum/length,
vertex accounting and minimum levels. Unknown versions fail closed.
Binary records remain exactly the existing v1 QSTR format; no migration is needed.
This is structural validation, not proof of geographic accuracy or authenticity.
Partition checksums are accidental-corruption checks, not signatures.

Stage a complete generated directory as static objects, e.g.
`aws s3 sync countries.bundle s3://YOUR_BUCKET/quadstream/countries/v1/`
(with your own permissions and configuration). Keep immutable versioned prefixes,
upload partitions before advertising the manifest, and serve JSON as
application/json and binary files as application/octet-stream. This is a staging
example, not a production HTTP loader or CDN integration.

The CLI reads regular files in chunks with a cumulative input byte budget
(default 64 MiB; override with `--max-bytes N`, maximum 1 GiB).
It rejects symlink inputs at the file level; use trusted local directories.
JSON is buffered and parsed in memory; geometry is also built in memory.
The byte budget is not a heap bound. Large/adversarial topology expansion,
quadratic geometry validation and production resource hardening remain release gates.
Benchmark reports measured build, partition and query phases for each run,
vertex counts, fallback status and partition bytes; it does not compare competitors.

## Validation

```sh
npm install
npm run check
node examples/hello.mjs
node bin/quadstream.mjs --help
```

CI is configured to run the same checks on Node 20 and 22. The project remains
private, and historical license review, clean-install sign-off and real-world
geography benchmarks are required before production use or npm publication.
