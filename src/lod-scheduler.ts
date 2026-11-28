export interface LatestGeometryOptions<T> {
  request: (level: number) => Promise<T>;
  onFrame: (frame: T) => void;
  onError?: (error: unknown) => void;
  cacheCapacity?: number;
}
// Compare against the current target, not the target at dispatch time.
// A first frame is useful; subsequent frames must strictly reduce LOD error.
export function improvesLod(
  level: number,
  rendered: number | null,
  target: number | null,
) {
  return (
    target != null &&
    (rendered == null || Math.abs(level - target) < Math.abs(rendered - target))
  );
}

// Completion-driven throttle: one active query, one replaceable desired level.
// Completed obsolete frames remain cached but cannot regress visible detail.
export function createLatestGeometry<T extends { seq?: number }>({
  request,
  onFrame,
  onError = () => {},
  cacheCapacity = 4,
}: LatestGeometryOptions<T>) {
  if (!Number.isInteger(cacheCapacity) || cacheCapacity < 0)
    throw new Error("Invalid cache capacity");
  let generation = 0,
    lastSeq = 0,
    desired: number | null = null,
    rendered: number | null = null,
    running = false,
    disposed = false;
  const cache = new Map<number, T>();

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
            if (cache.size > cacheCapacity)
              cache.delete(cache.keys().next().value!);
          }
          if (improvesLod(level, rendered, desired)) {
            rendered = level;
            onFrame(frame);
          }
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
    async select(level: number) {
      if (!Number.isFinite(level)) throw new Error("Invalid LOD");
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
