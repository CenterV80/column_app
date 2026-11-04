# ComfyUI-Idol：画像1枚から3D Gaussian Splatを生成する

*公開: 2026-11-04*

## 要点

- **画像1枚から、写っていない背面まで推定して3Dスプラット（`.ply`）を生成する**ComfyUIノードパック
- **ローカルで動く**。VRAMは約6GB、RTX 4090で1体約28秒
- ComfyUI標準のTripoSplatノード・KSamplerで動くので、**導入はノード追加＋モデル約5GBのダウンロードだけ**
- 商用利用は基本可能だが、**DINOv3だけ独自ライセンス**なので業務利用時は確認が必要
- 出力はポリゴンではなくスプラット。**メッシュ化は難しい**ので、現状は技術検証・見た目の確認向き

リポジトリ：<https://github.com/PedroMarinhoDev/ComfyUI-Idol>

---

## 何ができるか

speridlabsの画像→3Dモデル「Idol」をComfyUIで動かすためのノードパック。

- 入力画像1枚から、側面・背面まで含めた3D Gaussian Splatを生成する
- ガウシアン数はデフォルト262,144、最大1,048,576
- 入力画像のカメラ視点も推定するので、**元画像と同じ構図のレンダー**や、そこから始まる**ターンテーブル動画**も出力できる
- 生成画像やレンダー用の`synthetic`モードと、実写写真用の`real`モードがある

> **Gaussian Splatting（3DGS）とは**：ポリゴンの代わりに、色・透明度・向き・大きさを持つ半透明の楕円体（ガウシアン）を大量に並べて3Dを表現する方法。通常は多視点の写真から1シーンずつ最適化して作るが、Idolは学習済みモデルの推論で、画像1枚から直接生成する。

## しくみ

**画像を条件にした拡散モデルで、ガウシアンの集合を生成する**。画像生成AIが「ノイズから画像を作る」のに対し、こちらは「ノイズから3Dのガウシアン群を作る」と考えるとわかりやすい。

1. **前処理**：BiRefNetで背景を除去し、物体を1024×1024の黒背景に配置
2. **条件の抽出**：DINOv3で形や意味の特徴を、FLUX.2 VAEで見た目の詳細を取り出す
3. **デノイズ**：3D空間に散らばるトークン群を、ノイズから50ステップかけて整える（KSamplerを使用）
4. **デコード**：トークンを各ガウシアンの位置・色・大きさ・透明度に変換する
5. **カメラ推定**：生成と同時に、入力画像の視点を予測する

アーキテクチャはVASTの**TripoSplat**で、重みはsperidlabsが独自に学習したもの。Stable Diffusion系ではないので、SD用のLoRAやチェックポイントは使えない。

## 使用モデル（合計約5GB）

| ファイル | 役割 | 配置先 | サイズ |
|---|---|---|---|
| `idol_fp32.safetensors` | デノイザー本体 | `models/diffusion_models` | 1.48GB |
| `idol_vae_decoder_fp32.safetensors` | ガウシアンへの変換 | `models/vae` | 1.15GB |
| `dino_v3_vit_h.safetensors` | 画像特徴抽出 | `models/clip_vision` | 1.68GB |
| `flux2-vae.safetensors` | 画像の潜在化 | `models/vae` | 0.34GB |
| `birefnet.safetensors` | 背景除去 | `models/background_removal` | 0.44GB |

- 上の2つは `PedroMarinhoDev/Idol-ComfyUI`、下の3つは `VAST-AI/TripoSplat` から入手（TripoSplatを使っていれば導入済み）
- 軽量版の `idol_fp16`（0.74GB）と `idol_vae_decoder_fp16`（0.58GB）もあり、デフォルト精度なら結果はほぼ同じ

## 動作環境

- ComfyUI 0.43以降（ネイティブTripoSplatノードが必要）
- VRAMピーク約5.8GB
- 追加のPythonパッケージは不要
- RTX 4090で1体約28秒、RTX 3090でサンプリング約52秒

## 導入手順

**1. ノードをインストール**

