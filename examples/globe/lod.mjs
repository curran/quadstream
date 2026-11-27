// Provisional scale thresholds, not a measured projected-error guarantee.
export const MIN_AUTO_LEVEL = 4,
  MAX_LEVEL = 19;
// Auto LOD follows level = MIN_AUTO_LEVEL + log2(scale / BASE_SCALE).
export const BASE_SCALE = 120;
export const levelScale = (level) => BASE_SCALE * 2 ** (level - MIN_AUTO_LEVEL);
export const scaleLevel = (scale) =>
  MIN_AUTO_LEVEL + Math.log2(scale / BASE_SCALE);
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
  const continuous = min + Math.log2(scale / base);
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
// Completion-driven throttle: one active query, one replaceable desired level.
// A completed frame is useful even when the camera has already moved on.
export function createLatestGeometry({ request, onFrame, onError = () => {} }) {
  let generation = 0,
    lastSeq = 0,
    desired = null,
    rendered = null,
    running = false,
    disposed = false;
  const cache = new Map();

  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && desired !== null && desired !== rendered) {
        const level = desired,
          id = generation;
        try {
          let frame = cache.get(level);
          if (!frame) {
            frame = await request(level);
            if (disposed || id !== generation) continue;
            const seq = frame?.seq;
            if (seq != null) {
              if (seq < lastSeq) throw new Error("Out-of-order geometry frame");
              lastSeq = seq;
            }
            cache.set(level, frame);
            if (cache.size > 4) cache.delete(cache.keys().next().value);
          }
          rendered = level;
          onFrame(frame);
        } catch (e) {
          if (disposed || id !== generation) continue;
          // An obsolete failure must not block the newest target. A failure
          // of the current target may be retried by a subsequent selection.
          if (desired === level) {
            desired = null;
            onError(e);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  function invalidate() {
    generation++;
    lastSeq = 0;
    desired = null;
    rendered = null;
    cache.clear();
  }

  return {
    async select(level) {
      if (disposed) return;
      desired = level;
      // While busy this records intent only; the existing drain owns the
      // query and will consume the latest target when that query completes.
      await drain();
    },
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
    get target() {
      return desired;
    },
  };
}
