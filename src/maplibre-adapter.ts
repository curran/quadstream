import type { MapFrame, ProgressiveMapClient } from "./progressive-map.js";
import type { Bounds, FeatureCollection } from "./types.js";
interface MapBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}
export interface MapLibreLike {
  getZoom(): number;
  getBounds(): MapBounds;
  getSource(id: string): unknown;
  on(event: "movestart" | "moveend", listener: () => void): unknown;
  off(event: "movestart" | "moveend", listener: () => void): unknown;
}
export interface MapLibreAdapterOptions {
  sourceId: string;
  maxLevel: number;
  levelForZoom?: (zoom: number) => number;
  onFrame?: (frame: MapFrame) => void;
  onError?: (error: unknown) => void;
  onLoading?: () => void;
}
/** Conservative global query for wrap, invalid bounds or dateline crossing. */
export function mapLibreBounds(b: MapBounds): Bounds | undefined {
  const w = b.getWest(),
    s = b.getSouth(),
    e = b.getEast(),
    n = b.getNorth();
  if (
    ![w, s, e, n].every(Number.isFinite) ||
    w < -180 ||
    e > 180 ||
    w > e ||
    e - w >= 360 ||
    s > n ||
    s > 90 ||
    n < -90
  )
    return undefined;
  return [w, Math.max(-90, s), e, Math.min(90, n)];
}
export function attachMapLibre(
  map: MapLibreLike,
  client: ProgressiveMapClient,
  options: MapLibreAdapterOptions,
) {
  if (
    !Number.isInteger(options.maxLevel) ||
    options.maxLevel < 1 ||
    options.maxLevel > 26
  )
    throw new Error("Invalid maxLevel");
  let generation = 0,
    disposed = false;
  const source = () => {
    const value = map.getSource(options.sourceId) as
      { setData(data: FeatureCollection): unknown } | undefined;
    if (!value || typeof value.setData !== "function")
      throw new Error("GeoJSON source missing: " + options.sourceId);
    return value;
  };
  source();
  const clear = () =>
    source().setData({ type: "FeatureCollection", features: [] });
  const moving = () => {
    ++generation;
    client.cancel();
    try {
      clear();
      options.onLoading?.();
    } catch (error) {
      options.onError?.(error);
    }
  };
  const refresh = async () => {
    if (disposed) return;
    const id = ++generation;
    client.cancel();
    try {
      clear();
      options.onLoading?.();
      const zoom = map.getZoom(),
        level = options.levelForZoom?.(zoom) ?? Math.floor(zoom + 2);
      if (!Number.isFinite(level)) throw new Error("Invalid detail level");
      await client.request(
        {
          level: Math.max(0, Math.min(options.maxLevel - 1, Math.floor(level))),
          bounds: mapLibreBounds(map.getBounds()),
        },
        (frame) => {
          if (disposed || id !== generation) return;
          source().setData(frame.result.geojson);
          options.onFrame?.(frame);
        },
      );
    } catch (error) {
      if (!disposed && id === generation) options.onError?.(error);
    }
  };
  const moved = () => {
    void refresh();
  };
  map.on("movestart", moving);
  map.on("moveend", moved);
  void refresh();
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      client.cancel();
      map.off("movestart", moving);
      map.off("moveend", moved);
    },
  };
}
