# Maya MCP×ComfyUI 検証仕様書（姫路城）

*公開: 2026-10-07*

## 目的と概要

ClaudeにMaya MCPとComfyUI MCPを操作させ、参照画像をもとに白壁の日本の城（姫路城系）を再現できるかを検証する。見どころは**瓦の大量配置ツールをAIが作れるか**と、**ビューポート画像を見てAIが自分で修正できるか**の2点。

- ゴール：参照画像に近い城をAI主導で作り、任せられる作業と人が必要な作業を切り分けて報告する
- 範囲：モデリング、テクスチャ生成と割り当て、瓦配置、ビューポート評価まで（リグ・アニメーション・最終レンダーは対象外）

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

## 制作対象・スケール・形状

白壁の天守（姫路城系）を、単位cm・高さ約3000cmで作る。1パーツ＝1メッシュで分け、ポリゴン数の上限は設けない。

1. **箱組み版**：台形の石垣、三層の天守（上ほど小さい箱）、各層に寄棟の屋根（壁から少しはみ出す）。ここでパイプラインを一通り通す
2. **城らしさを足す**：屋根の反り、入母屋・千鳥破風、窓
3. **仕上げ**：石垣の反り（扇の勾配）、鯱などの装飾。できなければAIの限界として報告に入れる

## テクスチャ生成ワークフロー

ComfyUI公式テンプレート「Flux.2 Klein 4B text-to-image」をベースに、後処理でシームレス化と各マップ生成を足す。Fluxはモデル側のタイリングが効かないため、生成後にシームレス化する。

