# sample-image-maker 技術仕様書

## 1. 概要

キャラクターシート画像を入力に、ポーズ違いの画像を6パターン自動生成し、3x2レイアウトで出力するデスクトップツール。
サンプル画像を簡易に作成することが目的。

## 2. 全体構成

- **形態**: デスクトップアプリ(Python完結)
- **理由**: ライブラリの許可確認の観点から、フロントエンド(JS)とバックエンド(Python)を分離せず、単一言語で完結させる構成を採用

| レイヤー | 技術 |
|---|---|
| GUI | PySide6 |
| 描画(棒人間エディタ) | QGraphicsView / QGraphicsScene |
| 推論 | diffusers(同一プロセス内で直接呼び出し) |
| 非同期処理 | QThread(推論中のGUIフリーズ防止) |

Electron/Tauri + Webフロントエンド(React + react-konva)構成も検討したが、ライブラリ許可確認のしやすさを優先しPython完結構成に決定。

## 3. モデル構成

SDXL + ControlNet OpenPose + IP-Adapter構成を採用(Flux Kontextはフル版24GB/fp8量子化版12GBのためVRAM負荷が大きく、対象GPUでの安定動作を優先しSDXL構成に決定)。

**2026-09、ComfyUIコミュニティの実践例(consistent character系ワークフロー)を調査した結果に基づき、ControlNet単体・img2img単体のいずれでもなく「ControlNet OpenPose(ポーズ制御)+ IP-Adapter(キャラクター参照)併用」に確定した。** 理由は以下の通り。

- ComfyUIの「キャラクター一貫性」系ワークフローでは、**ControlNetとIP-Adapterは役割分担が明確**: ControlNetは「何をしているか(構図・ポーズ)」を、IP-Adapterは「誰であるか(絵柄・見た目)」を担当し、両者を併用するのが標準的な構成として広く使われている。
- 4.4節で指摘した「1枚の初期画像でポーズだけ変えて絵柄を保持する」というimg2img単体の矛盾は、ControlNet(ポーズ専用の条件付け)とIP-Adapter(絵柄専用の条件付け、初期画像スロットを消費しない)を役割分離することで解消できる。
- これによりキャラクターシートを**表示専用ではなく実際に生成へ反映**できるようになる(IP-Adapterの`ip_adapter_image`として使用)。

| モデル | 容量目安 | 用途 |
|---|---|---|
| SDXL base 1.0(fp16) | 約6.5GB | ベースモデル |
| VAE(sdxl-vae-fp16-fix) | 約300MB | VAE |
| ControlNet OpenPose(xinsir版, fp16) | 約2.5GB | ポーズ制御(「何をしているか」) |
| IP-Adapter SDXL(`ip-adapter_sdxl.bin`) | 約0.7GB | キャラクター参照条件付け重み |
| IP-Adapter image encoder(OpenCLIP ViT-bigG-14) | 約2.5GB | IP-Adapterが参照画像を埋め込むためのCLIP画像エンコーダ(「誰であるか」) |
| **合計** | **約12.5GB** | |

