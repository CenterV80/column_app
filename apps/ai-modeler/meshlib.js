// meshlib.js — 四角ポリゴン主体のメッシュを組み立てる小さなライブラリ
//
// AI が書くスクリプトはこのライブラリ（M と Mesh）だけを使って形を作る。
// 座標は Y が上、単位はメートル。面の頂点は「外側から見て反時計回り」。

const EPS = 1e-9;

// ------------------------------------------------------------------ ベクトル
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > EPS ? mul(a, 1 / l) : [0, 0, 0]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const avg = pts => { const s = [0, 0, 0]; for (const p of pts) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return mul(s, 1 / Math.max(pts.length, 1)); };
const ekey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

// 多角形の法線（Newell 法。非平面の四角形でも安定）
function faceNormal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n; // 長さ = 面積の2倍
}

// ------------------------------------------------------------------ Mesh
export class Mesh {
  constructor(name = 'Mesh') {
    this.name = String(name);
    this.verts = [];        // [[x,y,z], ...]
    this.faces = [];        // [[i,j,k,l], ...]
    this.creases = new Set(); // サブディビジョンで角を立てる辺（"a_b"）
  }

  /** 頂点を追加して番号を返す */
  v(x, y, z) {
    if (Array.isArray(x)) [x, y, z] = x;
    if (![x, y, z].every(Number.isFinite)) throw new Error(`頂点の座標が数値ではありません: ${x}, ${y}, ${z}`);
    this.verts.push([x, y, z]);
    return this.verts.length - 1;
  }

  /** 面を追加して番号を返す（外側から見て反時計回り） */
  f(...idx) {
    if (idx.length === 1 && Array.isArray(idx[0])) idx = idx[0];
    if (idx.length < 3) throw new Error('面には3つ以上の頂点が必要です');
    for (const i of idx) {
      if (!Number.isInteger(i) || i < 0 || i >= this.verts.length) throw new Error(`存在しない頂点番号です: ${i}`);
    }
    this.faces.push(idx.slice());
    return this.faces.length - 1;
  }

  /** 辺に折り目を付ける（subdivide で丸まらない） */
  crease(a, b) { this.creases.add(ekey(a, b)); return this; }

  clone(name = this.name) {
    const m = new Mesh(name);
    m.verts = this.verts.map(p => p.slice());
    m.faces = this.faces.map(f => f.slice());
    m.creases = new Set(this.creases);
    return m;
  }

  /** 別のメッシュを取り込む（1つのオブジェクトにまとめる） */
  append(...others) {
    for (const o of others) {
      const off = this.verts.length;
      for (const p of o.verts) this.verts.push(p.slice());
      for (const f of o.faces) this.faces.push(f.map(i => i + off));
      for (const k of o.creases) { const [a, b] = k.split('_').map(Number); this.creases.add(ekey(a + off, b + off)); }
    }
    return this;
  }

  /** 全頂点に関数を適用する: m.map(([x,y,z]) => [x, y + 1, z]) */
  map(fn) { this.verts = this.verts.map((p, i) => { const q = fn(p.slice(), i); return [q[0], q[1], q[2]]; }); return this; }

  translate(x = 0, y = 0, z = 0) { if (Array.isArray(x)) [x, y, z] = x; return this.map(p => [p[0] + x, p[1] + y, p[2] + z]); }

  scale(x = 1, y = x, z = x) {
    if (Array.isArray(x)) [x, y, z] = x;
    this.map(p => [p[0] * x, p[1] * y, p[2] * z]);
    if (x * y * z < 0) this.flip(); // 裏返る拡大縮小なら面の向きを戻す
    return this;
  }

