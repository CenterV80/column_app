// worker.js — AI が書いたスクリプトを、ページとは別のスレッドで実行する
//
// ・画面（DOM）や API キーには触れない
// ・通信に使える関数は消してから実行する
// ・無限ループなどで止まった場合は、呼び出し側が worker ごと止める
import { M, Mesh, inspect, problemsOf } from './meshlib.js';

for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* 消せないものは無視 */ }
}

const HEADER_LINES = 3; // new Function が付け足す行 + "use strict" の行

self.onmessage = e => {
  const { code } = e.data;
  const logs = [];
  const con = {
    log: (...a) => logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
  };
  con.warn = con.error = con.info = con.log;
  try {
    const fn = new Function('M', 'Mesh', 'console', '"use strict";\n' + code);
    let result = fn(M, Mesh, con);
    if (result instanceof Mesh) result = [result];
    if (!Array.isArray(result)) throw new Error('スクリプトの最後で return [メッシュ, ...] としてください（戻り値がメッシュの配列ではありません）');
    const meshes = result.flat(Infinity);
    meshes.forEach((m, i) => { if (!(m instanceof Mesh)) throw new Error(`戻り値の ${i + 1} 番目がメッシュではありません`); });
    // 名前の重複をなくす
    const seen = new Map();
    for (const m of meshes) {
      const base = m.name || 'Mesh';
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      if (n) m.name = `${base}_${n}`;
    }
    const stats = inspect(meshes);
    self.postMessage({
      ok: true, logs, stats, problems: problemsOf(stats),
      meshes: meshes.map(m => ({ name: m.name, verts: m.verts, faces: m.faces })),
    });
  } catch (err) {
    let where = '';
    const m = /<anonymous>:(\d+):(\d+)/.exec(err?.stack || '');
    if (m) where = `（${Number(m[1]) - HEADER_LINES}行目）`;
    self.postMessage({ ok: false, logs, error: `${err?.name || 'Error'}: ${err?.message || err}${where}` });
  }
};
