#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, writeFile, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import {
  buildQuadstream,
  exportPartitions,
  QuadstreamSession,
  importGeoJSON,
  importTopoJSON,
  exportGeoJSON,
  exportTopoJSON,
  validateManifest,
} from "../dist/index.js";

const usage = `Quadstream (development preview)
  quadstream build INPUT OUTPUT_DIR [--max-level N] [--file-depth N] [--max-bytes N]
  quadstream validate INPUT_OR_BUNDLE [--max-bytes N]
  quadstream inspect BUNDLE [--max-bytes N]
  quadstream query BUNDLE [--level N] [--bounds xmin,ymin,xmax,ymax] [--format geojson|topojson] [--output FILE] [--max-bytes N]
  quadstream benchmark INPUT [--max-level N] [--iterations N] [--max-bytes N]
Inputs are GeoJSON or TopoJSON files; all coordinates are planar. Output paths must not exist.
Exit codes: 0 success, 1 data/IO failure, 2 usage error.
`;
class UsageError extends Error {}
function parse(args, allowed, n) {
  const options = {},
    positional = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2),
      value = args[++i];
    if (
      !allowed.includes(key) ||
      Object.hasOwn(options, key) ||
      value === undefined ||
      value.startsWith("--")
    )
      throw new UsageError("Invalid option: " + token);
    options[key] = value;
  }
  if (positional.length !== n)
    throw new UsageError("Wrong number of arguments");
  return { options, positional };
}
function int(v, min, max, name) {
  if (
    !/^[0-9]+$/.test(String(v)) ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) < min ||
    Number(v) > max
  )
    throw new UsageError("Invalid " + name);
  return Number(v);
}
function budget(max) {
  let remaining = max;
  return async function read(path) {
    const st = await lstat(path);
    if (!st.isFile() || st.size > remaining)
      throw new Error("Not a regular file or byte limit exceeded: " + path);
    const chunks = [];
    let size = 0;
    for await (const chunk of createReadStream(path)) {
      size += chunk.length;
      if (size > remaining) throw new Error("Byte limit exceeded: " + path);
      chunks.push(chunk);
    }
    remaining -= size;
    return Buffer.concat(chunks, size);
  };
}
const json = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const asSource = (v) =>
  v?.type === "Topology" ? importTopoJSON(v) : importGeoJSON(v);
const print = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");
async function manifest(dir, read) {
  return validateManifest(json(await read(join(dir, "manifest.json"))));
}
async function load(dir, read) {
  const m = await manifest(dir, read),
    session = new QuadstreamSession(m);
  for (const p of m.partitions)
    session.load(p.key, await read(join(dir, p.key + ".qstr")));
  return { m, session };
}
function inspect(m) {
  return {
    format: m.format,
    version: m.version,
    maxLevel: m.maxLevel,
    fileDepth: m.fileDepth,
    bounds: m.bounds,
    features: m.features.length,
    arcs: m.arcs.length,
    vertices: m.vertices.length,
    partitions: m.partitions.length,
    partitionBytes: m.partitions.reduce((n, p) => n + p.byteLength, 0),
  };
}
function bbox(v) {
  const parts = v.split(",");
  if (
    parts.length !== 4 ||
    parts.some((x) => !x.trim() || !Number.isFinite(Number(x)))
  )
    throw new UsageError("Invalid bounds");
  const b = parts.map(Number);
  if (b[0] > b[2] || b[1] > b[3]) throw new UsageError("Invalid bounds order");
  return b;
}
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "--help" || cmd === "help" || args.includes("--help")) {
    process.stdout.write(usage);
    return;
  }
  const config = {
    build: [["max-level", "file-depth"], 2],
    validate: [[], 1],
    inspect: [[], 1],
    query: [["level", "bounds", "format", "output"], 1],
    benchmark: [["max-level", "iterations"], 1],
  };
  if (!Object.hasOwn(config, cmd)) throw new UsageError("Unknown command");
  const [allowed, n] = config[cmd],
    {
      options: o,
      positional: [input, output],
    } = parse(args, [...allowed, "max-bytes"], n);
  const read = budget(
    int(o["max-bytes"] ?? "67108864", 1, 1073741824, "max-bytes"),
  );
  const maxLevel = () => int(o["max-level"] ?? "20", 1, 26, "max-level");
  if (cmd === "build") {
    const level = maxLevel(),
      depth = int(
        o["file-depth"] ?? String(Math.min(4, level)),
        1,
        level,
        "file-depth",
      );
    const bundle = exportPartitions(
      buildQuadstream(asSource(json(await read(input))), { maxLevel: level }),
      { fileDepth: depth },
    );
    validateManifest(bundle.manifest);
    await mkdir(output);
    try {
      for (const [key, bytes] of bundle.partitions)
        await writeFile(join(output, key + ".qstr"), bytes, { flag: "wx" });
      await writeFile(
        join(output, "manifest.json"),
        JSON.stringify(bundle.manifest) + "\n",
        { flag: "wx" },
      );
    } catch (e) {
      await rm(output, { recursive: true, force: true });
      throw e;
    }
    print(inspect(bundle.manifest));
    return;
  }
  if (cmd === "inspect") {
    print(inspect(await manifest(input, read)));
    return;
  }
  if (cmd === "validate") {
    if ((await lstat(input)).isDirectory()) {
      const { m, session } = await load(input, read),
        result = session.query({ level: m.maxLevel - 1 });
      if (!result.complete || result.omittedFeatures)
        throw new Error("Incomplete full-detail reconstruction");
      print({ valid: true, ...inspect(m) });
    } else {
      const data = asSource(json(await read(input)));
      print({ valid: true, features: data.features.length });
    }
    return;
  }
  if (cmd === "query") {
    const format = o.format ?? "geojson";
    if (!["geojson", "topojson"].includes(format))
      throw new UsageError("Invalid format");
    const bounds = o.bounds === undefined ? undefined : bbox(o.bounds);
    const { m, session } = await load(input, read);
    const level = int(
      o.level ?? String(m.maxLevel - 1),
      0,
      m.maxLevel - 1,
      "level",
    );
    const result = session.query({ level, bounds });
    if (!result.complete) throw new Error("Incomplete query result");
    const data =
      format === "topojson"
        ? exportTopoJSON(result.geojson)
        : exportGeoJSON(result.geojson);
    if (o.output !== undefined)
      await writeFile(o.output, JSON.stringify(data) + "\n", { flag: "wx" });
    else print(data);
    return;
  }
  const iterations = int(o.iterations ?? "3", 1, 100, "iterations"),
    level = maxLevel(),
    data = asSource(json(await read(input))),
    runs = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(),
      dataset = buildQuadstream(data, { maxLevel: level }),
      built = performance.now(),
      bundle = exportPartitions(dataset, { fileDepth: Math.min(4, level) }),
      packed = performance.now();
    const coarse = dataset.query({ level: 0 }),
      full = dataset.query({ level: level - 1 }),
      done = performance.now();
    runs.push({
      buildMs: built - start,
      partitionMs: packed - built,
      queryMs: done - packed,
      vertices: dataset.topology.vertices.length,
      coarseVertices: coarse.selectedVertices,
      fullVertices: full.selectedVertices,
      coarseFallback: coarse.usedFallback,
      partitionBytes: inspect(bundle.manifest).partitionBytes,
    });
  }
  print({ iterations, maxLevel: level, runs });
}
main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + "\n");
  process.exitCode = e instanceof UsageError ? 2 : 1;
});
