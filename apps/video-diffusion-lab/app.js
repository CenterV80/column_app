"use strict";

/* =========================================================================
   動画生成AI ラボ

   画像生成の拡散モデルに「時間軸」を足すと何が変わるのかを、ブラウザ内の
   シミュレーションで確かめるための実験室。

   latent が [フレーム][チャンネル][縦][横] の4次元になるだけで、
   サンプラー・CFG・スケジュールは画像版とまったく同じ式が動く。
   動画特有なのは、時間方向も圧縮されること と、
   フレーム同士を見せ合う「時間方向の結合」があること の2つ。

   本物のDiTの代わりに「答えを知っているぼかし器」を使っている点だけが
   作り物。詳しくは index.html の最終セクションを参照。
   ========================================================================= */

const LAT = 24;              // latent の一辺（セル数）
const CH = 4;                // latent のチャンネル数
const FLAT = 6;              // latent のフレーム数
const SCALE = 8;             // 空間方向の圧縮率（1/8）
const TCOMP = 4;             // 時間方向の圧縮率（1/4）
const IMG = LAT * SCALE;     // 出力の一辺 = 192px
const FOUT = FLAT * TCOMP;   // 出力フレーム数 = 24
const FPS = 12;              // 再生フレームレート（24フレームで2秒）

const PLANE = LAT * LAT;
const FRAME_N = CH * PLANE;  // latent 1フレームぶんの要素数
const N = FLAT * FRAME_N;    // latent 全体の要素数

const SIGMA_MAX = 12;        // 最初に乗せるノイズの大きさ
const SIGMA_MIN = 0.0008;    // 最後まで削ったあとに残るノイズ
const RHO = 6;               // Karras スケジュールの曲がり具合
const BLUR_PER_SIGMA = 0.55; // ノイズが多いほど細部が見えない、の係数
const TIME_BLUR = 1.5;       // 時間方向にどれだけ隣のフレームを見るか（latentフレーム単位）
const KEEP0 = 0.2;           // ノイズが多いとき、予測が「いまの板」を信じる度合い
const SIGMA_H = 0.012;       // これを下回ると、予測はほぼ「いまの板」そのものになる
const GUIDE_CAP = 4.5;       // ガイダンス分をこの倍率あたりで頭打ちにする

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

function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

/* ------------------------------------------------------- プロンプト解析 */

const SUBJECTS = [
  { id: "apple", label: "りんご", emoji: "🍎", hue: 5,
    keys: ["りんご", "リンゴ", "林檎", "apple"] },
  { id: "cat", label: "ねこ", emoji: "🐱", hue: 32,
    keys: ["ねこ", "猫", "ネコ", "にゃんこ", "cat"] },
  { id: "balloon", label: "風船", emoji: "🎈", hue: 348,
    keys: ["風船", "ふうせん", "バルーン", "balloon"] },
  { id: "rocket", label: "ロケット", emoji: "🚀", hue: 210,
    keys: ["ロケット", "rocket", "宇宙船"] },
  { id: "ball", label: "ボール", emoji: "⚽", hue: 200,
    keys: ["ボール", "ball", "まり", "球"] },
  { id: "flower", label: "花", emoji: "🌸", hue: 330,
    keys: ["花", "はな", "flower", "チューリップ", "ひまわり"] },
];

const MOTIONS = [
  { id: "bounce", label: "跳ねる", emoji: "🏀",
    keys: ["跳ね", "はね", "バウンド", "bounce", "ジャンプ"] },
  { id: "cross", label: "横切る", emoji: "➡️",
    keys: ["横切", "よこぎ", "流れ", "走る", "移動", "右へ", "左へ", "pan"] },
  { id: "zoom", label: "近づく", emoji: "🔍",
    keys: ["近づ", "ちかづ", "ズーム", "寄る", "zoom", "大きくな"] },
  { id: "spin", label: "回る", emoji: "🔄",
    keys: ["回る", "回転", "まわ", "spin", "くるくる"] },
  { id: "float", label: "浮かび上がる", emoji: "🎈",
    keys: ["浮か", "うか", "飛んで", "上昇", "上に", "float"] },
  { id: "sway", label: "ゆれる", emoji: "🍃",
    keys: ["ゆれ", "揺れ", "そよ", "sway", "なびく"] },
];

const COLORS = [
  { label: "赤", hue: 4, keys: ["赤", "あか", "レッド", "red"] },
  { label: "青", hue: 215, keys: ["青", "あお", "ブルー", "blue"] },
  { label: "黄色", hue: 48, keys: ["黄", "きいろ", "イエロー", "yellow"] },
  { label: "緑", hue: 130, keys: ["緑", "みどり", "グリーン", "green"] },
  { label: "紫", hue: 280, keys: ["紫", "むらさき", "パープル", "purple"] },
  { label: "ピンク", hue: 335, keys: ["ピンク", "桃色", "pink"] },
  { label: "オレンジ", hue: 28, keys: ["オレンジ", "橙", "orange"] },
];

const MOODS = [
  { id: "night", label: "夜", emoji: "🌙", keys: ["夜", "よる", "night", "星空"] },
  { id: "sunset", label: "夕焼け", emoji: "🌇", keys: ["夕焼け", "夕暮れ", "夕方", "sunset"] },
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
  const m = matchGroup(t, MOTIONS);
  const c = matchGroup(t, COLORS);
  const d = matchGroup(t, MOODS);
  return {
    text: t,
    subject: s ? s.item : null, subjectKey: s ? s.key : null,
    motion: m ? m.item : MOTIONS[0], motionKey: m ? m.key : null,
    color: c ? c.item : null, colorKey: c ? c.key : null,
    mood: d ? d.item : MOODS[2], moodKey: d ? d.key : null,
  };
}

/* --------------------------------------------------------- お手本の動画

   本物のモデルは学習で覚えた動きを思い出しながら描くが、ここではその代わりに
   キャンバスへ直接、時刻 t の絵を描く。t を 0→1 と動かせば動画になる。   */

function newCanvas(w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
}

let SAT_MUL = 1;
function hslStr(h, s, l) {
  const hh = (((h % 360) + 360) % 360).toFixed(1);
  return "hsl(" + hh + ", " + clamp(s * SAT_MUL, 0, 100).toFixed(1) + "%, " +
    clamp(l, 0, 100).toFixed(1) + "%)";
}

