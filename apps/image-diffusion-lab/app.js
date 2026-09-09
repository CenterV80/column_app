"use strict";

/* =========================================================================
   画像生成AI ラボ
   拡散モデルの工程（テキストエンコード → latentノイズ → 反復デノイズ →
   VAEデコード）を、ブラウザ内の小さなシミュレーションで再現する。

   本物のU-Netの代わりに「答えを知っているぼかし器」を使っている点だけが
   作り物で、latentの形・サンプラーの式・CFGの式・ノイズの減り方は
   実物と同じ構造にしてある。詳しくはindex.htmlの最終セクションを参照。
   ========================================================================= */

const LAT = 40;              // latent の一辺（セル数）
const CH = 4;                // latent のチャンネル数
const SCALE = 8;             // VAE の拡大率。SD1.5 と同じ 1/8 圧縮
const IMG = LAT * SCALE;     // 出力画像の一辺 = 320px
const N = CH * LAT * LAT;    // latent の要素数

const SIGMA_MAX = 12;        // 最初に乗せるノイズの大きさ
const SIGMA_MIN = 0.0008;    // 最後まで削ったあとに残るノイズ
const RHO = 6;               // Karras スケジュールの曲がり具合
const BLUR_PER_SIGMA = 0.9;  // ノイズが多いほど細部が見えない、の係数
const KEEP0 = 0.2;           // ノイズが多いとき、予測が「いまの板」を信じる度合い
const SIGMA_H = 0.012;       // これを下回ると、予測はほぼ「いまの板」そのものになる
const GUIDE_CAP = 4.5;       // ガイダンス分をこの倍率あたりで頭打ちにする
const FW_MIN = 0.02;         // 「ノイズを足す」スライダーの左端のσ

/* ---------------------------------------------------------------- 乱数 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller 法で正規分布の乱数を作る
function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------- プロンプト解析 */

const SUBJECTS = [
  { id: "apple", label: "りんご", emoji: "🍎", hue: 5,
    keys: ["りんご", "リンゴ", "林檎", "apple", "アップル"] },
  { id: "cat", label: "ねこ", emoji: "🐱", hue: 32,
    keys: ["ねこ", "猫", "ネコ", "にゃんこ", "cat", "キャット"] },
  { id: "mountain", label: "山", emoji: "⛰️", hue: 210,
    keys: ["山", "やま", "富士", "mountain", "風景", "景色"] },
  { id: "house", label: "家", emoji: "🏠", hue: 20,
    keys: ["家", "いえ", "おうち", "house", "住宅", "建物"] },
  { id: "flower", label: "花", emoji: "🌸", hue: 330,
    keys: ["花", "はな", "flower", "チューリップ", "ひまわり", "バラ", "薔薇"] },
  { id: "cup", label: "コーヒーカップ", emoji: "☕", hue: 25,
    keys: ["コーヒー", "カップ", "coffee", "cup", "マグ", "紅茶"] },
];

const COLORS = [
  { label: "赤", hue: 4, keys: ["赤", "あか", "レッド", "red", "真っ赤"] },
  { label: "青", hue: 215, keys: ["青", "あお", "ブルー", "blue"] },
  { label: "黄色", hue: 48, keys: ["黄", "きいろ", "イエロー", "yellow"] },
  { label: "緑", hue: 130, keys: ["緑", "みどり", "グリーン", "green"] },
  { label: "紫", hue: 280, keys: ["紫", "むらさき", "パープル", "purple"] },
  { label: "ピンク", hue: 335, keys: ["ピンク", "桃色", "pink"] },
  { label: "オレンジ", hue: 28, keys: ["オレンジ", "橙", "orange"] },
  { label: "白", hue: -1, keys: ["白", "しろ", "ホワイト", "white"] },
];

const MOODS = [
  { id: "night", label: "夜", emoji: "🌙", keys: ["夜", "よる", "night", "星空", "深夜"] },
  { id: "sunset", label: "夕焼け", emoji: "🌇", keys: ["夕焼け", "夕暮れ", "夕方", "sunset", "黄昏"] },
  { id: "snow", label: "雪", emoji: "❄️", keys: ["雪", "ゆき", "snow", "冬"] },
  { id: "day", label: "昼", emoji: "☀️", keys: ["昼", "晴れ", "青空", "day"] },
];

function matchGroup(text, group) {
  for (const item of group) {
    for (const k of item.keys) {
      const at = text.indexOf(k);
      if (at >= 0) return { item, key: k, at };
    }
  }
  return null;
}

function parsePrompt(text) {
  const t = (text || "").trim();
  const s = matchGroup(t, SUBJECTS);
  const c = matchGroup(t, COLORS);
  const m = matchGroup(t, MOODS);
  return {
    text: t,
    subject: s ? s.item : null,
    subjectKey: s ? s.key : null,
    color: c ? c.item : null,
    colorKey: c ? c.key : null,
    mood: m ? m.item : MOODS[3],
    moodKey: m ? m.key : null,
  };
}

/* ------------------------------------------------- お手本の絵を procedural に描く

   本物のモデルは「学習で覚えた絵」を思い出しながら描くが、ここでは
   その記憶の代わりに、キャンバスに直接描いた絵を使う。
   シードによって位置・大きさ・色味が少し揺れるようにしてあるので、
   シードを変えると構図が変わる、という挙動も再現される。            */

function newCanvas(w, h) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

// 「白い〜」と指定されたときだけ、絵全体の彩度を落とすための倍率
let SAT_MUL = 1;

function hslStr(h, s, l) {
  const hh = (((h % 360) + 360) % 360).toFixed(1);
  return "hsl(" + hh + ", " + clamp(s * SAT_MUL, 0, 100).toFixed(1) + "%, " +
    clamp(l, 0, 100).toFixed(1) + "%)";
}

function skyPalette(mood) {
  switch (mood) {
    case "night": return { top: [225, 52, 27], bottom: [255, 38, 43], light: 0.5 };
    case "sunset": return { top: [22, 78, 58], bottom: [335, 62, 70], light: 0.85 };
    case "snow": return { top: [205, 30, 82], bottom: [205, 22, 93], light: 1.05 };
    default: return { top: [203, 62, 74], bottom: [196, 55, 90], light: 1 };
  }
}

