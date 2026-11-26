import { QuadstreamLoader } from "./loader.js";
import type { QuadstreamSession } from "./session.js";
import type { QueryOptions, Bounds } from "./types.js";
export type MapQuery = Omit<QueryOptions, "validate">;
export interface MapFrame {
  result: ReturnType<QuadstreamSession["query"]>;
  targetLevel: number;
  final: boolean;
  loadedPartitions: number;
  totalPartitions: number;
}
export interface ProgressiveMapClient {
  request(query: MapQuery, onFrame: (frame: MapFrame) => void): Promise<void>;
  cancel(): void;
}
function aborted(): Error {
  const e = new Error("Map request cancelled");
  e.name = "AbortError";
  return e;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
/** Staged, renderer-independent queries. Partial frames explicitly report omissions. */
export class ProgressiveMap implements ProgressiveMapClient {
  private active?: AbortController;
  private readonly retries: number;
  private readonly retryDelay: number;
  constructor(
    readonly loader: QuadstreamLoader,
    options: { retries?: number; retryDelayMs?: number } = {},
  ) {
    this.retries = options.retries ?? 2;
    this.retryDelay = options.retryDelayMs ?? 100;
    if (
      !Number.isInteger(this.retries) ||
      this.retries < 0 ||
      this.retries > 5 ||
      !Number.isFinite(this.retryDelay) ||
      this.retryDelay < 0 ||
      this.retryDelay > 5000
    )
      throw new Error("Invalid retry options");
  }
  cancel(): void {
    this.active?.abort();
    this.active = undefined;
  }
  async request(
    query: MapQuery,
    onFrame: (frame: MapFrame) => void,
  ): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    const { signal } = controller,
      session = this.loader.session;
    const target = query.level ?? session.manifest.maxLevel - 1;
    const bounds: Bounds | undefined = query.bounds
      ? [...query.bounds]
      : undefined;
    const check = () => {
      if (signal.aborted || this.active !== controller) throw aborted();
    };
    const ensure = async (level: number) => {
      for (let attempt = 0; ; attempt++) {
        check();
        try {
          await this.loader.ensureLevel(level, { signal });
          check();
          return;
        } catch (error) {
          check();
          if (attempt >= this.retries) throw error;
          await delay(this.retryDelay * 2 ** attempt, signal);
        }
      }
    };
    const emit = (level: number, final: boolean) => {
      check();
      const result = session.query({ level, bounds });
      if (final && !result.complete)
        throw new Error("Incomplete final geometry");
      onFrame({
        result,
        targetLevel: target,
        final,
        loadedPartitions: session.loadedKeys.length,
        totalPartitions: session.manifest.partitions.length,
      });
      check();
    };
    try {
      session.missingKeys(target);
      session.query({ level: target, bounds }); // validate bounds before fetching
      for (const level of [...new Set([0, Math.floor(target / 2), target])]) {
        await ensure(level);
        const global = session.query({ level });
        if (level === target) {
          if (!global.complete) {
            emit(level, false);
            await ensure(session.manifest.maxLevel - 1);
            if (!session.query({ level }).complete)
              throw new Error("Incomplete global geometry");
          }
          emit(level, true);
        } else emit(level, false);
      }
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  }
}