function paintBackdrop(ctx, mood, hue, camera) {
  const sky = mood === "night" ? [[228, 50, 30], [255, 36, 46]]
    : mood === "sunset" ? [[22, 74, 62], [335, 58, 72]]
    : [[203, 60, 80], [196, 52, 92]];
  const g = ctx.createLinearGradient(0, 0, 0, IMG);
  g.addColorStop(0, hslStr(sky[0][0], sky[0][1], sky[0][2]));
  g.addColorStop(1, hslStr(sky[1][0], sky[1][1], sky[1][2]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, IMG, IMG);

  // 地面。カメラが動くと一緒に流れるので「動いている感」が出る
  const gl = mood === "night" ? 24 : mood === "sunset" ? 32 : 48;
  ctx.fillStyle = hslStr(mood === "night" ? 230 : 105, 32, gl);
  ctx.fillRect(0, IMG * 0.76, IMG, IMG * 0.24);

  ctx.save();
  ctx.translate(-camera * IMG, 0);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  for (let i = -1; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(IMG * (0.25 + i * 0.5), IMG * 0.82, IMG * 0.14, IMG * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (mood === "night") {
    ctx.fillStyle = "rgba(255,255,225,0.85)";
    const rng = mulberry32(7);
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      ctx.arc(rng() * IMG, rng() * IMG * 0.7, 1 + rng() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* --- 主役だけを描く（背景は別。原点は主役の中心、r が大きさ） --- */

function subjApple(ctx, r, hue, light) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.25);
  g.addColorStop(0, hslStr(hue + 10, 82, 72 * light));
  g.addColorStop(0.55, hslStr(hue, 78, 52 * light));
  g.addColorStop(1, hslStr(hue - 8, 68, 30 * light));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 0.24, r * 0.05, r * 0.78, r * 0.92, 0, 0, Math.PI * 2);
  ctx.ellipse(r * 0.24, r * 0.05, r * 0.78, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 0.9, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hslStr(28, 55, 26 * light);
  ctx.lineWidth = r * 0.12; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.82);
  ctx.quadraticCurveTo(r * 0.06, -r * 1.12, r * 0.16, -r * 1.26);
  ctx.stroke();
  ctx.fillStyle = hslStr(118, 55, 40 * light);
  ctx.beginPath();
  ctx.ellipse(r * 0.5, -r * 1.02, r * 0.3, r * 0.13, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, -r * 0.32, r * 0.18, r * 0.27, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function subjCat(ctx, r, hue, light) {
  const body = hslStr(hue, 45, 62 * light);
  for (const s of [-1, 1]) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(s * r * 0.72, -r * 0.5);
    ctx.lineTo(s * r * 0.95, -r * 1.18);
    ctx.lineTo(s * r * 0.28, -r * 0.85);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = hslStr(340, 55, 78 * light);
    ctx.beginPath();
    ctx.moveTo(s * r * 0.68, -r * 0.58);
    ctx.lineTo(s * r * 0.82, -r * 1.0);
    ctx.lineTo(s * r * 0.42, -r * 0.8);
    ctx.closePath(); ctx.fill();
  }
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.2);
  g.addColorStop(0, hslStr(hue, 45, 76 * light));
  g.addColorStop(1, body);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light < 0.9 ? "#f7e98a" : "#2e6b3f";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.36, -r * 0.1, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#151515";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.36, -r * 0.1, r * 0.07, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = hslStr(345, 60, 62);
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, r * 0.22); ctx.lineTo(r * 0.1, r * 0.22); ctx.lineTo(0, r * 0.36);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = Math.max(1, r * 0.035);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = r * (0.16 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(s * r * 0.4, y);
      ctx.lineTo(s * r * 1.15, y - r * (0.12 - i * 0.1));
      ctx.stroke();
    }
  }
}

function subjBalloon(ctx, r, hue, light) {
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.08, 0, 0, r * 1.2);
  g.addColorStop(0, hslStr(hue + 8, 80, 78 * light));
  g.addColorStop(1, hslStr(hue, 72, 46 * light));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.82, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hslStr(hue, 60, 40 * light);
  ctx.beginPath();
  ctx.moveTo(-r * 0.12, r * 0.98); ctx.lineTo(r * 0.12, r * 0.98); ctx.lineTo(0, r * 1.18);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(0, r * 1.18);
  ctx.quadraticCurveTo(r * 0.28, r * 1.6, 0, r * 2.0);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.36, r * 0.16, r * 0.26, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function subjRocket(ctx, r, hue, light) {
  ctx.fillStyle = hslStr(18, 85, 58 * light);
  ctx.beginPath();
  ctx.moveTo(0, r * 1.5);
  ctx.quadraticCurveTo(-r * 0.3, r * 1.05, 0, r * 0.85);
  ctx.quadraticCurveTo(r * 0.3, r * 1.05, 0, r * 1.5);
  ctx.fill();
  ctx.fillStyle = hslStr(48, 95, 66 * light);
  ctx.beginPath();
  ctx.moveTo(0, r * 1.2);
  ctx.quadraticCurveTo(-r * 0.16, r * 1.0, 0, r * 0.85);
  ctx.quadraticCurveTo(r * 0.16, r * 1.0, 0, r * 1.2);
  ctx.fill();
  ctx.fillStyle = hslStr(hue, 55, 40 * light);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.32, r * 0.4);
    ctx.lineTo(s * r * 0.78, r * 0.95);
    ctx.lineTo(s * r * 0.32, r * 0.9);
    ctx.closePath(); ctx.fill();
  }
  const g = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, 0);
  g.addColorStop(0, hslStr(0, 0, 96 * light));
  g.addColorStop(1, hslStr(hue, 25, 68 * light));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.25);
  ctx.quadraticCurveTo(r * 0.42, -r * 0.2, r * 0.36, r * 0.9);
  ctx.lineTo(-r * 0.36, r * 0.9);
  ctx.quadraticCurveTo(-r * 0.42, -r * 0.2, 0, -r * 1.25);
  ctx.fill();
  ctx.fillStyle = hslStr(200, 70, 55 * light);
  ctx.beginPath();
  ctx.arc(0, -r * 0.25, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function subjBall(ctx, r, hue, light) {
  const g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r * 1.15);
  g.addColorStop(0, hslStr(hue, 20, 96 * light));
  g.addColorStop(1, hslStr(hue, 55, 52 * light));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hslStr(hue, 60, 28 * light);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.42);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
  }
  ctx.closePath(); ctx.fill();
}