function paintSky(ctx, mood, rng) {
  const p = skyPalette(mood);
  const g = ctx.createLinearGradient(0, 0, 0, IMG);
  g.addColorStop(0, hslStr(p.top[0], p.top[1], p.top[2]));
  g.addColorStop(1, hslStr(p.bottom[0], p.bottom[1], p.bottom[2]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, IMG, IMG);

  if (mood === "night") {
    ctx.fillStyle = "rgba(255,255,220,0.9)";
    for (let i = 0; i < 40; i++) {
      const x = rng() * IMG, y = rng() * IMG * 0.65, r = 1 + rng() * 2.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,250,225,0.95)";
    ctx.beginPath();
    ctx.arc(IMG * 0.76, IMG * 0.18, 26, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === "sunset") {
    ctx.fillStyle = "rgba(255,236,180,0.95)";
    ctx.beginPath();
    ctx.arc(IMG * 0.74, IMG * 0.26, 30, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood !== "snow") {
    ctx.fillStyle = "rgba(255,252,215,0.9)";
    ctx.beginPath();
    ctx.arc(IMG * 0.78, IMG * 0.17, 24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintGround(ctx, mood) {
  const h = mood === "snow" ? 200 : 105;
  const s = mood === "snow" ? 18 : 42;
  const l = mood === "night" ? 32 : mood === "snow" ? 90 : mood === "sunset" ? 38 : 52;
  const g = ctx.createLinearGradient(0, IMG * 0.66, 0, IMG);
  g.addColorStop(0, hslStr(h, s, l));
  g.addColorStop(1, hslStr(h, s, Math.max(8, l - 14)));
  ctx.fillStyle = g;
  ctx.fillRect(0, IMG * 0.68, IMG, IMG * 0.32);
}

function softBackdrop(ctx, mood, hue) {
  const p = skyPalette(mood);
  const g = ctx.createLinearGradient(0, 0, IMG, IMG);
  g.addColorStop(0, hslStr(p.top[0], Math.min(45, p.top[1]), mood === "night" ? 36 : 88));
  g.addColorStop(1, hslStr(hue + 180, 25, mood === "night" ? 27 : 78));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, IMG, IMG);
  // 机の面をうっすら
  ctx.fillStyle = mood === "night" ? "rgba(24,26,46,0.35)" : "rgba(120,95,70,0.22)";
  ctx.fillRect(0, IMG * 0.72, IMG, IMG * 0.28);
}

function shadow(ctx, cx, cy, rx, ry, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawApple(ctx, hue, mood, rng) {
  softBackdrop(ctx, mood, hue);
  const cx = IMG * (0.5 + (rng() - 0.5) * 0.26);
  const cy = IMG * (0.52 + (rng() - 0.5) * 0.16);
  const r = IMG * (0.22 + rng() * 0.11);
  const light = mood === "night" ? 0.85 : 1;

  shadow(ctx, cx, cy + r * 0.95, r * 1.02, r * 0.2, 0.22);

  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.25);
  g.addColorStop(0, hslStr(hue + 10, 82, 72 * light));
  g.addColorStop(0.55, hslStr(hue, 78, 52 * light));
  g.addColorStop(1, hslStr(hue - 8, 68, 30 * light));
  ctx.fillStyle = g;
  // 左右の膨らみを重ねてリンゴらしい輪郭に
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.24, cy + r * 0.05, r * 0.78, r * 0.92, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.24, cy + r * 0.05, r * 0.78, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.1, r * 0.9, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 上部のくぼみ
  ctx.fillStyle = mood === "night" ? "rgba(20,20,35,0.5)" : "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.82, r * 0.22, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // 軸
  ctx.strokeStyle = hslStr(28, 55, 26 * light);
  ctx.lineWidth = r * 0.11;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.82);
  ctx.quadraticCurveTo(cx + r * 0.06, cy - r * 1.12, cx + r * 0.16, cy - r * 1.28);
  ctx.stroke();

  // 葉
  ctx.fillStyle = hslStr(118, 55, 38 * light);
  ctx.save();
  ctx.translate(cx + r * 0.2, cy - r * 1.02);
  ctx.rotate(-0.5 + rng() * 0.35);
  ctx.beginPath();
  ctx.ellipse(r * 0.3, 0, r * 0.32, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ハイライト
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.36, cy - r * 0.32, r * 0.19, r * 0.28, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCat(ctx, hue, mood, rng) {
  softBackdrop(ctx, mood, hue);
  const cx = IMG * (0.5 + (rng() - 0.5) * 0.24);
  const cy = IMG * (0.54 + (rng() - 0.5) * 0.14);
  const r = IMG * (0.2 + rng() * 0.09);
  const light = mood === "night" ? 0.84 : 1;
  const body = hslStr(hue, 45, 62 * light);
  const dark = hslStr(hue, 45, 44 * light);

  shadow(ctx, cx, cy + r * 1.35, r * 1.0, r * 0.16, 0.2);

  // 体
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.35, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 耳
  ctx.fillStyle = body;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.72, cy - r * 0.5);
    ctx.lineTo(cx + s * r * 0.95, cy - r * 1.18);
    ctx.lineTo(cx + s * r * 0.28, cy - r * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = hslStr(340, 55, 78 * light);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.68, cy - r * 0.58);
    ctx.lineTo(cx + s * r * 0.82, cy - r * 1.0);
    ctx.lineTo(cx + s * r * 0.42, cy - r * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  // 顔
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.2);
  g.addColorStop(0, hslStr(hue, 45, 76 * light));
  g.addColorStop(1, body);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = mood === "night" ? "#f7e98a" : "#2e6b3f";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.36, cy - r * 0.1, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#151515";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.36, cy - r * 0.1, r * 0.06, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 鼻と口
  ctx.fillStyle = hslStr(345, 60, 62);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.1, cy + r * 0.22);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.22);
  ctx.lineTo(cx, cy + r * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(40,30,30,0.75)";
  ctx.lineWidth = Math.max(1.4, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.36);
  ctx.lineTo(cx, cy + r * 0.48);
  ctx.moveTo(cx, cy + r * 0.48);
  ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.6, cx - r * 0.3, cy + r * 0.44);
  ctx.moveTo(cx, cy + r * 0.48);
  ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.6, cx + r * 0.3, cy + r * 0.44);
  ctx.stroke();

  // ひげ
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = cy + r * (0.2 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.4, y);
      ctx.lineTo(cx + s * r * 1.15, y - r * (0.12 - i * 0.1));
      ctx.stroke();
    }
  }
}