  /** 回転（度）。X → Y → Z の順 */
  rotate(rx = 0, ry = 0, rz = 0) {
    if (Array.isArray(rx)) [rx, ry, rz] = rx;
    const r = Math.PI / 180;
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * r), Math.sin(rx * r), Math.cos(ry * r), Math.sin(ry * r), Math.cos(rz * r), Math.sin(rz * r)];
    return this.map(([x, y, z]) => {
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      return [x, y, z];
    });
  }

  /** 面の向きをすべて反転 */
  flip() { this.faces.forEach(f => f.reverse()); return this; }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.verts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    return { min, max, size: sub(max, min), center: lerp(min, max, 0.5) };
  }

  faceCenter(fi) { return avg(this.faces[fi].map(i => this.verts[i])); }
  faceNormal(fi) { return norm(faceNormal(this.faces[fi].map(i => this.verts[i]))); }

  /** 条件に合う面の番号を返す: m.select((center, normal) => normal[1] > 0.9) */
  select(fn) {
    const out = [];
    this.faces.forEach((f, i) => { if (fn(this.faceCenter(i), this.faceNormal(i), i)) out.push(i); });
    return out;
  }
}

// ------------------------------------------------------------------ 基本操作

/** 同じ位置の頂点をまとめ、つぶれた面を消す */
export function weld(m, eps = 1e-6) {
  const map = new Map(), remap = new Array(m.verts.length), verts = [];
  const q = v => Math.round(v / eps);
  m.verts.forEach((p, i) => {
    let found = -1;
    const kx = q(p[0]), ky = q(p[1]), kz = q(p[2]);
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      const list = map.get(`${kx + dx},${ky + dy},${kz + dz}`);
      if (list) for (const j of list) if (len(sub(verts[j], p)) <= eps) { found = j; break; }
    }
    if (found < 0) {
      found = verts.length; verts.push(p.slice());
      const k = `${kx},${ky},${kz}`; if (!map.has(k)) map.set(k, []); map.get(k).push(found);
    }
    remap[i] = found;
  });
  const faces = [];
  for (const f of m.faces) {
    const g = [];
    for (const i of f.map(i => remap[i])) if (g[g.length - 1] !== i) g.push(i);
    while (g.length > 1 && g[0] === g[g.length - 1]) g.pop();
    if (g.length >= 3 && new Set(g).size === g.length) faces.push(g);
  }
  const creases = new Set();
  for (const k of m.creases) { const [a, b] = k.split('_').map(Number); if (remap[a] !== remap[b]) creases.add(ekey(remap[a], remap[b])); }
  m.verts = verts; m.faces = faces; m.creases = creases;
  return m;
}

/** 面の向きをそろえ、閉じた部分は外向きにする */
export function orient(m) {
  const edges = new Map();
  m.faces.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = ekey(a, b);
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([fi, a < b ? 1 : -1]);
  }));
  const sign = new Array(m.faces.length).fill(0);
  for (let s = 0; s < m.faces.length; s++) {
    if (sign[s]) continue;
    sign[s] = 1;
    const comp = [s], stack = [s];
    let closed = true;
    while (stack.length) {
      const fi = stack.pop(), f = m.faces[fi];
      f.forEach((a, k) => {
        const b = f[(k + 1) % f.length], list = edges.get(ekey(a, b));
        if (list.length === 1) closed = false;
        if (list.length !== 2) return;
        const me = list.find(x => x[0] === fi) || list[0];
        const other = list.find(x => x[0] !== fi);
        if (!other || sign[other[0]]) return;
        sign[other[0]] = -me[1] * sign[fi] * other[1];
        comp.push(other[0]); stack.push(other[0]);
      });
    }
    for (const fi of comp) if (sign[fi] < 0) { m.faces[fi].reverse(); sign[fi] = 1; }
    if (closed && signedVolume(m, comp) < 0) for (const fi of comp) m.faces[fi].reverse();
  }
  return m;
}

function signedVolume(m, faceIdx) {
  let v = 0;
  for (const fi of faceIdx) {
    const f = m.faces[fi], p0 = m.verts[f[0]];
    for (let k = 1; k < f.length - 1; k++) v += dot(p0, cross(m.verts[f[k]], m.verts[f[k + 1]])) / 6;
  }
  return v;
}