function subjFlower(ctx, r, hue, light) {
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.translate(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(-r * 0.6, 0, r * 0.6, 0);
    g.addColorStop(0, hslStr(hue, 68, 84 * light));
    g.addColorStop(1, hslStr(hue - 12, 72, 62 * light));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = hslStr(46, 82, 60 * light);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

const SUBJ_DRAW = {
  apple: subjApple, cat: subjCat, balloon: subjBalloon,
  rocket: subjRocket, ball: subjBall, flower: subjFlower,
};

/* 時刻 t（0〜1）における主役の置き方。動きの種類ごとに決める。
   戻り値：中心座標・大きさ・回転・カメラの横移動量 */
function motionAt(motion, t, rng0) {
  const base = { x: 0.5, y: 0.52, scale: 1, rot: 0, camera: 0 };
  const p = Math.PI * 2 * t;
  switch (motion) {
    case "bounce": {
      const h = 0.5 + 0.5 * Math.cos(p); // t=0 で最高点、t=0.5 で接地、t=1 でまた最高点
      base.y = 0.68 - h * 0.34;
      base.scale = 1 + (1 - h) * 0.07;   // 接地でつぶれる
      break;
    }
    case "cross":
      base.x = -0.12 + t * 1.24;
      base.camera = t * 0.4;
      base.rot = Math.sin(p * 2) * 0.12;
      break;
    case "zoom":
      base.scale = 0.5 + ease(t) * 1.15;
      base.y = 0.55 - ease(t) * 0.04;
      break;
    case "spin":
      base.rot = p;
      break;
    case "float":
      base.y = 0.86 - ease(t) * 0.66;
      base.x = 0.5 + Math.sin(p) * 0.09;
      base.scale = 1 - t * 0.18;
      break;
    case "sway":
      base.x = 0.5 + Math.sin(p) * 0.14;
      base.rot = Math.sin(p) * 0.28;
      break;
  }
  base.x += (rng0 - 0.5) * 0.06;
  return base;
}

/* お手本動画の1フレームを描いて ImageData で返す。

   variant は「モデルが持つ自由度」を表す軸。0 と 1 のどちらも
   同じプロンプトの正解になりうる、少し違う描き方を指す。         */
function renderTargetFrame(parsed, seed, frameIndex, variant) {
  const cv = newCanvas(IMG, IMG);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const rng = mulberry32((seed >>> 0) * 2654435761 + 7);
  const jitter = rng();
  const sizeJit = rng();
  const mood = parsed.mood.id;
  const light = mood === "night" ? 0.84 : 1;
  const v = variant || 0;
  let hue = parsed.subject ? parsed.subject.hue : 30;
  if (parsed.color) hue = parsed.color.hue;
  hue += (rng() - 0.5) * 22 + v * 46;   // 色みの自由度
  SAT_MUL = 1;

  const t = frameIndex / FOUT;
  const m = motionAt(parsed.motion.id, t, jitter);
  paintBackdrop(ctx, mood, hue, m.camera);

  if (!parsed.subject) {
    // 覚えていない言葉のとき：形の定まらない塊がゆっくり動くだけ
    const g = ctx.createRadialGradient(IMG * m.x, IMG * m.y, 0, IMG * m.x, IMG * m.y, IMG * (0.3 + v * 0.1));
    g.addColorStop(0, hslStr(hue, 30, 62 + v * 12));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, IMG, IMG);
    return ctx.getImageData(0, 0, IMG, IMG);
  }

  const r = IMG * (0.17 + sizeJit * 0.05) * m.scale * (1 + v * 0.3); // 大きさの自由度
  // 影は接地感を出すので、主役より先に地面へ落とす
  ctx.save();
  ctx.globalAlpha = 0.2 * clamp(1 - (0.76 - m.y) * 1.6, 0.15, 1);
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(IMG * m.x, IMG * 0.8, r * 0.9, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(IMG * m.x, IMG * m.y);
  ctx.rotate(m.rot);
  SUBJ_DRAW[parsed.subject.id](ctx, r, hue, light);
  ctx.restore();

  return ctx.getImageData(0, 0, IMG, IMG);
}

/* ================================================================ 動画VAE

   エンコード：192×192×3色 × 24フレーム → 24×24×4ch × 6フレーム
   空間を1/8に縮めるだけでなく、時間も1/4に縮める。
   つまり「4フレームぶんが、latentの1フレームに畳まれる」。

   本物の動画VAEもこの形で、8×8×4（または×8）に圧縮しつつ
   チャンネルを16へ増やすものが主流。LTX-Videoはさらに攻めた
   32×32×8・128チャンネルという構成をとっている。               */

const CH_LABELS = ["明るさ", "赤 - 緑", "黄 - 青", "輪郭"];

const wrapF = (f) => ((f % FLAT) + FLAT) % FLAT;

function encodeVideo(frames) {
  const lat = new Float32Array(N);
  for (let lf = 0; lf < FLAT; lf++) {
    for (let ly = 0; ly < LAT; ly++) {
      for (let lx = 0; lx < LAT; lx++) {
        let sr = 0, sg = 0, sb = 0, lmin = 1e9, lmax = -1e9;
        // 空間 SCALE×SCALE ピクセルを1セルにまとめる。
        // 時間方向は「代表の1フレーム」を取る。TCOMP枚を平均してしまうと
        // 速い動きが溶けて跡形もなくなるし、本物のVAEもそういう潰し方はしない。
        // 代表以外のフレームで起きたことは、ここで丸ごと捨てられる。
        const px = frames[lf * TCOMP + (TCOMP >> 1)].data;
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
        const o = lf * FRAME_N + ly * LAT + lx;
        lat[o] = (L - 0.5) * 2;
        lat[o + PLANE] = (a - b2) * 2;
        lat[o + PLANE * 2] = c * 3;
        lat[o + PLANE * 3] = (lmax - lmin) * 3 - 0.6;
      }
    }
  }
  return lat;
}

// 出力フレーム f にあたる latent を、前後の latent フレームから補間して作る
function latentFrameAt(lat, f) {
  const pos = (f - (TCOMP - 1) / 2) / TCOMP;
  const f0 = Math.floor(pos), t = pos - f0;
  const a = wrapF(f0) * FRAME_N, b = wrapF(f0 + 1) * FRAME_N;
  const out = new Float32Array(FRAME_N);
  for (let i = 0; i < FRAME_N; i++) out[i] = lerp(lat[a + i], lat[b + i], t);
  return out;
}

function upsampleChannel(frame, ch, w) {
  const out = new Float32Array(w * w);
  const off = ch * PLANE;
  const s = LAT / w;
  for (let y = 0; y < w; y++) {
    const fy = clamp((y + 0.5) * s - 0.5, 0, LAT - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, LAT - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) * s - 0.5, 0, LAT - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, LAT - 1), tx = fx - x0;
      const a = lerp(frame[off + y0 * LAT + x0], frame[off + y0 * LAT + x1], tx);
      const b = lerp(frame[off + y1 * LAT + x0], frame[off + y1 * LAT + x1], tx);
      out[y * w + x] = lerp(a, b, ty);
    }
  }
  return out;
}

