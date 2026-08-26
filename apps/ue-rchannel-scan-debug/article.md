# UEマテリアル小技:台形カーブによるRチャンネル走査デバッグ表示

## 概要

テクスチャのRチャンネルを256階調として扱い、`Time`関数で走査レベルを動かすことで、特定階調のピクセルだけを台形カーブで浮かび上がらせるデバッグ表示です。分岐を使わず`saturate`のみで実装します。

## Custom Nodeピン構成

| Pin名 | 内容 |
|---|---|
| `R` | Texture SampleのRチャンネル |
| `Speed` | 走査速度(Scalar Parameter推奨) |
| `Plateau` | 頂上の平らな範囲(任意でパラメータ化) |
| `Slope` | 斜辺のなだらかさ(任意でパラメータ化) |

## HLSLコード

```hlsl
// Rを0-255の整数階調に変換
float level = round(R * 255.0);

// Time経過で0-255をループしながら走査するレベル
float scanLevel = fmod(floor(View.RealTimeSeconds * Speed), 256.0);

float diff = abs(level - scanLevel);

// 台形カーブのパラメータ
float plateau = 0.5;  // 完全に1になる範囲(頂上の平らな部分)
float slope   = 1.5;  // plateauの外側でなだらかに0まで落ちる範囲

float value = saturate(1.0 - (diff - plateau) / slope);

return value;
```

下のグラフは、この`value`が階調(0-255)に対してどう変化するかを示す台形カーブです。`Plateau`・`Slope`・走査レベルを動かして形を確認できるほか、「▶ 走査アニメーション」で実際に`Time`が経過したときの動きも再生できます。グラデーションバーには、そのときハイライトされる階調がどう見えるかのプレビューも表示しています。

<div id="scan-chart" class="chart-embed"></div>

## カーブの挙動

- `diff <= plateau` → `value = 1`(走査レベルと一致した階調が完全点灯)
- `plateau < diff < plateau + slope` → 1→0へ線形減衰(台形の斜辺)
- `diff >= plateau + slope` → `value = 0`(対象外階調は消灯)

## 補足

- `plateau`を大きくすると頂上の幅(=同時に光る階調の許容範囲)が広がる
- `slope`を大きくすると裾野が緩やかになり、隣接階調がうっすら光る演出になる
- 分岐命令を使わないため、GPU的にコストが低く安定した挙動になる
- `View.RealTimeSeconds`を直接参照しているためTime入力ピンは不要(ポーズ時に止めたい場合はTimeノードを別途Input Pinとして渡す)