/** 2つの頂点ループを四角形でつなぐ（同じ数・同じ向き） */
export function bridge(m, ringA, ringB, closed = true) {
  if (ringA.length !== ringB.length) throw new Error(`bridge: 頂点数が違います (${ringA.length} と ${ringB.length})`);
  const n = ringA.length, out = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    out.push(m.f(ringA[i], ringA[j], ringB[j], ringB[i]));
  }
  return out;
}

/**
 * 閉じた頂点ループを面でふさぐ。頂点数が4の倍数なら四角形のグリッド、
 * それ以外は中心から三角形を張る。戻り値は作った面の番号。
 * ループの並びに対して反時計回りに見える側が表になる。
 */
export function fill(m, ring, { relax = 30 } = {}) {
  const n = ring.length;
  if (n < 3) throw new Error('fill: 頂点が足りません');
  if (n === 4) return [m.f(...ring)];
  const B = ring.map(i => m.verts[i]);
  const c = avg(B);
  if (n % 4 !== 0) {
    const ci = m.v(...c);
    return ring.map((a, k) => m.f(a, ring[(k + 1) % n], ci));
  }
  const k = n / 4;
  // 正方形グリッド (k+1)×(k+1) の外周をループに、内側は放射状に置いてから均す
  const id = [];
  // u,v は 0..k。中心を原点とする座標 s∈[-1,1] に直す
  for (let u = 0; u <= k; u++) {
    id[u] = [];
    for (let v = 0; v <= k; v++) {
      if (u === 0 || v === 0 || u === k || v === k) {
        // 外周: (k,0) の角から反時計回りにループの番号を割り当てる
        let t;
        if (u === k) t = v;
        else if (v === k) t = k + (k - u);
        else if (u === 0) t = 2 * k + (k - v);
        else t = 3 * k + u;
        id[u][v] = ring[t % n];
      } else {
        const su = (u / k) * 2 - 1, sv = (v / k) * 2 - 1;
        const s = Math.max(Math.abs(su), Math.abs(sv));
        if (s < 1e-9) { id[u][v] = m.v(...c); continue; }
        // 正方形上の外周パラメータ t（0..n）
        const qu = su / s, qv = sv / s;
        let t;
        if (qu >= 1 - 1e-9) t = (qv + 1) / 2 * k;
        else if (qv >= 1 - 1e-9) t = k + (1 - qu) / 2 * k;
        else if (qu <= -1 + 1e-9) t = 2 * k + (1 - qv) / 2 * k;
        else t = 3 * k + (qu + 1) / 2 * k;
        const t0 = Math.floor(t) % n, t1 = (t0 + 1) % n, ft = t - Math.floor(t);
        const b = lerp(B[t0], B[t1], ft);
        id[u][v] = m.v(...lerp(c, b, s));
      }
    }
  }
  // 内側の頂点をラプラシアンで均す（外周は固定）
  for (let it = 0; it < relax; it++) {
    for (let u = 1; u < k; u++) for (let v = 1; v < k; v++) {
      const p = avg([m.verts[id[u - 1][v]], m.verts[id[u + 1][v]], m.verts[id[u][v - 1]], m.verts[id[u][v + 1]]]);
      m.verts[id[u][v]] = p;
    }
  }
  const out = [];
  for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) {
    out.push(m.f(id[u][v], id[u + 1][v], id[u + 1][v + 1], id[u][v + 1]));
  }
  // ループの並び（反時計回り）に合わせて表裏をそろえる
  const want = faceNormal(B);
  let got = [0, 0, 0];
  for (const fi of out) got = add(got, faceNormal(m.faces[fi].map(i => m.verts[i])));
  if (dot(want, got) < 0) for (const fi of out) m.faces[fi].reverse();
  return out;
}

