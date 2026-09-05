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

SDXL(img2img)構成を採用(Flux Kontextはフル版24GB/fp8量子化版12GBのためVRAM負荷が大きく、対象GPUでの安定動作を優先しSDXL構成に決定)。

**2026-09時点でControlNet OpenPoseは不採用とし、棒人間エディタの出力(スケルトンPNG)をimg2imgの初期画像として直接使う方式に変更した。** 理由・トレードオフは4.4節を参照。これによりControlNetモデルが不要になり、モデル合計容量も縮小している。

| モデル | 容量目安 | 用途 |
|---|---|---|
| SDXL base 1.0(fp16) | 約6.5GB | ベースモデル |
| VAE(sdxl-vae-fp16-fix) | 約300MB | VAE |
| **合計** | **約6.8GB** | |

### 対象GPU環境
- RTX5080(本番稼働用)
- RTX4070Ti(12GB、古いマシンでも動作することを前提とした構成)

上記合計容量であれば、量子化なしで両GPUとも動作可能(ControlNet不採用によりVRAM要件はさらに軽くなった)。

### モデル配置・自動検出

モデルファイルはStability Matrixのフォルダ階層(`Models/StableDiffusion/`、`Models/VAE/`)から自動検出する。パッケージ内にモデルは含めない。

- 各カテゴリフォルダ内を拡張子(`.safetensors`, `.ckpt`)で検索
- キーワード絞り込み(例: StableDiffusionフォルダは`"xl"`)で対象を限定
- 該当ファイルが0件、または複数件の場合はエラーで起動を停止する(意図しないモデルでの生成事故防止)

```python
def find_model_file(category_dir: Path, keyword: str = None, extensions=(".safetensors", ".ckpt")) -> Path:
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

diffusersの`from_single_file()`で単一ファイルから直接ロードする。

## 4. 生成処理の設計

REST API形式ではなく、内部関数呼び出しとして設計する(GUIと推論が同一プロセスのため)。以下はAPI設計として検討した内容を関数仕様として流用したもの。

### 4.1 生成処理

**入力**
| パラメータ | 型 | 説明 |
|---|---|---|
| character_sheet | 画像 | キャラクターシート(現状は表示・状態管理用途のみ。4.4節参照) |
| poses | 画像 x6 | スケルトンPNG(棒人間エディタ出力、img2imgの初期画像として使用) |
| prompt | string | キャラの特徴・スタイル指定 |
| negative_prompt | string(省略可) | ネガティブプロンプト |
| denoising_strength | float(省略可、デフォルト0.65、範囲0.0〜1.0) | img2imgの変化の強さ。低いほど棒人間の構図に忠実だが絵として崩れやすく、高いほど自然な絵になるがポーズの再現度が下がる |
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
1. 6ポーズ分のスケルトン画像をimg2imgの初期画像として順に推論(逐次処理、バッチサイズ1固定。低VRAM機での安全性を優先)
2. PILで3x2レイアウトに合成
3. 個別画像・合成画像の両方を保持

### 4.3 非同期処理
- 推論処理はQThread上で実行し、メインスレッド(GUI)をブロックしない
- 推論中はボタン無効化、進捗バー表示で二重実行を防止

### 4.4 ControlNetからimg2imgへの変更に伴う既知のトレードオフ

ControlNet OpenPoseは「入力画像の内容をポーズ条件として解釈し、指定したポーズになるよう強制する」ために専用学習されたモデルであるのに対し、img2imgは「入力画像にノイズを乗せて部分的に除去する」だけの汎用的な仕組みであり、SDXL自体はスケルトンPNGをポーズ指示として読む学習はされていない。この置き換えにより、以下の点はControlNet構成より弱くなることを認識した上で採用する。

- **ポーズ再現の確実性が下がる**: `denoising_strength`次第では、意図したポーズ通りにならない、あるいは骨格線の色や黒背景がノイズとして残る場合がある。プロンプトと`denoising_strength`の組み合わせを試行錯誤する運用が前提になる。
- **`denoising_strength`は「ポーズ忠実度」と「絵としての自然さ」のトレードオフを直接操作するパラメータ**であり、旧`controlnet_scale`(ControlNetの効き具合を調整するだけで絵の破綻とは直接結びつかない)とは性質が異なる。UI上の位置づけ(左パネルの生成パラメータ欄)は同じでも、意味合いが変わる点に注意する。
- **キャラクターシートは生成パイプラインに未接続のまま**: img2imgの初期画像スロットは棒人間画像(ポーズ制御用)が使用するため、同一呼び出しでキャラクターシートを初期画像として併用することはできない。キャラクターシートは引き続きUI上のアップロード・表示・状態管理(生成ボタン活性化条件)にのみ用い、絵柄・キャラクター一貫性への反映は行わない。将来的にキャラ一貫性を強化する場合は、IP-Adapter等の追加コンポーネント導入(3章のモデル一覧・容量表の見直しを含む)を別途検討する。

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
- 書き出し用は編集用(視認性重視の配色)と別に、I2I入力用(黒背景+関節ごとの色分け)のレイヤーで再描画してから画像化。ControlNet構成時代の名残でOpenPose標準配色を踏襲しているが、img2imgではSDXLが配色の意味を学習しているわけではないため、単に骨格線・関節点を視覚的に判別しやすくするための配色という位置づけに変わる

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
