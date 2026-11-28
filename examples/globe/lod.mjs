// Provisional scale thresholds, not a measured projected-error guarantee.
export const MIN_AUTO_LEVEL = 4.2,
  MAX_LEVEL = 19;
// Keep the scale-to-level calibration separate from the rendering floor.
export const BASE_LOD = 4;
export const BASE_SCALE = 120;
export const levelScale = (level) => BASE_SCALE * 2 ** (level - BASE_LOD);
export const scaleLevel = (scale) => BASE_LOD + Math.log2(scale / BASE_SCALE);
export function levelForScale(
  scale,
  previous,
  {
    min = MIN_AUTO_LEVEL,
    max = MAX_LEVEL,
    base = BASE_SCALE,
    hysteresis = 0.15,
  } = {},
) {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Invalid projection scale");
  const continuous = BASE_LOD + Math.log2(scale / base);
  const clamped = Math.max(min, Math.min(max, continuous));
  if (previous === undefined) return clamped;
  const prior = Math.max(min, Math.min(max, previous));
  const priorBand = Math.floor(prior);
  if (clamped >= priorBand + 1 && clamped < priorBand + 1 + hysteresis)
    return prior;
  if (clamped < priorBand && clamped >= priorBand - hysteresis) return prior;
  return clamped;
}
export function quantizeAutoLevel(level) {
  return Number((Math.round(level * 10) / 10).toFixed(1));
}
// The slider controls the base LOD at 1x; zoom cannot lower the rendered LOD
// below the demo floor. Quantize only after clamping the continuous level.
export function levelForZoom(baseLevel, zoomRatio) {
  if (
    !Number.isFinite(baseLevel) ||
    !Number.isFinite(zoomRatio) ||
    zoomRatio <= 0
  )
    throw new Error("Invalid globe LOD or zoom ratio");
  return quantizeAutoLevel(
    Math.max(
      MIN_AUTO_LEVEL,
      Math.min(MAX_LEVEL, baseLevel + Math.log2(zoomRatio)),
    ),
  );
}
export { createLatestGeometry, improvesLod } from "../../dist/index.js";
