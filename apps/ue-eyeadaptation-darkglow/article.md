# UEマテリアル小技:EyeAdaptationで「暗い場所だけ少し光る」表現を作る

## やりたいこと

Unreal Engineでは`EyeAdaptation`ノードを使うと、Auto Exposure(自動露出)の現在値をマテリアル内で取得できます。定番の使い方は、この値で`EmissiveColor`を**除算**することです。Auto Exposureはレンダリング後の画面全体をこの係数で明るく(暗く)持ち上げているため、マテリアル側で先に同じ係数で割っておけば相殺され、露出がどう変化しても発光オブジェクトの見た目の明るさを一定に保てます。

今回はそこから一歩進んで、こんな要件を実現します。

- **明るい〜通常時**:除算による「見た目の明るさが一定」の表現をキープ
- **暗い時**:そこに「少しだけ」加算で光を足す

## なぜ「乗算」では逆効果なのか

`EyeAdaptation`の値は暗いシーンほど大きくなります(露出を持ち上げようとするため)。ここで`EmissiveColor`に**乗算**してしまうと、「Auto Exposureがすでに画面全体を持ち上げている分」と「マテリアル側で追加でかけた分」が二重にかかり、暗いシーンで発光が想定以上に明るくなってしまいます。

正しくは逆で、`EmissiveColor`を`EyeAdaptation`で**除算**しておくことで、Auto Exposureによる底上げと相殺され、露出変化があっても見た目の明るさが変わらなくなります。これが「発光オブジェクトのチカチカを抑える」ための標準的なテクニックです。

## 最終的な式

```
DarkGlow = saturate(EyeAdaptation - 1.0)
DarkGlow = 1.0 - exp(-DarkGlow * k)        // 頭打ちカーブ

FinalEmissiveColor = (EmissiveColor + GlowColor * DarkGlow * GlowIntensity) / EyeAdaptation
```

下のグラフは、画面上に実際に見える明るさ(Auto Exposureとの相殺後)がEyeAdaptationに対してどう変化するかを示しています。`k`と`GlowIntensity`を動かしながらDarkGlow項・合計カーブの形を確認できます。EyeAdaptationスライダーを動かすと、その値での各項の実数値も表示されます。

<div id="darkglow-chart" class="chart-embed"></div>

### 各項の役割

**DarkGlow項(暗所だけの加算発光)**
`EyeAdaptation - 1.0`が0を超える(=暗くなってきた)場合だけ値を持ち、`1 - exp(-x*k)`というカーブに通します。この式は「最初は反応が良いが、すぐに頭打ちして1.0に収束する」という滑らかな曲線になり、どれだけ暗くなってもGlowIntensity以上には光らないようにできます。

**最後の除算(見た目の明るさを一定に保つ)**
`EmissiveColor`に`DarkGlow`分の加算を足してから、まとめて`EyeAdaptation`で割ります。こうすることでAuto Exposureの持ち上げ分と相殺され、画面上での明るさは「通常時は`EmissiveColor`のまま」「暗所では`EmissiveColor + GlowColor × GlowIntensity`まで」という、現在の露出設定に左右されない予測可能な範囲に収まります。DarkGlowを先に足してから割るため、`GlowIntensity`は「暗所で画面上に追加される光量の上限」をそのまま表すパラメータになります。

## ノード構成

1. `Subtract(EyeAdaptation, 1.0)` → `Saturate` → `Multiply(-k)` → `Exp` → `OneMinus` = DarkGlow項
2. DarkGlow × GlowColor × GlowIntensity(パラメータ化)
3. `Add(EmissiveColor, Glow項)`
4. その合計を`EyeAdaptation`で`Divide` → 最終`EmissiveColor`

## パラメータ化しておくと便利なもの

| パラメータ | 役割 |
|---|---|
| `k` | 暗部カーブの立ち上がり具合(大きいほど早く頭打ち) |
| `GlowIntensity` | 暗所で画面上に追加される光量の上限 |
| `GlowColor` | 発光色。元のEmissiveColorをそのまま使っても、別の色(例:青白い残光)を当ててもよい |

これらをScalar/Vector Parameterとして外に出し、Material Instance側で調整できるようにしておくと、シーンごとの微調整がしやすくなります。

## 補足:Exp(指数関数)について

`Exp`ノードは指数関数 `e^x` を計算するものです。今回使っている`exp(-x)`の形は「xが増えるほど急激に0へ近づく」カーブで、これを`1 -`することで「最初は感度良く反応し、途中から滑らかに頭打ちする」曲線になります。冷たい飲み物が常温に戻っていく温度変化などがイメージとして近いです。

もし数式に馴染みがなければ、`Saturate`と`Power`の組み合わせでも似た頭打ちカーブを近似できます。

## 補足:EyeAdaptationInverseノードについて

UE5系のバージョンでは、`EyeAdaptation`を`Divide`する代わりに使える`EyeAdaptationInverse`ノードも用意されています。名前の通り、通常の`EyeAdaptation`とは逆の傾向の値(暗いシーンでは小さく、明るいシーンでは大きくなる)を返すため、`Multiply`するだけで同じ「露出変化と相殺する」効果が得られます。バージョンによって使えるノードが異なるので、お使いのエンジンにどちらがあるか確認してから組むとよいです。

## 実装前に確認しておきたいこと

- `EyeAdaptation`の実値レンジは、シーンやPost Process Volumeの`Exposure`設定(Min/Max Brightness、Exposure Compensationなど)によって変わるため、まず数値を確認してから`k`・`GlowIntensity`を調整するのが安全
- 暗所での光り方が「少しだけ」の範囲に収まっているか、実機プレビューで確認する
