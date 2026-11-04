# Gaussian Splatting入門と、画像1枚から3D化する「ComfyUI-Idol」

*公開: 2026-11-04*

## 1. Gaussian Splatting（3DGS）とは

写真や動画から3Dシーンを再現する技術。ポリゴンメッシュの代わりに、**色・透明度・向き・大きさを持つ楕円体（ガウシアン）**を数十万〜数百万個空間に並べ、それを画面に重ね描き（スプラット）して描画する。2023年のSIGGRAPH論文で一気に広まった。

### 仕組み

1. 対象を多視点で撮影する
2. COLMAPなどでカメラ位置を推定する（SfM: Structure from Motion）
3. 点群を初期値にして、各ガウシアンのパラメータを「元写真と見た目が一致する」ように最適化する
4. 結果は `.ply` などの点群的なデータとして出力される

ラスタライズで描画するため、NeRFよりはるかに高速で、リアルタイム表示が可能。

### 得意・不得意

| 得意 | 不得意 |
|---|---|
| 植物・髪・反射・半透明など実写の質感の再現 | UV・マテリアル編集（メッシュではないため） |
| 高速なリアルタイム表示 | 物理衝突 |
| | ライティングの変更（撮影時の光が焼き込まれる） |
| | データ容量が大きい |

## 2. DCCツールの対応状況

### Houdini

- Houdini 21でネイティブ対応がプレビュー導入され、**2026年7月のHoudini 22で正式版**になった
- 対応範囲：PDG/TOPsでの学習、プロシージャルなクリーンアップ、Copernicusでのカラー・深度へのラスタライズ、Bone Deform / Surface Deformによる変形、リライティング
- **SfM（カメラ位置合わせ）だけは非対応**で、外部ツールで先に行う必要がある
- サードパーティの **GSOPs** は3.0.0でHoudini 22に対応し、スプラットのベイク機能も追加された

### Unreal Engine

- レンダリング系：NanoGS、SplatRenderer
- 学習ツール連携：PostshotのUnrealベータ、Volinga、XGRIDS
- **SplatCapture**：UEのレベル内で仮想カメラを飛ばし、学習用データセットを書き出すプラグイン（UE 5.3〜5.8対応、GitHubで無料公開）

### フォーマット

glTFのGaussian Splatting拡張の策定が進んでおり、標準化も近づいている。

## 3. どこから始めるか

おすすめの順番は、**まず専用ツールで「撮影→学習」を一通り体験し、その後Houdiniに持ち込む**こと。

- いきなりHoudiniで始めると、うまくいかないときに撮影・SfM・学習設定のどれが原因か切り分けにくい
- Postshot、Polycam、Lumaなどなら、スマホで撮った動画を入れるだけで結果が出るので、「どう撮れば綺麗になるか」の感覚を先につかめる

Houdiniが活きるのは次のような場面。

- フローター（ゴミ）の除去や切り出しをプロシージャルに行う
- 変形・リグ・リライトなど、撮影結果を加工する
- PDGで複数アセットを一括学習するパイプラインを組む
- クリーンアップ処理をHDA化して社内ツールにする

## 4. ComfyUI-Idol：画像1枚から3Dスプラットを生成

リポジトリ：<https://github.com/PedroMarinhoDev/ComfyUI-Idol>

### 概要

speridlabsの「Idol」をComfyUIで動かすノードパック。**画像1枚から、写っていない背面や側面まで推定した3D Gaussian Splat（`.ply`）を生成する**。

- ガウシアン数はデフォルトで262,144、最大1,048,576（32の倍数で指定）
- 入力画像のカメラ視点も推定するため、元の構図でのレンダーや、その視点から始まるターンテーブル動画も出力できる
- ラッパーではなく、ComfyUI標準のTripoSplatノード・KSampler・メモリ管理でそのまま動く

### 通常の3DGSとの違い

