"use strict";

// プリセット集。
//
// 全て「float4 を return する関数の中身」として書いてあるので、そのまま
// UE の Custom ノードに貼れる。ヘルパー関数・テクスチャ・派生命令
// （ddx/ddy）は使わず、for ループと算術だけで組み立てている。
//
// 球面上で模様を潰さないためのコツ:
//   - sin を 5 回ほど周波数 2 倍で足す（擬似 fbm）で高周波を作る
//   - 1.0 - abs(n) を pow で締める（リッジ化）と細い線が出る
//   - reflect() + 上下グラデ + 横縞の「偽環境マップ」で金属に見せる

const SHADER_PRESETS = [
  ["🧱 視差オクルージョン", `// パララックスオクルージョンマッピング（POM）
// Param1: 掘りの深さ / Param2: タイルの細かさ / Param3: 影の濃さ
//
// このエディタは接線ベクトルを渡してこないので、法線から解析的に
// 接空間を作る（球・円柱・平面の UV 向け。トーラスでは近似）。

float3 N = normalize(Normal);
float3 V = normalize(CameraVector);

// 極で cross が縮退するので基準軸を切り替える
float3 up = abs(N.y) < 0.99 ? float3(0.0, 1.0, 0.0) : float3(1.0, 0.0, 0.0);
float3 T = normalize(cross(up, N));
float3 B = cross(N, T);

// 視線を接空間へ持ち込む
float3 vt = float3(dot(V, T), dot(V, B), dot(V, N));

float depth = 0.02 + Param1 * 0.13;
float tiles = 4.0 + floor(Param2 * 12.0);

// 最深部まで潜ったときの UV 移動量。max() は斜めから見たときの暴走止め。
float2 maxOff = -(vt.xy / max(vt.z, 0.35)) * depth;
float2 duv = maxOff / 24.0;
float layer = 1.0 / 24.0;

// 高さ関数はベベル付きのタイル（1.0 が表面、0.0 が目地の底）。
// UE の Custom ノードに貼れるようヘルパー関数は使わず、
// 必要な箇所へ直接展開している。
float2 uv = UV;
float2 c = frac(uv * tiles);
float2 e = min(c, 1.0 - c);
float h = smoothstep(0.0, 0.12, min(e.x, e.y));

// ステップパララックス：高さに当たるまで視線方向へ潜る
float cur = 1.0;
float prevH = h;
float prevCur = cur;
for (int i = 0; i < 24; i++) {
  if (h >= cur) break;
  prevH = h;
  prevCur = cur;
  uv += duv;
  cur -= layer;
  c = frac(uv * tiles);
  e = min(c, 1.0 - c);
  h = smoothstep(0.0, 0.12, min(e.x, e.y));
}

// 直前のレイヤーとの間を線形補間する。これを省くと側面が
// ステップ数ぶんの階段になる（POM が単なる steep parallax に落ちる）。
float d1 = h - cur;
float d0 = prevH - prevCur;
uv -= duv * saturate(d1 / max(d1 - d0, 0.0001));

c = frac(uv * tiles);
e = min(c, 1.0 - c);
h = smoothstep(0.0, 0.12, min(e.x, e.y));

// ずらした先の高さ場から法線を作る（ddx/ddy を使わない有限差分）
float eps = 0.004 / tiles;
float2 c1 = frac((uv + float2(eps, 0.0)) * tiles);
float2 e1 = min(c1, 1.0 - c1);
float hx = smoothstep(0.0, 0.12, min(e1.x, e1.y));

float2 c2 = frac((uv + float2(0.0, eps)) * tiles);
float2 e2 = min(c2, 1.0 - c2);
float hy = smoothstep(0.0, 0.12, min(e2.x, e2.y));

float3 nt = normalize(float3(-(hx - h) * depth / eps, -(hy - h) * depth / eps, 1.0));
float3 Nw = normalize(nt.x * T + nt.y * B + nt.z * N);

// 自己影：見つけた点からライトへ向かって高さ場を辿り、
// 途中で遮られていれば影にする。奥行きの説得力はほぼこれで決まる。
float3 Lt = float3(dot(LightVector, T), dot(LightVector, B), dot(LightVector, N));
float shadow = 1.0;
if (Lt.z > 0.05) {
  float2 sduv = (Lt.xy / Lt.z) * depth * (1.0 - h) / 8.0;
  float2 suv = uv;
  float rayH = h;
  for (int j = 0; j < 8; j++) {
    suv += sduv;
    rayH += (1.0 - h) / 8.0;
    float2 cs = frac(suv * tiles);
    float2 es = min(cs, 1.0 - cs);
    float hs = smoothstep(0.0, 0.12, min(es.x, es.y));
    if (hs > rayH) shadow -= 0.16;
  }
  shadow = saturate(shadow);
}
shadow = lerp(1.0, shadow, Param3);

// 目地を暗く落として奥行きを出す
float ao = lerp(1.0 - Param3 * 0.6, 1.0, h);

float3 base = lerp(float3(0.05, 0.05, 0.06), BaseColor, h);
float3 col = base * (0.12 + saturate(dot(Nw, LightVector)) * shadow * 1.05) * ao;

float3 hv = normalize(V + LightVector);
col += pow(saturate(dot(Nw, hv)), 60.0) * h * shadow * 0.7;

return float4(col, 1.0);`],

  ["⚜️ 溶けた金", `// 溶けた金 — Param1: 表面の荒れ / Param2: 反射の強さ
float3 n = normalize(Normal);

// 擬似 fbm で表面を波打たせる
float3 q = WorldPosition * 4.0;
float bump = 0.0;
float amp = 0.5;
for (int i = 0; i < 4; i++) {
  bump += amp * sin(q.x + sin(q.y * 1.7 + Time) + q.z);
  q = q * 2.03 + 1.3;
  amp *= 0.5;
}
n = normalize(n + bump * Param1 * 0.6);

float3 v = normalize(CameraVector);
float3 r = reflect(-v, n);

// 偽の環境マップ（上下グラデ＋スタジオライトの横縞）
float env = pow(saturate(r.y * 0.5 + 0.5), 2.0);
env += 0.35 * pow(saturate(sin(r.y * 9.0) * 0.5 + 0.5), 6.0);

float3 gold = float3(1.0, 0.72, 0.28);
float3 col = gold * (0.15 + env * (0.6 + Param2));

// 鋭いハイライト
float3 h = normalize(v + LightVector);
col += float3(1.0, 0.95, 0.8) * pow(saturate(dot(n, h)), 180.0) * 2.0;

// フレネルで縁を焼く
col += pow(1.0 - saturate(dot(n, v)), 4.0) * gold * 0.8;

return float4(col, 1.0);`],

  ["🪞 クローム", `// クローム — 偽の環境反射だけで金属に見せる。Param1: 縞の細かさ
float3 n = normalize(Normal);
float3 v = normalize(CameraVector);
float3 r = reflect(-v, n);

// 空と地面
float3 sky    = float3(0.55, 0.68, 0.95);
float3 ground = float3(0.12, 0.11, 0.10);
float3 col = lerp(ground, sky, saturate(r.y * 0.5 + 0.5));

// スタジオライトの横縞を写り込ませる
float stripes = sin(r.y * (12.0 + Param1 * 40.0)) * 0.5 + 0.5;
col += pow(stripes, 12.0) * 1.4;

// 地平線の明るいライン
col += pow(1.0 - abs(r.y), 24.0) * 0.6;

float3 h = normalize(v + LightVector);
col += pow(saturate(dot(n, h)), 250.0) * 3.0;
col += pow(1.0 - saturate(dot(n, v)), 5.0) * 0.7;

return float4(col, 1.0);`],

  ["🫧 シャボン玉", `// 薄膜干渉 — 見る角度で虹色が動く。Param1: 膜厚
float3 n = normalize(Normal);
float3 v = normalize(CameraVector);
float ndv = saturate(dot(n, v));

// 厚みを揺らして虹を歪ませる。1/cos だと縁で発散して
// モアレになるので、視線角には線形に効かせる。
float3 q = WorldPosition * 2.5;
float wob = sin(q.x + Time * 0.7) * sin(q.y * 1.3 - Time * 0.5) * 0.5 + 0.5;
float thickness = (2.0 + Param1 * 6.0) * (0.6 + wob * 0.8) * (1.0 - ndv * 0.75);

// RGB で位相をずらして干渉色を作る
float3 film = 0.5 + 0.5 * cos(6.2831 * thickness * float3(1.0, 0.86, 0.72));

// 正面は薄く、縁ほど濃く色づく
float3 col = film * (0.25 + pow(1.0 - ndv, 1.5) * 1.1);

float3 h = normalize(v + LightVector);
col += pow(saturate(dot(n, h)), 90.0) * 1.2;

return float4(col, 1.0);`],

  ["🌋 溶岩の亀裂", `// 黒い岩に光る亀裂。Param1: 亀裂の細さ / Param2: 発光の強さ
float3 q = WorldPosition * 2.2;
float n = 0.0;
float amp = 0.5;
for (int i = 0; i < 5; i++) {
  n += amp * sin(q.x + sin(q.y * 1.4) + sin(q.z * 1.1) + Time * 0.3);
  q = q * 2.07 + 2.3;
  amp *= 0.5;
}

// リッジ化：n が 0 になる等高線だけを細く光らせる
float crack = pow(1.0 - saturate(abs(n) * (3.0 + Param1 * 14.0)), 2.0);

// 岩肌
float nDotL = saturate(dot(Normal, LightVector));
float3 rock = float3(0.05, 0.045, 0.05) * (0.4 + nDotL * 0.9);
rock *= 0.7 + 0.3 * sin(n * 6.0);

// 溶岩（黒→赤→橙→黄）
float heat = crack * (0.7 + 0.3 * sin(Time * 2.0 + n * 3.0));
float3 lava = float3(1.5, 0.25, 0.03) * heat;
lava += float3(1.0, 0.85, 0.3) * pow(heat, 3.0) * 2.0;

return float4(rock + lava * (0.6 + Param2 * 1.6), 1.0);`],

  ["🔥 炎", `// 下から舐め上がる炎。Param1: 勢い / Param2: 炎の痩せ具合
float3 p = WorldPosition;
float rise = Time * (1.0 + Param1 * 3.0);

float3 q = float3(p.x * 3.0, p.y * 2.0 - rise, p.z * 3.0);
float n = 0.0;
float amp = 0.5;
for (int i = 0; i < 5; i++) {
  n += amp * sin(q.x + sin(q.z * 1.3) + q.y);
  q = q * 2.04 + 1.9;
  amp *= 0.5;
}
n = n * 0.5 + 0.5;

// 上へ行くほど痩せさせて炎の舌にする
float h = saturate(p.y * 0.5 + 0.5);
float flame = pow(saturate(n - h * (0.5 + Param2 * 0.8) + 0.35), 1.6);

// 黒体っぽいランプ
float3 col = float3(1.2, 0.15, 0.02) * flame;
col += float3(1.0, 0.6, 0.05) * pow(flame, 2.0) * 1.4;
col += float3(1.0, 0.95, 0.75) * pow(flame, 6.0) * 2.0;

return float4(col, 1.0);`],

  ["⚡ 電撃", `// 表面を走る稲妻。Param1: 密度
float3 q = WorldPosition * (3.0 + Param1 * 6.0);
float n = 0.0;
float amp = 0.5;
for (int i = 0; i < 5; i++) {
  n += amp * sin(q.x + sin(q.y + Time * 1.7) * 1.6 + q.z);
  q = q * 2.11 + 4.7;
  amp *= 0.5;
}

// 等高線を細く光らせる＝アーク
float arc = pow(1.0 - saturate(abs(n) * 12.0), 2.5);

float3 col = float3(0.02, 0.03, 0.09);
col += float3(0.25, 0.6, 1.0) * arc * 2.2;
col += float3(1.0, 1.0, 1.0) * pow(arc, 4.0) * 2.0;

// 縁を光らせる
col += float3(0.2, 0.5, 1.0) * pow(1.0 - saturate(dot(Normal, CameraVector)), 3.0) * 0.8;

return float4(col, 1.0);`],

  ["🌊 光の帯", `// 歪んだ等高線が流れる光の帯。Param1: 速さ / Param2: 線の細さ
// 球の UV は縦横で密度が違うので、比を掛けて網目を正方形に近づける
float2 p = UV * float2(16.0, 8.0);
float t = Time * (0.4 + Param1);

float c = 0.0;
for (int i = 0; i < 5; i++) {
  float fi = float(i);
  // 座標を歪ませながら等高線を重ねる
  p += float2(sin(p.y * 1.5 + t + fi), cos(p.x * 1.5 - t + fi)) * 0.5;
  c += 1.0 - saturate(abs(sin(p.x) + sin(p.y)) * (2.5 + Param2 * 6.0));
}
c = pow(saturate(c * 0.5), 2.0);

float3 col = float3(0.01, 0.06, 0.16);
col += float3(0.3, 0.85, 1.0) * c * 1.6;
col += float3(1.0, 1.0, 1.0) * pow(c, 3.0) * 1.2;

col *= 0.55 + saturate(dot(Normal, LightVector)) * 0.75;

return float4(col, 1.0);`],

  ["🛡️ エネルギーシールド", `// フレネル＋グリッド＋走査線。Param1: グリッド密度
float3 n = normalize(Normal);
float f = pow(1.0 - saturate(dot(n, CameraVector)), 2.5);

// 互い違いに half オフセットしたセル
float2 uv = UV * (10.0 + Param1 * 30.0);
uv.y += fmod(floor(uv.x), 2.0) * 0.5;
float2 g = abs(frac(uv) - 0.5);
float edge = pow(saturate(max(g.x, g.y) * 2.6), 6.0);

// 走査線
float scan = pow(saturate(sin((UV.y - Time * 0.35) * 18.0)), 12.0);

float3 tint = float3(0.25, 0.7, 1.0);
float3 col = tint * (f * 0.9 + edge * 0.5 + scan * 0.6);
col += float3(1.0, 1.0, 1.0) * pow(f, 4.0) * 0.8;

return float4(col, 1.0);`],

  ["👻 ホログラム", `// 走査線とグリッチ。Param1: グリッチの量
float3 n = normalize(Normal);
float ndv = saturate(dot(n, CameraVector));

// 中央は透けて暗く、縁ほど濃い。これがホログラムらしさの肝。
float rim = pow(1.0 - ndv, 2.2);

// 細かい走査線と、下から上へ流れる明るいスイープ
float scan = 0.55 + 0.45 * sin(UV.y * 220.0);
float sweep = pow(saturate(sin((UV.y - Time * 0.25) * 6.2831)), 24.0);

// 横帯単位のグリッチ
float band = floor(UV.y * 36.0);
float r = frac(sin(band * 12.9898 + floor(Time * 10.0) * 78.233) * 43758.5453);
float glitch = step(1.0 - Param1 * 0.3, r);

float3 tint = float3(0.25, 0.95, 1.0);
float3 col = tint * (0.12 + rim * 1.3) * scan;
col += tint * sweep * 0.9;
col += float3(1.0, 0.25, 0.7) * glitch * 0.5;
col += float3(1.0, 1.0, 1.0) * pow(rim, 5.0) * 0.8;

return float4(col, 1.0);`],

  ["🌌 星雲", `// 星雲。Param1: 密度 / Param2: 星の量
float3 q = WorldPosition * 1.8;
float n = 0.0;
float amp = 0.5;
for (int i = 0; i < 6; i++) {
  n += amp * sin(q.x + sin(q.y * 1.2 + Time * 0.15) + sin(q.z * 0.9));
  q = q * 2.13 + 5.1;
  amp *= 0.5;
}
// saturate だと広い面積が 1 に張り付いて白飛びするので、
// smoothstep でなだらかに 0〜1 へ写す。
float d = smoothstep(-0.9, 0.9, n * (0.6 + Param1 * 0.9));

float3 col = float3(0.02, 0.01, 0.06);
col = lerp(col, float3(0.35, 0.08, 0.55), pow(d, 1.5));   // 紫
col = lerp(col, float3(1.0, 0.45, 0.25), pow(d, 4.0));    // 橙
col = lerp(col, float3(1.0, 0.95, 0.9), pow(d, 12.0));    // 芯

// 星（UV をセルに割って乱数で間引く）。ガスの薄いところだけに出す。
float star = frac(sin(dot(floor(UV * 700.0), float2(12.9898, 78.233))) * 43758.5453);
col += step(0.9985 - Param2 * 0.0015, star) * (1.0 - d) * 1.6;

return float4(col, 1.0);`],

  ["🌀 マーブル", `// ドメインワープした縞。Param1: 歪みの強さ
float3 p = WorldPosition * 2.0;

// 1 段目のノイズで座標そのものを歪ませる
float3 q = p;
float w = 0.0;
float amp = 0.5;
for (int i = 0; i < 4; i++) {
  w += amp * sin(q.x + sin(q.y) + Time * 0.4);
  q = q * 2.05 + 1.1;
  amp *= 0.5;
}
p += w * (1.0 + Param1 * 3.0);

// 2 段目で縞を作る
float m = pow(saturate(sin(p.x * 2.0 + p.y * 1.3 + w * 3.0) * 0.5 + 0.5), 1.5);

float3 col = lerp(float3(0.02, 0.05, 0.2), float3(0.1, 0.85, 0.8), m);
col = lerp(col, float3(1.0, 1.0, 0.95), pow(m, 8.0));

col *= 0.5 + saturate(dot(Normal, LightVector)) * 0.8;
float3 h = normalize(CameraVector + LightVector);
col += pow(saturate(dot(Normal, h)), 60.0) * 0.8;

return float4(col, 1.0);`],

  ["💎 クリスタル", `// 法線を量子化してファセットを作る。Param1: 面の粗さ
float3 n = normalize(Normal);
float steps = 2.0 + floor(Param1 * 6.0);
float3 fn = normalize(floor(n * steps + 0.5) / steps);

float3 v = normalize(CameraVector);
float3 r = reflect(-v, fn);

// 面ごとに色相をずらす。原色のままだとビーチボールになるので
// 白へ寄せて彩度を落とす。
float3 env = 0.5 + 0.5 * cos(r.y * 4.0 + float3(0.0, 1.6, 3.2));
env = lerp(float3(0.85, 0.92, 1.0), env, 0.35);

float3 col = BaseColor * 0.25 + env * 0.55;

// 面ごとに明るさを変えてファセットを立たせる
col *= 0.55 + 0.75 * saturate(dot(fn, LightVector));

float3 h = normalize(v + LightVector);
col += pow(saturate(dot(fn, h)), 140.0) * 2.2;

// 内部散乱っぽい縁の光
col += pow(1.0 - saturate(dot(fn, v)), 3.0) * float3(0.55, 0.8, 1.0) * 0.8;

return float4(col, 1.0);`],
];
