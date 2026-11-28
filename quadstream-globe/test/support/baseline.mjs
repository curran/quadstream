// Shared deterministic camera trace for future legacy/React comparisons.
export const cameraTrace = [
  { id: "atlantic-1x", rotation: [0, -20, 0], zoom: 1 },
  { id: "pacific-3x", rotation: [180, 4, 0], zoom: 3 },
  { id: "north-pole-1x", rotation: [0, 88, 0], zoom: 1 },
  { id: "south-pole-3x", rotation: [0, -90, 0], zoom: 3 },
];

export function summarizeSamples(samples) {
  if (samples.length === 0 || samples.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new RangeError("Expected nonempty, finite, nonnegative samples");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : sorted[middle - 1] / 2 + sorted[middle] / 2;
  return {
    count: sorted.length,
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
