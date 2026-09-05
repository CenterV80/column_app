# sample-image-maker

キャラクターシート画像を入力に、ポーズ違いの画像を6パターン自動生成し、3x2レイアウトで出力するデスクトップツール。
サンプル画像を簡易に作成することが目的。仕様は `sample-image-maker_技術仕様書.md` を参照。

構成: PySide6(GUI) + QGraphicsView/Scene(棒人間エディタ) + diffusers(SDXL img2img、同一プロセス内で直接呼び出し) + QThread(非同期推論)。

棒人間エディタが出力するスケルトンPNGを、img2imgの初期画像として直接使用します(ControlNet OpenPoseは不採用)。
この構成の背景・トレードオフは技術仕様書の4.4節を参照してください。

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

Stability Matrix のフォルダ階層(`Models/StableDiffusion/`、`Models/VAE/`)から以下を自動検出します。
パッケージにモデルは含まれないため、事前に配置してください。

| フォルダ | キーワード | 内容 |
|---|---|---|
| `Models/StableDiffusion/` | `xl` | SDXL base 1.0 (fp16, `.safetensors`) |
| `Models/VAE/` | (なし) | sdxl-vae-fp16-fix |

各フォルダに対象ファイルが0件・複数件の場合は起動時にエラーで停止します(意図しないモデルでの生成事故防止)。

モデルフォルダの場所は既定で `~/StabilityMatrix/Data/Models` を探しますが、異なる場合は
アプリの「設定 → モデルフォルダを設定」から変更するか、環境変数 `SAMPLE_IMAGE_MAKER_MODELS_DIR`
で指定してください。

## 起動

```bash
python main.py
```

## 既知の制約・今後の課題

- **キャラクターシートはUI上でアップロード・状態管理(生成ボタンの活性化条件)のみ行い、生成パイプラインには渡していません。**
  img2imgの初期画像スロットは棒人間スケルトンPNG(ポーズ制御用)が使用するため、同じ枠にキャラクターシートを
  併用することはできません。絵柄・キャラクター一貫性への反映が必要な場合はIP-Adapter等の追加コンポーネント
  導入を別途検討してください(技術仕様書 4.4節・README上記参照)。
- **ControlNetと異なり、denoising_strengthによるポーズ再現は確率的です。** 値が低いと絵が破綻しやすく、
  高いとポーズが再現されにくくなります。プロンプトと合わせて試行錯誤が前提になります(技術仕様書4.4節)。
- GPU(CUDA)が利用できない環境ではCPUにフォールバックしますが、実用的な速度では動作しません。
- ポーズプリセットは `app/presets.json` を編集することで追加・変更できます。
