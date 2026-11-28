# Extract transferable polygon geometry serialization

Preserve typed-array transport and worker protocol; reject unsupported lines and malformed buffers. Worker and client use library via demo compatibility re-export.

export { packGeometry, unpackGeometry } from "./geometry-wire.js";
export type { PackedGeometry } from "./geometry-wire.js";
