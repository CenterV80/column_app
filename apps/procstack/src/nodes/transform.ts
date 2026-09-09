import { emptyGeo } from "../geo/empty";
import type { NodeDef } from "./types";

export const transform: NodeDef = {
  label: "Transform",
  params: [
    { k: "t", label: "Translate", type: "vec", def: [0, 0, 0], step: 0.01 },
    { k: "r", label: "Rotate", type: "vec", def: [0, 0, 0], step: 1 },
    { k: "s", label: "Scale", type: "vec", def: [1, 1, 1], step: 0.01 },
  ],
  compute(inputs, p) {
    const src = inputs[0];
    if (!src) return emptyGeo();
    const t = p.t as number[];
    const r = p.r as number[];
    const s = p.s as number[];
    const d = Math.PI / 180;
    const [x, y, z] = [r[0] * d, r[1] * d, r[2] * d];
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    // R = Rz * Ry * Rx
    const m = [
      cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy,     cy * sx,                cy * cx,
    ];
    const n = src.points.length / 3;
    const P = new Float32Array(n * 3);
    const srcN = src.attribs.point.N;
    const N = srcN ? new Float32Array(n * 3) : null;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const vx = src.points[o] * s[0];
      const vy = src.points[o + 1] * s[1];
      const vz = src.points[o + 2] * s[2];
      P[o]     = m[0] * vx + m[1] * vy + m[2] * vz + t[0];
      P[o + 1] = m[3] * vx + m[4] * vy + m[5] * vz + t[1];
      P[o + 2] = m[6] * vx + m[7] * vy + m[8] * vz + t[2];
      if (N) {
        const ax = srcN[o], ay = srcN[o + 1], az = srcN[o + 2];
        N[o]     = m[0] * ax + m[1] * ay + m[2] * az;
        N[o + 1] = m[3] * ax + m[4] * ay + m[5] * az;
        N[o + 2] = m[6] * ax + m[7] * ay + m[8] * az;
      }
    }
    const geo = emptyGeo();
    geo.points = P;
    geo.indices = src.indices;
    geo.attribs.point = N ? { ...src.attribs.point, N } : { ...src.attribs.point };
    geo.attribs.prim = src.attribs.prim;
    geo.groups = src.groups;
    return geo;
  },
};