出典: [h94/IP-Adapter (Hugging Face)](https://huggingface.co/h94/IP-Adapter/tree/main/sdxl_models)、[diffusers IP-Adapterドキュメント](https://huggingface.co/docs/diffusers/en/using-diffusers/ip_adapter)、ComfyUIコミュニティの実践記事([Medium: How I Solved Character Consistency in ComfyUI](https://medium.com/@sophie_62065/how-i-solved-character-consistency-in-comfyui-after-trying-controlnet-and-ipadapter-fcd9eda25109)、[RunComfy: Create Consistent Characters within ComfyUI](https://www.runcomfy.com/comfyui-workflows/create-consistent-characters-within-comfyui))。

### 対象GPU環境
- RTX5080(16GB、本番稼働用): 合計約12.5GBがVRAMに収まるため、全モデルをVRAM常駐(`pipeline.to("cuda")`)させて動作させる。
- RTX4070Ti(12GB、古いマシンでも動作することを前提とした構成): 合計約12.5GBはVRAM容量を上回る可能性が高く、fp16のままVRAM常駐させると動作しない、または他プロセスとの競合でOOMになるおそれがある。**diffusersの`enable_model_cpu_offload()`(使用中のモデルだけをVRAMに乗せ、それ以外はCPU RAM側に置いておく機構)を使ってVRAM使用量を抑える。** 引き換えにモデルの出し入れが発生するため、RTX5080に比べて生成速度は低下する。
- 実装上は`torch.cuda.get_device_properties(0).total_memory`等でVRAM容量を確認し、一定値未満(目安14GB未満)なら`enable_model_cpu_offload()`、それ以上なら`pipeline.to("cuda")`を使う、というハードウェア別の分岐を行う。

### モデル配置・自動検出

モデルファイルはStability Matrixのフォルダ階層(`Models/StableDiffusion/`、`Models/VAE/`、`Models/ControlNet/`、`Models/IpAdaptersXl/`、`Models/ClipVision/`)から自動検出する。パッケージ内にモデルは含めない。

- 各カテゴリフォルダ内を拡張子(`.safetensors`, `.ckpt`, `.bin`)で検索(IP-Adapter系は`.bin`配布が多いため`.bin`も対象に含める)
- キーワード絞り込み(例: StableDiffusionフォルダは`"xl"`、ControlNetフォルダは`"openpose"`)で対象を限定
- 該当ファイルが0件、または複数件の場合はエラーで起動を停止する(意図しないモデルでの生成事故防止)

```python
def find_model_file(category_dir: Path, keyword: str = None, extensions=(".safetensors", ".ckpt", ".bin")) -> Path:
    candidates = [
        f for f in category_dir.iterdir()
        if f.suffix in extensions and f.is_file()
    ]
    if keyword:
        candidates = [f for f in candidates if keyword.lower() in f.name.lower()]

    if not candidates:
        raise FileNotFoundError(f"No model file found in {category_dir}")
    if len(candidates) > 1:
        names = ", ".join(f.name for f in candidates)
        raise RuntimeError(f"Multiple candidates found in {category_dir}: {names}. Please remove extras or narrow the keyword.")
    return candidates[0]
```

diffusersの`from_single_file()`で単一ファイルから直接ロードする(IP-Adapterのみ`pipeline.load_ip_adapter()`を使用)。

## 4. 生成処理の設計

REST API形式ではなく、内部関数呼び出しとして設計する(GUIと推論が同一プロセスのため)。以下はAPI設計として検討した内容を関数仕様として流用したもの。

### 4.1 生成処理

**入力**
| パラメータ | 型 | 説明 |
|---|---|---|
| character_sheet | 画像 | キャラクターシート。IP-Adapterの`ip_adapter_image`として生成に反映する |
| poses | 画像 x6 | スケルトンPNG(棒人間エディタ出力)。ControlNet OpenPoseの`image`(条件付け画像)として使用する |
| prompt | string | キャラの特徴・スタイル指定 |
| negative_prompt | string(省略可) | ネガティブプロンプト |
| controlnet_scale | float(省略可、デフォルト1.0、範囲0.0〜2.0) | ControlNet(ポーズ)の効き具合 |
| ip_adapter_scale | float(省略可、デフォルト0.6、範囲0.0〜1.0) | IP-Adapter(キャラクター参照)の効き具合。高いほど絵柄・特徴の再現度は上がるが、プロンプトでの指示が効きにくくなる |
| seed | int(省略可、-1でランダム) | シード値 |
| width / height | int(省略可、デフォルト1024) | 出力解像度(可変) |

**出力**
| 項目 | 内容 |
|---|---|
| combined_image | 3x2合成済み画像 |
| individual_images | 個別6枚の画像 |
| seed_used | 使用したシード値 |
| generation_time_sec | 生成にかかった時間 |

### 4.2 処理フロー
1. 6ポーズ分のスケルトン画像をControlNet入力として、キャラクターシートをIP-Adapter入力として、順に推論(逐次処理、バッチサイズ1固定。低VRAM機での安全性を優先)
2. PILで3x2レイアウトに合成
3. 個別画像・合成画像の両方を保持

### 4.3 非同期処理
- 推論処理はQThread上で実行し、メインスレッド(GUI)をブロックしない
- 推論中はボタン無効化、進捗バー表示で二重実行を防止

### 4.4 構成の変遷とトレードオフ(経緯メモ)

この仕様は以下の順で検討された。将来同じ再検討をしないための記録として残す。

1. **ControlNet OpenPoseのみ(初版)**: ポーズ制御はできるが、キャラクターシートを生成に反映する手段がなく、UI上の表示専用パラメータになっていた。
2. **img2img(棒人間画像を初期画像に、ControlNetの代わり)**: ControlNetモデルが不要になる利点はあったが、「1枚の初期画像でポーズだけ変えて絵柄を保持する」という要求はimg2img単体では原理的に両立しない(denoising_strengthを下げると新ポーズにならず、上げると絵柄が保持されない)、かつキャラクターシートは依然として未接続のままだった。
3. **ControlNet OpenPose + IP-Adapter併用(現行)**: ComfyUIコミュニティで確立されている「ControlNetがポーズ、IP-Adapterがキャラクター参照」という役割分担を採用し、上記2つの課題を解消した。

現行構成でも残るトレードオフ:

- **VRAM要件が増える**: モデル合計が約12.5GBになり、RTX4070Ti(12GB)では`enable_model_cpu_offload()`による緩和が前提になる(3章参照)。緩和した場合、モデルの出し入れにより生成速度がRTX5080より低下する。
- **`ip_adapter_scale`と`controlnet_scale`の両方を調整する運用になる**: IP-Adapterを強くしすぎるとプロンプトでの指示(表情・服装の変更等)が効きにくくなり、弱すぎるとキャラクターの特徴が薄れる。両パラメータの組み合わせを試行錯誤する前提のUIにする。
- **参照画像は「キャラクターシート」1枚をそのまま使う**: キャラクターシートが複数アングル・複数コマを含む1枚の画像である場合、IP-Adapterはその構図全体を「見た目の特徴」として抽出するため、コマ割りの線や背景も特徴として拾われる可能性がある。精度が問題になる場合は、キャラクターシートから顔・上半身などを切り出してIP-Adapterに渡す前処理を追加で検討する(初版の範囲外、将来課題)。

## 5. 棒人間エディタ(GUI内蔵)

### 5.1 データ構造

COCO18準拠の関節点構成。

```python
initial_pose = {
    "id": "standing",
    "joints": {
        "nose": {"x": 400, "y": 80},
        "neck": {"x": 400, "y": 150},
        "rShoulder": {"x": 340, "y": 160},
        "lShoulder": {"x": 460, "y": 160},
        "rElbow": {"x": 300, "y": 250},
        "lElbow": {"x": 500, "y": 250},
        "rWrist": {"x": 280, "y": 340},
        "lWrist": {"x": 520, "y": 340},
        "rHip": {"x": 370, "y": 380},
        "lHip": {"x": 430, "y": 380},
        "rKnee": {"x": 360, "y": 500},
        "lKnee": {"x": 440, "y": 500},
        "rAnkle": {"x": 355, "y": 620},
        "lAnkle": {"x": 445, "y": 620},
    }
}

skeleton = [
    ("neck", "nose"), ("neck", "rShoulder"), ("neck", "lShoulder"),
    ("rShoulder", "rElbow"), ("rElbow", "rWrist"),
    ("lShoulder", "lElbow"), ("lElbow", "lWrist"),
    ("neck", "rHip"), ("neck", "lHip"),
    ("rHip", "rKnee"), ("rKnee", "rAnkle"),
    ("lHip", "lKnee"), ("lKnee", "lAnkle"),
]
```

### 5.2 実装方式
- 関節点: `QGraphicsEllipseItem`(`ItemIsMovable`フラグでドラッグ可能)
- 骨格線: `QGraphicsLineItem`、`itemChange`オーバーライドで関節移動時に再描画
- 6ポーズ同時編集(1枚ずつではなく、3x2グリッドで6セット同時にエディタ表示。最終出力と同じ配置にすることで直感的に把握できるようにする)

### 5.3 機能
- プリセットポーズ切り替え(直立/しゃがみ/走る等をJSONで用意し、`QComboBox`から選択)
- 左右反転(全関節x座標を反転、rShoulder/lShoulder等のペアラベルも入れ替え)
- 書き出し用は編集用(視認性重視の配色)と別に、ControlNet入力用(黒背景+OpenPose標準配色)のレイヤーで再描画してから画像化

## 6. GUI画面構成

```
┌─────────────────────────────────────────────┐
│ メニューバー(ファイル/設定など)                    │
├─────────────────────────────────────────────┤
│ ┌───────────────┐  ┌──────────────────────┐ │
│ │ 左パネル        │  │ 中央: 6ポーズエディタ   │ │
│ │ ・キャラシート    │  │ ┌────┬────┬────┐   │ │
│ │   アップロード   │  │ │Pose1│Pose2│Pose3│   │ │
│ │ ・プロンプト入力  │  │ ├────┼────┼────┤   │ │
│ │ ・ネガティブ      │  │ │Pose4│Pose5│Pose6│   │ │
│ │ ・出力サイズ設定  │  │ └────┴────┴────┘   │ │
│ │ ・seed指定       │  │                      │ │
│ │ ・生成ボタン      │  │                      │ │
│ └───────────────┘  └──────────────────────┘ │
├─────────────────────────────────────────────┤
│ 下部: 生成結果プレビュー(合成画像 + 個別保存/ZIP) │
│ 進捗バー(推論中の状態表示)                       │
├─────────────────────────────────────────────┤
│ ▼ デバッグログ(折りたたみ可能)                    │
│ [12:34:01] モデルロード開始...                   │
│ [12:34:15] SDXL base loaded (6.5GB)            │
│ ...                                            │
│                          [ログをコピー] [クリア]   │
└─────────────────────────────────────────────┘
```

### 6.1 レイアウト
- 全体: `QMainWindow` + `QSplitter`(左パネルと中央エディタの幅を可変に)
- 左パネル: `QVBoxLayout`
- 中央: `QGridLayout`(3列2行、各セルに`QGraphicsView`+プリセット`QComboBox`+反転`QPushButton`)
- 下部: `QScrollArea`(サムネイル・合成画像表示)、`QProgressBar`

### 6.2 想定画面サイズ
- 横1980px前提
- 各セル: Canvas実寸500x600px程度
- ウィンドウ高さ: 1400px前後を想定

### 6.3 状態遷移
1. 初期状態: 生成ボタン無効(キャラシート未アップロード、またはモデル未ロード中)
2. モデルロード完了: ステータス表示「Ready」、ボタン有効化
3. 生成中: 進捗バー表示、ボタン無効化(二重押下防止)
4. 完了: 結果表示、ZIP/個別保存ボタン活性化

## 7. デバッグログ機能

バグ報告のしやすさを重視し、GUI起動時からログパネルを組み込む。

### 7.1 実装方式

```python
import logging
from PySide6.QtCore import Signal, QObject

class QtLogHandler(logging.Handler, QObject):
    log_signal = Signal(str)

    def __init__(self):
        logging.Handler.__init__(self)
        QObject.__init__(self)

    def emit(self, record):
        msg = self.format(record)
        self.log_signal.emit(msg)  # スレッドセーフにGUIへ反映

# 使用例
handler = QtLogHandler()
handler.log_signal.connect(log_text_edit.append)
logging.getLogger().addHandler(handler)
```

- ログ表示: 読み取り専用`QTextEdit`、`QSplitter`または`QDockWidget`で開閉可能
- 未処理例外は`sys.excepthook`をオーバーライドし、GUIをクラッシュさせずログパネルに表示

### 7.2 機能
- 「ログをコピー」ボタン(クリップボードにコピー)
- 「ログをファイル保存」ボタン(タイムスタンプ付き`.log`出力)
- エラーレベル(ERROR/WARNING)は文字色を変えて表示
- ログレベル: デフォルトはINFO以上表示、DEBUGはトグルで切り替え

## 8. 出力オプション

| 方法 | 実装 |
|---|---|
| 3x2合成画像として保存 | combined_imageを保存 |
| 個別1枚だけ保存 | 各セルにダウンロードボタン設置 |
| 6枚まとめてZIP(オプション) | individual_imagesをZIP化して一括保存 |

## 9. 用語・命名メモ

- プロジェクト名: sample-image-maker
- 「フロントエンド」より「WebUI」という呼び方を好む場面があるが、本プロジェクトはデスクトップアプリのためGUI/フロントエンドという呼称を使用
