# UEマテリアル小技:EyeAdaptationで「暗い場所だけ少し光る」表現を作る

## やりたいこと

Unreal Engineでは`EyeAdaptation`ノードを使うと、Auto Exposure(自動露出)の現在値をマテリアル内で取得できます。これを`EmissiveColor`に乗算することで、露出変化による発光オブジェクトのチカチカを抑える、という使い方は定番です。

今回はそこから一歩進んで、こんな要件を実現します。

- **明るい〜通常時**:今まで通り `EmissiveColor × EyeAdaptation` の乗算表現をキープ
- **暗い時**:そこに「少しだけ」加算で光を足す(乗算のまま伸ばすと暗所で破綻しやすいため)

## なぜ乗算だけだと厳しいのか

暗いシーンほど`EyeAdaptation`の値は大きくなります(露出を持ち上げようとするため)。そのまま`EmissiveColor`に掛け続けると、暗所で値が跳ね上がって光りすぎたり、逆に真っ暗になったりと制御が難しくなります。

そこで「通常時の乗算表現」と「暗所だけの加算発光」を別レイヤーとして分離するのが今回のアプローチです。

## 最終的な式

```
Normal   = EmissiveColor * min(EyeAdaptation, 1.0)
DarkGlow = saturate(EyeAdaptation - 1.0)
DarkGlow = 1.0 - exp(-DarkGlow * k)        // 頭打ちカーブ

FinalEmissiveColor = Normal + GlowColor * DarkGlow * GlowIntensity
```

下のグラフでは、`k`と`GlowIntensity`を動かしながらNormal項・DarkGlow項・合計カーブの形を確認できます。EyeAdaptationスライダーを動かすと、その値での各項の実数値も表示されます。

<div id="darkglow-chart" class="chart-embed"></div>

### 各項の役割

**Normal項(通常表現の維持)**
`min(EyeAdaptation, 1.0)`で1.0を上限にクランプしてから`EmissiveColor`に掛けることで、明るい時の見た目は今まで通りのまま、1.0を超えて明るくなりすぎるのも防ぎます。

**DarkGlow項(暗所だけの加算発光)**
`EyeAdaptation - 1.0`が0を超える(=暗くなってきた)場合だけ値を持ち、`1 - exp(-x*k)`というカーブに通します。この式は「最初は反応が良いが、すぐに頭打ちして1.0に収束する」という滑らかな曲線になり、どれだけ暗くなってもGlowIntensity以上には光らないようにできます。

## ノード構成

1. `Min(EyeAdaptation, 1.0)` → `Multiply(EmissiveColor)` = Normal項
2. `Subtract(EyeAdaptation, 1.0)` → `Saturate` → `Multiply(-k)` → `Exp` → `OneMinus` = DarkGlow項
3. DarkGlow × GlowColor × GlowIntensity(パラメータ化)
4. Normal項 + Glow項 → 最終`EmissiveColor`

## パラメータ化しておくと便利なもの

| パラメータ | 役割 |
|---|---|
| `k` | 暗部カーブの立ち上がり具合(大きいほど早く頭打ち) |
| `GlowIntensity` | 暗所での光量上限 |
| `GlowColor` | 発光色。元のEmissiveColorをそのまま使っても、別の色(例:青白い残光)を当ててもよい |

これらをScalar/Vector Parameterとして外に出し、Material Instance側で調整できるようにしておくと、シーンごとの微調整がしやすくなります。

## 補足:Exp(指数関数)について

`Exp`ノードは指数関数 `e^x` を計算するものです。今回使っている`exp(-x)`の形は「xが増えるほど急激に0へ近づく」カーブで、これを`1 -`することで「最初は感度良く反応し、途中から滑らかに頭打ちする」曲線になります。冷たい飲み物が常温に戻っていく温度変化などがイメージとして近いです。

もし数式に馴染みがなければ、`Saturate`と`Power`の組み合わせでも似た頭打ちカーブを近似できます。

## 実装前に確認しておきたいこと

- `EyeAdaptation`の実値レンジは、シーンやPost Process Volumeの`Exposure`設定(Min/Max Brightness、Exposure Compensationなど)によって変わるため、まず数値を確認してから`k`・`GlowIntensity`を調整するのが安全
- 暗所での光り方が「少しだけ」の範囲に収まっているか、実機プレビューで確認する