function drawMountain(ctx, hue, mood, rng) {
  paintSky(ctx, mood, rng);
  const light = mood === "night" ? 0.78 : mood === "sunset" ? 0.9 : 1;
  const base = IMG * 0.78;
  const peaks = [
    { x: IMG * (0.34 + (rng() - 0.5) * 0.12), h: IMG * (0.46 + rng() * 0.1), w: IMG * 0.42 },
    { x: IMG * (0.66 + (rng() - 0.5) * 0.12), h: IMG * (0.36 + rng() * 0.1), w: IMG * 0.38 },
  ];
  peaks.sort((a, b) => b.h - a.h);
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    const top = base - p.h;
    ctx.fillStyle = hslStr(hue, 26 - i * 6, (i === 0 ? 40 : 48) * light);
    ctx.beginPath();
    ctx.moveTo(p.x - p.w, base);
    ctx.lineTo(p.x, top);
    ctx.lineTo(p.x + p.w, base);
    ctx.closePath();
    ctx.fill();
    // 雪の冠
    ctx.fillStyle = hslStr(210, 20, 94 * (mood === "night" ? 0.75 : 1));
    const k = 0.3;
    ctx.beginPath();
    ctx.moveTo(p.x - p.w * k, top + p.h * k);
    ctx.lineTo(p.x, top);
    ctx.lineTo(p.x + p.w * k, top + p.h * k);
    ctx.lineTo(p.x + p.w * k * 0.4, top + p.h * k * 0.72);
    ctx.lineTo(p.x, top + p.h * k * 1.05);
    ctx.lineTo(p.x - p.w * k * 0.45, top + p.h * k * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  paintGround(ctx, mood);
}

function drawHouse(ctx, hue, mood, rng) {
  paintSky(ctx, mood, rng);
  paintGround(ctx, mood);
  const light = mood === "night" ? 0.8 : 1;
  const cx = IMG * (0.5 + (rng() - 0.5) * 0.26);
  const w = IMG * (0.3 + rng() * 0.14);
  const h = IMG * 0.28;
  const top = IMG * 0.74 - h;

  shadow(ctx, cx, IMG * 0.75, w * 0.75, IMG * 0.02, 0.2);
  ctx.fillStyle = hslStr(hue, 30, 82 * light);
  ctx.fillRect(cx - w / 2, top, w, h);
  // 屋根
  ctx.fillStyle = hslStr(hue - 10, 55, 42 * light);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.62, top);
  ctx.lineTo(cx, top - IMG * 0.16);
  ctx.lineTo(cx + w * 0.62, top);
  ctx.closePath();
  ctx.fill();
  // 扉
  ctx.fillStyle = hslStr(25, 50, 34 * light);
  ctx.fillRect(cx - w * 0.1, top + h * 0.42, w * 0.2, h * 0.58);
  // 窓
  ctx.fillStyle = mood === "night" ? "#ffe9a8" : hslStr(200, 55, 72);
  ctx.fillRect(cx - w * 0.38, top + h * 0.2, w * 0.18, h * 0.26);
  ctx.fillRect(cx + w * 0.2, top + h * 0.2, w * 0.18, h * 0.26);
  ctx.strokeStyle = "rgba(60,50,45,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - w * 0.38, top + h * 0.2, w * 0.18, h * 0.26);
  ctx.strokeRect(cx + w * 0.2, top + h * 0.2, w * 0.18, h * 0.26);
  // 煙突
  ctx.fillStyle = hslStr(10, 40, 38 * light);
  ctx.fillRect(cx + w * 0.28, top - IMG * 0.11, w * 0.12, IMG * 0.11);
}

function drawFlower(ctx, hue, mood, rng) {
  softBackdrop(ctx, mood, hue);
  const light = mood === "night" ? 0.84 : 1;
  const cx = IMG * (0.5 + (rng() - 0.5) * 0.24);
  const cy = IMG * (0.42 + (rng() - 0.5) * 0.14);
  const r = IMG * (0.1 + rng() * 0.06);

  // 茎
  ctx.strokeStyle = hslStr(120, 45, 36 * light);
  ctx.lineWidth = IMG * 0.022;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.quadraticCurveTo(cx + IMG * 0.03, IMG * 0.72, cx - IMG * 0.01, IMG * 0.92);
  ctx.stroke();
  // 葉
  ctx.fillStyle = hslStr(125, 48, 40 * light);
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + s * IMG * 0.01, IMG * (0.68 + (s > 0 ? 0.07 : 0)));
    ctx.rotate(s * 0.6);
    ctx.beginPath();
    ctx.ellipse(s * IMG * 0.07, 0, IMG * 0.08, IMG * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 花びら
  const petals = 6 + Math.floor(rng() * 3);
  const rot = rng() * Math.PI;
  for (let i = 0; i < petals; i++) {
    const a = rot + (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, hslStr(hue, 68, 82 * light));
    g.addColorStop(1, hslStr(hue - 12, 72, 62 * light));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 中心
  ctx.fillStyle = hslStr(46, 82, 58 * light);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(150,110,20,0.45)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawCup(ctx, hue, mood, rng) {
  softBackdrop(ctx, mood, hue);
  const light = mood === "night" ? 0.85 : 1;
  const cx = IMG * (0.48 + (rng() - 0.5) * 0.24);
  const cy = IMG * (0.58 + (rng() - 0.5) * 0.12);
  const w = IMG * (0.26 + rng() * 0.11);
  const h = w * 0.72;

  shadow(ctx, cx, cy + h * 0.62, w * 0.68, h * 0.1, 0.2);
  // 受け皿
  ctx.fillStyle = hslStr(hue, 18, 88 * light);
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.56, w * 0.78, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 取っ手
  ctx.strokeStyle = hslStr(hue, 22, 92 * light);
  ctx.lineWidth = w * 0.1;
  ctx.beginPath();
  ctx.arc(cx + w * 0.5, cy, h * 0.28, -1.1, 1.1);
  ctx.stroke();
  // 本体
  const g = ctx.createLinearGradient(cx - w * 0.5, 0, cx + w * 0.5, 0);
  g.addColorStop(0, hslStr(hue, 20, 96 * light));
  g.addColorStop(1, hslStr(hue, 24, 74 * light));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.46, cy - h * 0.42);
  ctx.lineTo(cx + w * 0.46, cy - h * 0.42);
  ctx.lineTo(cx + w * 0.36, cy + h * 0.46);
  ctx.quadraticCurveTo(cx, cy + h * 0.62, cx - w * 0.36, cy + h * 0.46);
  ctx.closePath();
  ctx.fill();
  // 中身
  ctx.fillStyle = hslStr(25, 62, 26 * light);
  ctx.beginPath();
  ctx.ellipse(cx, cy - h * 0.42, w * 0.46, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.14, cy - h * 0.44, w * 0.16, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // 湯気
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = w * 0.035;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * w * 0.2, cy - h * 0.55);
    ctx.quadraticCurveTo(cx + i * w * 0.2 + w * 0.1, cy - h * 0.78, cx + i * w * 0.2, cy - h * 1.0);
    ctx.stroke();
  }
}