| | 通常の3DGS | Idol / TripoSplat |
|---|---|---|
| 入力 | 多視点の写真・動画 | 画像1枚 |
| 生成方法 | 1シーンごとに最適化（数分〜数十分） | 学習済みモデルによる推論（数十秒） |
| 見えない部分 | 作れない | 推測で生成する |
| 精度 | 実物に忠実 | 正面は忠実、背面は推測 |

### 技術の中身

一言でいえば、**画像を条件にした拡散モデルで、ガウシアンの集合を生成する**技術。

1. **前処理**：BiRefNetで背景を除去し、物体を1024×1024の黒背景に配置する
2. **条件の抽出**：DINOv3で形や意味の特徴を、FLUX.2 VAEで見た目の詳細を潜在化する
3. **デノイズ**：3D空間内に均一に散らばる位置（Sobol列）に置いたトークン群を、ノイズから50ステップかけて整える
4. **デコード**：オクツリーデコーダで「どこに物があるか」、ガウシアンデコーダで「各ガウシアンの位置・色・大きさ・透明度」に変換する
5. **カメラ推定**：生成と同時に入力画像の視点を予測する

Stable Diffusionが「ノイズから画像を作る」のに対し、こちらは「ノイズから3Dのガウシアン群を作る」モデルと考えるとわかりやすい。

#### SD系との関係

Stable Diffusion系では**ない**。アーキテクチャはVASTのTripoSplatで、重みはsperidlabsの独自学習。共通点は拡散モデルであること（KSamplerが使える）と、FLUX.2 VAEを使っている点。time shift 3の設定があることから、FLUXやSD3と同じフローマッチング型と思われる（推測）。SD用のLoRAやチェックポイントは流用できない。

### 使用モデル（合計約5GB）

| ファイル | 役割 | 配置先 | サイズ |
|---|---|---|---|
| `idol_fp32.safetensors` | デノイザー本体 | `models/diffusion_models` | 1.48GB |
| `idol_vae_decoder_fp32.safetensors` | 潜在→ガウシアン変換 | `models/vae` | 1.15GB |
| `dino_v3_vit_h.safetensors` | 画像特徴抽出 | `models/clip_vision` | 1.68GB |
| `flux2-vae.safetensors` | 画像の潜在化 | `models/vae` | 0.34GB |
| `birefnet.safetensors` | 背景除去 | `models/background_removal` | 0.44GB |

- 上の2つは `PedroMarinhoDev/Idol-ComfyUI` から、下の3つは `VAST-AI/TripoSplat` から入手する（TripoSplatを使っていれば導入済み）
- 軽量版の `idol_fp16`（0.74GB）と `idol_vae_decoder_fp16`（0.58GB）もある。デフォルト精度なら速度・結果ともにほぼ同じ

### 動作環境と速度

- ComfyUI 0.43以降（ネイティブTripoSplatノードが必要）
- VRAMピークは約5.8GB
- 追加のPythonパッケージは不要
- RTX 4090で1オブジェクト約28秒、RTX 3090でサンプリング約52秒

### 導入手順

**1. ノードをインストールする**