// ------------------------------------------------------------------ プリミティブ

/** XZ 平面のグリッド（+Y 向き、中心が原点） */
export function grid(name, { w = 1, d = 1, nx = 1, nz = 1 } = {}) {
  const m = new Mesh(name), id = [];
  for (let i = 0; i <= nx; i++) { id[i] = []; for (let j = 0; j <= nz; j++) id[i][j] = m.v(-w / 2 + w * i / nx, 0, -d / 2 + d * j / nz); }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) m.f(id[i][j], id[i][j + 1], id[i + 1][j + 1], id[i + 1][j]);
  return m;
}

/** 箱（中心が原点）。nx,ny,nz は各方向の分割数 */
export function box(name, { w = 1, h = 1, d = 1, nx = 1, ny = 1, nz = 1 } = {}) {
  const m = new Mesh(name);
  const side = (o, a, b, na, nb) => {
    const id = [];
    for (let i = 0; i <= na; i++) { id[i] = []; for (let j = 0; j <= nb; j++) id[i][j] = m.v(...add(o, add(mul(a, i / na), mul(b, j / nb)))); }
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) m.f(id[i][j], id[i + 1][j], id[i + 1][j + 1], id[i][j + 1]);
  };
  const [x, y, z] = [w / 2, h / 2, d / 2];
  side([-x, -y, z], [w, 0, 0], [0, h, 0], nx, ny);   // 前 +Z
  side([x, -y, -z], [-w, 0, 0], [0, h, 0], nx, ny);  // 後 -Z
  side([x, -y, z], [0, 0, -d], [0, h, 0], nz, ny);   // 右 +X
  side([-x, -y, -z], [0, 0, d], [0, h, 0], nz, ny);  // 左 -X
  side([-x, y, z], [w, 0, 0], [0, 0, -d], nx, nz);   // 上 +Y
  side([-x, -y, -z], [w, 0, 0], [0, 0, d], nx, nz);  // 下 -Y
  weld(m, Math.min(w, h, d) * 1e-6);
  return orient(m);
}

/** 円周上の点を返す（XZ 平面、高さ y）。loft 用 */
export function circle(n, r = 0.5, y = 0, { rz = r, start = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, y, -Math.sin(a) * rz]);
  }
  return pts;
}

/**
 * 回転体。profile は [[半径, 高さ], ...] を下から上へ。Y 軸まわりに回す。
 * 半径 0 の端は極（三角形）になる。cap: 端が半径>0 のときふさぐ（seg が4の倍数なら四角形）
 */
