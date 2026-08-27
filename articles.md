## 2026年8月

### MiniMax-H3-Acc-LoRAs - Alibaba製、FL2V・Ref2V対応の加速LoRA
[Hugging Face - alibaba-pai/MiniMax-H3-Acc-LoRAs](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs)

AlibabaがMiniMax-H3向けに公開した加速LoRA群。larryvrhのTurbo-Loraと同様、通常より大幅に少ないステップ数で動画を生成できるようにするもので、**FL2VA**（最初と最後のフレーム指定）・**Ref2VA**（参照素材利用）の両モードに対応するチェックポイントが用意されている。単純なLoRAではなく、ランク64の基幹LoRAに加えて、モダリティごとに32個の区間別最終層射影を持つ「**PDD（Parallel Decoding Distillation）**」ヘッドバンクを組み合わせた構成になっているのが技術的な特徴で、これによりCFG（Classifier-Free Guidance）不要で8ステップ（設定によっては4ステップ）での音声付き動画生成を実現している。公式にはDiffusersのMiniMax-H3 ModularPipeline（diffusers 0.40.0以上が必要）を使い、`predict_t2v.py`や`predict_ref2v.py`にモデルパスとLoRAパスを指定して実行する形。ComfyUIで使う場合は、このAlibaba公式チェックポイントをそのまま読み込める専用のカスタムノードパック（`ComfyUI-MiniMax-H3-PDD-Acc`）が別途必要で、FL2VAはfl2va用、Ref2VAはref2va用のUNET（bf16・int8-convrotいずれのビルドも可）と組み合わせて使う。

