import { emptyGeo } from "../geo/empty";
import { pushQuad } from "../geo/helpers";
import type { NodeDef } from "./types";

export const box: NodeDef = {
  label: "Box",
  generator: true,
  params: [
    { k: "size", label: "Size", type: "vec", def: [1, 1, 1], step: 0.01, min: 0.001 },
    { k: "center", label: "Center", type: "vec", def: [0, 0, 0], step: 0.01 },
  ],
  compute(_inputs, p) {
    const size = p.size as number[];
    const center = p.center as number[];
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const [cx, cy, cz] = center;
    const P: number[] = [];
    const N: number[] = [];
    const I: number[] = [];
    pushQuad(P, N, I, [cx + hx, cy, cz], [0, hy, 0], [0, 0, hz], [1, 0, 0]);
    pushQuad(P, N, I, [cx - hx, cy, cz], [0, 0, hz], [0, hy, 0], [-1, 0, 0]);
    pushQuad(P, N, I, [cx, cy + hy, cz], [0, 0, hz], [hx, 0, 0], [0, 1, 0]);
    pushQuad(P, N, I, [cx, cy - hy, cz], [hx, 0, 0], [0, 0, hz], [0, -1, 0]);
    pushQuad(P, N, I, [cx, cy, cz + hz], [hx, 0, 0], [0, hy, 0], [0, 0, 1]);
    pushQuad(P, N, I, [cx, cy, cz - hz], [0, hy, 0], [hx, 0, 0], [0, 0, -1]);
    const geo = emptyGeo();
    geo.points = new Float32Array(P);
    geo.indices = new Uint32Array(I);
    geo.attribs.point.N = new Float32Array(N);
    return geo;
  },
};
