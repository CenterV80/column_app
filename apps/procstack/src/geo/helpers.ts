type Vec3 = readonly [number, number, number];

/** 面を1枚積む。u × v = normal の順で渡すと表向きになる */
export function pushQuad(
  P: number[],
  N: number[],
  I: number[],
  center: Vec3,
  u: Vec3,
  v: Vec3,
  n: Vec3
) {
  const base = P.length / 3;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [su, sv] of corners) {
    P.push(
      center[0] + u[0] * su + v[0] * sv,
      center[1] + u[1] * su + v[1] * sv,
      center[2] + u[2] * su + v[2] * sv
    );
    N.push(n[0], n[1], n[2]);
  }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** 面法線を頂点ごとに平均した頂点法線を計算する(N属性が無い入力向けのフォールバック)。 */
export function computeVertexNormals(points: Float32Array, indices: Uint32Array): Float32Array {
  const n = points.length / 3;
  const N = new Float32Array(n * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = points[ia], ay = points[ia + 1], az = points[ia + 2];
    const ux = points[ib] - ax, uy = points[ib + 1] - ay, uz = points[ib + 2] - az;
    const vx = points[ic] - ax, vy = points[ic + 1] - ay, vz = points[ic + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    N[ia] += nx; N[ia + 1] += ny; N[ia + 2] += nz;
    N[ib] += nx; N[ib + 1] += ny; N[ib + 2] += nz;
    N[ic] += nx; N[ic + 1] += ny; N[ic + 2] += nz;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const len = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
    N[o] /= len; N[o + 1] /= len; N[o + 2] /= len;
  }
  return N;
}