### ComfyUI-MAINodes - 低VRAM環境でも長尺のブレ補正を可能にするメモリ最適化を追加
[GitHub - matlowai/ComfyUI-MAINodes](https://github.com/matlowai/ComfyUI-MAINodes)

MiniMax-H3向けのカスタムノードパックで、2つの主要機能を持つ。1つ目の「**Motion Lab**」は、動画内で動きが速すぎてブレてしまう区間を、時間軸を引き伸ばした（スローモーションの）クロックで生成し直し、その後で実時間に圧縮して戻す「デローピング（de-rope）」という手法でブレを修正する仕組み。学習は不要で、生成後の後処理として機能する。2つ目の「**Contact-Sheet diffusion**」は、1枚の参照画像から同じ被写体の5つの異なる視点をまとめて生成できる機能で、ターンアラウンド用のLoRAと組み合わせて使うことを想定している。直近のアップデートでは、低VRAM環境での長時間処理を可能にするメモリ最適化が実施された。従来、長尺のデローピング処理はH3ブロックが系列全体のQKVやSwiGLUテンソルを一括で保持する仕様のため、96GB VRAM環境でもOOM（メモリ不足）になることがあったが、「H3 Streamed Blocks」と呼ばれる、各DiTブロックの計算をトークンをチャンク（分割）しながら行う仕組み（int8・W4A8での量子化演算により通常版とビット単位で同一の結果を保証）を導入したことで、16GB VRAMの環境でも同等の処理速度で動作するようになったという。あわせて、レビュー用に含まれていた約400MBのメディアファイルを別リポジトリ（MAINodes-media）へ分離し、履歴からも削除することで、クローンサイズを約100MBまで軽量化。加えて、デローピング処理時に口の動きと音声の同期がズレる問題の修正も行われたとのこと。GPL-3.0-or-laterライセンスで公開。

### Minimax-h3-Turbo-SLA - スパース＋リニアアテンションで約2.5倍高速化する4ステップLoRA
[Hugging Face - lightx2v/Minimax-h3-Turbo-SLA](https://huggingface.co/lightx2v/Minimax-h3-Turbo-SLA)

MiniMax-H3向けに公開された、4ステップに蒸留したFL2V（最初と最後のフレーム指定）用のLoRAチェックポイント。単に蒸留してステップ数を減らすだけでなく、**SLA（Sparse-Linear Attention）**と呼ばれる、アテンション計算を疎（スパース）かつ線形にする手法を組み合わせているのが特徴で、アテンションのスパース率は85%に達する。開発元であるLightX2Vの検証環境（RTX 5090）では、視覚品質を維持しつつ約2.5倍の推論高速化を確認したという。配布されているのはLoRAの重みのみで、推論には元のMiniMax-H3本体が別途必要。LightX2Vネイティブ環境向けと、ComfyUIでも扱えるBF16チェックポイントの両方が用意されている。

### LTX-2.5でVideoDecodeが遅い問題への対処法 - VAE設定とVRAMクリーンで高速化
(サイト運営者による実践メモ)

LTX-2.5でVideoDecodeの処理が遅くなる問題に対する、実際に効果が確認された対処法。①video-vaeを`conv-bf16`に変更する、②VAEDecode（Tiled）の設定を`tile_size=512`・`temp_size=2048`にする、③VAEDecodeノードの直前に「Clean VRAM Used」ノードを挟む、という3点を組み合わせることで、体感できるレベルで高速化したとのこと。VAEのタイル処理設定やVRAMの明示的な解放が絡む問題のため、同様に生成が重いと感じている場合は試す価値がある組み合わせ。

### Minimax_h3_latent_Upscaler - VAEを経由せず潜在表現のまま高速アップスケール
[Hugging Face - LBH-123-AI/Minimax_h3_latent_Upscaler](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/tree/main/workflow_templates)

MiniMax-H3の24チャンネル潜在表現（latent）を対象にした、ニューラルネットベースの潜在空間アップスケーラー。低解像度で動画を生成したあと、この学習済みアップスケーラーで潜在表現の空間解像度だけを引き上げ（時間方向の次元は保持）、目的の解像度で再サンプリング・リファインして細部を復元するというパイプラインを想定している。最大の狙いは、約5Bパラメータと重いMiniMax-H3のVAEを介した「デコード→ピクセル空間でアップスケール→エンコード」という往復処理を丸ごとスキップできる点で、生成時間を節約しつつ、単純な潜在表現の補間では起きやすいゴースト（二重像）アーティファクトも避けられるとしている。対応する拡大率は1.0〜4.0倍（0.1刻みで連続的に指定可能、デフォルトは2.0倍）。低解像度潜在表現と高解像度の正解データのペアを約8万件用意し、モダリティや拡大率のバランスを取りながら学習したとのこと。アーキテクチャは3D畳み込みをベースに時間方向の畳み込みとトライリニア補間を組み合わせたもので、LTX-2.3 Spatial UpscalerやTtl/ComfyUi_NNLatentUpscaleで先行していた潜在空間アップスケーリングの考え方を踏襲している。チェックポイントはfp16・bf16・fp32の複数形式で配布。

### ComfyUI「App Mode」「App Builder」「ComfyHub」- ワークフローをインストール不要のWebアプリに変換
[CGinterest](https://cginterest.com/2026/03/12/comfyui%E3%80%81%E3%83%AF%E3%83%BC%E3%82%AF%E3%83%95%E3%83%AD%E3%83%BC%E3%82%92web%E3%82%A2%E3%83%97%E3%83%AA%E3%81%AB%E5%A4%89%E6%8F%9B%E3%81%99%E3%82%8B%E6%96%B0%E3%81%97%E3%81%84%E3%83%84%E3%83%BC/)

ComfyUIが、複雑なノードのワークフローを、インストール不要のシンプルなWebアプリとして使えるようにする新機能群を発表した。中心となる「**App Mode**」は、既存のComfyUIとは別のアプリケーションを作るのではなく、その場でUIだけを切り替える仕組みで、バックエンドやキュー管理は通常のComfyUIと共通のまま動く。「**App Builder**」は、そのApp Mode画面の見た目を設定するためのインターフェースで、ワークフロー内のどのノードの入力をアプリの入力欄として見せるか、どのノードの出力をアプリの出力として見せるかを選んで組み立てられる。作成したアプリは、ワークフロー設定・App Modeのレイアウト・ノードの紐づけといった必要な情報がすべてURL内にエンコードされる形で、URL1本を共有するだけで他の人にも使ってもらえる。これらの機能を軸にした共有プラットフォーム「**ComfyHub**」も合わせて発表されており、ノードの繋ぎ方を知らない人でも、作られたワークフローをアプリ感覚で使い回せるようにすることを狙いとしている。

### MAI-Code-1.1-Flash - コスト4分の1でGitHub Copilotのコーディング性能を強化
[Microsoft News](https://news.microsoft.com/source/asia/features/mai-code-1-1-flash-br-better-faster-at-a-quarter-of-the-cost/?lang=ja)

Microsoftが、コーディング特化モデル「MAI-Code」の新版「MAI-Code-1.1-Flash」を公開した。6月のMicrosoft Buildで発表した前バージョンと比べて、コード品質の向上に加えてトークン効率が25%改善し、コストは4分の1に抑えられている。性能面では、GitHub Copilot CLI上のTerminal-Bench 2.1で22%、.NET関連タスクで15%の改善を確認。GitHub Copilot上ではトークンの出力速度が25%速くなり、タスク完了に必要なトークン数も25%削減されたという。料金は入力100万トークンあたり0.20ドル・キャッシュ済み入力は0.02ドル・出力は1.20ドルで、前バージョン「MAI-Code-1-Flash」（入力0.75ドル・キャッシュ0.075ドル・出力4.50ドル）から大幅に引き下げられている。加えて、コーディング作業の一環として画像を解析・理解できるネイティブなビジョン対応も新たに搭載。すでにGitHub Copilotの本番環境に投入されている。

### LTX-2.5 Pixel Spatial Upscaler - 低解像度で作った動画を高解像度に「生成的に」アップスケール
[Hugging Face - Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler](https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler)

LTX-2.5（22B）向けに公開された、動画をアップスケールするIC-LoRA。現時点では2倍（2x）版が公開されている。単純な補間で解像度を上げるアップスケーラーとは異なり、低解像度の映像を参照にしながら細部を新たに合成する「生成的（generative）」なアップスケーラーである点が特徴。仕組みとしては、ノイズ除去中の潜在表現と一緒に参照動画を文脈（コンテキスト）として読み込ませるIC-LoRAの手法を用いており、学習時にはターゲットとなる高解像度クリップを縮小したものを参照として使うことで、低解像度の参照映像を同じシーンの高解像度レンダリングへ写像する対応関係を学習している。推奨される使い方は、まず約280pという低い基準解像度で構図やモーションに納得がいくまで動画を生成し、その完成したクリップを参照として2倍アップスケーラーに読み込ませ、最終的な高解像度出力を得るという2段階のワークフロー。ComfyUIのワークフローで使えるsafetensors形式のチェックポイントとして配布されている。

### awesome-minimax-H3 - MiniMax-H3関連リソースをまとめたキュレーションリスト
[GitHub - wildminder/awesome-minimax-H3](https://github.com/wildminder/awesome-minimax-H3)

テキスト・画像・動画・オーディオを理解し、最大2K解像度・15秒の動画を生成できるオムニモーダルモデル「MiniMax-H3」まわりのリソースを一箇所にまとめた、いわゆる「Awesomeリスト」形式のリポジトリ。公式チェックポイント（BF16・INT8など複数精度、最初と最後のフレームを指定するFL2VAモード、参照素材を使うRef2VAモード）はもちろん、サンプリングを高速化するターボ（加速LoRA、約5倍高速化）、ConvRot・NVFP4・INT4といった各種量子化版、llama.cpp系ツール向けのGGUF形式、スタイル系・実験系のLoRA、個別のテキストエンコーダやVAE・Tiny Autoencoderといったコンポーネント単位のファイルまで幅広く整理されている。それぞれHugging Faceへの直接ダウンロードリンクが張られているほか、ComfyUI用カスタムノードやチュートリアル・技術ガイドへのリンクも網羅。これまで本ページで個別に紹介してきたGGUF量子化版、Turbo-Lora、ClipProjといったMiniMax-H3関連ツール群を俯瞰して探すのに便利な、いわば「索引」的な一覧。

### ComfyUI-MiniMax-H3-Image-Studio - 動画生成モデルを「画像生成」用途に転用するノード
[GitHub - astropuzzo/ComfyUI-MiniMax-H3-Image-Studio](https://github.com/astropuzzo/ComfyUI-MiniMax-H3-Image-Studio)

本来は動画生成モデルであるMiniMax-H3を、画像生成に特化した実用ツールとして使えるようにするComfyUIカスタムノード群。テキストから画像（T2I）、画像から画像（I2I）、参照画像を使った編集（REF2VA）という3つの生成モードに対応する。仕組みとしては、5/9/13/20フレームという複数のフレーム数プロファイルで短い動画を生成させたうえで、その中から最適な1枚の静止画を自動的に選び出すという、動画モデルならではのアプローチを取っている。高速処理向けの「LightX v0.1」アダプターにも対応し、GPUメモリ効率を考慮した設計になっているという。動作にはComfyUI 0.30.0以上が必須で、追加のPython依存関係は不要（ComfyUIが提供するPyTorchをそのまま利用）。GitHubからのクローンのほか、ComfyUI Manager経由でのインストールにも対応している。開発者自身も「実験的でAI支援により開発された」上級者向けツールと位置付けている。

### LTX-2.5 オープンウェイト公開 - ネイティブ4K HDR・マルチショット対応
[LTXモデルページ](https://ltx.io/model/ltx-2-5) | [Hugging Face - Lightricks/LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5/tree/main)

LTX-2.3の後継にあたる、Lightricksのオープンウェイト動画・音声生成モデル「LTX-2.5」の本体が公開された。ローカル実行とファインチューニングを前提に設計されており、テキスト・画像・動画を入力として、同期した高精細な映像と音声を生成できる。目玉機能は3つ。1つ目は**ネイティブマルチショット**で、1回の生成だけでキャラクター・環境・照明・声・スタイルを保ったまま複数のカットをつなげて出力できる。2つ目は**ネイティブ4K HDR**で、最大50fpsの同期音声付きでプロの仕上げ作業にも耐える高解像度HDR出力に対応。3つ目は、複雑なシーンほど計算リソースを重点的に割り当てる「Diffusion Fidelity Rendering」と、通常のVAEデコードの代わりに使う「Diffusion Video Decoder」で、顔のシャープさや画面上の文字の可読性を保ちつつ、素早い動きでも滲みが出にくいという。構成は22Bパラメータの蒸留済みトランスフォーマーに加え、テキストエンコーダにはLTX-2.3から採用されているGemma系列を継承しつつ**Gemma 3 12B→Gemma4-12B**へと更新したもの（投影層付き）を採用し、映像用・音声用それぞれのVAEを備える。配布形式も特徴的で、1つの巨大なファイルにまとめるのではなく、コンポーネントごとに`.safetensors`を分割した「Comfyに揃えた」パック形式を採用しており、蒸留トランスフォーマーが46.2GB、音声VAEが365MB、映像VAEが1.47GBという内訳になっている。動作要件はPython 3.12以上・CUDA 12.7以上・PyTorch 2.7系を推奨、VRAM 16GB以上のGPUであればローカルで動作するとされる。公開初日からComfyUI・Hugging Face・LTX APIに加えてRunwayでも利用可能。ライセンスは「LTX-2.x Community License」で、年間売上1,000万米ドル未満の事業者であれば商用・本番利用も無償・透かしなし・クリップ課金なしで可能。

### LTX-2.5 プロンプトガイド - シングルショット/マルチショットの書き分け方
[LTX Blog - LTX-2.5 Prompt Guide](https://ltx.io/blog/ltx-2-5-prompt-guide)

Lightricksが公開した、後継モデル「LTX-2.5」（LTX-2.3の後継にあたる22Bパラメータのオープンウェイト音声・動画基盤モデルで、ネイティブなマルチショット生成・4K HDR出力・公式ComfyUIワークフローに対応）向けの公式プロンプトガイド。プロンプトに盛り込むべき要素として、ショットの種類・シーンや照明・アクション・キャラクターの詳細・カメラワーク・音声の6点を挙げている。構成は大きく2パターンに分かれ、**シングルショット**は1つの場面を時系列に沿った1つの段落として書き、地の文で描写しない限りショットリストや番号付きのビート、脚本のようなスラッグライン（場面見出し）は使わないのが基本。**マルチショット**（2〜4カット）の場合は、カット間の明示的な転換表現、カットごとのフレーミングの再提示、カットをまたいだ音声の連続性を文章内で示す必要がある。プロンプトの長さの目安は、シンプルな単一ショットなら4〜8文程度、脚本調の長めのシーンならさらに長くてもよいが、いずれの文も具体的な視覚・音声情報を追加するものであるべきとしている。セリフを書く際は「悲しそうに」のようなラベルではなく身体的な感情の手がかりを現在形で描写し、セリフ自体は鍵カッコで囲むことが推奨されている。

### ClipProj-MiniMax-H3 - テキストエンコーダを32B→4Bに置き換えてVRAM使用量を1/3に
[Hugging Face - NicoLab28/ClipProj-MiniMax-H3](https://huggingface.co/NicoLab28/ClipProj-MiniMax-H3) | [GitHub - nicolab28/ComfyUI-ClipProj](https://github.com/nicolab28/ComfyUI-ClipProj)

MiniMax-H3が標準で使うQwen3-VL-32Bのテキストエンコーダを、はるかに小さいQwen3-VL-4Bに置き換えるための「投影行列（projection matrices）」を公開したプロジェクト。拡散モデル本体やVAE、サンプラーには一切手を加えず、テキストエンコーダ部分だけをVRAM 15.7GBから**5.2GB**まで削減できるのが最大の特徴。仕組みとしては、Qwen3-VLシリーズはサイズが違ってもトークナイザーが共通（151,936トークン）であることを利用し、大きいモデルと小さいモデルの隠れ状態を位置ごとに対応づける線形変換をリッジ回帰だけで学習（勾配降下やエポック、学習率といった通常のニューラルネット学習は不要）することで、小さいモデルでも同等の条件付けベクトルを再現できるようにしている。公開者自身も「動作する検証段階のプロダクト（proof of concept）」と位置付けているが、実機で計測した結果として実際に良好な動画が生成できることを確認済み。利用には専用のComfyUIカスタムノード`ComfyUI-ClipProj`が必要で、投影行列ファイルは`ComfyUI/models/clip_projections/`に配置する。

### MiniMax H3、Apache 2.0ライセンスへの移行を検討 - 制限撤廃へ
[PC Watch](https://pc.watch.impress.co.jp/docs/news/2131995.html)

MiniMaxが、動画生成AI「MiniMax H3」のライセンスを、現行の「MiniMax H3 Community License」から**Apache 2.0**へ移行することを検討していると報じられた。現行ライセンスには、商用利用自体は可能なものの年間売上2,000万米ドルを超える企業は事前の書面承認が必須、UI上での目立つクレジット表記が義務付け、さらに米国・EU・英国・韓国の4地域は利用対象から除外され利用申請が必要、といった制約があった。Apache 2.0への移行が実現すれば、こうした売上規模やクレジット表記、地域制限がすべて撤廃され、開発者や企業が自社サービスへより柔軟に組み込めるようになる。移行の実施時期については、著作権まわりの課題が解決され次第検討するとされている。

### MiniMax-H3公式skills - プロンプト作成術をテンプレート化した公式スキル集
[GitHub - MiniMax-AI/MiniMax-H3 (skills)](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills)

MiniMax公式が、MiniMax-H3向けのプロンプトノウハウをテンプレート集として整理・公開したディレクトリ。内容は大きく2種類で、1つはT2VA・I2VA・FL2VA・L2VA・Ref2VAという5つの生成モードに対応した構造化プロンプトの書き方を支援する「h3-prompt-writing」スキル、もう1つはミニマリスト商品広告・3Dアニメーション短編・ペーパークラフトのストップモーション・ブランド販促ビデオ・字幕付きミュージックビデオ・協力ゲーム紹介・ペーパーコラージュ説明動画・手描きとライブアクションの融合動画という、スタイル別に特化した8つの動画生成スキルで構成されている。各スキルは英語・中国語の二言語対応。導入は専用のスキルCLIを使い、`npx skills add https://github.com/MiniMax-AI/MiniMax-H3`のようなコマンドで全スキルをまとめて取り込める。プロンプトを一から考えるのではなく、用途別のテンプレートから始めたい場合に参考になる公式リソース。

### LTX-2.3 GGUF 最新動向まとめ - 主要配布元の比較と量子化レベルの選び方
[Hugging Face - QuantStack/LTX-2.3-GGUF](https://huggingface.co/QuantStack/LTX-2.3-GGUF) | [Hugging Face - unsloth/LTX-2.3-GGUF](https://huggingface.co/unsloth/LTX-2.3-GGUF) | [GitHub - city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF)

Lightricksが開発した音声・動画生成の基盤モデル「LTX-2.3」（22Bパラメータ、AVTransformer3DModelアーキテクチャ）は、コミュニティによってGGUF量子化版が複数公開されており、コンシューマー向けGPUでのローカル推論を可能にしている。配布元として実績・ダウンロード数で主流なのは2つ。**QuantStack/LTX-2.3-GGUF**はアップストリームの重みを素直に変換したもので、Q2_K（12.4GB）〜Q8_0（25.5GB）まで幅広いビット精度でdev版・蒸留版の両方を収録し、とにかく最小サイズを優先したい場合に向く。**unsloth/LTX-2.3-GGUF**は「Dynamic 2.0」という手法で重要なレイヤーだけ高精度にアップキャストしてから量子化しており、同じビット数でも画質面で有利な傾向がある。蒸留版LoRAをdev版の出力に重ねてリファインするワークフロー例も公開している。dev版は20ステップ以上必要な代わりに高品質な最終出力向き、蒸留版は4〜8ステップで生成できる分ドラフトやdev版出力の高速リファイン向きという住み分け。量子化レベルの目安としては、Q2_Kは動作確認・テスト用途で実運用には不向き、Q3_K_S/MはVRAMが厳しい環境向け、**Q4_K_M**はオリジナルに近い品質を保ちながらメモリ使用量を大幅削減できる「実用的な最低ライン」として人気が高く、Q5〜Q6はVRAMに余裕がある場合のさらなる高品質選択、Q8_0はほぼフル精度で25.5GB。実運用の目安は、画質重視でVRAMに余裕があればunsloth版Q4_K_M以上、VRAMが12GB前後と厳しければQuantStack版Q4_K_S/M、下書き・動作確認用途なら蒸留版のQ2_K〜Q3_K。注意点として、ファイル名だけで判断するとLTX-2.0（19B、旧アーキテクチャ）とLTX-2.3（22B、AVTransformer3DModel）を取り違えやすい（LTX-2.0 19B fp8は約23.5GB、LTX-2.3 22B GGUF Q4は約17.8GB）ため、ファイル名の「2.3」表記とモデルカードのアーキテクチャ表記を必ず確認することが推奨されている。ComfyUI環境での実行にはcity96氏の`ComfyUI-GGUF`ノードパックが必要。

### MiniMax-H3-Turbo-Lora - サンプリングを4ステップに短縮するLoRAとComfyUI高速化ノウハウ
[Hugging Face - larryvrh/MiniMax-H3-Turbo-Lora](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora) | [Discussion: For ComfyUI users](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora/discussions/6) | [GitHub - kijai/ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) | [GitHub - xmarre/ComfyUI-Spectrum-MiniMax-H3](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3)

MiniMax-H3向けに公開された、通常20ステップ前後かかるサンプリングを**わずか4ステップ**まで圧縮できるLoRA。映像と同期したステレオ音声を含めて生成でき、サンプリング時間ベースでおよそ5倍の高速化が見込める。bf16で約744MBのLoRAをベースモデルに標準的な低ランク更新として適用する仕組みで、公開者自身も「まだ学習途中のデモ版で、EMA（移動平均）も十分成熟していない」と位置付けているプレビュー版だが、それでもベースモデルの4ステップ生成と比べてディテールや音声の同期精度が明確に向上しているという。技術的な注意点として、MiniMax-H3は映像用（shift 12）と音声用（shift 3）で異なるフロースケジュールを使っており、4ステップのような超低ステップ数では音声側のスケジュールを大きく踏み越えてノイズが破綻しやすい。ComfyUIコミュニティのディスカッションでは、この問題への対処法として、LoRAをComfyUI用に変換するスクリプトの利用、「Power LoRa Loader」ノードで解像度720×720・4〜6ステップ・Euler-betaサンプラーを使う設定などのノウハウが共有されている。

さらにRTX4080クラスのGPUでの実践報告として、**①Patch Sage Attention KJ → ②Patch Sol-Attn → ③Spectrum Apply MiniMax H3** の順にノードを繋ぐと生成速度が上がる、という組み合わせも共有されている（③①②の順でも動作するとの報告あり）。ここでいう「Spectrum Apply MiniMax H3」は、`ComfyUI-Spectrum-MiniMax-H3`が提供するノードで、計算コストの高いH3トランスフォーマーの評価をChebyshevリッジ回帰による特徴量予測で一部スキップする仕組み。ウォームアップと終盤は通常通り実行しつつ、中間ステップで「予測」と「実際の実行」を交互に行うことで、20ステップ実行時にトランスフォーマー評価を30〜35%程度削減できるとされる。履歴スナップショットは最大8個までRAM/VRAMに保持する設計でメモリ効率にも配慮されているが、ネイティブ実行とは出力が変わる場合があり、特に目や指など小さく動く部分の品質低下が報告されているため、品質重視の場合は有効・無効を比較しての確認が推奨されている。

### ComfyUI-MiniMax-H3-Promptor - 画像・動画を見て「シネマ級」のプロンプトを自動生成するカスタムノード
[GitHub - 1038lab/ComfyUI-MiniMax-H3-Promptor](https://github.com/1038lab/ComfyUI-MiniMax-H3-Promptor)

MiniMax H3向けに、映画制作レベルのプロンプトを自動生成するComfyUIカスタムノード群。「ビジュアル分析」と「プロンプト生成」を別ノードに分離しているのが設計上の特徴で、まず`H3_Vision_Analyzer`ノードが最大4枚の画像や動画を同時に解析し、その分析方法自体もJSONベースのプリセット（`vision_prompts.json`を編集すれば独自の分析戦略も追加可能）でカスタマイズできる。出力言語は英語・中国語に対応し、解析にはOpenAI・Ollama・Gemini・Claudeを使い分けられる。続く`H3_Promptor`ノードは、その解析結果からText-to-VideoやVideo-to-Videoなど6種類の生成モードを自動判別し、構造化されたショットリストと、動画の長さ（4〜15秒）に正確に対応したプロンプトを組み立てる。分析とテキスト処理を分けることで、API呼び出しのコストを抑えつつ柔軟にカスタマイズできる構成になっている。GPL-3.0ライセンスで公開。

### Mayz.love Gallery「Prompts to remix」- プロンプトと生成動画をセットで公開するギャラリー
[Mayz.love Gallery - item 24](https://mayz.love/gallery?item=24)

動画生成AIに使ったプロンプトと、そこから実際に生成された動画をセットで公開しているギャラリーサイト「Mayz.love」の一項目。「Prompts to remix（リミックス用のプロンプト）」と題されており、公開されているプロンプトをそのまま流用したり、一部を書き換えたりして自分の生成にリミックス（再利用）できるのがコンセプト。完成した動画だけでなく、そこに至るプロンプトの書き方自体が共有される形式のため、動画生成AIのプロンプト作りのアイデア集・参考事例として眺めるのに向いている。

### Hunyuan3D-Buffalo 1.0 - 理解・生成・編集を1つに統合したTencentの3Dマルチモーダルモデル
[プロジェクトページ](https://tencent-hunyuan.github.io/Hunyuan3D-Buffalo1.0/)

Tencentが公開した、3Dコンテンツの「理解」「テキストからの生成」「指示に基づく編集」「パーツ単位の生成」を単一のアーキテクチャに統合したマルチモーダルモデル。仕組みとしては、自己回帰型のマルチモーダル理解モデル「Hunyuan3D-VLM」と、拡散モデルベースの3D生成バックボーン（Hunyuan3D-2.1から初期化した3D-DiT）を組み合わせており、高レベルな言語・画像理解の結果を統一的な条件付けインターフェース経由で3D生成・編集に反映できる。学習には合計8,700万件規模という大規模な3Dマルチモーダルデータセットを構築しており、内訳は理解タスク用2,500万件、テキストから3D生成用のペア5,000万件、Nano3D-v2で生成した編集ペア1,200万件。テキストからの3D生成や3D編集のベンチマークで最先端級の性能を達成しつつ、3D理解やパーツ単位の生成でも高い能力を示しているのが特徴。

### MiniMax-H3-experimental - Kijaiによるプルーニング＋W4A8量子化の実験的軽量版
[Hugging Face - Kijai/MiniMax-H3-experimental](https://huggingface.co/Kijai/MiniMax-H3-experimental)

ComfyUIノード開発者のKijaiが公開した、MiniMax-H3（33Bパラメータのオムニモーダル動画生成モデル）を軽量化する実験的なチェックポイント。公開されているファイル「minimax_h3_fl2va_pruned_w4a8_mixed.safetensors」（12.5GB）は、モデルをプルーニング（不要な部分を削減）したうえで、**W4A8混合量子化**（重みを4bit、活性化を8bitに落とす非対称int8量子化方式）を適用したもの。通常のfp8やNVFP4量子化よりもさらに踏み込んだビット幅を採用しており、CUDAの専用デコードカーネルやTritonでの実行、コードブックを使ったグループ量子化などによって精度低下を抑えつつサイズと必要VRAMを削減する狙いがある。まだ「experimental」を冠する開発中の成果物で、Comfy-Org/comfy-kitchen側でもW4A8対応の実装が並行して進められている。低スペックなGPUでもMiniMax-H3をローカルで動かしたいユーザーにとって、今後の軽量化の方向性を示す一例。

### MiniMax H3 高速生成のヒント - EasyCache + Patch Sol Attention + Patch Sage Attention KJ
[GitHub - kijai/ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | [GitHub - kijai/ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton)

ComfyUIノード開発者のKijaiが紹介した、MiniMax H3の生成時間を短縮するためのノード組み合わせ。ワークフローに **EasyCache**（拡散モデルの計算結果をステップ間でキャッシュ・再利用し、冗長な計算をスキップする仕組み。ComfyUIにはネイティブ実装も存在する）、**Patch Sol Attention**（以前紹介したスパースアテンション手法Sol-Attnを、ワークフロー内から有効化できるパッチノードとして提供するもの）、**Patch Sage Attention KJ**（アテンション計算を量子化して高速化する「SageAttention」を、ComfyUI再起動なしでワークフロー内から切り替えられるようにするノード。`ComfyUI-KJNodes`に収録）の3つを追加するだけで、GPU全体の演算効率を底上げできる。実際にコミュニティでは、1メガピクセル・5秒の動画生成がEasyCache＋Sage Attentionの組み合わせで6分から2分半まで短縮されたという報告もあり、Sage Attention単体でも約25%の高速化が確認されている。3つとも既存のワークフローにノードを追加するだけで導入でき、モデルの再学習や設定ファイルの変更は不要。

### MiniMax-H3_GGUFs - ComfyUIでそのまま使えるMiniMax-H3のGGUF量子化版
[Hugging Face - realrebelai/MiniMax-H3_GGUFs](https://huggingface.co/realrebelai/MiniMax-H3_GGUFs/tree/main)

MiniMaxが公開したオープンウェイト動画生成モデル「MiniMax-H3」を、ComfyUIで扱いやすいGGUF形式に量子化して配布しているリポジトリ。合計約38.6GB分のファイルが公開されており、動画生成本体を担うUNet（MiniMax-H3-FL2VA系のGGUF各種）、テキストエンコーダ（qwen3vl_32b_minimax_h3）、VAEがそれぞれ個別ファイルとして用意されている。GGUFはもともとllama.cpp系のツール向けに使われてきた量子化フォーマットで、モデルサイズと必要VRAMを抑えつつ動かせるのが利点。ComfyUI-GGUFなどのローダーノードと組み合わせることで、フル精度版では厳しいスペックのマシンでもMiniMax-H3をローカル実行しやすくなる。ベースモデルはComfy-Org/MiniMax-H3で、配布元はMiniMaxとのライセンス契約に基づいて公開していると明記している。

### ComfyUI-SolAttn_triton - 動画生成を最大3.5倍高速化するスパースアテンション実装
[GitHub - kijai/ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton)

論文「Sol-Attn」をベースにした、ComfyUI向けの高速アテンション実装。Sol-Attnは学習不要（training-free）のスパースアテンション手法で、クエリごとの閾値ルーティング・スパース計算・近似補正を1回のオンラインsoftmaxパスの中で統合している点が特徴。重要度の低いブロックをオンチップで選別しつつ、閾値未満のスコアも一部再利用することでロングテールの寄与を捨てすぎないようにしており、これにより速度と品質のトレードオフを改善している。論文ベースでは動画生成で最大2.1倍、動画編集で最大2.3倍の高速化、カーネル融合やキャッシュと組み合わせるとWan 2.1-14Bで3.48倍、HunyuanVideo-13Bで5.08倍まで高速化できると報告されている。本リポジトリはTriton実装で、RTX 4090/5090で動作確認済み、MiniMax H3での利用に最適化されている。初回実行時はコンパイルのため時間がかかる仕様で、start/end percentやtauといったパラメータで品質と速度のバランスを調整できる。現時点では「work in progress」の実験的なプロジェクト。

### Claude of Duty - アートアセット一切なし、コードだけで動くブラウザFPS
[GitHub - mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty)

Three.jsとWebGL2で作られた、ブラウザで動くファーストパーソンシューティングゲーム。最大の特徴は「アートアセットが一切ない」ことで、テクスチャ・メッシュ・アニメーション・音声のすべてを実行時にコードから手続き的に生成している。全体は約55,000行のコードで構成され、HDRレンダリングパイプラインや影のマッピングを含むレンダリングシステム、マテリアルシステム、空の表現、ワールド生成、物理演算、プレイヤー操作、武器システム、エフェクト、AI、UI、オーディオという11のサブシステムに分かれている。スクリーンショット取得・パフォーマンスプロファイリング・画像差分検査といった開発ツール群も同梱されており、これらを使った最適化でfpsを12〜17から28〜30まで改善した実績もある。`npm install && npm run dev` ですぐに起動でき、WASD移動・マウス照準・左クリック射撃という標準的なFPS操作で遊べる。

### MiniMax H3、ComfyUIにネイティブ対応 - Partner Nodes経由で公式ワークフロー公開
[ComfyUI公式ドキュメント](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)

MiniMaxの動画生成モデル「H3」が、ComfyUIから直接呼び出せる公式ワークフローとして公開された。Partner Nodes経由でAPIアクセスがすでに利用可能で、テキストから動画、画像から動画、リファレンス動画からの生成（Omni Reference）まで一通りのワークフロー例がComfyUI公式ドキュメントに用意されている。特徴は生成される動画すべてにネイティブなステレオ音声が付く点、最大2K・5〜15秒・24fpsで出力できる点、そしてキャラクター・シーン・セリフ・声を後から部分的に編集できる点。各ワークフローはResolution Selectorノードで出力サイズを一括制御できる作りになっている。モデル本体はHugging FaceのComfy-Orgリポジトリでホストされており、ネイティブなオープンウェイト対応（ローカルでのGPU実行）も近日公開予定とアナウンスされている。

### LTX2.3-22B IC-LoRA CrossView-Warp - 1本の動画から視点を自由に動かすIC-LoRA
[Hugging Face - Cseti/LTX2.3-22B_IC-LoRA-CrossView-Warp](https://huggingface.co/Cseti/LTX2.3-22B_IC-LoRA-CrossView-Warp) | [GitHub - ComfyUI-CrossViewWarp](https://github.com/cseti007/ComfyUI-CrossViewWarp)

LTX-Video 2.3（22B）向けに公開されたIC-LoRAで、1本の動画とカメラのオフセット（ずらし量）を入力するだけで、あたかも別の位置から撮影したかのような視点違いの映像を生成できる。通常のLoRAがモデルの重みを書き換えてスタイルなどをグローバルに変化させるのに対し、IC-LoRA（In-Context LoRA）は参照データを「文脈（コンテキスト）」として入力し、元のシーンのアイデンティティを保ちながら狙った変換だけを行う手法。今回のケースでは、元動画を新しい視点へ深度情報を使って再投影（ワープ）し、元のカメラでは写っていなかった部分をマゼンタ色の穴として明示した「条件動画」を作り、それを参照コンテキストとしてIC-LoRAに読み込ませることで視点変換を実現している。専用のComfyUIカスタムノード「ComfyUI-CrossViewWarp」も同時公開されており、被写体を囲む3Dの球体UI上でカメラの位置をドラッグして直感的に操作できるほか、右クリックでキーフレームを打てば滑らかなカメラワークも生成可能。学習データの範囲に対応する形で、水平方向は±45度、垂直方向は+30度/−15度あたりが安定して機能する目安（黄色ゾーンの±65度までは画質が落ちつつも動作）。ただし現状はv0.9のプルーフオブコンセプト（技術検証)段階と位置付けられている。

### Mage-VL - 圧縮動画ストリームをそのまま読めるMicrosoftの軽量マルチモーダルモデル
[Mage 公式サイト](https://microsoft.github.io/Mage/) | [GitHub - microsoft/Mage](https://github.com/microsoft/Mage)

Microsoftが公開した、画像・動画理解向けのコーデックネイティブなマルチモーダル基盤モデル。最大の特徴は、動画をいったん全フレームにデコードしてから処理する従来型とは違い、H.264/HEVCなどの**圧縮済みコーデックストリームをそのまま**読み込める点。専用のビジュアルエンコーダ「Mage-ViT」はゼロから学習されており、Iフレームのパッチは保持しつつ、コーデックがビットを割いたPフレームのパッチだけを選択的に使うことで、視覚トークン数を75%以上削減している。デコーダにはQwen3-4Bを採用し、全体で4Bパラメータというコンパクトなサイズながら、静止画タスクではQwen3-VL-4Bに匹敵し、動画タスクでは自社の15B規模のPhi-4-reasoning-visionを上回る性能を報告。従来コーデック動画に加え、ニューラルコーデック(DCVC-RT)や、イベント駆動型のストリーミング実況にも対応する。推論速度は最大3.5倍高速化されており、Apache-2.0ライセンスでHugging Faceに公開されている。

### ComfyUI-ModelResolver - 足りないモデルを自動で見つけてくれるカスタムノード
[GitHub - 21omen/ComfyUI-ModelResolver](https://github.com/21omen/ComfyUI-ModelResolver)

ComfyUIのワークフローで「モデルが見つかりません」というエラーに悩まされがちな問題を解決するカスタムノード。ミュート・バイパス・未接続のノードを無視して、実際に実行に必要なモデルだけを解析する賢いグラフ解析が特徴。CivitaiとHugging Faceの両方を横断的に自動検索し、複数ソースで同じファイルが見つかった場合はSHA256ハッシュで重複を排除してくれる。ダウンロード完了時にはSHA256/MD5のチェックサム検証も行われるため、壊れたファイルや偽物を掴む心配がない。`custom_nodes/`に配置すれば、ワークフロー内の「Model Resolver」パネルから欠落モデルの確認・検索・ダウンロードまで一気通貫で完結する。

## 2026年7月

### 高速・省メモリなVAEデコーダ「PrunaVAED」登場、LTX-2.3向けにComfyUIも即対応
[Hugging Face - PrunaAI/PrunaVAED](https://huggingface.co/PrunaAI/PrunaVAED) | [ComfyUI Wiki](https://comfyui-wiki.com/ja/news/2026-07-28-pruna-vaed-ltx-vae-decoder)

PrunaAIが公開した、LTX-2.3系列の動画生成モデル向けVAEデコーダ。既存のデコーダをプルーニング（枝刈り）・再学習・蒸留することで効率化した「差し替えるだけで使える」高速版デコーダで、conv_inからup_blocks.0まではオリジナルとビット単位で同一の出力を保ちつつ、up_blocks.1以降を軽量化しているのが技術的なポイント。効果は**デコード速度が約1.7〜2.1倍、ピークVRAM使用量が約50%削減**と大幅な改善でありながら、潜在表現(latent)自体には手を加えていないため画質はオリジナルとほぼ変わらない。diffusersのLTX-2.3蒸留2段階パイプラインに対応しているほか、ComfyUIでも公開直後から利用可能になっている。

### MiniMax-H3 - タスクとモダリティの境界を壊すオープン動画生成モデル
[MiniMax公式ブログ](https://www.minimax.io/blog/minimax-h3) | [ModelScope](https://modelscope.cn/models/MiniMax/MiniMax-H3/summary)

MiniMaxが公開したオープンウェイトの動画生成モデル。最大の特徴は、テキスト・画像・動画・オーディオを1つのモデルで同時に理解し、映像と音声が揃った完成クリップを1回の生成で出力できる点。最大2K解像度・最長15秒・24fps（映画やテレビと同じフレームレート）でネイティブなステレオ音声付き動画を生成できる。既存動画の一部だけ編集したり、あるクリップのモーションを別のクリップへ転送したりする編集機能も搭載。価格は2K出力で1秒あたり0.14ドル、768pで0.10ドルと比較的低コストで、広告・ブランディング・EC・プロダクトデザイン・UI/UX・ゲーム制作など幅広い用途を想定している。