export function lathe(name, profile, { seg = 16, capStart = true, capEnd = true, angle = 360 } = {}) {
  if (profile.length < 2) throw new Error('lathe: profile には2点以上必要です');
  const m = new Mesh(name), full = Math.abs(angle - 360) < 1e-6;
  const cols = full ? seg : seg + 1;
  const rings = profile.map(([r, y]) => {
    if (Math.abs(r) < 1e-9) return [m.v(0, y, 0)];
    const ids = [];
    for (let i = 0; i < cols; i++) {
      const a = (i / seg) * angle * Math.PI / 180;
      ids.push(m.v(Math.cos(a) * r, y, -Math.sin(a) * r));
    }
    return ids;
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    if (A.length === 1 && B.length === 1) continue;
    for (let i = 0; i < (full ? seg : seg); i++) {
      const j = full ? (i + 1) % seg : i + 1;
      if (A.length === 1) m.f(A[0], B[i], B[j]);
      else if (B.length === 1) m.f(A[i], A[j], B[0]);
      else m.f(A[i], A[j], B[j], B[i]);
    }
  }
  if (full) {
    const first = rings[0], last = rings[rings.length - 1];
    if (capStart && first.length > 1) fill(m, first.slice().reverse());
    if (capEnd && last.length > 1) fill(m, last);
  }
  return orient(m);
}

/** 円柱（中心が原点）。seg を4の倍数にするとフタも四角形になる */
export function cylinder(name, { r = 0.5, h = 1, seg = 16, rows = 1, capTop = true, capBottom = true } = {}) {
  const prof = [];
  for (let i = 0; i <= rows; i++) prof.push([r, -h / 2 + h * i / rows]);
  return lathe(name, prof, { seg, capStart: capBottom, capEnd: capTop });
}

/** 球（立方体を膨らませた四角ポリゴンの球）。n は1面あたりの分割数 */
export function sphere(name, { r = 0.5, n = 4 } = {}) {
  const m = box(name, { w: 2, h: 2, d: 2, nx: n, ny: n, nz: n });
  m.map(p => {
    const q = p.map(v => Math.tan(v * Math.PI / 4)); // 等間隔に近づける
    return mul(norm(q), r);
  });
  return m;
}

/** トーラス（XZ 平面、中心が原点） */
export function torus(name, { R = 0.5, r = 0.15, seg = 24, tube = 12 } = {}) {
  const m = new Mesh(name), id = [];
  for (let i = 0; i < seg; i++) {
    id[i] = [];
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < tube; j++) {
      const b = (j / tube) * Math.PI * 2;
      const rr = R + Math.cos(b) * r;
      id[i][j] = m.v(Math.cos(a) * rr, Math.sin(b) * r, -Math.sin(a) * rr);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const i2 = (i + 1) % seg, j2 = (j + 1) % tube;
    m.f(id[i][j], id[i2][j], id[i2][j2], id[i][j2]);
  }
  return orient(m);
}

/**
 * 断面のループを順につないだ形。sections は [[[x,y,z], ...], ...]（各ループの点数は同じ）
 * capStart / capEnd で両端をふさぐ。closed=false なら断面を開いた線として扱う
 */
export function loft(name, sections, { closed = true, capStart = false, capEnd = false } = {}) {
  if (sections.length < 2) throw new Error('loft: 断面は2つ以上必要です');
  const n = sections[0].length;
  if (!sections.every(s => s.length === n)) throw new Error('loft: 断面ごとの点数をそろえてください');
  const m = new Mesh(name);
  const rings = sections.map(s => s.map(p => m.v(...p)));
  for (let k = 0; k < rings.length - 1; k++) bridge(m, rings[k], rings[k + 1], closed);
  if (closed) {
    if (capStart) fill(m, rings[0].slice().reverse());
    if (capEnd) fill(m, rings[rings.length - 1]);
  }
  return orient(m);
}

// ------------------------------------------------------------------ 編集

/** 面のまとまりを押し出す。dist は法線方向の距離か [dx,dy,dz]。戻り値は押し出した先の面の番号 */
export function extrude(m, faceIdx, dist, { scale = 1 } = {}) {
  const set = new Set(faceIdx);
  const used = new Set();
  for (const fi of set) for (const i of m.faces[fi]) used.add(i);
  let dir;
  if (Array.isArray(dist)) dir = dist;
  else {
    let n = [0, 0, 0];
    for (const fi of set) n = add(n, faceNormal(m.faces[fi].map(i => m.verts[i])));
    dir = mul(norm(n), dist);
  }
  const c = avg([...used].map(i => m.verts[i]));
  // 外周の辺（まとまりの中で1回しか出てこない辺）
  const count = new Map();
  for (const fi of set) { const f = m.faces[fi]; f.forEach((a, k) => { const key = ekey(a, f[(k + 1) % f.length]); count.set(key, (count.get(key) || 0) + 1); }); }
  const rim = new Set();
  for (const fi of set) { const f = m.faces[fi]; f.forEach((a, k) => { const b = f[(k + 1) % f.length]; if (count.get(ekey(a, b)) === 1) { rim.add(a); rim.add(b); } }); }
  // 外周の頂点は複製、内側の頂点はそのまま動かす
  const dup = new Map();
  for (const i of used) {
    const p = add(add(c, mul(sub(m.verts[i], c), scale)), dir);
    if (rim.has(i)) dup.set(i, m.v(...p));
    else { m.verts[i] = p; dup.set(i, i); }
  }
  for (const fi of set) {
    const f = m.faces[fi];
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      if (count.get(ekey(a, b)) === 1) m.f(a, b, dup.get(b), dup.get(a));
    });
  }
  for (const fi of set) m.faces[fi] = m.faces[fi].map(i => dup.get(i));
  return [...set];
}

