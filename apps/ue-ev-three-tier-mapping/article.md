# UEマテリアル小技:露出値(EV)の3段マッピング

*公開: 2026-09-16*

暗いところでは少し光り、明るいところでは普通に光る。この挙動を感覚ではなく数値で制御するための仕組みです。

## 考え方

1. `EyeAdaptation`を`log2`して、露出を**EV**(段数)に変換する
2. 明るい / 普通 / 暗い の3つのEV(a / b / c)で、出力値(Va / Vb / Vc)を決める
3. その間は**fit(clamp付き)を2段重ねて**補間する

```
EV = log2(EyeAdaptation)
```

- EVが小さい → 明るい場所
- EVが大きい → 暗い場所

| 状態 | EV | 出力 |
|---|---|---|
| 明るい | a | Va |
| 普通 | b | Vb |
| 暗い | c | Vc |

## 式

### fit 2段(補間あり)

```
Out = fit(EV, b, c, fit(EV, a, b, Va, Vb), Vc)
```

- 内側のfit:a→bの区間をVa→Vbに変換する
- 外側のfit:b→cの区間を、内側の結果からVcへ変換する
- fitはクランプされるので、aより明るければVa、cより暗ければVcで止まる
- ※Houdiniの`efit`(クランプなし)では同じ結果にならない

lerpで書くと次の通りで、結果はfit版と同一です。

```
t1  = saturate((EV - a) / (b - a))
t2  = saturate((EV - b) / (c - b))
Out = lerp(lerp(Va, Vb, t1), Vc, t2)
```

### 段切り替え(補間なし)

a < b < cの場合、境界はそれぞれの中間点になります。

```
Out = lerp(Va, Vb, step((a+b)/2, EV))
Out = lerp(Out, Vc, step((b+c)/2, EV))
```

EyeAdaptation自体がゆっくり変化するため、境界をまたいだ瞬間にパッと切り替わります。ポップが気になる場合はfit版を使ってください。

下のグラフで、a / b / cとVa / Vb / Vcを動かしながら2つの版の形を見比べられます。横軸がEV(左が明るい場所、右が暗い場所)です。

<div id="ev-chart" class="chart-embed"></div>

## UEでの実装

### マテリアル関数 `MF_Fit`

入力:`x, omin, omax, nmin, nmax`

```
lerp(nmin, nmax, saturate((x - omin) / (omax - omin)))
```

グラフ上では、MF_Fitを2個つなぐだけで3段マッピングになります。

### Customノード(HLSL)版

```hlsl
float t1 = saturate((EV - A) / (B - A));
float t2 = saturate((EV - B) / (C - B));
return lerp(lerp(Va, Vb, t1), Vc, t2);
```

### 暗所で光らせる用途での組み方

```
EV       = log2(EyeAdaptation)
GlowAmt  = fit(EV, b, c, fit(EV, a, b, Va, Vb), Vc)   // 例: Va=0, Vb=0, Vc=0.3
Glow     = EyeAdaptationInverse(GlowColor * GlowAmt, Alpha=1)
Final    = EmissiveColor ÷ EyeAdaptation + Glow
```

- `EyeAdaptationInverse`(Alpha=1)を通すことで、GlowAmtが「画面上での見え方」をそのまま表すようになる
- 既存の露出相殺の表現(明るい〜通常時)はそのまま維持できる。`EmissiveColor`側も`EyeAdaptationInverse`(Alpha=1)に通せば、除算と同じ結果を乗算の形で書ける

### a / b / cの決め方

1. `log2(EyeAdaptation)`を`DebugScalarValues`に接続する
2. 明るい場所・普通の場所・暗い場所で、それぞれ値を読む
3. 読んだ値をそのままa / b / cに入れる

複数のマテリアルで揃えたい場合は、閾値をMaterial Parameter Collectionにまとめると管理しやすくなります。

## Desmos用の式

[Desmos](https://www.desmos.com/calculator)でも同じカーブを触れます。次の式を上から順に、1行ずつ別々の式として入力してください。横軸がEVです。

Va / Vb / Vcは、Desmos側では添字なしのu / v / wに置き換えてあります。Desmosの入力欄は`_`を打つと添字の中にカーソルが入るため、`V_a=0`のように書くと`=0`まで添字に飲み込まれてしまうことがあるからです。

```
a=-1
b=1
c=4
u=0
v=0.3
w=1
s(x)=min(1,max(0,x))
g(x)=u+(v-u)s((x-a)/(b-a))
y=g(x)+(w-g(x))s((x-b)/(c-b))
(a,u),(b,v),(c,w)
```

- `g(x)`が内側のfit(a→b)、`y`の行が外側のfit(b→c)で、上のlerp版と同じ形です
- 最後の1行はa / b / cの位置に点を打つためのもの。点はカンマ区切りで1つの式にまとめられます
- a〜wは自動でスライダーになります

段切り替え版を重ねて表示する場合は、以下を追加します。

```
y={2x<a+b:u,2x<b+c:v,w}
```

境界の(a+b)/2・(b+c)/2は、両辺を2倍して分数を書かずに済ませています。

入力のコツ：

- プレーンテキストの貼り付けは、Desmosの数式入力欄では意図した形にならないことがあります。崩れたら手で打つのが確実です
- `/`を打つと分数の分母にカーソルが入ります。分母から抜けるには→キーを押す
- `{`で始まる場合分けも同様で、閉じたいところで→キーを押す
- a=bまたはb=cにすると、ゼロ除算になって線が消えます
