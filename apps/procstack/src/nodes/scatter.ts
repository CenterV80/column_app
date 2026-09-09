import { emptyGeo } from "../geo/empty";
import { mulberry32 } from "./rng";
import type { NodeDef } from "./types";

/**
 * 面積加重で三角形上にランダムな点を撒く。出力はindices空の点群Geo。
 * N(面法線)とpscaleをpoint属性に載せる。
 */
export const scatter: NodeDef = {
  label: "Scatter",
  params: [
    { k: "count", label: "Count", type: "float", def: 50, step: 1, int: true, min: 0, max: 2000 },
    { k: "pscale", label: "Pscale", type: "float", def: 0.05, step: 0.005, min: 0 },
    { k: "seed", label: "Seed", type: "float", def: 0, step: 1, int: true },
  ],
  compute(inputs, p) {
    const src = inputs[0];
    if (!src || src.indices.length === 0) return emptyGeo();

    const count = Math.max(0, Math.floor(p.count as number));
    const pscale = p.pscale as number;
    const seed = p.seed as number;
    if (count === 0) return emptyGeo();

    const triCount = src.indices.length / 3;
    const cumulative = new Float64Array(triCount);
    const faceN = new Float32Array(triCount * 3);
    let total = 0;
    for (let t = 0; t < triCount; t++) {
      const ia = src.indices[t * 3] * 3, ib = src.indices[t * 3 + 1] * 3, ic = src.indices[t * 3 + 2] * 3;
      const ax = src.points[ia], ay = src.points[ia + 1], az = src.points[ia + 2];
      const ux = src.points[ib] - ax, uy = src.points[ib + 1] - ay, uz = src.points[ib + 2] - az;
      const vx = src.points[ic] - ax, vy = src.points[ic + 1] - ay, vz = src.points[ic + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      total += len * 0.5;
      cumulative[t] = total;
      faceN[t * 3] = len > 0 ? nx / len : 0;
      faceN[t * 3 + 1] = len > 0 ? ny / len : 0;
      faceN[t * 3 + 2] = len > 0 ? nz / len : 0;
    }
    if (total <= 0) return emptyGeo();

    const rng = mulberry32(seed);
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const S = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // 面積の累積分布から三角形を1つ選ぶ(二分探索)
      const r = rng() * total;
      let lo = 0, hi = triCount - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      const t = lo;
      const ia = src.indices[t * 3] * 3, ib = src.indices[t * 3 + 1] * 3, ic = src.indices[t * 3 + 2] * 3;

      // 三角形内の一様なランダム点(sqrt法によるバリセントリック座標)
      const r1 = Math.sqrt(rng());
      const r2 = rng();
      const a = 1 - r1, b = r1 * (1 - r2), c = r1 * r2;

      const o = i * 3;
      P[o] = a * src.points[ia] + b * src.points[ib] + c * src.points[ic];
      P[o + 1] = a * src.points[ia + 1] + b * src.points[ib + 1] + c * src.points[ic + 1];
      P[o + 2] = a * src.points[ia + 2] + b * src.points[ib + 2] + c * src.points[ic + 2];
      N[o] = faceN[t * 3];
      N[o + 1] = faceN[t * 3 + 1];
      N[o + 2] = faceN[t * 3 + 2];
      S[i] = pscale;
    }

    const geo = emptyGeo();
    geo.points = P;
    geo.attribs.point.N = N;
    geo.attribs.point.pscale = S;
    return geo;
  },
};
