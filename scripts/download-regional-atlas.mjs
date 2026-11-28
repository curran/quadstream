import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mesh } from "topojson-client";

const args = process.argv.slice(2);
const countries = new Set(args.map((s) => s.toUpperCase()));
if (args.some((s) => !/^[A-Z]{3}$/i.test(s))) {
  throw new Error("Usage: node scripts/download-regional-atlas.mjs [ISO3 ...]");
}
const version = "gb80";
const root = fileURLToPath(
  new URL("../examples/globe/regional-data/", import.meta.url),
);
const api = "https://www.geoboundaries.org/api/" + version + "/gbOpen/";
const rad = Math.PI / 180;
const vector = ([lon, lat]) => [
  Math.cos(lat * rad) * Math.cos(lon * rad),
  Math.cos(lat * rad) * Math.sin(lon * rad),
  Math.sin(lat * rad),
];
const angle = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
function cap(lines) {
  const sum = [0, 0, 0];
  for (const line of lines)
    for (const p of line) {
      const v = vector(p);
      for (let i = 0; i < 3; i++) sum[i] += v[i];
    }
  const n = Math.hypot(...sum);
  const center = n > 1e-9 ? sum.map((v) => v / n) : [1, 0, 0];
  let radius = 0,
    edge = 0;
  for (const line of lines) {
    let prev;
    for (const p of line) {
      const v = vector(p);
      radius = Math.max(radius, angle(center, v));
      if (prev) edge = Math.max(edge, angle(prev, v));
      prev = v;
    }
  }
  // Triangle inequality bounds points along the original minor arcs.
  return {
    cx: center[0],
    cy: center[1],
    cz: center[2],
    radiusRad: Math.min(Math.PI, radius + edge + 1e-6),
  };
}
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(response.status + " " + url);
  return response.text();
}

await mkdir(root, { recursive: true });
const records = [];
const failures = [];
for (const level of ["ADM1", "ADM2"]) {
  const index = JSON.parse(await get(api + "ALL/" + level + "/"));
  if (!Array.isArray(index)) throw new Error("Expected metadata array");
  for (const summary of index.sort((a, b) =>
    a.boundaryISO.localeCompare(b.boundaryISO),
  )) {
    const iso = summary.boundaryISO;
    if (
      !/^[A-Z]{3}$/.test(iso) ||
      iso === "USA" ||
      (countries.size && !countries.has(iso))
    )
      continue;
    try {
      const meta = summary;
      const source = meta.tjDownloadURL;
      if (!source || !source.startsWith("https://"))
        throw new Error("Missing TopoJSON URL");
      const raw = await get(source);
      const topology = JSON.parse(raw);
      const objects = Object.keys(topology.objects ?? {});
      if (topology.type !== "Topology" || objects.length !== 1)
        throw new Error("Expected a single TopoJSON object");
      const object = objects[0];
      const lines = mesh(
        topology,
        topology.objects[object],
        (a, b) => a !== b,
      ).coordinates;
      if (!lines.length) continue; // No internal boundaries.
      if (
        lines.some((line) =>
          line.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])),
        )
      )
        throw new Error("Nonfinite coordinate");
      const hash = createHash("sha256").update(raw).digest("hex");
      const id = iso.toLowerCase() + "-" + level.toLowerCase();
      const file = id + "-" + hash.slice(0, 16) + ".json";
      await writeFile(join(root, file), raw);
      records.push({
        id,
        iso,
        level,
        file,
        object,
        caps: [cap(lines)],
        sha256: hash,
        bytes: Buffer.byteLength(raw),
        boundaryID: meta.boundaryID,
        source,
        license: meta.boundaryLicense,
        licenseSource: meta.licenseSource,
        attribution: meta.boundarySource,
        year: meta.boundaryYearRepresented,
      });
      console.log(id, file);
    } catch (error) {
      failures.push(iso + "/" + level + ": " + error.message);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  throw new Error("Download incomplete; existing catalog unchanged");
}
if (!records.length) throw new Error("No nonempty boundary layers downloaded");
const tmp = join(root, "catalog.tmp");
await writeFile(tmp, JSON.stringify({ version, records }, null, 2) + "\n");
await rename(tmp, join(root, "catalog.json"));
console.log("Published " + records.length + " regional layers");