ComfyUI-Managerで「Idol (image to 3D splat)」を検索してインストールし、再起動する。手動の場合は以下。

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/PedroMarinhoDev/ComfyUI-Idol
```

**2. モデルをダウンロード**

```bash
cd ComfyUI/models
hf download PedroMarinhoDev/Idol-ComfyUI diffusion_models/idol_fp32.safetensors vae/idol_vae_decoder_fp32.safetensors --local-dir .
hf download VAST-AI/TripoSplat clip_vision/dino_v3_vit_h.safetensors vae/flux2-vae.safetensors background_removal/birefnet.safetensors --local-dir .
```

`hf` コマンドがなければ先に `pip install -U huggingface_hub` を実行する。ワークフローを開いたときに不足ファイルのダウンロードを促されるので、そこから入れてもよい。

**3. ワークフローを開く**

Templates → ComfyUI-Idol → `idol_image_to_splat` を選ぶ（`example_workflows/idol_image_to_splat.json` のドラッグ&ドロップでも可）。

**4. 設定して実行**

- Load Imageで画像を選ぶ（同梱の `example_inputs/fennec-figure.png` で試せる）
- 2つのIdolノードの `mode` をそろえる（生成画像なら`synthetic`、実写なら`real`）
- サンプラー設定（euler / simple / 50 steps / cfg 4）はワークフローに入っているので変更不要
- **Idol Precisionノードは消さない**（消すとfp32モデルが約4.6倍遅くなるバグを回避できない）

**5. 出力を確認**

`output/3d` に `.ply`、入力視点のレンダー、ターンテーブル動画が保存される。`.ply` はSuperSplatなどのビューアやHoudiniで開ける。

## うまくいかないとき

- **物体が切れる・小さい・背景が残る**：「What the model sees」プレビューで、黒背景に物体だけが乗っているか確認。透過PNGなら、Remove Backgroundの代わりに Load ImageのMASK → Invert Mask をつなぐ
- **背面がおかしい**：seedを変える。真正面より**斜め3/4ビュー**の画像のほうが情報が多く有利

## ライセンス

| 要素 | ライセンス | 商用利用 |
|---|---|---|
| ComfyUI-Idolのコード | GPL-3.0 | 可（改変して配布する場合はソース公開義務あり） |
| Idolの重み | Apache-2.0 | 可 |
| FLUX.2 VAE | Apache-2.0 | 可（FLUX.2 [dev]本体は非商用だが、VAEは別途Apache 2.0で公開） |
| DINOv3 | Meta独自のDINOv3 License | 条件付きで可 |
| BiRefNet | MIT（要確認） | 可 |

- **DINOv3**：Meta公式ライセンスはロイヤリティフリーで使用・改変・配布を認めているが、軍事・核・諜報・銃器などの用途は禁止。標準的なOSSライセンスではないため、業務利用時は確認が推奨される
- 社内で動かして生成物を使うだけなら、GPLの公開義務は基本的に発生しない
- 生成した `.ply` の権利については明記が見当たらない

## 注意点と使いどころ

- **背面や細部は推測**。正確な再現が必要なら、多視点撮影ベースの3DGSのほうが向いている
- **ポリゴンへの変換は難しい**。スプラットには明確な表面がなく、メッシュ化しても高密度でリトポ・UV展開が別途必要になる。ゲームアセットが目的なら、最初からメッシュを出す画像→3Dモデルを使うほうが早い
- 公開直後のリポジトリで、執筆時点ではコミット2件・スター1件と実績はまだない

向いている用途は、**コンセプトの立体確認、AI生成キャラや小物の見た目チェック、3DGSの技術検証**。生成画像（斜め3/4ビュー）→ Idol → ビューアやHoudiniで確認、という流れなら撮影なしで試せる。

## 参考

- [ComfyUI-Idol (GitHub)](https://github.com/PedroMarinhoDev/ComfyUI-Idol)
- [Idol-ComfyUI 重み (Hugging Face)](https://huggingface.co/PedroMarinhoDev/Idol-ComfyUI)
- [Idol SDK (speridlabs)](https://github.com/speridlabs/idol-sdk)
- [FLUX.2 VAE (Hugging Face)](https://huggingface.co/unsloth/FLUX.2-VAE)
- [DINOv3 License (Meta)](https://ai.meta.com/resources/models-and-libraries/dinov3-license)
