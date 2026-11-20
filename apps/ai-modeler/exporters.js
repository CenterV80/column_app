// exporters.js — 法線の計算と、OBJ / FBX（バイナリ 7.4）の書き出し
//
// メッシュは { name, verts: [[x,y,z]...], faces: [[i,j,k,l]...] }。Y が上、単位はメートル。

// ------------------------------------------------------------------ 法線

function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n;
}
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * 面の角ごとの法線を返す（faces と同じ形の配列）。
 * angle: この角度より緩い折れはなめらかにつなぐ。0 ならフラット、180 なら全部なめらか
 */
export function cornerNormals(mesh, angle = 30) {
  const fn = mesh.faces.map(f => newell(f.map(i => mesh.verts[i]))); // 長さ＝面積の2倍
  const fu = fn.map(unit);
  if (angle <= 0) return mesh.faces.map((f, fi) => f.map(() => fu[fi]));
  const cos = Math.cos(Math.min(angle, 180) * Math.PI / 180) - 1e-9;
  const vf = mesh.verts.map(() => []);
  mesh.faces.forEach((f, fi) => f.forEach(i => vf[i].push(fi)));
  return mesh.faces.map((f, fi) => f.map(i => {
    const s = [0, 0, 0];
    for (const g of vf[i]) {
      const u = fu[g];
      if (u[0] * fu[fi][0] + u[1] * fu[fi][1] + u[2] * fu[fi][2] >= cos) { s[0] += fn[g][0]; s[1] += fn[g][1]; s[2] += fn[g][2]; }
    }
    return unit(s);
  }));
}

// ------------------------------------------------------------------ OBJ