// 学習データに無い言葉のときに出る「なんとなくの塊」
function drawBlob(ctx, hue, mood, rng) {
  softBackdrop(ctx, mood, hue < 0 ? 30 : hue);
  for (let i = 0; i < 5; i++) {
    const cx = IMG * (0.3 + rng() * 0.4);
    const cy = IMG * (0.3 + rng() * 0.4);
    const r = IMG * (0.16 + rng() * 0.2);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const hh = hue < 0 ? 20 + rng() * 40 : hue + (rng() - 0.5) * 60;
    g.addColorStop(0, hslStr(hh, 42, 58));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const DRAWERS = {
  apple: drawApple, cat: drawCat, mountain: drawMountain,
  house: drawHouse, flower: drawFlower, cup: drawCup,
};

/* 指定のプロンプト内容で 320x320 のお手本画像を描き、ImageData を返す */
function renderTarget(parsed, seed) {
  const cv = newCanvas(IMG, IMG);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const rng = mulberry32((seed >>> 0) * 2654435761 + 7);
  const mood = parsed.mood ? parsed.mood.id : "day";
  let hue = parsed.subject ? parsed.subject.hue : 30;
  const white = parsed.color && parsed.color.hue < 0;
  if (parsed.color && !white) hue = parsed.color.hue;
  hue += (rng() - 0.5) * 26;
  SAT_MUL = white ? 0.12 : 1;

  if (parsed.subject && DRAWERS[parsed.subject.id]) {
    DRAWERS[parsed.subject.id](ctx, hue, mood, rng);
  } else {
    drawBlob(ctx, hue, mood, rng);
  }
  return ctx.getImageData(0, 0, IMG, IMG);
}

/* プロンプトを空にしたとき（uncond）の予測にあたるもの。
   「その場面のだいたいの明るさや色みは分かるが、何が写っているかは分からない」
   という状態を、お手本を大きくぼかして平均に寄せることで作る。

   ここをお手本と無関係な絵にしてしまうと、暗い場面のときに差分が大きくなりすぎて、
   CFGを少し上げただけで黒つぶれ・白飛びを起こす。チャンネルごとの平均を
   お手本と揃えておくのがポイント。 */
function makeUncondTarget(tCond) {
  const blurred = blurLatent(tCond, 8);
  const out = new Float32Array(N);
  const plane = LAT * LAT;
  for (let c = 0; c < CH; c++) {
    const off = c * plane;
    let mean = 0;
    for (let i = 0; i < plane; i++) mean += blurred[off + i];
    mean /= plane;
    // 明るさは少しだけ形を残し、色と輪郭はほとんど平らにする
    const gain = c === 0 ? 0.4 : c === 3 ? 0.15 : 0.25;
    for (let i = 0; i < plane; i++) out[off + i] = mean + (blurred[off + i] - mean) * gain;
  }
  return out;
}

/* ====================================================================== VAE

   エンコード：320x320x3 の画像 → 40x40x4 の latent（情報量は約1/48）
   デコード  ：40x40x4 の latent → 320x320x3 の画像

   本物のVAEはニューラルネットで、4つのチャンネルが何を表すかは学習で
   勝手に決まる（人間には読めない）。ここでは説明のために
   ch0=明るさ / ch1=赤-緑 / ch2=黄-青 / ch3=輪郭の強さ と決め打ちしている。
   ch0〜ch2 は完全に可逆なので、色の情報は往復しても失われない。       */

const CH_LABELS = ["明るさ", "赤 - 緑", "黄 - 青", "輪郭"];

function encode(imageData) {
  const px = imageData.data;
  const lat = new Float32Array(N);
  const plane = LAT * LAT;
  for (let ly = 0; ly < LAT; ly++) {
    for (let lx = 0; lx < LAT; lx++) {
      let sr = 0, sg = 0, sb = 0, lmin = 1e9, lmax = -1e9;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const i = (((ly * SCALE + dy) * IMG) + lx * SCALE + dx) * 4;
          const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
          sr += r; sg += g; sb += b;
          const lum = (r + g + b) / 3;
          if (lum < lmin) lmin = lum;
          if (lum > lmax) lmax = lum;
        }
      }
      const n = SCALE * SCALE;
      const R = sr / n, G = sg / n, B = sb / n;
      const L = (R + G + B) / 3;
      const a = R - L, b2 = G - L, c = B - L;
      const o = ly * LAT + lx;
      lat[o] = (L - 0.5) * 2;                 // ch0 明るさ
      lat[plane + o] = (a - b2) * 2;          // ch1 赤 - 緑
      lat[plane * 2 + o] = c * 3;             // ch2 黄 - 青
      lat[plane * 3 + o] = (lmax - lmin) * 3 - 0.6; // ch3 輪郭の強さ
    }
  }
  return lat;
}

// latent の1チャンネルを bilinear で画像サイズまで拡大
function upsampleChannel(lat, ch, w) {
  const out = new Float32Array(w * w);
  const off = ch * LAT * LAT;
  const s = LAT / w;
  for (let y = 0; y < w; y++) {
    const fy = clamp((y + 0.5) * s - 0.5, 0, LAT - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, LAT - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) * s - 0.5, 0, LAT - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, LAT - 1), tx = fx - x0;
      const a = lerp(lat[off + y0 * LAT + x0], lat[off + y0 * LAT + x1], tx);
      const b = lerp(lat[off + y1 * LAT + x0], lat[off + y1 * LAT + x1], tx);
      out[y * w + x] = lerp(a, b, ty);
    }
  }
  return out;
}

// ch0..ch2 から RGB を復元する（encode の逆算）
function channelsToRGB(c0, c1, c2) {
  const L = c0 / 2 + 0.5;
  const cB = c2 / 3;
  const diff = c1 / 2;
  const a = (-cB + diff) / 2;
  const b = (-cB - diff) / 2;
  return [L + a, L + b, L + cB];
}

/* latent を画像に戻す。拡大 → ch3（輪郭）の強さに応じたシャープ化、
   という流れは、VAEデコーダーが「ぼやけた情報から輪郭を作り直す」
   仕事をしていることのごく簡単な見立て。 */
function decode(lat, ctx, opts) {
  const w = ctx.canvas.width;
  const o = opts || {};
  // ch3（輪郭の強さ）は「このあたりに細部があるか」の地図なので、
  // ざらつきを増幅しないよう少しならしてから使う
  const smoothed = blurLatent(lat, 1.2);
  const up = [0, 1, 2].map((c) => upsampleChannel(lat, c, w));
  up.push(upsampleChannel(smoothed, 3, w));
  const n = w * w;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rgb = channelsToRGB(up[0][i], up[1][i], up[2][i]);
    R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
  }

  const img = ctx.createImageData(w, w);
  const d = img.data;
  const sharpen = o.sharpen !== false;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = R[i], g = G[i], b = B[i];
      if (sharpen) {
        // 3x3 平均との差を足し戻す（アンシャープマスク）。
        // 強さは ch3（輪郭チャンネル）が持っている。
        let sr = 0, sg = 0, sb = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clamp(y + dy, 0, w - 1);
          for (let dx = -1; dx <= 1; dx++) {
            const j = yy * w + clamp(x + dx, 0, w - 1);
            sr += R[j]; sg += G[j]; sb += B[j];
          }
        }
        const amt = clamp(0.3 + up[3][i] * 0.8, 0, 1.3);
        r += (r - sr / 9) * amt;
        g += (g - sg / 9) * amt;
        b += (b - sb / 9) * amt;
      }
      const k = i * 4;
      d[k] = clamp(r, 0, 1) * 255;
      d[k + 1] = clamp(g, 0, 1) * 255;
      d[k + 2] = clamp(b, 0, 1) * 255;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// latent をそのまま（拡大せず）色として見る。ステージ3・5で使う