1. Klein 4Bで生成（2048×2048）
2. High-Pass Delightで焼き込まれた陰影を除去（[ComfyUI-Seamless-Texture](https://comfyai.run/custom_node/ComfyUI-Seamless-Texture)）
3. Multiband Blendでシームレス化（overlap 0.10〜0.20）
4. Albedoを保存
5. Albedoから Depth Anything → Height、グレースケール＋レベル補正 → Roughness を保存
6. 確認用にTile PreviewとSeam Heatmapを出す

**MCPに公開する入力**：プロンプト（可変部分）、シード、出力名、解像度の4つのみ。

**固定プロンプト**：`seamless tileable texture, top-down orthographic view, flat even lighting, no shadows, high detail`

| 素材 | 可変プロンプト |
| --- | --- |
| 石垣 | `Japanese castle stone wall, tightly fitted granite blocks, uchikomi-hagi style, weathered gray stone, moss in the gaps` |
| 白漆喰 | `white Japanese plaster wall, smooth lime plaster, subtle stains and faint weathering` |
| 木部 | `dark aged wood, Japanese castle timber, straight vertical grain` |
| 瓦（1枚の質感） | `dark gray fired clay surface, Japanese roof tile, subtle glaze and weathering` |

## マテリアル・命名規則・フォルダ

シェーダーはaiStandardSurfaceで統一し、Arnoldでそのまま確認する。テクスチャ1枚＝実寸2m四方を基準にUVタイリングを合わせる。

| マップ | 接続先 |
| --- | --- |
| Albedo | baseColor |
| Height | bump2d → normalCamera |
| Roughness | specularRoughness |

| 対象 | 命名 | 例 |
| --- | --- | --- |
| メッシュ | `castle_{部位}_geo` | castle_roof01_geo |
| マテリアル | `castle_{素材}_mtl` | stone / plaster / wood / tile |
| テクスチャ | `castle_{素材}_{albedo\|height\|rough}.png` | castle_stone_albedo.png |

- ComfyUIの出力先は `project/textures/` に直接保存し、Mayaプロジェクトのsourceimagesに指定する
- 評価ログは `project/log/` に保存する

## 瓦の大量配置

検証の肝。瓦はテクスチャではなく1枚ずつのジオメトリとし、AIにPythonの配置ツールを作らせて**インスタンス**で並べる（数千〜数万枚になるため複製は使わない）。

- 瓦の種類：丸瓦と平瓦から始め、余裕があれば軒瓦（巴紋）と棟瓦を追加
- 配置ルール：屋根面の勾配方向に列を作り、平瓦と丸瓦を交互に並べる
- パラメータ：列の間隔、重なり量、ランダム回転、ランダム位置ズレ、色ムラ用のランダムID
- 反り対応：第1段階は平面屋根。第2段階で反った面に沿い、法線に合わせて向きを変える
- 進め方：まず屋根1面で試し、問題なければ全屋根に適用する
- 再利用：パラメータを変えて再配置できる形にし、他の屋根にも使えるツールとして残す

**未決事項**

- [ ] 瓦1枚の寸法
- [ ] 瓦モデルを自前で用意するか、AIに作らせるか

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
<text x="420" y="316" text-anchor="end">10回、または3回連続で改善なし</text>
<text x="328" y="164" text-anchor="middle">確認後に再制作</text>
</g>
</svg>
<figcaption>参照画像の再現ループ · 停止条件つき</figcaption>
</figure>

**撮影**

- `playblast` で1フレームをPNG出力（GG_MayaMCPにキャプチャ機能があればそれを使う）
- 評価用カメラは固定5台：正面、側面、俯瞰、斜め45°、軒先アップ。加えて参照画像と同じ構図のカメラ1台

**採点（各10点、合計50点）**：シルエット、プロポーション、屋根の形と反り、瓦の並び・密度、素材感・色

**AIに見させるチェック項目**

- 瓦の浮き・めり込み、向きの逆転、列のずれ、隙間
- テクスチャの継ぎ目や引き伸ばし
- 全体のプロポーション

**数値チェックとの併用**：画像では小さな浮きを見逃すため、各瓦と屋根面の距離をレイキャストで測り、許容値超えをリスト化する。全体の見た目は画像、細かい精度は数値で見る。

**記録**：各回の画像・点数・修正内容を `project/log/` に残す。AIの自己採点は甘くなりがちなので、最終判断は人が行う。

## Claudeへの指示テンプレート

前提はCLAUDE.md（またはプロジェクト指示）に書き、作業は段階ごとに依頼する。下の「前提」は要点だけを抜き出したもの。この仕様書のルールをすべて入れた完成版は、[ページ末尾のCLAUDE.md](#claude-md)からそのままコピー・ダウンロードできる。

**前提**

```
あなたはMaya MCPとComfyUI MCPを使って、日本の城（白壁・姫路城系）を作る。

ルール
- 単位はcm。天守の高さは約3000cm
- 命名：メッシュ castle_{部位}_geo、マテリアル castle_{素材}_mtl
- テクスチャ：castle_{素材}_{albedo|height|rough}.png を project/textures/ に保存
- シェーダーは aiStandardSurface。Albedo→baseColor、Height→bump2d、Roughness→specularRoughness
- 作業前に必ずシーンを保存。1ステップごとに結果を報告して止まる
- 失敗や手直しが必要な箇所は、隠さずに報告する
- 各ステップの最後に評価用カメラ5台でplayblastを撮影して確認し、問題点を報告する
```

**段階0：参照画像の読み解き**

```
参照画像を再現する。まず画像から形状・素材の要素を書き出して私に確認を取る。
次に参照と同じ構図のカメラを作り、以降は「制作→撮影→比較→採点→修正」を繰り返す。
採点は5項目×10点。40点以上で完了、最大10回、3回連続で改善しなければ停止。
修正案を出したら私の確認を待つ。各回の画像・点数・修正内容を project/log/ に記録する。
```

**段階1：形を作る**

```
石垣の台形の土台と、三層の天守（上ほど小さい箱）、
各層に寄棟の屋根を作って。屋根は壁から少しはみ出させて。
```

**段階2：テクスチャ生成と割り当て**

```
石垣・白漆喰・木部・瓦1枚用の4種類のテクスチャを
ComfyUIで生成して、それぞれのマテリアルに接続して。
UVは2m四方で1タイルになるように調整して。
```

**段階3：瓦配置**

```
丸瓦と平瓦のモデルを作り、屋根面に沿ってインスタンスで配置する
Pythonツールを作って。
パラメータ：列の間隔、重なり量、ランダム回転、ランダム位置ズレ
まず1つの屋根面で試して、問題なければ全屋根に適用して。
配置後は屋根面との距離チェックも実行して。
```

## 評価項目と報告

報告では「AIに任せられた作業」と「人が必要だった作業」を分けて示す。

- 所要時間：人が手作業で行った場合との比較
- 手直し：人が修正した回数と箇所
- 発見者の区別：AIが見つけた問題と、人が見つけた問題
- 再現度：ループの回数ごとの点数推移と、最終的な人の評価
- 成果物：瓦配置ツールが他の屋根にも再利用できるか

**Sources**

- [GG_MayaMCP（PyPI）](https://pypi.org/project/maya-mcp/0.6.0/)
- [metabrain-labs/comfyui-mcp-server](https://claudemarketplaces.com/mcp/io.github.metabrain-labs/comfyui-mcp-server)
- [ComfyUI公式 Flux.2 Klein ガイド](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [ComfyUI-Seamless-Texture](https://comfyai.run/custom_node/ComfyUI-Seamless-Texture)
- [spinagon/ComfyUI-seamless-tiling](https://github.com/spinagon/ComfyUI-seamless-tiling)
