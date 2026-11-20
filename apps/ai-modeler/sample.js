// 木製スツール（座面は縁を丸めた円盤、脚4本は下に向かって少し外へ開く、貫で補強）
const H = 0.45;   // 座面の高さ
const R = 0.175;  // 座面の半径
const T = 0.035;  // 座面の厚み

// 座面：断面を回して作る。seg は4の倍数なので上下のフタも四角形のグリッドになる
const seat = M.lathe('Seat', [
  [R - 0.012, H - T],
  [R - 0.004, H - T + 0.002],
  [R,         H - T + 0.010],
  [R,         H - 0.010],
  [R - 0.004, H - 0.002],
  [R - 0.012, H],
], { seg: 32 });

// 脚：高さ方向に断面を並べて loft でつなぐ（上が細く、下ほど外へ）
const yTop = H - T;
const topOff = 0.11, footOff = 0.15;
const legPos = (t, sx, sz) => {
  const d = (footOff + (topOff - footOff) * t) / Math.SQRT2;
  return [sx * d, sz * d];
};
const corners = [[1, 1, 'Leg_FR'], [-1, 1, 'Leg_FL'], [1, -1, 'Leg_BR'], [-1, -1, 'Leg_BL']];
const legs = corners.map(([sx, sz, name]) => {
  const sections = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, y = yTop * t;
    const r = 0.016 - 0.003 * t;
    const [cx, cz] = legPos(t, sx, sz);
    sections.push(M.circle(8, r, y).map(([x, yy, z]) => [x + cx, yy, z + cz]));
  }
  return M.loft(name, sections, { capStart: true, capEnd: true });
});

// 貫（ぬき）：前後は低め、左右は高めにして交差を避ける
const rung = (name, y, alongX, side) => {
  const t = y / yTop;
  const [cx, cz] = legPos(t, 1, 1);
  const len = 2 * (alongX ? cx : cz);
  const m = M.cylinder(name, { r: 0.008, h: len, seg: 8, rows: 6 });
  if (alongX) m.rotate(0, 0, 90).translate(0, y, side * cz);
  else m.rotate(90, 0, 0).translate(side * cx, y, 0);
  return m;
};
const rungs = [
  rung('Rung_F', 0.15, true, 1), rung('Rung_B', 0.15, true, -1),
  rung('Rung_R', 0.19, false, 1), rung('Rung_L', 0.19, false, -1),
];

return [seat, ...legs, ...rungs];