function drawLatentRaw(lat, ctx) {
  const img = ctx.createImageData(LAT, LAT);
  const d = img.data;
  const plane = LAT * LAT;
  for (let i = 0; i < plane; i++) {
    const rgb = channelsToRGB(lat[i], lat[plane + i], lat[plane * 2 + i]);
    d[i * 4] = clamp(rgb[0], 0, 1) * 255;
    d[i * 4 + 1] = clamp(rgb[1], 0, 1) * 255;
    d[i * 4 + 2] = clamp(rgb[2], 0, 1) * 255;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// 1チャンネルを白黒で表示（ステージ3のチャンネル分解）
function drawChannel(lat, ch, ctx, span) {
  const s = span || 2;
  const img = ctx.createImageData(LAT, LAT);
  const d = img.data;
  const off = ch * LAT * LAT;
  for (let i = 0; i < LAT * LAT; i++) {
    const v = clamp(lat[off + i] / s * 0.5 + 0.5, 0, 1) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* =============================================================== 拡散の中身 */

// 走査和による箱ぼかし。半径が大きくても速度が変わらない
function boxBlurPlane(src, dst, r) {
  const tmp = new Float32Array(LAT * LAT);
  const win = 2 * r + 1;
  for (let y = 0; y < LAT; y++) {
    const row = y * LAT;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + clamp(i, 0, LAT - 1)];
    for (let x = 0; x < LAT; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + clamp(x + r + 1, 0, LAT - 1)] - src[row + clamp(x - r, 0, LAT - 1)];
    }
  }
  for (let x = 0; x < LAT; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[clamp(i, 0, LAT - 1) * LAT + x];
    for (let y = 0; y < LAT; y++) {
      dst[y * LAT + x] = sum / win;
      sum += tmp[clamp(y + r + 1, 0, LAT - 1) * LAT + x]
           - tmp[clamp(y - r, 0, LAT - 1) * LAT + x];
    }
  }
}

const _blurA = new Float32Array(LAT * LAT);
const _blurB = new Float32Array(LAT * LAT);

// latent 全体をぼかす。半径は小数でもよい（整数半径2つの補間）
function blurLatent(lat, radius) {
  const out = new Float32Array(N);
  const r = clamp(radius, 0, LAT * 0.45);
  if (r < 0.02) { out.set(lat); return out; }
  const r0 = Math.floor(r), r1 = r0 + 1, t = r - r0;
  const plane = LAT * LAT;
  for (let c = 0; c < CH; c++) {
    const off = c * plane;
    const src = lat.subarray(off, off + plane);
    if (r0 === 0) {
      boxBlurPlane(src, _blurB, 1);
      for (let i = 0; i < plane; i++) out[off + i] = lerp(src[i], _blurB[i], t);
    } else {
      boxBlurPlane(src, _blurA, r0);
      boxBlurPlane(src, _blurB, r1);
      for (let i = 0; i < plane; i++) out[off + i] = lerp(_blurA[i], _blurB[i], t);
    }
  }
  return out;
}

/* ノイズ予測の本体（本物ではU-Net）。
   「いまの板 x に、どれだけノイズが乗っているか」を答える代わりに、
   ここでは同じ意味の「ノイズを全部取ったらどうなるか（x0）」を返す。

   考え方：
     - ノイズが多い（sigma が大きい）ほど、細かいところは見えない。
       → お手本も、いまの板も、同じだけぼかしてから見る。
     - 見えた範囲では「お手本に寄せる」が、いまの板の内容も少し残す。
       → これがあるのでシード（最初の砂嵐の柄）が結果に効いてくる。
   sigma が 0 に近づくとぼかしが消え、x0 はお手本そのものに収束する。 */
// ノイズがほとんど無くなったら、消すべきノイズも無い。
// つまり終盤の予測は「いまの板」そのものに近づく（keep → 1）。
// ここが1に向かうおかげで、序盤〜中盤で決まった絵が終盤に上書きされずに残る。
function keepAt(sigma) {
  return 1 - (1 - KEEP0) * (sigma / (sigma + SIGMA_H));
}

function predictX0(x, sigma, target) {
  const r = BLUR_PER_SIGMA * sigma;
  const P = blurLatent(target, r);   // お手本のうち、いま見えている分
  const O = blurLatent(x, r);        // いまの板のうち、いま見えている分
  const k = keepAt(sigma);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = P[i] + k * (O[i] - P[i]);
  return out;
}

function stdOf(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - m; v += d * d; }
  return Math.sqrt(v / a.length);
}

/* Classifier-Free Guidance。
   本物とまったく同じ式で、「プロンプトありの予測」と「プロンプトなしの予測」の
   差の方向へ cfg 倍だけ進む。cfg=1 でプロンプトそのまま、0 で無視。

   そのまま倍率を上げると値が振り切れて色が飛ぶので、最後に振れ幅を
   プロンプトありの予測に合わせて戻している（CFG rescale）。これは実際の
   パイプラインでも、高いCFGでの色の焼き付きを抑えるために使われている手法。 */
function guidedEps(x, sigma, tCond, tUncond, cfg) {
  const x0c = predictX0(x, sigma, tCond);
  const epsC = new Float32Array(N);
  for (let i = 0; i < N; i++) epsC[i] = (x[i] - x0c[i]) / sigma;
  if (cfg === 1) return epsC;

  // eps_u + cfg * (eps_c - eps_u) は、eps_c + (cfg - 1) * (eps_c - eps_u) と同じ。
  // 後者の形で書くと「プロンプトありの予測」に「りんごらしさの方向」を
  // 足しているのがはっきりする。
  const x0u = predictX0(x, sigma, tUncond);
  const delta = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const eu = (x[i] - x0u[i]) / sigma;
    delta[i] = (cfg - 1) * (epsC[i] - eu);
  }

  // 足す量が予測ノイズ本体より極端に大きくなると、ノイズ除去そのものが
  // 壊れて画面がざらついてしまう。振れ幅を基準にゆるく頭打ちさせる。
  const sd = stdOf(delta), sc = stdOf(epsC);
  const f = (sd > 1e-6 && sc > 1e-6) ? 1 / (1 + sd / (GUIDE_CAP * sc)) : 1;

  const g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = epsC[i] + delta[i] * f;
  return g;
}

// Karras 方式のノイズスケジュール。最初は大胆に、最後は慎重に削る
function karrasSigmas(steps) {
  const out = [];
  const a = Math.pow(SIGMA_MAX, 1 / RHO), b = Math.pow(SIGMA_MIN, 1 / RHO);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(Math.pow(a + t * (b - a), RHO));
  }
  out.push(0);
  return out;
}

function noiseLatent(seed, sigma) {
  const rng = mulberry32(seed >>> 0);
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = randn(rng) * sigma;
  return x;
}

/* Euler法によるサンプリング。1ステップは
      予測ノイズ eps = (x - x0) / sigma
      x ← x + (次のsigma - いまのsigma) * eps
   という、実際のサンプラーと同じ2行。 */
