# Maya MCP×ComfyUI 検証仕様書（姫路城）

*公開: 2026-10-07*

## 目的と概要

ClaudeにMaya MCPとComfyUI MCPを操作させ、参照画像をもとに白壁の日本の城（姫路城系）を再現できるかを検証する。見どころは**瓦の大量配置ツールをAIが作れるか**と、**ビューポート画像を見てAIが自分で修正できるか**の2点。

- ゴール：参照画像に近い城をAI主導で作り、任せられる作業と人が必要な作業を切り分けて報告する
- 範囲：モデリング、テクスチャ生成と割り当て、瓦配置、ビューポート評価まで（リグ・アニメーション・最終レンダーは対象外。素材確認用の低解像度レンダーは可）

## 環境とツール構成

| 項目 | 内容 |
| --- | --- |
| Maya | 2024以降（GG_MayaMCPの対応範囲） |
| Maya MCP | [GG_MayaMCP](https://pypi.org/project/maya-mcp/)（commandPort経由、Maya外で動作） |
| ComfyUI MCP | [metabrain-labs/comfyui-mcp-server](https://claudemarketplaces.com/mcp/io.github.metabrain-labs/comfyui-mcp-server)（自作ワークフローをツールとして公開） |
| 画像生成モデル | FLUX.2 [klein] 4B 蒸留版 |
| テキストエンコーダ | Qwen3 4B |
| クライアント | Claude Code（画像を直接読めるため評価ループ向き） |
| Claudeモデル | 配置ツールの設計・デバッグはOpus 5.5、定型作業はSonnet 5.5 |

- Klein 4Bのライセンス（Apache 2.0の想定）はBFLのモデルページで最終確認する
- commandPortは任意のPython/MELを受け付けるため、`commandPort -n "localhost:<ポート>"` のようにlocalhostだけで開く

## 制作対象・スケール・形状

白壁の天守（姫路城系）を作る。**層数・屋根の構成・各部の比率は参照画像に準拠する**。単位はcmで、天守の高さは参照画像の比率から割り出す（目安は約3000cm）。1パーツ＝1メッシュで分け、ポリゴン数の上限は設けない。

1. **箱組み版**：台形の石垣、参照画像と同じ層数の天守（上ほど小さい箱）、各層に寄棟の屋根（壁から少しはみ出す）。ここでパイプラインを一通り通す
2. **城らしさを足す**：参照画像に見える屋根の反り、入母屋・千鳥破風、窓
3. **仕上げ**：石垣の反り（扇の勾配）、鯱などの装飾。できなければAIの限界として報告に入れる

## テクスチャ生成ワークフロー

ComfyUI公式テンプレート「Flux.2 Klein 4B text-to-image」をベースに、後処理でシームレス化と各マップ生成を足す。Fluxはモデル側のタイリングが効かないため、生成後にシームレス化する。

1. Klein 4Bで生成（2048×2048）
2. High-Pass Delightで焼き込まれた陰影を除去（[ComfyUI-Seamless-Texture](https://comfyai.run/custom_node/ComfyUI-Seamless-Texture)）
3. Multiband Blendでシームレス化（overlap 0.10〜0.20）
4. Albedoを保存
5. Albedoから Depth Anything V2（[ComfyUI-DepthAnythingV2](https://github.com/kijai/ComfyUI-DepthAnythingV2)）→ Height、グレースケール＋レベル補正 → Roughness を保存
6. Albedo・Height・Roughnessの3枚すべてでTile PreviewとSeam Heatmapを出す。Heightは継ぎ目が出やすいので、出た場合はHeightにもMultiband Blendをかけ直す

**MCPに公開する入力**：プロンプト（可変部分）、シード、出力名、解像度の4つのみ。

**固定プロンプト**：`seamless tileable texture, top-down orthographic view, flat even lighting, no shadows, high detail`

| 素材 | 可変プロンプト |
| --- | --- |
| 石垣 | `Japanese castle stone wall, tightly fitted granite blocks, uchikomi-hagi style, weathered gray stone, moss in the gaps` |
| 白漆喰 | `white Japanese plaster wall, smooth lime plaster, subtle stains and faint weathering` |
| 木部 | `dark aged wood, Japanese castle timber, straight vertical grain` |
| 瓦（1枚の質感） | `dark gray fired clay surface, Japanese roof tile, subtle glaze and weathering` |

**瓦のバリエーション**：瓦は同じプロンプトでシードだけを変えて3種類（tile01〜03）生成する。屋根全体の色ムラは、この3種類を瓦ごとに割り振って出す（後述）。

## マテリアル・UV・命名規則・フォルダ

シェーダーはaiStandardSurfaceで統一し、Arnoldでそのまま確認する。

| マップ | 接続先 |
| --- | --- |
| Albedo | baseColor |
| Height | bump2d → normalCamera |
| Roughness | specularRoughness |

**UVのルール**

- 石垣・白漆喰・木部：テクスチャ1枚＝実寸2m四方を基準にUVタイリングを合わせる
- 瓦：2mタイリングは使わない。瓦モデルのUVを0〜1に収め、テクスチャ1枚を瓦1枚に貼る

| 対象 | 命名 | 例 |
| --- | --- | --- |
| メッシュ | `castle_{部位}_geo` | castle_roof01_geo |
| 瓦の元モデル | `castle_tile_{maru\|hira}{01-03}_geo` | castle_tile_maru02_geo |
| マテリアル | `castle_{素材}_mtl` | stone / plaster / wood / tile01〜03 |
| テクスチャ | `castle_{素材}_{albedo\|height\|rough}.png` | castle_stone_albedo.png、castle_tile02_rough.png |

- ComfyUIの出力先は `project/textures/` に直接保存し、Mayaプロジェクトのsourceimagesに指定する
- 評価ログは `project/log/` に保存する

## 瓦の大量配置

検証の肝。瓦はテクスチャではなく1枚ずつのジオメトリとし、AIにPythonの配置ツールを作らせて**instancerノード**で並べる（数千〜数万枚になるため、複製や瓦1枚ごとのインスタンスノードは使わない）。

- 仕組み：屋根面上の配置点をパーティクル（nParticle）として作り、各点に位置・回転・objectIndexを持たせる。instancerノードには瓦の元モデル（丸瓦・平瓦×3バリエーション）を登録し、objectIndexでどれを置くかを決める
- 瓦の種類：丸瓦と平瓦から始め、余裕があれば軒瓦（巴紋）と棟瓦を追加
- 配置ルール：屋根面の勾配方向に列を作り、平瓦と丸瓦を交互に並べる
- パラメータ：列の間隔、重なり量、ランダム回転、ランダム位置ズレ、バリエーションの割り振り（シード指定で再現できること）
- 色ムラ：元モデルごとにtile01〜03のマテリアルを割り当てておき、objectIndexをランダムに振ることで出す
- 反り対応：第1段階は平面屋根。第2段階で反った面に沿い、法線に合わせて向きを変える
- 進め方：まず屋根1面で試し、問題なければ全屋根に適用する
- 再利用：パラメータを変えて再配置できる形にし、他の屋根にも使えるツールとして残す

**決定事項**

- 瓦1枚の寸法：参照画像からAIが割り出す（段階0で他の部位の比率と一緒に書き出し、人が確認する）
- 瓦モデル：丸瓦・平瓦の元モデルもAIに作らせる（検証項目に含める）
- 浮き・めり込みの許容値：2cmまで

## ビューポート評価と再現ループ

AIが自分で撮影・比較・採点し、参照画像に近づくまで修正を繰り返す。上限に達したら必ず止まり、人に報告する。

<figure>
<svg viewBox="0 0 760 420" role="img" aria-label="参照画像に近づくまで制作・撮影・採点を繰り返し、上限で止まる" font-size="13" font-family="inherit">
<defs><marker id="loop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9aa8"/></marker></defs>
<text x="24" y="34" font-size="15" font-weight="600" fill="#222">参照画像に近づくまで繰り返し、上限で必ず止まる</text>
<g fill="none" stroke="#9a9aa8" stroke-width="1.25">
<path d="M172 110H208" marker-end="url(#loop-arrow)"/>
<path d="M356 110H392" marker-end="url(#loop-arrow)"/>
<path d="M540 110H576" marker-end="url(#loop-arrow)"/>
<path d="M650 138V214" marker-end="url(#loop-arrow)"/>
<path d="M586 250H494" marker-end="url(#loop-arrow)"/>
<path d="M366 250H264" marker-end="url(#loop-arrow)"/>
<path d="M190 222V172H466V138" marker-end="url(#loop-arrow)"/>
<path d="M650 286V346" marker-end="url(#loop-arrow)"/>
<path d="M430 286V346" marker-end="url(#loop-arrow)"/>
</g>
<g fill="none" stroke="#9a9aa8" stroke-width="1.25">
<rect x="24" y="82" width="148" height="56" rx="8"/>
<rect x="208" y="82" width="148" height="56" rx="8"/>
<rect x="392" y="82" width="148" height="56" rx="8"/>
<rect x="576" y="82" width="148" height="56" rx="8"/>
<rect x="116" y="222" width="148" height="56" rx="8"/>
<rect x="356" y="346" width="148" height="48" rx="8"/>
<polygon points="586,250 650,214 714,250 650,286"/>
<polygon points="366,250 430,214 494,250 430,286"/>
</g>
<rect x="576" y="346" width="148" height="48" rx="8" fill="#6d5bd0" fill-opacity="0.12" stroke="#6d5bd0" stroke-width="2"/>
<g text-anchor="middle" fill="#222">
<text x="98" y="106" font-weight="600">参照画像の読み解き</text>
<text x="282" y="106" font-weight="600">カメラを合わせる</text>
<text x="466" y="106" font-weight="600">制作</text>
<text x="650" y="106" font-weight="600">撮影して採点</text>
<text x="190" y="246" font-weight="600">修正案を出す</text>
<text x="650" y="254">40点以上？</text>
<text x="430" y="254">上限に到達？</text>
<text x="650" y="374" font-weight="600">完了</text>
<text x="430" y="374" font-weight="600">停止して報告</text>
</g>
<g font-size="11.5" fill="#777">
<text x="98" y="125" text-anchor="middle">要素を書き出し人が確認</text>
<text x="282" y="125" text-anchor="middle">参照と同じ構図</text>
<text x="466" y="125" text-anchor="middle">Maya＋ComfyUI</text>
<text x="650" y="125" text-anchor="middle">5項目×10点</text>
<text x="190" y="265" text-anchor="middle">人の確認を待つ</text>
<text x="540" y="242" text-anchor="middle">いいえ</text>
<text x="660" y="316">はい</text>
<text x="315" y="242" text-anchor="middle">いいえ</text>
<text x="440" y="316">はい</text>
<text x="420" y="316" text-anchor="end">10回、または3回連続で+2点未満</text>
<text x="328" y="164" text-anchor="middle">確認後に再制作</text>
</g>
</svg>
<figcaption>参照画像の再現ループ · 停止条件つき</figcaption>
</figure>

**カメラ**

- 評価用カメラは固定5台：正面、側面、俯瞰、斜め45°、軒先アップ
- 加えて参照画像と同じ構図のカメラ1台。段階0で参照画像から焦点距離・カメラの高さ・向きを推定し、人の確認を取ってから固定する

**撮影**

- `playblast` で1フレームをPNG出力（GG_MayaMCPにキャプチャ機能があればそれを使う）
- playblastはViewport 2.0の近似表示なので、「素材感・色」の採点だけは参照構図カメラでArnoldの低解像度レンダー（960×540程度）を使う

**採点（各10点、合計50点）**

採点のぶれを抑えるため、3点・6点・9点の目安を決めておく。

| 項目 | 3点 | 6点 | 9点 |
| --- | --- | --- | --- |
| シルエット | 輪郭が別物 | 大まかな輪郭は合うが、層や屋根の数・位置がずれる | 参照と重ねてもほぼ一致 |
| プロポーション | 石垣・各層の高さの比が明らかに違う | 一部の層の幅・高さがずれる | 各部の比率が参照と一致 |
| 屋根の形と反り | 寄棟の直線のまま | 反り・破風はあるが、形や位置が参照と違う | 軒先の反り上がりと破風の配置が参照と一致 |
| 瓦の並び・密度 | 浮き・隙間・向きの乱れが目立つ | 並びは揃うが、密度や重なりが参照と違う | 列・重なり・密度が自然で破綻がない |
| 素材感・色 | 素材の区別がつかない | 素材は分かるが、色味や汚れ方が参照と違う | 白壁・石垣・瓦の色と質感が参照に近い |

- 採点は、修正の経緯を渡さないサブエージェントに、参照画像と撮影画像だけを見せて行う（自分で作ったものを自分で採点すると甘くなるため）
- 前回より合計+2点以上を「改善」とみなす。+2点未満が3回続いたら停止する

**AIに見させるチェック項目**

- 瓦の浮き・めり込み、向きの逆転、列のずれ、隙間
- テクスチャの継ぎ目や引き伸ばし
- 全体のプロポーション

**数値チェックとの併用**：画像では小さな浮きを見逃すため、各瓦と屋根面の距離をレイキャストで測り、許容値（2cm）を超えた瓦をリスト化する。全体の見た目は画像、細かい精度は数値で見る。

**記録**：各回の画像・点数（項目別）・修正内容を `project/log/` に残す。点数はあくまで参考値で、最終判断は人が行う。

## Claudeへの指示テンプレート

ルールはすべて[ページ末尾のCLAUDE.md](#claude-md)にまとめてある。Mayaプロジェクトのルートに置いたうえで、作業は以下の依頼文で段階ごとに頼む。

**段階0：参照画像の読み解き**

```
参照画像を再現する。まず画像から層数・屋根の構成・各部の比率・瓦1枚の寸法・素材の要素を書き出して私に確認を取る。
次に参照画像から焦点距離・カメラの高さ・向きを推定して同じ構図のカメラを作り、私の確認を取る。
以降は「制作→撮影→比較→採点→修正」を繰り返す。採点はCLAUDE.mdの基準に従い、サブエージェントに行わせる。
40点以上で完了、最大10回、+2点未満が3回続いたら停止。
修正案を出したら私の確認を待つ。各回の画像・点数・修正内容を project/log/ に記録する。
```

**段階1：形を作る**

```
石垣の台形の土台と、参照画像と同じ層数の天守（上ほど小さい箱）、
各層に寄棟の屋根を作って。屋根は壁から少しはみ出させて。
各部の比率は段階0で確認した内容に合わせて。
```

**段階2：テクスチャ生成と割り当て**

```
石垣・白漆喰・木部の3種類と、瓦1枚用（シード違いで3種類）のテクスチャを
ComfyUIで生成して、それぞれのマテリアルに接続して。
石垣・白漆喰・木部のUVは2m四方で1タイルに、瓦モデルのUVは0〜1に収めて。
```

**段階3：瓦配置**

```
丸瓦と平瓦の元モデルを作り、tile01〜03のマテリアルを割り当てた3バリエーションずつ用意して。
屋根面上の配置点をnParticleで作り、instancerノードで瓦を並べるPythonツールを作って。
パラメータ：列の間隔、重なり量、ランダム回転、ランダム位置ズレ、バリエーションの割り振り（シード指定）
まず1つの屋根面で試して、問題なければ全屋根に適用して。
配置後は屋根面との距離チェック（許容値2cm）も実行して。
```

## 評価項目と報告

報告では「AIに任せられた作業」と「人が必要だった作業」を分けて示す。

- 所要時間：検証の前に、担当者が手作業での所要時間を工程ごと（箱組み、テクスチャ、瓦配置など）に見積もっておき、それと比べる
- 手直し：人が修正した回数と箇所
- 発見者の区別：AIが見つけた問題と、人が見つけた問題
- 再現度：ループの回数ごとの点数推移（項目別）と、最終的な人の評価
- 成果物：瓦配置ツールが他の屋根にも再利用できるか

**Sources**

- [GG_MayaMCP（PyPI）](https://pypi.org/project/maya-mcp/0.6.0/)
- [metabrain-labs/comfyui-mcp-server](https://claudemarketplaces.com/mcp/io.github.metabrain-labs/comfyui-mcp-server)
- [ComfyUI公式 Flux.2 Klein ガイド](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [ComfyUI-Seamless-Texture](https://comfyai.run/custom_node/ComfyUI-Seamless-Texture)
- [kijai/ComfyUI-DepthAnythingV2](https://github.com/kijai/ComfyUI-DepthAnythingV2)
- 参考：[spinagon/ComfyUI-seamless-tiling](https://github.com/spinagon/ComfyUI-seamless-tiling)（A1111の「Tiling」をモデル側で再現するノード。本ワークフローでは生成後のシームレス化を採用したため使わない）
