# Substance Designer × AI自動化 調査まとめ

## 目的

Substance Designerの**ピクセルプロセッサー内部の関数グラフ(Function Graph)接続**を、AIに自動生成させられるか検証する。MCP経由での操作も検討したが、最終的には**Substance Automation Toolkit (SAT) の pysbs** を使う方針に決定。

---

## 1. MCPサーバーの調査

Substance Designer用のMCP(Model Context Protocol)サーバーはAnthropic公式ディレクトリには存在しないが、コミュニティ製のものがいくつか見つかった。

### 見つかったMCPサーバー

| 名前 | 概要 |
|---|---|
| `matthieuhuguet/substance-designer-mcp` | SD初のMCP統合。グラフ作成・ノード配置・接続・パラメータ設定・79種のマテリアルレシピを自然言語から生成 |
| `MikeLi-28/substance-designer-mcp` | セキュリティ重視。ランタイムをDesigner外部に分離 |
| `dcc-mcp-substance3d-designer` (PyPI) | Designer内部に組み込みのHTTP MCPサーバーを起動し、Qtメインスレッド上でツール実行 |

### 対応範囲と限界

- 対応: ライブラリノード(Clouds, Cells, Perlin Noiseなど)、アトミックノード(blend, levels, blur)、PBR出力ノード、マテリアルレシピの一括生成
- **未対応: ピクセルプロセッサー内部のシェーダーグラフ編集**
  - README上でも「現状height/grayscaleグラフ中心で、カラーグラフ対応すら未整備」と明記されている
  - `execute_sd_code` という任意のPythonコードをSDプロセス内で実行できるツールはあるが、専用サポートではなく力技での回避策

**結論**: ピクセルプロセッサーが使えないと実用性が低いため、MCP経由の路線は保留。

---

## 2. Substance DesignerのPython実行環境について

SDには公式のPython Scripting API(`sd`モジュール)が組み込まれており、`sd.api.sdgraph` や `sd.api.sdnode` などでグラフ・ノード・プロパティを操作できる。

- ノード(`SDNode`)はオブジェクトへの操作を表し、複数のプロパティを持つ
- ピクセルプロセッサーやFxMapの中身は「Function Graph」という別レイヤーのノードグラフで構成されており、これもAPI経由で操作可能なはず
- 実例として、コミュニティ製プラグイン `igor-elovikov/sd-sex` が存在し、Pythonライクな構文をSubstance DesignerのFunction Graphに変換するツールとして機能している(PythonのASTを解析してFunction Graphノードを自動生成)

これにより「AIがコードを生成 → SD内で実行/変換 → Function Graph構築」という流れが技術的に可能であることが確認できた。

---

## 3. 方針決定: Substance Automation Toolkit (pysbs) を使う

MCPではなく、Adobe公式のPython SDKである **Substance Automation Toolkit (SAT)** の `pysbs` を使う方針に決定。

### pysbsを選んだ理由

1. SD本体を起動せず、バッチ処理で `.sbs` ファイル(XML形式)を直接生成・編集できる
2. 公式SDKのためドキュメントが安定している
3. ピクセルプロセッサー内部のFunction Graphも `SBSDynamicValue` というクラスで構築可能
4. ComfyUIやUEの作業とパイプライン統合しやすい(Pythonスクリプトとして完結)

### 核心となるクラス: `SBSDynamicValue`

公式ドキュメントによると、このクラスは以下の3つすべてを表現する:

- Function graph
- dynamic parameterの値を決める関数
- **Pixel Processorの関数**

つまりピクセルプロセッサー内部のノードグラフも、このクラスのAPIでそのまま構築できる。

**主なメソッド**
- `connectNodes(aLeftNode, aRightNode, aRightNodeInput=None)` — ノード同士を接続。右側の入力ポートを省略すると互換性のある最初の入力に自動接続
- `createFunctionNode(...)` — 演算子・定数・サンプルノードなどを追加
- `createFunctionInstanceNodeFromPath(...)` — 既存の関数定義(数学関数など)を参照するノードを作成

