import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { importTopoJSON } from "../dist/index.js";
const bin = fileURLToPath(new URL("../bin/quadstream.mjs", import.meta.url));
const run = (...args) =>
  spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
function ok(...args) {
  const r = run(...args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function bad(code, ...args) {
  const r = run(...args);
  assert.equal(r.status, code, r.stderr);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.trim());
  return r.stderr;
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "quadstream-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source file.json"),
    bundle = join(root, "bundle"),
    data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "a",
          properties: { value: 12 },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
          },
        },
        {
          type: "Feature",
          id: "b",
          properties: { value: 15 },
          geometry: {
            type: "LineString",
            coordinates: [
              [10, 10],
              [11, 11],
              [12, 12],
            ],
          },
        },
      ],
    };
  await writeFile(source, JSON.stringify(data));
  return { root, source, bundle, data };
}
test("CLI help and invalid usage", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  for (const word of ["build", "validate", "inspect", "query", "benchmark"])
    assert.match(help.stdout, new RegExp(word));
  bad(2);
  bad(2, "unknown");
  bad(2, "build", "only");
  bad(2, "inspect", "x", "--unknown", "1");
  bad(2, "build", "x", "y", "--max-level", "27");
  bad(2, "validate", "x", "--max-bytes", "0");
  bad(2, "build", "x", "y", "--max-level", "1.5");
  bad(2, "build", "x", "y", "--max-level", "20", "--max-level", "21");
});
test("build, inspect, validate, query full detail and bounds", async (t) => {
  const { source, bundle, data } = await fixture(t);
  assert.equal(ok("validate", source).features, 2);
  const built = ok(
    "build",
    source,
    bundle,
    "--max-level",
    "12",
    "--file-depth",
    "2",
  );
  assert.equal(built.features, 2);
  assert.equal(built.version, 1);
  assert.equal(built.vertices, 6);
  assert.ok(built.partitionBytes > 0);
  assert.deepEqual(ok("inspect", bundle), built);
  assert.equal(ok("validate", bundle).valid, true);
  assert.deepEqual(ok("query", bundle, "--level", "11"), data);
  assert.deepEqual(ok("query", bundle, "--bounds", "-1,-1,3,3").features, [
    data.features[0],
  ]);
  assert.deepEqual(ok("query", bundle, "--bounds", "20,20,30,30").features, []);
  assert.equal(ok("query", bundle, "--level", "0").features.length, 2);
});
test("deterministic build and TopoJSON input/output", async (t) => {
  const { root, source, bundle, data } = await fixture(t),
    second = join(root, "second"),
    topo = join(root, "map.topojson");
  ok("build", source, bundle);
  ok("build", source, second);
  const names = await readdir(bundle);
  assert.deepEqual(names, await readdir(second));
  for (const name of names)
    assert.deepEqual(
      await readFile(join(bundle, name)),
      await readFile(join(second, name)),
    );
  const r = run("query", bundle, "--format", "topojson", "--output", topo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.deepEqual(
    importTopoJSON(JSON.parse(await readFile(topo, "utf8"))),
    data,
  );
  assert.equal(ok("validate", topo).valid, true);
  ok("build", topo, join(root, "topobundle"));
  assert.deepEqual(ok("query", join(root, "topobundle")), data);
  bad(1, "query", bundle, "--output", topo);
});
test("malformed input, limits, missing files, existing output", async (t) => {
  const { root, source, bundle } = await fixture(t);
  const malformed = join(root, "bad.json");
  await writeFile(malformed, "{");
  bad(1, "validate", malformed);
  bad(1, "validate", join(root, "missing"));
  bad(1, "validate", source, "--max-bytes", "5");
  await writeFile(malformed, Buffer.from([0xff]));
  bad(1, "validate", malformed);
  ok("build", source, bundle);
  bad(1, "build", source, bundle);
  bad(1, "query", bundle, "--max-bytes", "10");
  bad(2, "query", bundle, "--format", "mvt");
  bad(2, "query", bundle, "--bounds", "1,0,0,1");
  bad(2, "query", bundle, "--bounds", "0,,1,1");
  bad(2, "query", bundle, "--level", "99");
  const link = join(root, "link.json");
  await symlink(source, link);
  bad(1, "validate", link);
});
test("corrupt partition and manifest fail closed", async (t) => {
  const { source, bundle } = await fixture(t);
  ok("build", source, bundle);
  const mp = join(bundle, "manifest.json"),
    m = JSON.parse(await readFile(mp, "utf8")),
    p = join(bundle, m.partitions[0].key + ".qstr");
  const original = await readFile(p),
    damaged = Buffer.from(original);
  damaged[0] ^= 255;
  await writeFile(p, damaged);
  bad(1, "validate", bundle);
  bad(1, "query", bundle);
  await writeFile(p, original);
  const altered = structuredClone(m);
  altered.partitions[0].key = "../unsafe";
  await writeFile(mp, JSON.stringify(altered));
  bad(1, "inspect", bundle);
  bad(1, "query", bundle);
  await writeFile(mp, JSON.stringify(m));
  await rm(p);
  bad(1, "validate", bundle);
});
test("benchmark reports measured nonnegative phase times and sizes", async (t) => {
  const { source } = await fixture(t);
  const r = ok("benchmark", source, "--iterations", "2");
  assert.equal(r.runs.length, 2);
  for (const x of r.runs) {
    for (const k of ["buildMs", "partitionMs", "queryMs"])
      assert.ok(Number.isFinite(x[k]) && x[k] >= 0);
    assert.equal(x.vertices, 6);
    assert.ok(x.partitionBytes > 0);
  }
  bad(2, "benchmark", source, "--iterations", "101");
});
