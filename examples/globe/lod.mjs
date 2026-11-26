// Provisional scale thresholds, not a measured projected-error guarantee.
export const MIN_AUTO_LEVEL = 4,
  MAX_LEVEL = 19;
export function levelForScale(
  scale,
  previous,
  { min = MIN_AUTO_LEVEL, max = MAX_LEVEL, base = 120, hysteresis = 0.15 } = {},
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
export function quantizeAutoLevel(level, interacting = false) {
  return interacting
    ? Number((Math.round(level * 5) / 5).toFixed(1))
    : Number((Math.round(level * 10) / 10).toFixed(1));
}
export function createLatestGeometry({ request, onFrame, onError = () => {} }) {
  let generation = 0,
    lastSeq = 0,
    desired = null,
    disposed = false;
  const cache = new Map();
  return {
    async select(level) {
      if (disposed || desired === level) return;
      desired = level;
      const id = ++generation;
      try {
        let frame = cache.get(level);
        const fromCache = Boolean(frame);
        if (!frame) {
          frame = await request(level);
          if (disposed || id !== generation) return;
          cache.set(level, frame);
          if (cache.size > 4) cache.delete(cache.keys().next().value);
        }
        if (!disposed && id === generation) {
          const seq = frame?.seq;
          if (!fromCache && seq != null) {
            if (seq < lastSeq) return;
            lastSeq = seq;
          }
          onFrame(frame);
        }
      } catch (e) {
        if (!disposed && id === generation) {
          desired = null;
          onError(e);
        }
      }
    },
    invalidate() {
      generation++;
      lastSeq = 0;
      desired = null;
      cache.clear();
    },
    dispose() {
      disposed = true;
      generation++;
      lastSeq = 0;
      cache.clear();
    },
    get target() {
      return desired;
    },
  };
}