**参考実例**: Adobe公式に「Pixel Processor Ray tracer」というサンプルがあり、pysbsでピクセルプロセッサーの中身(レイトレーサーのロジック)を丸ごとPythonコードから生成する実例として存在する。

**関連クラス**
- `SBSParamsGraph` — FxMapノード用の関数グラフ生成
- `sbscleaner.cleanSubstance` — dynamic value内(pixel processor functionを含む)の不要な関数ノードを掃除する機能

---

## 4. 検証手順(実施予定)

AIに「ピクセルプロセッサー内部の関数接続」をやってもらえるかを確認するための手順。

### Step 1: 環境準備
- Adobe公式サイトからSubstance Automation Toolkit (SAT) をダウンロード・インストール(SD本体とは別パッケージ)
- SAT同梱のPython(または自分のPython環境)に `pysbs` をインストール
- 出力先の `.sbs` ファイル保存フォルダを用意

### Step 2: 最小テストケースを決める
- いきなり複雑なシェーダーを作らず、まず「入力画像を反転するだけ」のような単純なピクセルプロセッサーで検証する
- 目的は「AIが正しいノード接続コードを書けるか」の確認であり、複雑さは後回しにする

### Step 3: AIにpysbsコードを書かせる
1. `sbsgenerator` で空の `.sbs` とグラフを作成
2. グラフ内に `PIXEL_PROCESSOR` ノードを配置
3. そのノードの `SBSDynamicValue`(Function Graph)に対し、`createFunctionNode` や `connectNodes` でノードを組む
   - 例: `Sample(input1)` → `Sub(1.0, sample)` → `Output`(反転処理)

### Step 4: コンパイル・確認
- 生成した `.sbs` をSubstance Designerで開く、または `sbscooker` で `.sbsar` にコンパイルしてエラーが出ないか確認
- SD上でピクセルプロセッサーノードをダブルクリックし、意図した関数グラフができているか目視確認
- `sbsrender` で実際にレンダリングし、期待通りの画像が出るか検証

### Step 5: 結果次第で複雑化
- 単純な反転処理が動作したら、`$pos` を使った座標参照や複数入力のブレンドなど、より実践的な処理へ進む

---

## 5. 開発環境: VS Code + GitHub Copilot

pysbsのAPIは独特なクセがあり、メソッド名・引数の細部は一発で正確に書けない可能性が高い。そのため以下の運用を想定:

1. VS Code上でpysbsスクリプトを記述
2. Copilotに、SAT同梱のAPIリファレンス(`html-doc.zip`)と照らし合わせながら修正を依頼
3. 実行してエラーが出たらCopilotに貼り、その場で修正を繰り返す
4. `.sbs` が正しく生成されたらSDで目視確認 → `sbsrender` で最終検証

### 作成した検証用スクリプト

`generate_invert_pp.py` — 入力画像を反転するだけの最小構成ピクセルプロセッサーを生成するテストコード。

処理内容:
```
出力 = 1.0 - サンプルした入力画像の値
```

ノード構成:
```
[Get Input (Sample)] → [Sub (1.0 - x)] → [Output]
```

**注意**: このスクリプトは構造・流れの叩き台であり、`createFunctionNode` の引数形式や `FunctionEnum` の値名など、細部はSAT付属の正確なAPIリファレンスと照らし合わせた修正が必要。初回実行では型不一致・引数名の違いによるエラーが出る前提で、Copilotとの往復修正を想定している。

---

## 6. 現時点の結論

- 既製のSubstance Designer MCPには、ピクセルプロセッサー専用のサポートはない
- しかし **pysbs (`SBSDynamicValue`)** を使えば、ピクセルプロセッサー内部のFunction Graphノード構成をPythonコードから生成することは技術的に可能
- 公式サンプル(Pixel Processor Ray tracer)がその実現可能性を裏付けている
- 次のアクションは、VS Code + Copilotを使って実際に最小構成(反転処理)のスクリプトを動かし、SD上で意図通りのグラフが構築されるかを検証すること