export function toOBJ(meshes, angle = 30) {
  const out = ['# AIモデル生成（ブラウザ版）', '# 単位: メートル / Y が上', ''];
  let vo = 1, no = 1;
  const r = x => +x.toFixed(6);
  for (const m of meshes) {
    out.push(`o ${m.name.replace(/\s+/g, '_') || 'Mesh'}`);
    for (const p of m.verts) out.push(`v ${r(p[0])} ${r(p[1])} ${r(p[2])}`);
    const cn = cornerNormals(m, angle), key = new Map(), list = [];
    const nid = cn.map(f => f.map(n => {
      const k = n.map(v => v.toFixed(5)).join(' ');
      if (!key.has(k)) { key.set(k, list.length); list.push(k); }
      return key.get(k);
    }));
    for (const k of list) out.push(`vn ${k}`);
    m.faces.forEach((f, fi) => out.push('f ' + f.map((i, c) => `${i + vo}//${nid[fi][c] + no}`).join(' ')));
    vo += m.verts.length; no += list.length;
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ FBX（バイナリ 7.4）

const te = new TextEncoder();
const bytes = s => (s instanceof Uint8Array ? s : te.encode(s));
const nameClass = (name, cls) => { const a = te.encode(name), b = te.encode(cls), o = new Uint8Array(a.length + 2 + b.length); o.set(a); o.set([0, 1], a.length); o.set(b, a.length + 2); return o; };

// プロパティ
const I = v => ({ t: 'I', v });
const D = v => ({ t: 'D', v });
const L = v => ({ t: 'L', v: BigInt(v) });
const C = v => ({ t: 'C', v });
const S = v => ({ t: 'S', v: bytes(v) });
const R = v => ({ t: 'R', v });
const darr = v => ({ t: 'd', v: Float64Array.from(v) });
const iarr = v => ({ t: 'i', v: Int32Array.from(v) });

function propSize(p) {
  switch (p.t) {
    case 'I': return 5; case 'D': return 9; case 'L': return 9; case 'C': return 2;
    case 'S': case 'R': return 5 + p.v.length;
    case 'd': return 13 + p.v.length * 8;
    case 'i': return 13 + p.v.length * 4;
  }
  throw new Error('unknown prop ' + p.t);
}

const N = (name, props = [], children = []) => ({ name: te.encode(name), props, children });
const P = (name, type, label, flags, ...vals) => N('P', [S(name), S(type), S(label), S(flags), ...vals]);

const SENTINEL = 13;

// Blender の FBX 書き出しと同じ固定値（FileId / CreationTime とフッターの対応を保つ）
const FILE_ID = new Uint8Array([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]);
const FOOT_ID = new Uint8Array([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
const FOOT_MAGIC = new Uint8Array([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
const HEAD = new Uint8Array([...te.encode('Kaydara FBX Binary  '), 0x00, 0x1a, 0x00]);
const VERSION = 7400;

function nodeSize(n, isLast) {
  let s = 13 + n.name.length;
  for (const p of n.props) s += propSize(p);
  if (n.children.length) { n.children.forEach((c, i) => { s += nodeSize(c, i === n.children.length - 1); }); s += SENTINEL; }
  else if (!n.props.length && !isLast) s += SENTINEL;
  return s;
}

function writeNodes(dv, u8, off, nodes, closeList) {
  nodes.forEach((n, idx) => {
    const isLast = idx === nodes.length - 1;
    const start = off, end = start + nodeSize(n, isLast);
    let plen = 0; for (const p of n.props) plen += propSize(p);
    dv.setUint32(off, end, true); dv.setUint32(off + 4, n.props.length, true); dv.setUint32(off + 8, plen, true);
    u8[off + 12] = n.name.length; u8.set(n.name, off + 13);
    off += 13 + n.name.length;
    for (const p of n.props) {
      u8[off++] = p.t.charCodeAt(0);
      switch (p.t) {
        case 'I': dv.setInt32(off, p.v, true); off += 4; break;
        case 'D': dv.setFloat64(off, p.v, true); off += 8; break;
        case 'L': dv.setBigInt64(off, p.v, true); off += 8; break;
        case 'C': u8[off++] = p.v ? 1 : 0; break;
        case 'S': case 'R': dv.setUint32(off, p.v.length, true); u8.set(p.v, off + 4); off += 4 + p.v.length; break;
        case 'd': case 'i': {
          const w = p.t === 'd' ? 8 : 4;
          dv.setUint32(off, p.v.length, true); dv.setUint32(off + 4, 0, true); dv.setUint32(off + 8, p.v.length * w, true); off += 12;
          for (let k = 0; k < p.v.length; k++) { if (w === 8) dv.setFloat64(off, p.v[k], true); else dv.setInt32(off, p.v[k], true); off += w; }
          break;
        }
      }
    }
    if (n.children.length) { off = writeNodes(dv, u8, off, n.children, true); }
    else if (!n.props.length && !isLast) off += SENTINEL;
    if (off !== end) throw new Error(`FBX: ノードの長さが合いません (${new TextDecoder().decode(n.name)})`);
  });
  if (closeList) off += SENTINEL; // 子リストの終わり（0 埋め済み）
  return off;
}

/** メッシュを FBX（バイナリ）にする。FBX の標準単位はセンチなので 100 倍して書く */
export function toFBX(meshes, angle = 30) {
  let nextId = 1000000;
  const id = () => nextId++;
  const objects = [], conns = [];
  for (const m of meshes) {
    const gid = id(), mid = id();
    const verts = [], pvi = [], nrm = [];
    for (const p of m.verts) verts.push(p[0] * 100, p[1] * 100, p[2] * 100);
    const cn = cornerNormals(m, angle);
    m.faces.forEach((f, fi) => f.forEach((i, k) => {
      pvi.push(k === f.length - 1 ? -(i + 1) : i);
      nrm.push(...cn[fi][k]);
    }));
    const name = m.name || 'Mesh';
    objects.push(N('Geometry', [L(gid), S(nameClass(name, 'Geometry')), S('Mesh')], [
      N('Properties70'),
      N('GeometryVersion', [I(124)]),
      N('Vertices', [darr(verts)]),
      N('PolygonVertexIndex', [iarr(pvi)]),
      N('LayerElementNormal', [I(0)], [
        N('Version', [I(101)]), N('Name', [S('')]),
        N('MappingInformationType', [S('ByPolygonVertex')]),
        N('ReferenceInformationType', [S('Direct')]),
        N('Normals', [darr(nrm)]),
      ]),
      N('Layer', [I(0)], [
        N('Version', [I(100)]),
        N('LayerElement', [], [N('Type', [S('LayerElementNormal')]), N('TypedIndex', [I(0)])]),
      ]),
    ]));
    objects.push(N('Model', [L(mid), S(nameClass(name, 'Model')), S('Mesh')], [
      N('Version', [I(232)]),
      N('Properties70', [], [
        P('Lcl Translation', 'Lcl Translation', '', 'A', D(0), D(0), D(0)),
        P('Lcl Rotation', 'Lcl Rotation', '', 'A', D(0), D(0), D(0)),
        P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1)),
        P('DefaultAttributeIndex', 'int', 'Integer', '', I(0)),
      ]),
      N('MultiLayer', [I(0)]), N('MultiTake', [I(0)]),
      N('Shading', [C(true)]), N('Culling', [S('CullingOff')]),
    ]));
    conns.push(N('C', [S('OO'), L(mid), L(0)]), N('C', [S('OO'), L(gid), L(mid)]));
  }
  const app = 'AI Modeler (browser)';
  const root = [
    N('FBXHeaderExtension', [], [
      N('FBXHeaderVersion', [I(1003)]), N('FBXVersion', [I(VERSION)]), N('EncryptionType', [I(0)]),
      N('CreationTimeStamp', [], [N('Version', [I(1000)]), N('Year', [I(1970)]), N('Month', [I(1)]), N('Day', [I(1)]),
        N('Hour', [I(10)]), N('Minute', [I(0)]), N('Second', [I(0)]), N('Millisecond', [I(0)])]),
      N('Creator', [S(app)]),
      N('SceneInfo', [S(nameClass('GlobalInfo', 'SceneInfo')), S('UserData')], [
        N('Type', [S('UserData')]), N('Version', [I(100)]),
        N('MetaData', [], [N('Version', [I(100)]), N('Title', [S('')]), N('Subject', [S('')]), N('Author', [S('')]),
          N('Keywords', [S('')]), N('Revision', [S('')]), N('Comment', [S('')])]),
        N('Properties70', [], [
          P('DocumentUrl', 'KString', 'Url', '', S('/model.fbx')),
          P('SrcDocumentUrl', 'KString', 'Url', '', S('/model.fbx')),
          P('Original', 'Compound', '', ''),
          P('Original|ApplicationVendor', 'KString', '', '', S('column_app')),
          P('Original|ApplicationName', 'KString', '', '', S(app)),
          P('Original|ApplicationVersion', 'KString', '', '', S('1.0')),
          P('Original|DateTime_GMT', 'DateTime', '', '', S('01/01/1970 00:00:00.000')),
          P('Original|FileName', 'KString', '', '', S('/model.fbx')),
          P('LastSaved', 'Compound', '', ''),
          P('LastSaved|ApplicationVendor', 'KString', '', '', S('column_app')),
          P('LastSaved|ApplicationName', 'KString', '', '', S(app)),
          P('LastSaved|ApplicationVersion', 'KString', '', '', S('1.0')),
          P('LastSaved|DateTime_GMT', 'DateTime', '', '', S('01/01/1970 00:00:00.000')),
        ]),
      ]),
    ]),
    N('FileId', [R(FILE_ID)]),
    N('CreationTime', [S('1970-01-01 10:00:00:000')]),
    N('Creator', [S(app)]),
    N('GlobalSettings', [], [
      N('Version', [I(1000)]),
      N('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', I(1)), P('UpAxisSign', 'int', 'Integer', '', I(1)),
        P('FrontAxis', 'int', 'Integer', '', I(2)), P('FrontAxisSign', 'int', 'Integer', '', I(1)),
        P('CoordAxis', 'int', 'Integer', '', I(0)), P('CoordAxisSign', 'int', 'Integer', '', I(1)),
        P('OriginalUpAxis', 'int', 'Integer', '', I(1)), P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
        P('UnitScaleFactor', 'double', 'Number', '', D(1)), P('OriginalUnitScaleFactor', 'double', 'Number', '', D(1)),
        P('AmbientColor', 'ColorRGB', 'Color', '', D(0), D(0), D(0)),
        P('DefaultCamera', 'KString', '', '', S('Producer Perspective')),
        P('TimeMode', 'enum', '', '', I(11)),
        P('TimeSpanStart', 'KTime', 'Time', '', L(0)), P('TimeSpanStop', 'KTime', 'Time', '', L(46186158000)),
        P('CustomFrameRate', 'double', 'Number', '', D(24)),
      ]),
    ]),
    N('Documents', [], [
      N('Count', [I(1)]),
      N('Document', [L(id()), S('Scene'), S('Scene')], [
        N('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', S(''))]),
        N('RootNode', [L(0)]),
      ]),
    ]),
    N('References'),
    N('Definitions', [], [
      N('Version', [I(100)]), N('Count', [I(1 + meshes.length * 2)]),
      N('ObjectType', [S('GlobalSettings')], [N('Count', [I(1)])]),
      N('ObjectType', [S('Geometry')], [N('Count', [I(meshes.length)])]),
      N('ObjectType', [S('Model')], [N('Count', [I(meshes.length)])]),
    ]),
    N('Objects', [], objects),
    N('Connections', [], conns),
    N('Takes', [], [N('Current', [S('')])]),
  ];

  let body = HEAD.length + 4;
  root.forEach((n, i) => { body += nodeSize(n, i === root.length - 1); });
  body += SENTINEL;
  let foot = body + FOOT_ID.length + 4;
  let pad = ((foot + 15) & ~15) - foot; if (pad === 0) pad = 16;
  const total = foot + pad + 4 + 120 + FOOT_MAGIC.length;

  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set(HEAD, 0); dv.setUint32(HEAD.length, VERSION, true);
  let off = writeNodes(dv, u8, HEAD.length + 4, root, true);
  if (off !== body) throw new Error('FBX: 全体の長さが合いません');
  u8.set(FOOT_ID, off); off += FOOT_ID.length + 4 + pad;
  dv.setUint32(off, VERSION, true); off += 4 + 120;
  u8.set(FOOT_MAGIC, off);
  return buf;
}