function sample(opts) {
  const { tCond, tUncond, seed, steps, cfg } = opts;
  const sig = karrasSigmas(steps);
  let x = noiseLatent(seed, sig[0]);
  const frames = [];
  for (let i = 0; i < steps; i++) {
    const s = sig[i], sn = sig[i + 1];
    const eps = guidedEps(x, s, tCond, tUncond, cfg);
    const x0 = new Float32Array(N);   // 表示用の「完成予想図」
    const nx = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      x0[k] = x[k] - s * eps[k];
      nx[k] = clamp(x[k] + (sn - s) * eps[k], -40, 40);
    }
    frames.push({ x, x0, eps, sigma: s, index: i });
    x = nx;
  }
  const last = frames[frames.length - 1];
  frames.push({ x, x0: last.x0, eps: last.eps, sigma: 0, index: steps, final: true });
  return frames;
}

/* ================================================= テキストエンコーダー風 */

// 本物のCLIPトークナイザではなく、日本語を読める形に切るだけの簡易版。
// 「1文が複数のトークンに切られ、それぞれに番号が付く」という構造を見せるのが目的。
const PARTICLES = ["を", "が", "は", "に", "の", "と", "で", "も", "から", "まで"];
const TAILS = ["描いて", "書いて", "生成して", "作って", "ください", "お願い", "して", "、", "。", "！", "!"];

function tokenize(text, parsed) {
  const t = (text || "").trim();
  const marks = [];
  const push = (at, word, kind) => {
    if (at < 0 || !word) return;
    marks.push({ at, word, kind });
  };
  if (parsed.subjectKey) push(t.indexOf(parsed.subjectKey), parsed.subjectKey, "subject");
  if (parsed.colorKey) push(t.indexOf(parsed.colorKey), parsed.colorKey, "color");
  if (parsed.moodKey) push(t.indexOf(parsed.moodKey), parsed.moodKey, "mood");
  for (const w of PARTICLES.concat(TAILS)) {
    let from = 0, at;
    while ((at = t.indexOf(w, from)) >= 0) { push(at, w, "plain"); from = at + w.length; }
  }
  marks.sort((a, b) => a.at - b.at || b.word.length - a.word.length);

  // 左から見ていき、その位置から始まる一番長い既知の語を1トークンにする
  const tokens = [];
  let i = 0;
  while (i < t.length) {
    const here = marks.filter((m) => m.at === i);
    if (here.length) {
      const m = here.reduce((a, b) => (b.word.length > a.word.length ? b : a));
      tokens.push({ word: m.word, kind: m.kind });
      i += m.word.length;
    } else {
      tokens.push({ word: t[i], kind: "plain" });
      i += 1;
    }
  }
  const out = [{ word: "<start>", kind: "special" }].concat(tokens);
  out.push({ word: "<end>", kind: "special" });
  for (const tk of out) tk.id = 300 + (hash32(tk.word) % 49100);
  return out;
}

// トークン番号から決まる12次元の見せかけベクトル（本物は768次元）
function tokenVector(token, dim) {
  const rng = mulberry32(hash32(token.word) ^ 0x9e3779b9);
  const v = [];
  const gain = token.kind === "subject" ? 1 : token.kind === "special" ? 0.35 : 0.7;
  for (let i = 0; i < dim; i++) v.push((rng() * 2 - 1) * gain);
  return v;
}

/* ============================================================== 画面まわり */

const $ = (id) => document.getElementById(id);

// プロンプトはユーザーが自由に打つ文字列なので、HTMLに差し込む前に必ず通す
function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const el = {
  prompt: $("prompt"), presets: $("presets"),
  seed: $("seed"), seedVal: $("seed-val"),
  steps: $("steps"), stepsVal: $("steps-val"),
  cfg: $("cfg"), cfgVal: $("cfg-val"),
  run: $("run"), reroll: $("reroll"), tourStop: $("tour-stop"),
  parseNote: $("parse-note"), rail: $("rail"),
  parseCards: $("parse-cards"),
  tokList: $("tok-list"), condMap: $("cond-map"), uncondMap: $("uncond-map"),
  noiseView: $("noise-view"), noiseChans: $("noise-chans"),
  difX: $("dif-x"), difEps: $("dif-eps"), difX0: $("dif-x0"),
  difSlider: $("dif-slider"), difPlay: $("dif-play"),
  difFirst: $("dif-first"), difLast: $("dif-last"),
  difReadout: $("dif-readout"), difStrip: $("dif-strip"),
  vaeLat: $("vae-lat"), vaeOut: $("vae-out"),
  fwCanvas: $("fw-canvas"), fwSlider: $("fw-slider"), fwLabel: $("fw-label"),
  labCfg: $("lab-cfg"), labSteps: $("lab-steps"), labSeed: $("lab-seed"),
  labRun: $("lab-run"),
};

const state = {
  parsed: null, tCond: null, tUncond: null,
  frames: [], seed: 42, steps: 24, cfg: 7,
  playing: false, rafId: 0, tourTimers: [],
};

function ctxOf(canvas) { return canvas.getContext("2d", { willReadFrequently: true }); }

function scaledCopy(lat, k) {
  const o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = lat[i] * k;
  return o;
}

// x はノイズの分だけ値が大きいので、見るときは大きさをそろえる
function viewScale(sigma) { return 1 / Math.sqrt(1 + sigma * sigma); }

const PRESETS = [
  "りんごを描いて", "赤いりんごを描いて", "青いりんごを描いて",
  "ねこを描いて", "夕焼けの山", "夜の家", "ピンクの花を描いて",
  "コーヒーカップ", "雪の山", "ドラゴンを描いて",
];

/* ---------------------------------------------------- ステージ1：解析結果 */

function renderStage1() {
  const p = state.parsed;
  const cards = [
    { t: "主役", v: p.subject ? p.subject.emoji + " " + p.subject.label : "❓ 見つからず",
      s: p.subject ? "「" + esc(p.subjectKey) + "」という言葉から" : "覚えている言葉がありませんでした" },
    { t: "色", v: p.color ? "🎨 " + p.color.label : "— 指定なし",
      s: p.color ? "「" + esc(p.colorKey) + "」という言葉から" : "主役の標準の色を使います" },
    { t: "時間帯・天気", v: p.mood.emoji + " " + p.mood.label,
      s: p.moodKey ? "「" + esc(p.moodKey) + "」という言葉から" : "指定がないので昼にしました" },
  ];
  el.parseCards.innerHTML = cards.map((c) =>
    '<div class="cv-card"><div class="cv-title">' + c.t + '</div>' +
    '<div style="text-align:center;font-size:17px;font-weight:700;padding:6px 0;">' + c.v + '</div>' +
    '<div class="cv-sub">' + c.s + '</div></div>').join("");

  if (p.subject) {
    let msg = "<b>" + p.subject.label + "</b> を描く、と受け取りました。";
    if (p.color) msg += " 色は <b>" + p.color.label + "</b>。";
    if (p.moodKey) msg += " 場面は <b>" + p.mood.label + "</b>。";
    el.parseNote.className = "parse-note";
    el.parseNote.innerHTML = msg;
  } else {
    el.parseNote.className = "parse-note miss";
    el.parseNote.innerHTML =
      "この言葉は<b>覚えていません</b>でした。描けるのは " +
      SUBJECTS.map((s) => s.emoji + s.label).join("・") +
      " だけです。<br>本物のAIも同じで、学習データに入っていないものは描けません（このデモの語彙が極端に少ないだけです）。";
  }
}