/** 面を1枚ずつ内側にずらして縁を作る（amount は 0〜1、中心へ寄せる割合）。戻り値は内側の面の番号 */
export function inset(m, faceIdx, amount = 0.2) {
  for (const fi of faceIdx) {
    const f = m.faces[fi], c = m.faceCenter(fi);
    const inner = f.map(i => m.v(...lerp(m.verts[i], c, amount)));
    f.forEach((a, k) => { const k2 = (k + 1) % f.length; m.f(a, f[k2], inner[k2], inner[k]); });
    m.faces[fi] = inner;
  }
  return faceIdx;
}

/** 面を消す */
export function removeFaces(m, faceIdx) {
  const set = new Set(faceIdx);
  m.faces = m.faces.filter((_, i) => !set.has(i));
  return m;
}

/** 使われていない頂点を消す */
export function clean(m) {
  const used = new Set(m.faces.flat()), remap = new Map(), verts = [];
  m.verts.forEach((p, i) => { if (used.has(i)) { remap.set(i, verts.length); verts.push(p); } });
  m.faces = m.faces.map(f => f.map(i => remap.get(i)));
  const cr = new Set();
  for (const k of m.creases) { const [a, b] = k.split('_').map(Number); if (remap.has(a) && remap.has(b)) cr.add(ekey(remap.get(a), remap.get(b))); }
  m.verts = verts; m.creases = cr;
  return m;
}

/** 鏡像コピーして結合する（axis: 'x' | 'y' | 'z'）。対称面の近くの頂点は面上に寄せてつなぐ */
export function mirror(m, axis = 'x', { merge = 1e-4 } = {}) {
  const k = { x: 0, y: 1, z: 2 }[axis];
  if (k === undefined) throw new Error("mirror: axis は 'x' 'y' 'z' のどれか");
  m.verts.forEach(p => { if (Math.abs(p[k]) <= merge) p[k] = 0; });
  const copy = m.clone();
  copy.verts.forEach(p => { p[k] = -p[k]; });
  copy.flip();
  const n = m.verts.length;
  m.append(copy);
  // 対称面上の頂点だけをまとめる
  const remap = new Map();
  for (let i = 0; i < n; i++) if (m.verts[i][k] === 0) remap.set(i + n, i);
  m.faces = m.faces.map(f => f.map(i => remap.get(i) ?? i));
  const cr = new Set();
  for (const key of m.creases) { const [a, b] = key.split('_').map(Number); cr.add(ekey(remap.get(a) ?? a, remap.get(b) ?? b)); }
  m.creases = cr;
  // 対称面にぴったり重なる面（重複）を消す
  const seen = new Set();
  m.faces = m.faces.filter(f => { const key = [...f].sort((a, b) => a - b).join(','); if (seen.has(key)) return false; seen.add(key); return true; });
  return clean(m);
}

