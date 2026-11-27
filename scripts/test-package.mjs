import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "quadstream-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && cmd === npm,
  });
try {
  // Build through prepack rather than relying on a previous test's dist.
  rmSync(join(root, "dist"), { recursive: true, force: true });
  const packResult = JSON.parse(
    run(npm, ["pack", "--json", "--pack-destination", temp]),
  );
  const pack = Array.isArray(packResult)
    ? packResult[0]
    : Object.values(packResult)[0];
  const paths = pack.files.map((file) => file.path);
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "dist/index.js",
    "dist/index.d.ts",
    "bin/quadstream.mjs",
  ]) {
    assert(paths.includes(required), "missing packed file: " + required);
  }
  for (const path of paths) {
    assert(
      /^(package\.json|README\.md|LICENSE|CHANGELOG\.md|bin\/quadstream\.mjs|dist\/[\w.-]+\.(js|d\.ts))$/.test(
        path,
      ),
      "unexpected packed file: " + path,
    );
  }
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    npm,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(temp, pack.filename),
    ],
    temp,
  );
  const installed = JSON.parse(
    readFileSync(
      join(temp, "node_modules/@vizhub/quadstream/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.license, "MIT");
  const sourcePackage = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  assert.equal(installed.version, sourcePackage.version);
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);

  writeFileSync(
    join(temp, "consumer.ts"),
    `
import assert from 'node:assert/strict';
`.replace("import assert from 'node:assert/strict';", "") +
      `
import { buildQuadstream, buildSphericalQuadstream, exportPartitions,
  QuadstreamSession, QuadstreamLoader, fetchFromBundle } from '@vizhub/quadstream';
import type { FeatureCollection, QueryResult } from '@vizhub/quadstream';
const source: FeatureCollection = {type:'FeatureCollection', features:[
  {type:'Feature', id:'line', properties:{}, geometry:{type:'LineString',
    coordinates:[[0,0],[1,1],[2,2]]}}
]};
const planar: QueryResult = buildQuadstream(source, {maxLevel:8}).query({level:7});
if (planar.geojson.features.length !== 1) throw new Error('planar query failed');
const bundle = exportPartitions(buildQuadstream(source, {maxLevel:8}), {fileDepth:2});
const session = new QuadstreamSession(bundle.manifest);
const result = await new QuadstreamLoader(session, fetchFromBundle(bundle)).loadLatest({level:7});
if (!result.complete || result.geojson.features.length !== 1) throw new Error('partition query failed');
const spherical: QueryResult = buildSphericalQuadstream(source, {maxLevel:8}).query({level:7});
if (spherical.geojson.features.length !== 1) throw new Error('spherical query failed');
`,
  );
  writeFileSync(
    join(temp, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
      },
      files: ["consumer.ts"],
    }),
  );
  run(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    temp,
  );
  run(process.execPath, ["consumer.js"], temp);
  const cli = join(
    temp,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "quadstream.cmd" : "quadstream",
  );
  assert.match(
    execFileSync(cli, ["--help"], {
      cwd: temp,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
    /quadstream build/,
  );
  console.log(
    "Packed package: contents, MIT metadata, ESM, TypeScript, planar/progressive/spherical queries and installed CLI verified.",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
