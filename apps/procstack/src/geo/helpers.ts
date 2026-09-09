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