/** 厚みを付ける（開いた面に）。外側に thickness、両端は四角形でつなぐ */
export function solidify(m, thickness = 0.01) {
  const vn = m.verts.map(() => [0, 0, 0]);
  for (const f of m.faces) { const n = faceNormal(f.map(i => m.verts[i])); for (const i of f) vn[i] = add(vn[i], n); }
  const off = m.verts.map((p, i) => m.v(...sub(p, mul(norm(vn[i]), thickness))));
  const count = new Map();
  for (const f of m.faces) f.forEach((a, k) => { const key = ekey(a, f[(k + 1) % f.length]); count.set(key, (count.get(key) || 0) + 1); });
  const orig = m.faces.slice();
  for (const f of orig) m.f(f.map(i => off[i]).reverse());
  for (const f of orig) f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    if (count.get(ekey(a, b)) === 1) m.f(b, a, off[a], off[b]);
  });
  return clean(m);
}

/** Catmull-Clark サブディビジョン。開いた辺と crease を付けた辺は角が立つ */
export function subdivide(m, levels = 1) {
  for (let L = 0; L < levels; L++) {
    const V = m.verts, F = m.faces;
    const edges = new Map(); // key -> {a,b,faces:[]}
    F.forEach((f, fi) => f.forEach((a, k) => {
      const b = f[(k + 1) % f.length], key = ekey(a, b);
      if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      edges.get(key).faces.push(fi);
    }));
    const hard = e => e.faces.length !== 2 || m.creases.has(ekey(e.a, e.b));
    const fp = F.map(f => avg(f.map(i => V[i])));
    const out = new Mesh(m.name);
    // 元の頂点
    const vEdges = V.map(() => []), vFaces = V.map(() => []);
    for (const e of edges.values()) { vEdges[e.a].push(e); vEdges[e.b].push(e); }
    F.forEach((f, fi) => f.forEach(i => vFaces[i].push(fi)));
    const vid = V.map((p, i) => {
      const es = vEdges[i];
      if (!es.length) return -1;
      const hs = es.filter(hard);
      let q;
      if (hs.length >= 3) q = p;
      else if (hs.length === 2) {
        const o = hs.map(e => V[e.a === i ? e.b : e.a]);
        q = mul(add(mul(p, 6), add(o[0], o[1])), 1 / 8);
      } else {
        const n = es.length;
        const Fa = avg(vFaces[i].map(fi => fp[fi]));
        const R = avg(es.map(e => lerp(V[e.a], V[e.b], 0.5)));
        q = mul(add(add(Fa, mul(R, 2)), mul(p, n - 3)), 1 / n);
      }
      return out.v(...q);
    });
    const eid = new Map();
    for (const [key, e] of edges) {
      const q = hard(e) ? lerp(V[e.a], V[e.b], 0.5) : avg([V[e.a], V[e.b], fp[e.faces[0]], fp[e.faces[1]]]);
      eid.set(key, out.v(...q));
    }
    const fid = fp.map(p => out.v(...p));
    F.forEach((f, fi) => f.forEach((a, k) => {
      const prev = f[(k + f.length - 1) % f.length], next = f[(k + 1) % f.length];
      out.f(vid[a], eid.get(ekey(a, next)), fid[fi], eid.get(ekey(prev, a)));
    }));
    for (const key of m.creases) {
      const e = edges.get(key); if (!e) continue;
      const mid = eid.get(key);
      out.crease(vid[e.a], mid); out.crease(mid, vid[e.b]);
    }
    m.verts = out.verts; m.faces = out.faces; m.creases = out.creases;
  }
  return m;
}

// ------------------------------------------------------------------ 検査