ComfyUI-Managerで「Idol (image to 3D splat)」を検索してインストールし、再起動する。手動の場合は以下。

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/PedroMarinhoDev/ComfyUI-Idol
```

**2. モデルをダウンロードする**

```bash
cd ComfyUI/models
hf download PedroMarinhoDev/Idol-ComfyUI diffusion_models/idol_fp32.safetensors vae/idol_vae_decoder_fp32.safetensors --local-dir .
hf download VAST-AI/TripoSplat clip_vision/dino_v3_vit_h.safetensors vae/flux2-vae.safetensors background_removal/birefnet.safetensors --local-dir .
```

`hf` コマンドがなければ `pip install -U huggingface_hub` を先に実行する。ワークフローを開いたときに不足ファイルのダウンロードを促されるので、そこから入れることもできる。

**3. ワークフローを開く**

Templates → ComfyUI-Idol → `idol_image_to_splat` を選ぶ。`example_workflows/idol_image_to_splat.json` をドラッグ&ドロップしてもよい。

**4. 設定して実行する**

- Load Imageで画像を選ぶ（同梱の `example_inputs/fennec-figure.png` で試せる）
- 2つのIdolノードの `mode` を同じ値にそろえる。生成画像・レンダーなら `synthetic`、実写写真なら `real`
- サンプラー設定（euler / simple / 50 steps / cfg 4）はワークフローに入っているので変更不要
- **Idol Precisionノードは消さない**。消すとfp32モデルが約4.6倍遅くなるバグを回避できなくなる

**5. 出力を確認する**

`output/3d` に `.ply`、入力視点のレンダー、ターンテーブル動画が保存される。`.ply` はSuperSplatなどのビューアやHoudiniで開ける。

### トラブルシューティング

- **物体が切れる・小さい・背景が残る**：「What the model sees」プレビューで、黒背景に物体だけが乗っているか確認する。透過PNGの場合は、Remove Backgroundの代わりに Load ImageのMASK → Invert Mask をつなぐ
- **背面がおかしい**：seedを変える。真正面より**斜め3/4ビュー**の画像のほうが情報が多く有利

### ライセンス

| 要素 | ライセンス | 商用利用 |
|---|---|---|
| ComfyUI-Idolのコード | GPL-3.0 | 可（改変して配布する場合はソース公開義務あり） |
| Idolの重み | Apache-2.0 | 可 |
| FLUX.2 VAE | Apache-2.0 | 可（FLUX.2 [dev]本体は非商用だが、VAEは別途Apache 2.0で公開） |
| DINOv3 | Meta独自のDINOv3 License | 条件付きで可 |
| BiRefNet | MIT（要確認） | 可 |

- **DINOv3**：Meta公式ライセンスはロイヤリティフリーで、使用・改変・配布を認めている。ただし軍事・核・諜報・銃器などの用途は禁止。標準的なOSSライセンスではないため、業務利用時は法務確認が推奨される。なお「CC BY-NC（非商用）」と記載した非公式サイトもあるが、Meta公式ページの記載が正しい
- 社内で動かして生成物を使うだけなら、GPLの公開義務は基本的に発生しない
- 生成した `.ply` の権利については明記が見当たらない。会社のアセットにする場合は法務確認が安心

### 注意点

- 公開直後のリポジトリで、執筆時点ではコミット2件・スター1件と実績はほぼない
- 背面や細部は推測なので、実物の正確な再現には撮影ベースの3DGSのほうが向いている

## 5. 活用アイデア

撮影なしで3DGSのパイプラインを一通り試す流れ：

1. Nano Bananaなどで、対象物の**斜め3/4ビュー**画像を生成する
2. ComfyUI-Idolでスプラット化する
3. Houdiniでクリーンアップ・加工する
4. UEのプラグインで表示する

向いている用途：コンセプト確認、背景の小物、AI生成キャラクターの立体化。

## 参考

- [ComfyUI-Idol (GitHub)](https://github.com/PedroMarinhoDev/ComfyUI-Idol)
- [Idol-ComfyUI 重み (Hugging Face)](https://huggingface.co/PedroMarinhoDev/Idol-ComfyUI)
- [Idol SDK (speridlabs)](https://github.com/speridlabs/idol-sdk)
- [Houdini と Gaussian Splatting (radiancefields.com)](https://radiancefields.com/platforms/sidefx)
- [SplatCapture 3.0.0 (radiancefields.com)](https://radiancefields.com/splatcapture-3.0.0-adds-spline-capture)
- [3D Gaussian Splatting 関連ニュース (CG Channel)](https://www.cgchannel.com/tag/3d-gaussian-splatting)
- [FLUX.2 VAE (Hugging Face)](https://huggingface.co/unsloth/FLUX.2-VAE)
- [DINOv3 License (Meta)](https://ai.meta.com/resources/models-and-libraries/dinov3-license)
