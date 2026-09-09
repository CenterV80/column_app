import { emptyGeo } from "../geo/empty";
import type { NodeDef } from "./types";

export const grid: NodeDef = {
  label: "Grid",
  generator: true,
  params: [
    { k: "size", label: "Size", type: "vec", def: [2, 2], step: 0.01, min: 0.001 },
    { k: "divs", label: "Divisions", type: "vec", def: [10, 10], step: 1, int: true, min: 1 },
  ],
  compute(_inputs, p) {
    const size = p.size as number[];
    const divs = p.divs as number[];
    const nx = Math.max(1, divs[0] | 0);
    const nz = Math.max(1, divs[1] | 0);
    const sx = size[0];
    const sz = size[1];
    const P = new Float32Array((nx + 1) * (nz + 1) * 3);
    const N = new Float32Array((nx + 1) * (nz + 1) * 3);
    const I = new Uint32Array(nx * nz * 6);
    let o = 0;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        P[o] = (i / nx - 0.5) * sx;
        P[o + 1] = 0;
        P[o + 2] = (j / nz - 0.5) * sz;
        N[o + 1] = 1;
        o += 3;
      }
    }
    let k = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        I[k++] = a; I[k++] = c; I[k++] = d;
        I[k++] = a; I[k++] = d; I[k++] = b;
      }
    }
    const geo = emptyGeo();
    geo.points = P;
    geo.indices = I;
    geo.attribs.point.N = N;
    return geo;
  },
};
