import type { Geo, TypedArray } from "./types";

/**
 * スタックの各段でGeoの点数がこれを超えないようクランプする。
 * scatter等、点を増やすノードが際限なく重くなるのを防ぐための安全弁で、
 * 最終出力だけでなく評価エンジンが各ノードの結果に対して都度かける
 * （eval/evaluate.ts）。以降のノードはこの上限内のGeoしか受け取らないため、
 * スタックを流れるほど負荷が積み上がることはない。
 */
export const MAX_POINTS = 200;

function sameKindArray(v: TypedArray, length: number): TypedArray {
  if (v instanceof Float32Array) return new Float32Array(length);
  if (v instanceof Uint32Array) return new Uint32Array(length);
  if (v instanceof Uint16Array) return new Uint16Array(length);
  if (v instanceof Int32Array) return new Int32Array(length);
  return new Uint8Array(length);
}

export function clampGeoToPointBudget(geo: Geo, maxPoints: number = MAX_POINTS): Geo {
  const n = geo.points.length / 3;
  if (n <= maxPoints) return geo;

  const points = geo.points.slice(0, maxPoints * 3) as Float32Array;

  const point: Record<string, TypedArray> = {};
  for (const [k, v] of Object.entries(geo.attribs.point)) {
    const stride = v.length / n;
    point[k] = v.slice(0, maxPoints * stride);
  }

  // 切り捨てた点を参照する三角形(とそのprimアトリビュート)は落とす
  const triCount = geo.indices.length / 3;
  const keptTris: number[] = [];
  const keptIndices: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 3;
    const a = geo.indices[o], b = geo.indices[o + 1], c = geo.indices[o + 2];
    if (a < maxPoints && b < maxPoints && c < maxPoints) {
      keptTris.push(t);
      keptIndices.push(a, b, c);
    }
  }

  const prim: Record<string, TypedArray> = {};
  for (const [k, v] of Object.entries(geo.attribs.prim)) {
    const stride = v.length / triCount;
    const out = sameKindArray(v, keptTris.length * stride);
    keptTris.forEach((t, i) => {
      for (let s = 0; s < stride; s++) out[i * stride + s] = v[t * stride + s];
    });
    prim[k] = out;
  }

  return {
    points,
    indices: new Uint32Array(keptIndices),
    attribs: { point, prim, detail: geo.attribs.detail },
    groups: geo.groups,
  };
}
