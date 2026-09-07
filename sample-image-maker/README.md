# sample-image-maker

キャラクターシート画像を入力に、ポーズ違いの画像を6パターン自動生成し、3x2レイアウトで出力するデスクトップツール。
サンプル画像を簡易に作成することが目的。仕様は `sample-image-maker_技術仕様書.md` を参照。

構成: PySide6(GUI) + QGraphicsView/Scene(棒人間エディタ) + diffusers(SDXL + ControlNet OpenPose + IP-Adapter、
同一プロセス内で直接呼び出し) + QThread(非同期推論)。

ControlNet OpenPoseが「ポーズ(何をしているか)」、IP-Adapterが「キャラクター参照(誰であるか)」を分担する構成です。
棒人間エディタが出力するスケルトンPNGはControlNetの条件付け画像として、キャラクターシートはIP-Adapterの参照画像
として、それぞれ生成に反映されます。ComfyUIコミュニティの実践例を調査した上でこの構成に決定した経緯・トレード
オフは技術仕様書の3章・4.4節を参照してください。

## セットアップ

```bash
cd sample-image-maker
python3 -m venv .venv
source .venv/bin/activate  # Windowsは .venv\Scripts\activate
pip install -r requirements.txt
```

`torch` はGPU環境(CUDA)に合わせて別途インストールし直すことを推奨します
(PyPI既定のwheelはCPU版のことがあるため、公式手順 https://pytorch.org/get-started/locally/ に従ってください)。

## モデルの配置

Stability Matrix のフォルダ階層から以下4種類を自動検出します。パッケージにモデルは含まれないため、
事前に配置してください。

| フォルダ | キーワード | 内容 |
|---|---|---|
| `Models/StableDiffusion/` | `xl` | SDXL base 1.0 (fp16, `.safetensors`) |
| `Models/VAE/` | (なし) | sdxl-vae-fp16-fix |
| `Models/ControlNet/` | `openpose` | ControlNet OpenPose (xinsir版, fp16) |
| `Models/IpAdaptersXl/` | `vit-h` | IP-Adapter SDXL ViT-H版 (`ip-adapter_sdxl_vit-h.safetensors`) |

各フォルダに対象ファイルが0件・複数件の場合は起動時にエラーで停止します(意図しないモデルでの生成事故防止)。

モデルフォルダの場所は既定で `~/StabilityMatrix/Data/Models` を探しますが、異なる場合は
アプリの「設定 → モデルフォルダを設定」から変更するか、環境変数 `SAMPLE_IMAGE_MAKER_MODELS_DIR`
で指定してください。

### CLIP画像エンコーダだけは別途フォルダ指定が必要

IP-Adapterが参照画像を埋め込むために使うCLIP画像エンコーダは、diffusersが `config.json` を含む
**HF形式のフォルダ**を要求するため、他のモデルのような単一ファイル自動検出ができません
(Stability Matrix の `ClipVision/` に置かれるのはComfyUI流の単一ファイルで、diffusersからは読めません)。

[h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) の `models/image_encoder`
(OpenCLIP ViT-H-14、約2.4GB、`config.json` と重みを含むフォルダ)を任意の場所にダウンロードし、
アプリの「設定 → 画像エンコーダフォルダを設定」でそのフォルダを指定してください
(環境変数 `SAMPLE_IMAGE_MAKER_IMAGE_ENCODER_DIR` でも指定できます)。

実行時にHugging Faceから自動ダウンロードする方式は、社内環境での許可確認の観点から採用していません。

## 起動

```bash
python main.py
```

## VRAMについて

配布ファイルの合計は約12.4GBですが、fp16でロードするためVRAM上の重みは**約10.7GB**です
(IP-Adapterと画像エンコーダはfp32配布のため、ロード時に約半分になります)。

RTX5080(16GB)ではVRAMに常駐させて動作しますが、RTX4070Ti(12GB)などVRAMが不足する環境では
自動的に`enable_model_cpu_offload()`(使用中のモデルだけをVRAMに乗せる仕組み)に切り替わります。
その場合、モデルの出し入れが発生するため生成速度は低下します。

## 既知の制約・今後の課題

- **ControlNetとIP-Adapterのバランス調整が前提の運用になります。** IP-Adapter強度を上げすぎるとプロンプトでの
  指示(表情・服装の変更など)が効きにくくなり、下げすぎるとキャラクターの特徴が薄れます(技術仕様書4.4節)。
- **キャラクターシートは1枚の画像全体がIP-Adapterの参照対象になります。** 複数アングル・複数コマを含む
  シートの場合、コマ割りの線や背景も特徴として拾われる可能性があります。精度が問題になる場合は、
  顔・上半身などを切り出してから渡す前処理の追加を検討してください(将来課題)。
- GPU(CUDA)が利用できない環境ではCPUにフォールバックしますが、実用的な速度では動作しません。
- ポーズプリセットは `app/presets.json` を編集することで追加・変更できます。
