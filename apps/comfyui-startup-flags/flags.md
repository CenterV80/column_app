# ComfyUI 起動引数 一覧

`python main.py [引数...]` の形で指定。組み合わせ可能。
最新情報は `python main.py --help` または https://docs.comfy.org/development/comfyui-server/startup-flags で確認。

## ネットワーク・サーバー
| 引数 | デフォルト | 内容 |
|---|---|---|
| `--listen [IP]` | `127.0.0.1` | 待受IP。値なしで`0.0.0.0`(全インターフェース = LAN/外部からアクセス可能) |
| `--port` | `8188` | ポート番号 |
| `--tls-keyfile PATH` / `--tls-certfile PATH` | — | HTTPS化(SSL証明書) |
| `--enable-cors-header [ORIGIN]` | 無効 | CORS許可(`*`で全許可) |
| `--max-upload-size` | `100` | 最大アップロードサイズ(MB) |
| `--enable-compress-response-body` | 無効 | レスポンス圧縮 |

## ディレクトリ
| 引数 | 内容 |
|---|---|
| `--base-directory PATH` | models/custom_nodes/input/output等のベース |
| `--extra-model-paths-config PATH` | モデルパス設定yamlを読み込み(複数指定可) |
| `--output-directory PATH` | 出力先変更 |
| `--input-directory PATH` | 入力先変更 |
| `--temp-directory PATH` | 一時ファイル先変更 |
| `--user-directory PATH` | ユーザーディレクトリ変更 |

## 起動・ブラウザ
| 引数 | 内容 |
|---|---|
| `--auto-launch` | 起動時にブラウザ自動起動 |
| `--disable-auto-launch` | ブラウザを開かない(サーバー運用向け) |
| `--windows-standalone-build` | Windows Portable用の自動起動モード |

## デバイス・CUDA
| 引数 | 内容 |
|---|---|
| `--cuda-device DEVICE_ID` | 使用GPU番号(例: `0`, `0,1`, `all`) |
| `--default-device ID` | デフォルトデバイスID |
| `--cuda-malloc` / `--disable-cuda-malloc` | cudaMallocAsync有効/無効 |
| `--directml [DEVICE]` | torch-directml使用(AMD/Intel等) |
| `--oneapi-device-selector STRING` | Intel oneAPIデバイス指定 |

## 精度(グローバル・相互排他グループごと)
| 引数 | 内容 |
|---|---|
| `--force-fp32` / `--force-fp16` | 全体精度を強制 |
| `--fp32-unet` / `--fp64-unet` / `--bf16-unet` / `--fp16-unet` | UNet精度指定 |
| `--fp8_e4m3fn-unet` / `--fp8_e5m2-unet` / `--fp8_e8m0fnu-unet` | UNet重みをfp8で保持 |
| `--fp16-vae` / `--fp32-vae` / `--bf16-vae` / `--cpu-vae` | VAE精度・CPU実行 |
| `--fp8_e4m3fn-text-enc` / `--fp8_e5m2-text-enc` / `--fp16-text-enc` / `--fp32-text-enc` / `--bf16-text-enc` | テキストエンコーダ精度 |
| `--fp16-intermediates` | ノード間の中間テンソルをfp16に(実験的) |
| `--force-channels-last` | channels-lastメモリ形式を強制 |

## VRAM・メモリ(モード系は相互排他)
| 引数 | 内容 |
|---|---|
| `--gpu-only` | 全てGPUに常駐(テキストエンコーダ含む) |
| `--highvram` | 使用後もGPUにモデルを残す |
| `--lowvram` | テキストエンコーダをCPU実行 |
| `--novram` | 最小VRAM使用 |
| `--cpu` | 全てCPUで実行 |
| `--reserve-vram GB` | OS/他アプリ用にVRAM確保 |
| `--async-offload [NUM_STREAMS]` / `--disable-async-offload` | 非同期ウェイトオフロード |
| `--disable-dynamic-vram` / `--enable-dynamic-vram` | 動的VRAM管理の無効/有効 |
| `--fast-disk` | 高速NVMe向けディスクベースロード優先 |
| `--disable-smart-memory` | 積極的にRAMへオフロード |
| `--disable-pinned-memory` | ピン留めメモリを無効化 |
| `--mmap-torch-files` / `--disable-mmap` | mmap読み込みの有効/無効 |

