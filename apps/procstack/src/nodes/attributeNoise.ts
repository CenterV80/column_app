import { createNoise3D } from "simplex-noise";
import { emptyGeo } from "../geo/empty";
import type { NodeDef } from "./types";

/** paramsのseedから決定的なPRNGを作る(同じseedなら常に同じノイズ場になる)。 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const attributeNoise: NodeDef = {
  label: "Attribute Noise",
  params: [
    { k: "amp", label: "Amplitude", type: "float", def: 0.1, step: 0.01, min: 0 },
    { k: "freq", label: "Frequency", type: "float", def: 1, step: 0.01, min: 0.001 },
    { k: "seed", label: "Seed", type: "float", def: 0, step: 1, int: true },
  ],
  compute(inputs, p) {
    const src = inputs[0];
    if (!src) return emptyGeo();

    const amp = p.amp as number;
    const freq = p.freq as number;
    const seed = p.seed as number;
    const noise3D = createNoise3D(mulberry32(seed));

    const n = src.points.length / 3;
    const P = new Float32Array(src.points);
    const srcN = src.attribs.point.N as Float32Array | undefined;

    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const nx = src.points[o] * freq;
      const ny = src.points[o + 1] * freq;
      const nz = src.points[o + 2] * freq;
      if (srcN) {
        // 法線方向に変位させる(いわゆるHoudiniのmountain SOP的な凹凸)
        const d = noise3D(nx, ny, nz) * amp;
        P[o] += srcN[o] * d;
        P[o + 1] += srcN[o + 1] * d;
        P[o + 2] += srcN[o + 2] * d;
      } else {
        // 法線がない Geo(点群など)は軸ごとに別位相のノイズで変位する
        P[o] += noise3D(nx, ny, nz) * amp;
        P[o + 1] += noise3D(nx + 37.1, ny, nz) * amp;
        P[o + 2] += noise3D(nx, ny + 71.3, nz) * amp;
      }
    }

    const geo = emptyGeo();
    geo.points = P;
    geo.indices = src.indices;
    geo.attribs.point = { ...src.attribs.point };
    // 変位後は元のNが実形状とズレるため外す。Viewport側はN不在ならcomputeVertexNormalsする。
    delete geo.attribs.point.N;
    geo.attribs.prim = src.attribs.prim;
    geo.groups = src.groups;
    return geo;
  },
};
