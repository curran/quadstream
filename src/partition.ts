import { boundsOf, intersects } from "./geometry.js";
import type {
  Bounds,
  PartitionBundle,
  PartitionRecord,
  QuadstreamManifest,
  PartitionInfo,
  Position,
} from "./types.js";
import { QuadstreamDataset } from "./dataset.js";

const MAGIC = [81, 83, 84, 82]; // QSTR
const VERSION = 1,
  HEADER_BYTES = 10,
  RECORD_BYTES = 22;
export function encodePartition(
  records: readonly PartitionRecord[],
): Uint8Array {
  if (records.length > (2 ** 32 - 1) / RECORD_BYTES)
    throw new Error("Partition too large");
  const bytes = new Uint8Array(HEADER_BYTES + records.length * RECORD_BYTES);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, VERSION, true);
  view.setUint32(6, records.length, true);
  for (let i = 0; i < records.length; i++) {
    const { id, x, y, level } = records[i]!,
      offset = HEADER_BYTES + i * RECORD_BYTES;
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id > 0xffffffff ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 65535
    )
      throw new Error("Invalid partition record");
    view.setUint32(offset, id, true);
    view.setFloat64(offset + 4, x, true);
    view.setFloat64(offset + 12, y, true);
    view.setUint16(offset + 20, level, true);
  }
  return bytes;
}
export function decodePartition(
  bytes: Uint8Array,
  maxRecords = 1_000_000,
): PartitionRecord[] {
  if (bytes.byteLength < HEADER_BYTES || MAGIC.some((v, i) => bytes[i] !== v))
    throw new Error("Invalid Quadstream partition magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== VERSION)
    throw new Error("Unsupported Quadstream partition version");
  const n = view.getUint32(6, true);
  if (n > maxRecords || bytes.length !== HEADER_BYTES + n * RECORD_BYTES)
    throw new Error("Invalid partition length or record limit");
  const out: PartitionRecord[] = [];
  for (let i = 0; i < n; i++) {
    const offset = HEADER_BYTES + i * RECORD_BYTES;
    const record = {
      id: view.getUint32(offset, true),
      x: view.getFloat64(offset + 4, true),
      y: view.getFloat64(offset + 12, true),
      level: view.getUint16(offset + 20, true),
    };
    if (!Number.isFinite(record.x) || !Number.isFinite(record.y))
      throw new Error("Invalid partition coordinate");
    out.push(record);
  }
  return out;
}
/** FNV-1a detects accidental corruption; this is not an authentication signature. */
export function checksum(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function exportPartitions(
  dataset: QuadstreamDataset,
  { fileDepth = 4 }: { fileDepth?: number } = {},
): PartitionBundle {
  if (
    !Number.isInteger(fileDepth) ||
    fileDepth < 1 ||
    fileDepth > dataset.quadtree.maxLevel
  )
    throw new Error("Invalid fileDepth");
  const byKey = new Map<string, PartitionRecord[]>(),
    cells = dataset.quadtree.cells;
  for (const cell of cells) {
    const v = dataset.topology.vertices[cell.vertexId]!;
    const groupLevel = Math.floor(cell.level / fileDepth) * fileDepth;
    const shift = cell.level - groupLevel;
    const key =
      v.critical || groupLevel === 0
        ? "base"
        : `${groupLevel}_${Math.floor(cell.i / 2 ** shift)}_${Math.floor(cell.j / 2 ** shift)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ id: v.id, x: v.x, y: v.y, level: cell.level });
  }
  const partitions = new Map<string, Uint8Array>(),
    infos: PartitionInfo[] = [];
  for (const key of [...byKey.keys()].sort((a, b) =>
    a === "base" ? -1 : b === "base" ? 1 : a.localeCompare(b),
  )) {
    const records = byKey.get(key)!.sort((a, b) => a.id - b.id),
      bytes = encodePartition(records);
    const bounds = boundsOf(records.map((r) => [r.x, r.y] as Position));
    partitions.set(key, bytes);
    infos.push({
      key,
      byteLength: bytes.byteLength,
      checksum: checksum(bytes),
      vertexIds: records.map((r) => r.id),
      minLevel: records.reduce((min, r) => Math.min(min, r.level), Infinity),
      bounds,
    });
  }
  const manifest: QuadstreamManifest = {
    format: "quadstream",
    version: VERSION,
    maxLevel: dataset.quadtree.maxLevel,
    fileDepth,
    bounds: dataset.topology.bounds,
    features: dataset.topology.features,
    arcs: dataset.topology.arcs,
    vertices: dataset.topology.vertices.map((v) => ({
      id: v.id,
      level: dataset.quadtree.levelByVertexId[v.id]!,
      critical: v.critical,
    })),
    partitions: infos,
  };
  return { manifest, partitions };
}
/** Conservative request planner: all partitions with relevant importance. No incorrect bbox-only pruning. */
export function requiredPartitionKeys(
  manifest: QuadstreamManifest,
  level: number,
): string[] {
  if (!Number.isInteger(level) || level < 0 || level >= manifest.maxLevel)
    throw new Error("Invalid query level");
  return manifest.partitions
    .filter((p) => p.minLevel <= level || p.key === "base")
    .map((p) => p.key);
}
/** Coverage is diagnostic only: a line can cross the view even when its vertices do not. */
export function partitionsWithVerticesInBounds(
  manifest: QuadstreamManifest,
  bounds: Bounds,
): string[] {
  return manifest.partitions
    .filter((p) => intersects(p.bounds, bounds))
    .map((p) => p.key);
}
