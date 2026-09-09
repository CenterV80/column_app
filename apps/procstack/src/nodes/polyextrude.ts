import { emptyGeo } from "../geo/empty";
import { computeVertexNormals } from "../geo/helpers";
import type { NodeDef } from "./types";

/**
 * まずは全面押し出しのみ(グループ対応は後)。
 * 全ての点を頂点法線方向にdistanceだけオフセットした複製("front")を作り、
 * 元の面("back", 裏返し)とオフセット面("front")を残したまま、
 * 開いた境界エッジ(隣接三角形が1つしかないエッジ)だけを側面で繋ぐ。
 * 閉じたメッシュ(Boxなど)は境界エッジが無いため側面は生成されず、
 * 二重殻のシェルになる。
 */
export const polyextrude: NodeDef = {
  label: "Poly Extrude",
  params: [{ k: "dist", label: "Distance", type: "float", def: 0.2, step: 0.01 }],
  compute(inputs, p) {
    const src = inputs[0];
    if (!src) return emptyGeo();
    if (src.indices.length === 0) return src; // 面がない(点群)Geoは何もしない

    const dist = p.dist as number;
    const n = src.points.length / 3;
    const N = (src.attribs.point.N as Float32Array | undefined) ?? computeVertexNormals(src.points, src.indices);

    const points = new Float32Array(n * 2 * 3);
    points.set(src.points, 0);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      points[n * 3 + o] = src.points[o] + N[o] * dist;
      points[n * 3 + o + 1] = src.points[o + 1] + N[o + 1] * dist;
      points[n * 3 + o + 2] = src.points[o + 2] + N[o + 2] * dist;
    }

    const indices: number[] = [];
    // back面: 元の三角形を裏返して積む
    for (let i = 0; i < src.indices.length; i += 3) {
      indices.push(src.indices[i], src.indices[i + 2], src.indices[i + 1]);
    }
    // front面: オフセット後の三角形をそのまま積む
    for (let i = 0; i < src.indices.length; i += 3) {
      indices.push(src.indices[i] + n, src.indices[i + 1] + n, src.indices[i + 2] + n);
    }

    // 境界エッジ(逆向きの有向エッジが存在しない=隣接三角形が無い辺)を側面で繋ぐ
    const directed = new Set<string>();
    for (let i = 0; i < src.indices.length; i += 3) {
      const tri = [src.indices[i], src.indices[i + 1], src.indices[i + 2]];
      for (let e = 0; e < 3; e++) directed.add(`${tri[e]}_${tri[(e + 1) % 3]}`);
    }
    for (let i = 0; i < src.indices.length; i += 3) {
      const tri = [src.indices[i], src.indices[i + 1], src.indices[i + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        if (directed.has(`${b}_${a}`)) continue; // 内部エッジ
        const aF = a + n, bF = b + n;
        indices.push(a, b, bF);
        indices.push(a, bF, aF);
      }
    }

    const geo = emptyGeo();
    geo.points = points;
    geo.indices = new Uint32Array(indices);
    // 形状が変わるため法線はViewport側のcomputeVertexNormalsフォールバックに任せる
    return geo;
  },
};
