# MiniMax H3をComfyUIで動かす環境構築

## 概要

MiniMax H3はMiniMaxが2026年7月末にオープンウェイト公開した、動画・音声同時生成モデルです。ComfyUIには公開当日からネイティブ対応しており、テキスト→動画(T2V)、画像→動画(I2V)、参照素材→動画(R2V/Ref2VA)の3系統のワークフローが用意されています。ステレオ音声も同じ生成プロセス内で作られるのが特徴です。

## ベースモデルの選定

公式配布は複数の量子化バリアントがあり、環境によって選び方が変わります。

- **int8_convrot**: 精度と速度のバランスが良く、基本はこちらを推奨
- **fp8_scaled**: int8_convrotが使えない環境(GPU側の対応や実装都合)向けのフォールバック
- **pruned / NVFP4 / GGUF / w4a8**: 低VRAM環境向けの追加バリアント

いずれも「量子化」であり、重みの数値精度を落として軽量・高速化したものです。ステップ数(サンプリングの反復回数)自体は変わりません。

入手先: `https://huggingface.co/Comfy-Org/MiniMax-H3`

## Turbo LoRA(蒸留)の導入

量子化とは別に、サンプリングのステップ数自体を減らす「蒸留LoRA」を追加で挿入できます。有志によるlarryvrh版が現時点で最も情報が多く、導入例も豊富です。

### 導入方法(ComfyUI-Manager経由、推奨)

1. ComfyUI-Managerで「MiniMax-H3 Turbo」を検索してインストール
2. ComfyUIを再起動(ノード定義は起動時に読み込まれるため必須)
3. LoRA本体(.safetensors)を `ComfyUI/models/loras/` に配置

### 導入方法(手動)

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo
```

### ワークフローへの組み込み

公式のt2v/i2vワークフローをベースに、以下の2点だけ変更します。

- `Load Diffusion Model → MiniMax-H3 Turbo LoRA → SamplerCustomAdvanced` の順でノードを挿入
- `SamplerCustomAdvanced` を `MiniMax-H3 Turbo Sampler` から給電し、`BasicScheduler` のスケジューラを `simple`、ステップ数を4以上に設定

条件付け・VAEデコード・音声出力部分は公式グラフのまま変更不要です。

## 速度の目安

RTX 5080/5060 Ti(VRAM 16GB)での実測では、LoRAなし20ステップ基準で総生成時間の倍率は条件によって大きく変動します。

- 1344×768・8秒: 約4.18倍高速化
- 同解像度・2.33秒: 約3.34倍高速化
- 864×480・56フレーム: 約2.49倍高速化(比較対象を8ステップ版にすると1.47倍まで縮小)

VRAM 8GBのRTX 3070でも、Turbo LoRA + 8ステップ構成で5秒程度の音声付き動画がOOMなしで生成できたという報告もあります。

## まとめ

| 用途 | 構成 |
|---|---|
| 安定・高画質重視 | int8_convrot + Turbo LoRA 8ステップ |
| 速度最優先 | fp8量子化 + Turbo LoRA 4ステップ(画質やや犠牲) |
| VRAMが厳しい(8〜12GB) | pruned/int8版 + Turbo LoRA |

4ステップだと出力がソフトになりやすいため、シャープさを求めるなら6〜8ステップが現実的な範囲です。