/** トポロジーを数える */
export function inspect(meshes) {
  const q = { objects: 0, verts: 0, faces: 0, quads: 0, tris: 0, ngons: 0, bad_edges: 0, boundary_edges: 0,
    loose_verts: 0, dup_verts: 0, flipped_edges: 0, inward: 0, degenerate: 0 };
  for (const m of meshes) {
    q.objects++;
    q.verts += m.verts.length;
    q.faces += m.faces.length;
    const b = m.bounds(), eps = Math.max(len(b.size), 1e-6) * 1e-6;
    const edges = new Map(), used = new Set();
    m.faces.forEach((f, fi) => {
      const n = f.length;
      q[n === 3 ? 'tris' : n === 4 ? 'quads' : 'ngons']++;
      if (new Set(f).size !== n || len(faceNormal(f.map(i => m.verts[i]))) < eps * eps) q.degenerate++;
      f.forEach((a, k) => {
        used.add(a);
        const c = f[(k + 1) % n], key = ekey(a, c);
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push([fi, a < c ? 1 : -1]);
      });
    });
    for (const list of edges.values()) {
      if (list.length > 2) q.bad_edges++;
      else if (list.length === 1) q.boundary_edges++;
      else if (list[0][1] === list[1][1]) q.flipped_edges++;
    }
    q.loose_verts += m.verts.length - used.size;
    // 重複頂点
    const seen = new Map();
    m.verts.forEach(p => {
      const key = p.map(v => Math.round(v / eps)).join(',');
      if (seen.has(key)) q.dup_verts++; else seen.set(key, 1);
    });
    // 閉じた部分ごとの体積の符号（内向きかどうか）
    const parent = m.faces.map((_, i) => i);
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (const list of edges.values()) for (let i = 1; i < list.length; i++) parent[find(list[i][0])] = find(list[0][0]);
    const comps = new Map();
    m.faces.forEach((_, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); });
    for (const comp of comps.values()) {
      let open = false;
      for (const fi of comp) { const f = m.faces[fi]; f.forEach((a, k) => { if (edges.get(ekey(a, f[(k + 1) % f.length])).length === 1) open = true; }); if (open) break; }
      if (!open && signedVolume(m, comp) < 0) q.inward++;
    }
  }
  return q;
}

export const TRI_LIMIT = 0.10;
export const FACE_LIMIT = 200000;

/** 直させるべき問題を日本語で返す */
export function problemsOf(q) {
  const p = [];
  if (q.objects === 0 || q.faces === 0) p.push('メッシュがひとつもない（スクリプトの最後で return [メッシュ, ...] しているか確認）');
  if (q.ngons) p.push(`Nゴン（5角形以上）が ${q.ngons} 枚ある。四角形に分割する`);
  if (q.faces && q.tris / q.faces > TRI_LIMIT) p.push(`三角ポリゴンが ${q.tris} 枚（全体の ${Math.floor(q.tris * 100 / q.faces)}%）ある。できるだけ四角形にする`);
  if (q.bad_edges) p.push(`3枚以上の面が共有している辺が ${q.bad_edges} 本ある（非多様体）`);
  if (q.flipped_edges) p.push(`となりの面と向きが逆になっている辺が ${q.flipped_edges} 本ある。M.orient(mesh) で向きをそろえる`);
  if (q.inward) p.push(`法線が内向きの閉じた部品が ${q.inward} 個ある。面の頂点順を反時計回りにするか M.orient(mesh) を使う`);
  if (q.dup_verts) p.push(`同じ位置に重なった頂点が ${q.dup_verts} 個ある。共有するか M.weld(mesh) でまとめる`);
  if (q.degenerate) p.push(`つぶれた面（面積ゼロや同じ頂点の重複）が ${q.degenerate} 枚ある`);
  if (q.loose_verts) p.push(`どの面にも使われていない頂点が ${q.loose_verts} 個ある。M.clean(mesh) で消せる`);
  if (q.faces > FACE_LIMIT) p.push(`面が ${q.faces} 枚と多すぎる。${FACE_LIMIT} 枚以下にする（subdivide の回数を減らす）`);
  return p;
}

// AI のスクリプトに渡す名前空間
export const M = {
  Mesh, mesh: name => new Mesh(name),
  grid, box, circle, lathe, cylinder, sphere, torus, loft,
  bridge, fill, extrude, inset, removeFaces, mirror, solidify, subdivide,
  weld, orient, clean,
  vec: { add, sub, mul, dot, cross, len, norm, lerp, avg },
};
