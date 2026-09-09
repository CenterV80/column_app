import type { Geo, TypedArray } from "./types";

/**
 * Worker → メインスレッドへ Geo を渡す前に TypedArray を複製する。
 * 評価エンジンのキャッシュは同じ Geo インスタンスを再利用するため、
 * transferable でそのまま転送すると ArrayBuffer が detach されキャッシュが壊れる。
 * 複製したバッファだけを transfer list に載せてゼロコピー転送する。
 */
export function cloneGeoForTransfer(geo: Geo | null): { geo: Geo | null; buffers: ArrayBuffer[] } {
  if (!geo) return { geo: null, buffers: [] };
  const buffers: ArrayBuffer[] = [];

  function cloneTA<T extends TypedArray>(ta: T): T {
    const copy = ta.slice() as T;
    buffers.push(copy.buffer as ArrayBuffer);
    return copy;
  }

  function cloneRecord(rec: Record<string, TypedArray>): Record<string, TypedArray> {
    const out: Record<string, TypedArray> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = cloneTA(v);
    return out;
  }

  const points = cloneTA(geo.points);
  const indices = cloneTA(geo.indices);
  const point = cloneRecord(geo.attribs.point);
  const prim = cloneRecord(geo.attribs.prim);
  const groups: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(geo.groups)) groups[k] = cloneTA(v);

  const cloned: Geo = {
    points,
    indices,
    attribs: { point, prim, detail: geo.attribs.detail },
    groups,
  };
  return { geo: cloned, buffers };
}