/* -------------------------------------------- ステージ2：トークンと指示書 */

const VEC_DIM = 12;

function renderStage2() {
  const tokens = tokenize(state.parsed.text, state.parsed);
  el.tokList.innerHTML = tokens.map((tk) => {
    const v = tokenVector(tk, VEC_DIM);
    const bars = v.map((x) =>
      '<i style="height:' + (8 + Math.abs(x) * 90).toFixed(0) + '%;opacity:' +
      (0.35 + Math.abs(x) * 0.65).toFixed(2) + '"></i>').join("");
    const cls = "tok" + (tk.kind === "special" ? " special" : "") +
      (tk.kind === "subject" || tk.kind === "color" || tk.kind === "mood" ? " key" : "");
    return '<div class="' + cls + '"><div class="w">' + esc(tk.word) + '</div>' +
      '<div class="id">#' + tk.id + '</div><div class="bars">' + bars + '</div></div>';
  }).join("");

  drawCondMap(el.condMap, tokens);
  drawCondMap(el.uncondMap, tokenize("", { subjectKey: null, colorKey: null, moodKey: null }));
}

// 77トークン × 16成分の「指示書」を1枚の図にする
function drawCondMap(canvas, tokens) {
  const ctx = ctxOf(canvas);
  const W = canvas.width, H = canvas.height;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let x = 0; x < W; x++) {
    const tk = tokens[x];
    const v = tk ? tokenVector(tk, H) : null;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (!v) {                       // 使われていない枠（パディング）
        d[i] = 232; d[i + 1] = 233; d[i + 2] = 238;
      } else {
        const t = clamp(v[y] * 0.5 + 0.5, 0, 1);
        d[i] = 40 + t * 150;
        d[i + 1] = 60 + t * 90;
        d[i + 2] = 130 + t * 120;
      }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------ ステージ3：最初のノイズ */

function renderStage3() {
  const x = state.frames[0].x;
  const view = scaledCopy(x, 1 / SIGMA_MAX);
  drawLatentRaw(view, ctxOf(el.noiseView));

  if (!el.noiseChans.childElementCount) {
    el.noiseChans.innerHTML = CH_LABELS.map((label, i) =>
      '<div class="chan"><canvas width="' + LAT + '" height="' + LAT +
      '" class="pixelated" id="nch' + i + '"></canvas><span>ch' + i + '<br>' + label + '</span></div>').join("");
  }
  for (let c = 0; c < CH; c++) drawChannel(view, c, ctxOf($("nch" + c)), 2.4);
}

/* -------------------------------------------- ステージ4：ノイズを取り除く */

function renderFrame(i) {
  const f = state.frames[clamp(i, 0, state.frames.length - 1)];
  const k = viewScale(f.sigma);
  drawLatentRaw(scaledCopy(f.x, k), ctxOf(el.difX));
  // 予測ノイズは、ステップによって値の大きさが桁違いに変わるので、
  // 見た目の濃さがそろうように毎回そのフレームの振れ幅で割ってから表示する
  const es = stdOf(f.eps);
  drawLatentRaw(scaledCopy(f.eps, es > 1e-6 ? 0.85 / es : 0.85), ctxOf(el.difEps));
  decode(f.x0, ctxOf(el.difX0));

  const total = state.frames.length - 1;
  const pct = (f.sigma / SIGMA_MAX) * 100;
  el.difReadout.innerHTML =
    "<span>ステップ <b>" + f.index + " / " + total + "</b></span>" +
    "<span>残りノイズ量 σ = <b>" + f.sigma.toFixed(2) + "</b></span>" +
    "<span>ノイズの多さ <b>" + pct.toFixed(1) + "%</b></span>" +
    "<span>" + (f.final ? "完成（このあとステージ5でデコード）" : "まだ削っている途中") + "</span>";
}

function renderStrip() {
  const n = state.frames.length;
  const picks = [];
  const want = Math.min(8, n);
  for (let i = 0; i < want; i++) picks.push(Math.round((i / (want - 1)) * (n - 1)));
  el.difStrip.innerHTML = picks.map((i) =>
    '<figure><canvas width="80" height="80" id="stp' + i + '"></canvas>' +
    '<figcaption>' + state.frames[i].index + '</figcaption></figure>').join("");
  for (const i of picks) decode(state.frames[i].x0, ctxOf($("stp" + i)));
}

function setPlaying(on) {
  state.playing = on;
  el.difPlay.textContent = on ? "⏸ 一時停止" : "▶ 再生";
  if (!on) { cancelAnimationFrame(state.rafId); return; }
  const total = state.frames.length - 1;
  let idx = Number(el.difSlider.value);
  if (idx >= total) idx = 0;
  const perFrame = Math.max(45, 3600 / Math.max(1, total));
  let last = performance.now();
  const tick = (now) => {
    if (!state.playing) return;
    if (now - last >= perFrame) {
      last = now;
      idx += 1;
      if (idx > total) { setPlaying(false); return; }
      el.difSlider.value = String(idx);
      renderFrame(idx);
    }
    state.rafId = requestAnimationFrame(tick);
  };
  el.difSlider.value = String(idx);
  renderFrame(idx);
  state.rafId = requestAnimationFrame(tick);
}

/* ------------------------------------------------ ステージ5：VAEデコード */

function renderStage5() {
  const finalLat = state.frames[state.frames.length - 1].x;
  drawLatentRaw(finalLat, ctxOf(el.vaeLat));
  decode(finalLat, ctxOf(el.vaeOut));
}

/* -------------------------------------- おまけ：ノイズを足していく（学習） */

function renderForward() {
  const t = Number(el.fwSlider.value) / 100;
  // 絵が崩れていく様子が見えるのは σ が 0.1〜1 あたり。そこがスライダーの
  // 端に潰れないよう、対数的に上げていく
  const sigma = t <= 0 ? 0 : FW_MIN * Math.pow(SIGMA_MAX / FW_MIN, t);
  const noise = noiseLatent(state.seed * 7 + 13, 1);
  const lat = new Float32Array(N);
  for (let i = 0; i < N; i++) lat[i] = state.tCond[i] + noise[i] * sigma;
  const k = viewScale(sigma);
  drawLatentRaw(scaledCopy(lat, k), ctxOf(el.fwCanvas));
  el.fwLabel.innerHTML = "ノイズ量 σ = <b>" + sigma.toFixed(2) + "</b>（" +
    (t === 0 ? "お手本そのもの" : t >= 0.99 ? "ここがステージ3のスタート地点" : "練習問題として使える状態") + "）";
}

/* -------------------------------------------------------- おまけ：実験室 */

function renderLabGrid(container, variants) {
  container.innerHTML = variants.map((v, i) =>
    '<figure><canvas width="112" height="112" id="' + container.id + '-c' + i + '"></canvas>' +
    '<figcaption><b>' + v.head + '</b>' + v.note + '</figcaption></figure>').join("");
  variants.forEach((v, i) => {
    const frames = sample({
      tCond: v.tCond || state.tCond, tUncond: state.tUncond,
      seed: v.seed, steps: v.steps, cfg: v.cfg,
    });
    decode(frames[frames.length - 1].x, ctxOf($(container.id + "-c" + i)));
  });
}

function renderLab() {
  renderLabGrid(el.labCfg, [0, 1, 4, 8, 18].map((c) => ({
    head: "CFG " + c, seed: state.seed, steps: 24, cfg: c,
    note: c === 0 ? "プロンプト無視" : c === 1 ? "そのまま" : c === 4 ? "やや控えめ"
      : c === 8 ? "標準的" : "強すぎ・色が焼ける",
  })));
  renderLabGrid(el.labSteps, [2, 4, 8, 16, 40].map((s) => ({
    head: s + " ステップ", seed: state.seed, steps: s, cfg: state.cfg,
    note: s === 2 ? "形にならない" : s === 4 ? "輪郭がまだあまい"
      : s === 8 ? "だいぶ整う" : "ここから先はほぼ変わらない",
  })));
  renderLabGrid(el.labSeed, [0, 1, 2, 3].map((i) => {
    const seed = state.seed + i * 17;
    return {
      head: "シード " + seed, seed: seed, steps: 20, cfg: state.cfg,
      tCond: encode(renderTarget(state.parsed, seed)),
      note: "設定は全部同じ",
    };
  }));
}

/* -------------------------------------------------------------- 生成実行 */

function readControls() {
  state.seed = Number(el.seed.value);
  state.steps = Number(el.steps.value);
  state.cfg = Number(el.cfg.value);
  el.seedVal.textContent = String(state.seed);
  el.stepsVal.textContent = String(state.steps);
  el.cfgVal.textContent = state.cfg.toFixed(1);
}

function generate() {
  setPlaying(false);
  readControls();
  state.parsed = parsePrompt(el.prompt.value);
  state.tCond = encode(renderTarget(state.parsed, state.seed));
  state.tUncond = makeUncondTarget(state.tCond);
  state.frames = sample({
    tCond: state.tCond, tUncond: state.tUncond,
    seed: state.seed, steps: state.steps, cfg: state.cfg,
  });

  renderStage1();
  renderStage2();
  renderStage3();
  el.difSlider.max = String(state.frames.length - 1);
  el.difSlider.value = "0";
  renderFrame(0);
  renderStrip();
  renderStage5();
  renderForward();
}

/* ------------------------------------------------------------ 順番の案内 */

function clearTour() {
  state.tourTimers.forEach(clearTimeout);
  state.tourTimers = [];
  el.tourStop.hidden = true;
  document.querySelectorAll(".stage").forEach((s) => s.classList.remove("lit"));
  el.rail.querySelectorAll("li").forEach((li) => li.classList.remove("active"));
}

function lightStage(id) {
  document.querySelectorAll(".stage").forEach((s) => s.classList.remove("lit"));
  el.rail.querySelectorAll("li").forEach((li) =>
    li.classList.toggle("active", li.dataset.target === id));
  const node = $(id);
  if (!node) return;
  node.classList.add("lit");
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

function runTour() {
  clearTour();
  el.tourStop.hidden = false;
  const order = ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5"];
  const gap = 2000;
  order.forEach((id, i) => {
    state.tourTimers.push(setTimeout(() => {
      lightStage(id);
      if (id === "stage-4") setPlaying(true);
      if (i === order.length - 1) {
        state.tourTimers.push(setTimeout(() => {
          el.tourStop.hidden = true;
          document.querySelectorAll(".stage").forEach((s) => s.classList.remove("lit"));
        }, 2600));
      }
    }, i * gap + (i > 3 ? 2600 : 0)));
  });
}

/* -------------------------------------------------------------- イベント */

function wire() {
  el.presets.innerHTML = PRESETS.map((p) =>
    '<button class="chip" type="button">' + p + '</button>').join("");
  el.presets.addEventListener("click", (e) => {
    if (!e.target.classList.contains("chip")) return;
    el.prompt.value = e.target.textContent;
    generate();
    lightStage("stage-1");
  });

  for (const s of [el.seed, el.steps, el.cfg]) {
    s.addEventListener("input", () => {
      readControls();
      if (s === el.seed) {           // シードはドラッグ中も即反映して楽しめるように
        state.parsed = parsePrompt(el.prompt.value);
        state.tCond = encode(renderTarget(state.parsed, state.seed));
        state.tUncond = makeUncondTarget(state.tCond);
        state.frames = sample({
          tCond: state.tCond, tUncond: state.tUncond,
          seed: state.seed, steps: state.steps, cfg: state.cfg,
        });
        renderStage3();
        el.difSlider.max = String(state.frames.length - 1);
        renderFrame(Number(el.difSlider.value));
        renderStage5();
      }
    });
    s.addEventListener("change", () => { generate(); });
  }

  el.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { generate(); runTour(); }
  });
  el.run.addEventListener("click", () => { generate(); runTour(); });
  el.tourStop.addEventListener("click", clearTour);
  el.reroll.addEventListener("click", () => {
    el.seed.value = String(1 + Math.floor(Math.random() * 200));
    generate();
    lightStage("stage-3");
  });

  el.difSlider.addEventListener("input", () => {
    setPlaying(false);
    renderFrame(Number(el.difSlider.value));
  });
  el.difPlay.addEventListener("click", () => setPlaying(!state.playing));
  el.difFirst.addEventListener("click", () => {
    setPlaying(false); el.difSlider.value = "0"; renderFrame(0);
  });
  el.difLast.addEventListener("click", () => {
    setPlaying(false);
    el.difSlider.value = el.difSlider.max;
    renderFrame(Number(el.difSlider.max));
  });

  el.fwSlider.addEventListener("input", renderForward);
  el.labRun.addEventListener("click", renderLab);

  el.rail.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) { clearTour(); lightStage(li.dataset.target); }
  });

  // 数値表示を実データに合わせる
  $("px-size").textContent = IMG + " × " + IMG + " × 3色";
  $("lat-size").textContent = LAT + " × " + LAT + " × 4チャンネル";
  const pxCount = IMG * IMG * 3, latCount = LAT * LAT * CH;
  $("px-count").textContent = pxCount.toLocaleString() + "個";
  $("lat-count").textContent = latCount.toLocaleString() + "個";
}

window.addEventListener("DOMContentLoaded", () => {
  wire();
  generate();
  renderLab();
});