## プレビュー
| 引数 | デフォルト | 内容 |
|---|---|---|
| `--preview-method` | `none` | `none`/`auto`/`latent2rgb`/`taesd` |
| `--preview-size` | `512` | プレビュー画像最大サイズ(px) |

## キャッシュ(相互排他)
| 引数 | 内容 |
|---|---|
| `--cache-ram [GB] [GB]` | RAM圧力ベースキャッシュ(デフォルトモード) |
| `--cache-classic` | 旧来の積極的キャッシュ |
| `--cache-lru N` | LRUキャッシュ(最大N件) |
| `--cache-none` | キャッシュなし(毎回再実行、省メモリ) |

## Attention(相互排他)
| 引数 | 内容 |
|---|---|
| `--use-split-cross-attention` | Split cross attention |
| `--use-quad-cross-attention` | Sub-quadratic cross attention |
| `--use-pytorch-cross-attention` | PyTorch 2.0標準attention |
| `--use-sage-attention` | Sage attention |
| `--use-flash-attention` | FlashAttention |
| `--disable-xformers` | xformers無効化 |
| `--force-upcast-attention` / `--dont-upcast-attention` | attentionのアップキャスト強制/禁止 |

## パフォーマンス・デバッグ
| 引数 | 内容 |
|---|---|
| `--fast [OPT...]` | 実験的高速化(`fp16_accumulation`/`fp8_matrix_mult`/`cublas_ops`/`autotune`) |
| `--deterministic` | 決定論的アルゴリズム使用(低速) |
| `--default-hashing-function` | `md5`/`sha1`/`sha256`(既定)/`sha512` |

## カスタムノード・APIノード
| 引数 | 内容 |
|---|---|
| `--disable-all-custom-nodes` | 全カスタムノード無効化 |
| `--whitelist-custom-nodes FOLDER...` | 特定フォルダのみ許可 |
| `--disable-api-nodes` | APIノード無効化(外部通信禁止) |
| `--disable-metadata` | 出力ファイルへのプロンプトメタデータ保存を無効化 |

## ComfyUI Manager
| 引数 | 内容 |
|---|---|
| `--enable-manager` | Manager有効化 |
| `--disable-manager-ui` | Manager UI/エンドポイントのみ無効化(バックグラウンド処理は継続) |
| `--enable-manager-legacy-ui` | 旧UIを使用 |

## フロントエンド・API
| 引数 | 内容 |
|---|---|
| `--front-end-version` | フロントエンドバージョン指定(`owner/repo@version`) |
| `--front-end-root PATH` | ローカルのフロントエンドパスを直接指定 |
| `--comfy-api-base` | ComfyUI APIのベースURL |
| `--database-url` | DB URL(デフォルトSQLite) |
| `--enable-assets` | アセットシステム有効化 |
| `--feature-flag KEY[=VALUE]` | 機能フラグ設定 |
| `--list-feature-flags` | 設定可能な機能フラグ一覧をJSONで表示 |

## ログ・その他
| 引数 | デフォルト | 内容 |
|---|---|---|
| `--verbose [LEVEL]` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL` |
| `--log-stdout` | 無効 | 通常出力をstdoutへ |
| `--dont-print-server` | 無効 | サーバー出力をコンソールに出さない |
| `--multi-user` | 無効 | ユーザーごとのストレージ分離 |
| `--quick-test-for-ci` | 無効 | CI用の起動即終了テスト |

---
出典: https://docs.comfy.org/development/comfyui-server/startup-flags (comfy/cli_args.py ベース)
