import { readFile, writeFile } from "node:fs/promises";

// The legacy spec remains the source of truth. Adapt only deployment URLs,
// module access (Vite bundles the modules), and the worker's hashed filename.
export function adaptLegacySpec(source) {
  return source
    .replaceAll("../../examples/globe/lod.mjs", "../../../examples/globe/lod.mjs")
    .replaceAll("/examples/globe/index.html", "/migration/")
    .replaceAll('import("/examples/globe/map.mjs")', "Promise.resolve(globalThis.globeDebug.testModules.map)")
    .replaceAll('import("/examples/globe/geometry.mjs")', "Promise.resolve(globalThis.globeDebug.testModules.geometry)")
    .replaceAll("/node_modules/world-atlas/", "/migration/globe-data/test-atlas/")
    .replaceAll("globalThis.topojson", "globalThis.globeDebug.testModules.topojson")
    .replaceAll("globalThis.d3", "globalThis.globeDebug.testModules.d3")
    .replaceAll('!String(url).endsWith("/worker.mjs")', 'options?.name !== "quadstream-geometry"');
}

const source = await readFile(new URL("../../../test/browser/globe.spec.mjs", import.meta.url), "utf8");
await writeFile(new URL("../browser/legacy-parity.generated.spec.mjs", import.meta.url), adaptLegacySpec(source));