function channelsToRGB(c0, c1, c2) {
  const L = c0 / 2 + 0.5;
  const cB = c2 / 3;
  const diff = c1 / 2;
  return [L + (-cB + diff) / 2, L + (-cB - diff) / 2, L + cB];
}

// latent 1フレームを w×w の ImageData に展開する
function decodeFrame(frame, w) {
  const smoothed = blurFramePlane(frame, 3, 1.2);
  const up = [0, 1, 2].map((c) => upsampleChannel(frame, c, w));
  up.push(upsampleChannel(smoothed, 3, w));
  const n = w * w;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rgb = channelsToRGB(up[0][i], up[1][i], up[2][i]);
    R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
  }
  const img = new ImageData(w, w);
  const d = img.data;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let sr = 0, sg = 0, sb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = clamp(y + dy, 0, w - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const j = yy * w + clamp(x + dx, 0, w - 1);
          sr += R[j]; sg += G[j]; sb += B[j];
        }
      }
      const amt = clamp(0.3 + up[3][i] * 0.8, 0, 1.3);
      const k = i * 4;
      d[k] = clamp(R[i] + (R[i] - sr / 9) * amt, 0, 1) * 255;
      d[k + 1] = clamp(G[i] + (G[i] - sg / 9) * amt, 0, 1) * 255;
      d[k + 2] = clamp(B[i] + (B[i] - sb / 9) * amt, 0, 1) * 255;
      d[k + 3] = 255;
    }
  }
  return img;
}

// latent 1フレームを、拡大せずそのまま色として見る（latentの生の姿）
function latentFrameToImageData(frame) {
  const img = new ImageData(LAT, LAT);
  const d = img.data;
  for (let i = 0; i < PLANE; i++) {
    const rgb = channelsToRGB(frame[i], frame[PLANE + i], frame[PLANE * 2 + i]);
    d[i * 4] = clamp(rgb[0], 0, 1) * 255;
    d[i * 4 + 1] = clamp(rgb[1], 0, 1) * 255;
    d[i * 4 + 2] = clamp(rgb[2], 0, 1) * 255;
    d[i * 4 + 3] = 255;
  }
  return img;
}

function channelToImageData(frame, ch, span) {
  const img = new ImageData(LAT, LAT);
  const d = img.data;
  const off = ch * PLANE;
  for (let i = 0; i < PLANE; i++) {
    const v = clamp(frame[off + i] / span * 0.5 + 0.5, 0, 1) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return img;
}

/* ============================================== ぼかし（空間 + 時間方向） */

function boxBlurPlaneInto(src, off, dst, r) {
  const tmp = new Float32Array(PLANE);
  const win = 2 * r + 1;
  for (let y = 0; y < LAT; y++) {
    const row = y * LAT;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[off + row + clamp(i, 0, LAT - 1)];
    for (let x = 0; x < LAT; x++) {
      tmp[row + x] = sum / win;
      sum += src[off + row + clamp(x + r + 1, 0, LAT - 1)]
           - src[off + row + clamp(x - r, 0, LAT - 1)];
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

const _bA = new Float32Array(PLANE);
const _bB = new Float32Array(PLANE);

// latent 1フレームの1チャンネルだけをぼかして返す（decode の ch3 用）
function blurFramePlane(frame, ch, radius) {
  const out = new Float32Array(FRAME_N);
  out.set(frame);
  const r0 = Math.floor(radius), t = radius - r0;
  boxBlurPlaneInto(frame, ch * PLANE, _bA, Math.max(1, r0));
  boxBlurPlaneInto(frame, ch * PLANE, _bB, Math.max(1, r0) + 1);
  for (let i = 0; i < PLANE; i++) out[ch * PLANE + i] = lerp(_bA[i], _bB[i], t);
  return out;
}

/* latent 全体を、空間半径 rs と 時間半径 rt でぼかす。
   rt = 0 なら各フレームは完全に独立に扱われる（＝画像モデルの状態）。 */
function blurLatent(lat, rs, rt) {
  let cur = lat;
  const r = clamp(rs, 0, LAT * 0.45);
  if (r >= 0.02) {
    const out = new Float32Array(N);
    const r0 = Math.floor(r), t = r - r0;
    for (let f = 0; f < FLAT; f++) {
      for (let c = 0; c < CH; c++) {
        const off = f * FRAME_N + c * PLANE;
        if (r0 === 0) {
          boxBlurPlaneInto(cur, off, _bB, 1);
          for (let i = 0; i < PLANE; i++) out[off + i] = lerp(cur[off + i], _bB[i], t);
        } else {
          boxBlurPlaneInto(cur, off, _bA, r0);
          boxBlurPlaneInto(cur, off, _bB, r0 + 1);
          for (let i = 0; i < PLANE; i++) out[off + i] = lerp(_bA[i], _bB[i], t);
        }
      }
    }
    cur = out;
  }

  const rtc = clamp(rt, 0, FLAT / 2);
  if (rtc < 0.02) return cur === lat ? lat.slice() : cur;

  // 時間方向はループするので、端は巻き戻してつなぐ
  const out = new Float32Array(N);
  const t0 = Math.floor(rtc), tf = rtc - t0;
  for (let c = 0; c < CH; c++) {
    for (let i = 0; i < PLANE; i++) {
      const at = (f) => wrapF(f) * FRAME_N + c * PLANE + i;
      for (const [rr, weight] of [[t0, 1 - tf], [t0 + 1, tf]]) {
        if (weight <= 0) continue;
        const win = 2 * rr + 1;
        let sum = 0;
        for (let k = -rr; k <= rr; k++) sum += cur[at(k)];
        for (let f = 0; f < FLAT; f++) {
          out[at(f)] += (sum / win) * weight;
          sum += cur[at(f + rr + 1)] - cur[at(f - rr)];
        }
      }
    }
  }
  return out;
}

/* ============================================================== 拡散の中身 */

function keepAt(sigma) {
  return 1 - (1 - KEEP0) * (sigma / (sigma + SIGMA_H));
}

/* ノイズ予測。画像版との違いは「時間方向にも隣を見るかどうか」の1点だけ。

   coupled = true  … 動画モデル。隣のフレームも見て予測するので、
                     フレームごとにバラバラだったノイズの影響がならされる。
   coupled = false … 画像モデルを1フレームずつ回した状態。
                     各フレームが自分のノイズだけを頼りに別々の答えへ進む。 */
function predictX0(x, sigma, target, coupled) {
  const rs = BLUR_PER_SIGMA * sigma;
  const P = blurLatent(target, rs, 0);   // お手本のうち、いま見えている分
  const O = blurLatent(x, rs, 0);        // いまの板のうち、いま見えている分
  const k = keepAt(sigma);
  const out = new Float32Array(N);

  if (!coupled) {
    // 各フレームが、自分のフレームの情報だけで予測する（＝画像モデル）
    for (let i = 0; i < N; i++) out[i] = P[i] + k * (O[i] - P[i]);
    return out;
  }

  // 動画モデル。お手本からのズレを、前後のフレームとならしてから足し戻す。
  // お手本そのもの(P)はぼかさないので、動きは鈍らずにズレだけが揃う。
  // 時間方向のAttentionが結局やっているのはこれ。
  const diff = new Float32Array(N);
  for (let i = 0; i < N; i++) diff[i] = O[i] - P[i];
  const pooled = blurLatent(diff, 0, TIME_BLUR);
  for (let i = 0; i < N; i++) out[i] = P[i] + k * pooled[i];
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

function guidedEps(x, sigma, tCond, tUncond, cfg, coupled) {
  const x0c = predictX0(x, sigma, tCond, coupled);
  const epsC = new Float32Array(N);
  for (let i = 0; i < N; i++) epsC[i] = (x[i] - x0c[i]) / sigma;
  if (cfg === 1) return epsC;

  const x0u = predictX0(x, sigma, tUncond, coupled);
  const delta = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    delta[i] = (cfg - 1) * (epsC[i] - (x[i] - x0u[i]) / sigma);
  }
  const sd = stdOf(delta), sc = stdOf(epsC);
  const f = (sd > 1e-6 && sc > 1e-6) ? 1 / (1 + sd / (GUIDE_CAP * sc)) : 1;
  const g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = epsC[i] + delta[i] * f;
  return g;
}

function makeUncondTarget(tCond) {
  const blurred = blurLatent(tCond, 5, 2);
  const out = new Float32Array(N);
  for (let c = 0; c < CH; c++) {
    let mean = 0;
    for (let f = 0; f < FLAT; f++)
      for (let i = 0; i < PLANE; i++) mean += blurred[f * FRAME_N + c * PLANE + i];
    mean /= FLAT * PLANE;
    const gain = c === 0 ? 0.4 : c === 3 ? 0.15 : 0.25;
    for (let f = 0; f < FLAT; f++)
      for (let i = 0; i < PLANE; i++) {
        const j = f * FRAME_N + c * PLANE + i;
        out[j] = mean + (blurred[j] - mean) * gain;
      }
  }
  return out;
}

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

// 最初のノイズはフレームごとに独立。ここが「ちらつき」の種になる
function noiseLatent(seed, sigma) {
  const rng = mulberry32(seed >>> 0);
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = randn(rng) * sigma;
  return x;
}

/* モデルには「どちらでもよい自由度」がある。同じ「跳ねるりんご」でも、
   大きさや色みや位置が少し違う答えがどれも正解になりうる。
   そのどれを選ぶかを決めているのが、そのフレームに置かれたノイズ。

   ここでは自由度の代表として、少しだけ違うお手本をもう1つ用意し、
   「2つのお手本のあいだのどこを選ぶか」を各フレームのノイズに決めさせる。

   隣を見ない場合  … フレームごとに別々の答えを選ぶ → ちらつく
   隣を見る場合    … フレーム全体で1つの答えに合意する → 揃う          */
function ambiguityWeights(noise, coupled) {
  const w = [];
  for (let f = 0; f < FLAT; f++) {
    let m = 0;
    for (let i = 0; i < PLANE; i++) m += noise[f * FRAME_N + i];
    m /= PLANE;                       // そのフレームのノイズの偏り
    w.push(1 / (1 + Math.exp(-m / 0.5)));
  }
  if (!coupled) return w;
  const mean = w.reduce((a, b) => a + b, 0) / FLAT;
  return w.map(() => mean);
}

function blendTarget(tA, tB, w) {
  const out = new Float32Array(N);
  for (let f = 0; f < FLAT; f++) {
    const g = w[f];
    for (let i = 0; i < FRAME_N; i++) {
      const j = f * FRAME_N + i;
      out[j] = lerp(tA[j], tB[j], g);
    }
  }
  return out;
}

function sample(opts) {
  const { tUncond, seed, steps, cfg } = opts;
  const coupled = opts.coupled !== false;
  const sig = karrasSigmas(steps);
  let x = noiseLatent(seed, sig[0]);
  const tCond = opts.tAlt
    ? blendTarget(opts.tCond, opts.tAlt, ambiguityWeights(x, coupled))
    : opts.tCond;
  const frames = [];
  for (let i = 0; i < steps; i++) {
    const s = sig[i], sn = sig[i + 1];
    const eps = guidedEps(x, s, tCond, tUncond, cfg, coupled);
    const x0 = new Float32Array(N);
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

/* ============================================================== 画面まわり */

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const el = {
  prompt: $("prompt"), presets: $("presets"), busy: $("busy"),
  seed: $("seed"), seedVal: $("seed-val"),
  steps: $("steps"), stepsVal: $("steps-val"),
  cfg: $("cfg"), cfgVal: $("cfg-val"),
  run: $("run"), reroll: $("reroll"), tourStop: $("tour-stop"),
  parseNote: $("parse-note"), rail: $("rail"), parseCards: $("parse-cards"),
  latVideo: $("lat-video"), latFrames: $("lat-frames"),
  noiseVideo: $("noise-video"), noiseChans: $("noise-chans"),
  difX: $("dif-x"), difEps: $("dif-eps"), difX0: $("dif-x0"),
  difSlider: $("dif-slider"), difPlay: $("dif-play"),
  difFirst: $("dif-first"), difLast: $("dif-last"), difReadout: $("dif-readout"),
  flickOff: $("flick-off"), flickOn: $("flick-on"), flickMetric: $("flick-metric"),
  vaeLat: $("vae-lat"), vaeOut: $("vae-out"),
  labCfg: $("lab-cfg"), labSteps: $("lab-steps"), labSeed: $("lab-seed"),
  labRun: $("lab-run"),
};

const state = {
  parsed: null, tCond: null, tUncond: null, targetFrames: null,
  frames: [], seed: 42, steps: 20, cfg: 7,
  stepPlaying: false, rafId: 0, tourTimers: [],
};

const ctxOf = (c) => c.getContext("2d", { willReadFrequently: true });

function scaledCopy(lat, k) {
  const o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = lat[i] * k;
  return o;
}
const viewScale = (sigma) => 1 / Math.sqrt(1 + sigma * sigma);

/* ---------------------------------------------------------- 動画プレイヤー

   すべての canvas を1本の時計で回す。個別に requestAnimationFrame を
   持たせると本数ぶん重くなるし、並べたときにズレて比較にならない。      */

const views = [];

function videoView(canvas) {
  const v = { ctx: ctxOf(canvas), frames: null };
  views.push(v);
  return v;
}

function startClock() {
  let last = 0, idx = 0;
  const tick = (now) => {
    if (now - last >= 1000 / FPS) {
      last = now;
      idx = (idx + 1) % FOUT;
      for (const v of views) {
        if (v.frames && v.frames.length) {
          v.ctx.putImageData(v.frames[idx % v.frames.length], 0, 0);
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// latent を「そのままの色」で24フレームぶん展開する
function latentVideoRaw(lat) {
  const out = [];
  for (let f = 0; f < FOUT; f++) out.push(latentFrameToImageData(latentFrameAt(lat, f)));
  return out;
}

// latent をデコードして24フレームぶんの画像にする
function decodeVideo(lat, w) {
  const out = [];
  for (let f = 0; f < FOUT; f++) out.push(decodeFrame(latentFrameAt(lat, f), w));
  return out;
}

/* ちらつきの量を測る。

   単純に隣のフレームの画素を引き算すると、被写体が動いているぶんが
   そのまま出てしまい、ちらつきと区別がつかない。
   そこで「画面全体の平均の色」がフレームごとにどれだけ揺れるかを見る。
   被写体が動くだけなら画面全体の平均はほとんど変わらないので、
   ここが揺れていれば、それは見た目そのものが暴れているということ。   */
function flickerScore(videoFrames) {
  const means = videoFrames.map((im) => {
    const d = im.data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, g / n, b / n];
  });
  let total = 0;
  const n = means.length;
  for (let f = 0; f < n; f++) {
    const a = means[f], b = means[(f + 1) % n];
    total += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
  }
  return total / n;
}

const PRESETS = [
  "りんごが跳ねる", "ねこが横切る", "風船が浮かび上がる", "ロケットが飛ぶ",
  "夜、ボールが跳ねる", "花がゆれる", "夕焼けにねこが回る", "青いりんごに近づく",
  "ドラゴンが跳ねる",
];

/* ---------------------------------------------------- ステージ1：解析結果 */

function renderStage1() {
  const p = state.parsed;
  const cards = [
    { t: "主役", v: p.subject ? p.subject.emoji + " " + p.subject.label : "❓ 見つからず",
      s: p.subject ? "「" + esc(p.subjectKey) + "」から" : "覚えている言葉がありませんでした" },
    { t: "動き", v: p.motion.emoji + " " + p.motion.label,
      s: p.motionKey ? "「" + esc(p.motionKey) + "」から" : "指定がないので「跳ねる」にしました" },
    { t: "色", v: p.color ? "🎨 " + p.color.label : "— 指定なし",
      s: p.color ? "「" + esc(p.colorKey) + "」から" : "主役の標準の色を使います" },
    { t: "時間帯", v: p.mood.emoji + " " + p.mood.label,
      s: p.moodKey ? "「" + esc(p.moodKey) + "」から" : "指定がないので昼にしました" },
  ];
  el.parseCards.innerHTML = cards.map((c) =>
    '<div class="cv-card"><div class="cv-title">' + c.t + '</div>' +
    '<div style="text-align:center;font-size:16px;font-weight:700;padding:6px 0;">' + c.v + '</div>' +
    '<div class="cv-sub">' + c.s + '</div></div>').join("");

  if (p.subject) {
    el.parseNote.className = "parse-note";
    el.parseNote.innerHTML = "<b>" + p.subject.label + "</b> が <b>" + p.motion.label +
      "</b> 動画を作ります。" + (p.moodKey ? " 場面は <b>" + p.mood.label + "</b>。" : "");
  } else {
    el.parseNote.className = "parse-note miss";
    el.parseNote.innerHTML =
      "この主役は<b>覚えていません</b>でした。描けるのは " +
      SUBJECTS.map((s) => s.emoji + s.label).join("・") +
      " だけです。<br>動き（" + MOTIONS.map((m) => m.label).join("・") +
      "）は指定できるので、組み合わせて試してみてください。";
  }
}

/* ------------------------------------------- ステージ2：時間つきlatent */

const latView = videoView(el.latVideo);

function renderStage2() {
  latView.frames = latentVideoRaw(state.tCond);

  el.latFrames.innerHTML = Array.from({ length: FLAT }, (_, f) =>
    '<figure><canvas width="' + LAT + '" height="' + LAT + '" id="lf' + f + '"></canvas>' +
    '<figcaption>' + (f + 1) + '</figcaption></figure>').join("");
  for (let f = 0; f < FLAT; f++) {
    const frame = state.tCond.subarray(f * FRAME_N, (f + 1) * FRAME_N);
    ctxOf($("lf" + f)).putImageData(latentFrameToImageData(frame), 0, 0);
  }

  const pxCount = IMG * IMG * 3 * FOUT;
  const latCount = N;
  $("px-size").textContent = IMG + "×" + IMG + "×3色 × " + FOUT + "フレーム";
  $("lat-size").textContent = LAT + "×" + LAT + "×" + CH + "ch × " + FLAT + "フレーム";
  $("px-count").textContent = pxCount.toLocaleString() + "個";
  $("lat-count").textContent = latCount.toLocaleString() + "個";
  $("ratio").textContent = "約 " + Math.round(pxCount / latCount) + " 分の1（空間 1/" +
    (SCALE * SCALE) + " × 時間 1/" + TCOMP + " × チャンネル 3→" + CH + "）";
}

/* --------------------------------------------- ステージ3：ノイズ動画 */

const noiseView = videoView(el.noiseVideo);

function renderStage3() {
  const x = state.frames[0].x;
  const view = scaledCopy(x, 1 / SIGMA_MAX);
  noiseView.frames = latentVideoRaw(view);

  if (!el.noiseChans.childElementCount) {
    el.noiseChans.innerHTML = CH_LABELS.map((label, i) =>
      '<div class="chan"><canvas width="' + LAT + '" height="' + LAT +
      '" class="pixelated" id="nch' + i + '"></canvas><span>ch' + i + '<br>' +
      label + '</span></div>').join("");
  }
  const first = view.subarray(0, FRAME_N);
  for (let c = 0; c < CH; c++) {
    ctxOf($("nch" + c)).putImageData(channelToImageData(first, c, 2.4), 0, 0);
  }
}

/* ------------------------------------------------- ステージ4：削り出し */

const difXView = videoView(el.difX);
const difEpsView = videoView(el.difEps);
const difX0View = videoView(el.difX0);

function renderStep(i) {
  const f = state.frames[clamp(i, 0, state.frames.length - 1)];
  difXView.frames = latentVideoRaw(scaledCopy(f.x, viewScale(f.sigma)));
  const es = stdOf(f.eps);
  difEpsView.frames = latentVideoRaw(scaledCopy(f.eps, es > 1e-6 ? 0.85 / es : 0.85));
  difX0View.frames = decodeVideo(f.x0, el.difX0.width);

  const total = state.frames.length - 1;
  el.difReadout.innerHTML =
    "<span>ステップ <b>" + f.index + " / " + total + "</b></span>" +
    "<span>残りノイズ量 σ = <b>" + f.sigma.toFixed(2) + "</b></span>" +
    "<span>ノイズの多さ <b>" + ((f.sigma / SIGMA_MAX) * 100).toFixed(1) + "%</b></span>" +
    "<span>" + (f.final ? "完成" : "まだ削っている途中") + "</span>";
}

function setStepPlaying(on) {
  state.stepPlaying = on;
  el.difPlay.textContent = on ? "⏸ 一時停止" : "▶ ステップ再生";
  if (!on) { cancelAnimationFrame(state.rafId); return; }
  const total = state.frames.length - 1;
  let idx = Number(el.difSlider.value);
  if (idx >= total) idx = 0;
  let last = performance.now();
  const per = Math.max(160, 5000 / Math.max(1, total));
  const tick = (now) => {
    if (!state.stepPlaying) return;
    if (now - last >= per) {
      last = now;
      idx += 1;
      if (idx > total) { setStepPlaying(false); return; }
      el.difSlider.value = String(idx);
      renderStep(idx);
    }
    state.rafId = requestAnimationFrame(tick);
  };
  el.difSlider.value = String(idx);
  renderStep(idx);
  state.rafId = requestAnimationFrame(tick);
}

/* ------------------------------------------------- ステージ5：ちらつき */

const flickOffView = videoView(el.flickOff);
const flickOnView = videoView(el.flickOn);

function renderStage5() {
  const common = {
    tCond: state.tCond, tAlt: state.tAlt, tUncond: state.tUncond,
    seed: state.seed, steps: state.steps, cfg: state.cfg,
  };
  const off = sample(Object.assign({}, common, { coupled: false }));
  const on = state.frames;   // 通常の生成が「隣を見る」側

  const w = el.flickOff.width;
  const offVid = decodeVideo(off[off.length - 1].x, w);
  const onVid = decodeVideo(on[on.length - 1].x, w);
  const refVid = decodeVideo(state.tCond, w);
  flickOffView.frames = offVid;
  flickOnView.frames = onVid;

  const dRef = flickerScore(refVid), dOn = flickerScore(onVid), dOff = flickerScore(offVid);
  el.flickMetric.innerHTML =
    '<div class="ref"><div class="k">お手本（本来あるべき変化）</div><div class="v">' +
      dRef.toFixed(2) + '</div></div>' +
    '<div class="good"><div class="k">⭕ 隣のフレームを見る</div><div class="v">' +
      dOn.toFixed(2) + '</div></div>' +
    '<div class="bad"><div class="k">❌ 隣のフレームを見ない</div><div class="v">' +
      dOff.toFixed(2) + '</div></div>';
}

/* ------------------------------------------------- ステージ6：デコード */

const vaeLatView = videoView(el.vaeLat);
const vaeOutView = videoView(el.vaeOut);

function renderStage6() {
  const finalLat = state.frames[state.frames.length - 1].x;
  vaeLatView.frames = latentVideoRaw(finalLat);
  vaeOutView.frames = decodeVideo(finalLat, el.vaeOut.width);
}

/* ------------------------------------------------------------- VRAMの表 */

function renderVram() {
  const rows = [[1, "v1"], [2, "v2"], [4, "v4"], [8, "v8"]];
  for (const [sec, id] of rows) {
    const outF = FPS * sec;
    const latF = Math.round(outF / TCOMP);
    $(id + "f").textContent = latF + "フレーム";
    $(id + "n").textContent = (latF * FRAME_N).toLocaleString() + "個";
    $(id + "a").textContent = (latF * latF).toLocaleString() + " 通り";
  }
}

/* --------------------------------------------------------------- 実験室 */

function renderLabGrid(container, variants) {
  container.innerHTML = variants.map((v, i) =>
    '<figure><canvas width="72" height="72" id="' + container.id + '-c' + i + '"></canvas>' +
    '<figcaption><b>' + v.head + '</b>' + v.note + '</figcaption></figure>').join("");
  variants.forEach((v, i) => {
    const frames = sample({
      tCond: v.tCond || state.tCond, tAlt: v.tAlt || state.tAlt,
      tUncond: state.tUncond,
      seed: v.seed, steps: v.steps, cfg: v.cfg,
    });
    const view = videoView($(container.id + "-c" + i));
    view.frames = decodeVideo(frames[frames.length - 1].x, 72);
  });
}

function clearLabViews() {
  // 実験しなおすたびに view が増え続けないよう、実験室ぶんは捨てる
  for (let i = views.length - 1; i >= 0; i--) {
    if (views[i].lab) views.splice(i, 1);
  }
}

function renderLab() {
  clearLabViews();
  const mark = views.length;
  renderLabGrid(el.labCfg, [0, 1, 7, 16].map((c) => ({
    head: "CFG " + c, seed: state.seed, steps: 16, cfg: c,
    note: c === 0 ? "無視" : c === 1 ? "そのまま" : c === 7 ? "標準的" : "強すぎ",
  })));
  renderLabGrid(el.labSteps, [2, 4, 8, 24].map((s) => ({
    head: s + " ステップ", seed: state.seed, steps: s, cfg: state.cfg,
    note: s === 2 ? "形にならない" : s === 4 ? "まだあまい" : s === 8 ? "だいぶ整う" : "ほぼ完成",
  })));
  renderLabGrid(el.labSeed, [0, 1, 2].map((i) => {
    const seed = state.seed + i * 23;
    return {
      head: "シード " + seed, seed: seed, steps: 16, cfg: state.cfg,
      tCond: encodeVideo(targetVideo(state.parsed, seed)),
      tAlt: encodeVideo(targetVideo(state.parsed, seed, 1)),
      note: "設定は同じ",
    };
  }));
  for (let i = mark; i < views.length; i++) views[i].lab = true;
}

/* ------------------------------------------------------------- 生成実行 */

function targetVideo(parsed, seed, variant) {
  const out = [];
  for (let f = 0; f < FOUT; f++) out.push(renderTargetFrame(parsed, seed, f, variant));
  return out;
}

function readControls() {
  state.seed = Number(el.seed.value);
  state.steps = Number(el.steps.value);
  state.cfg = Number(el.cfg.value);
  el.seedVal.textContent = String(state.seed);
  el.stepsVal.textContent = String(state.steps);
  el.cfgVal.textContent = state.cfg.toFixed(1);
}

function generate() {
  setStepPlaying(false);
  readControls();
  state.parsed = parsePrompt(el.prompt.value);
  state.targetFrames = targetVideo(state.parsed, state.seed);
  state.tCond = encodeVideo(state.targetFrames);
  state.tAlt = encodeVideo(targetVideo(state.parsed, state.seed, 1));
  state.tUncond = makeUncondTarget(state.tCond);
  state.frames = sample({
    tCond: state.tCond, tAlt: state.tAlt, tUncond: state.tUncond,
    seed: state.seed, steps: state.steps, cfg: state.cfg,
  });

  renderStage1();
  renderStage2();
  renderStage3();
  el.difSlider.max = String(state.frames.length - 1);
  el.difSlider.value = "0";
  renderStep(0);
  renderStage5();
  renderStage6();
}

// 重い処理の前に「計算中…」を出してから走らせる
function withBusy(fn) {
  el.busy.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { fn(); } finally { el.busy.hidden = true; }
  }));
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
  const order = ["stage-1", "stage-2", "stage-3", "stage-4", "stage-5", "stage-6"];
  order.forEach((id, i) => {
    state.tourTimers.push(setTimeout(() => {
      lightStage(id);
      if (id === "stage-4") setStepPlaying(true);
      if (i === order.length - 1) {
        state.tourTimers.push(setTimeout(() => {
          el.tourStop.hidden = true;
          document.querySelectorAll(".stage").forEach((s) => s.classList.remove("lit"));
        }, 3000));
      }
    }, i * 2200 + (i > 3 ? 3200 : 0)));
  });
}

/* --------------------------------------------------------------- 配線 */

function wire() {
  el.presets.innerHTML = PRESETS.map((p) =>
    '<button class="chip" type="button">' + esc(p) + '</button>').join("");
  el.presets.addEventListener("click", (e) => {
    if (!e.target.classList.contains("chip")) return;
    el.prompt.value = e.target.textContent;
    withBusy(() => { generate(); lightStage("stage-1"); });
  });

  for (const s of [el.seed, el.steps, el.cfg]) {
    s.addEventListener("input", readControls);
    s.addEventListener("change", () => withBusy(generate));
  }

  el.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") withBusy(() => { generate(); runTour(); });
  });
  el.run.addEventListener("click", () => withBusy(() => { generate(); runTour(); }));
  el.tourStop.addEventListener("click", clearTour);
  el.reroll.addEventListener("click", () => {
    el.seed.value = String(1 + Math.floor(Math.random() * 200));
    withBusy(() => { generate(); lightStage("stage-3"); });
  });

  el.difSlider.addEventListener("input", () => {
    setStepPlaying(false);
    renderStep(Number(el.difSlider.value));
  });
  el.difPlay.addEventListener("click", () => setStepPlaying(!state.stepPlaying));
  el.difFirst.addEventListener("click", () => {
    setStepPlaying(false); el.difSlider.value = "0"; renderStep(0);
  });
  el.difLast.addEventListener("click", () => {
    setStepPlaying(false);
    el.difSlider.value = el.difSlider.max;
    renderStep(Number(el.difSlider.max));
  });

  el.rail.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) { clearTour(); lightStage(li.dataset.target); }
  });
  el.labRun.addEventListener("click", () => withBusy(renderLab));
}

window.addEventListener("DOMContentLoaded", () => {
  wire();
  renderVram();
  startClock();
  withBusy(() => { generate(); renderLab(); });
});
