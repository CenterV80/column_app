## 2026年7月

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

### 高速・省メモリなVAEデコーダ「PrunaVAED」登場、LTX-2.3向けにComfyUIも即対応
[Hugging Face - PrunaAI/PrunaVAED](https://huggingface.co/PrunaAI/PrunaVAED) | [ComfyUI Wiki](https://comfyui-wiki.com/ja/news/2026-07-28-pruna-vaed-ltx-vae-decoder)

PrunaAIが公開した、LTX-2.3系列の動画生成モデル向けVAEデコーダ。既存のデコーダをプルーニング（枝刈り）・再学習・蒸留することで効率化した「差し替えるだけで使える」高速版デコーダで、conv_inからup_blocks.0まではオリジナルとビット単位で同一の出力を保ちつつ、up_blocks.1以降を軽量化しているのが技術的なポイント。効果は**デコード速度が約1.7〜2.1倍、ピークVRAM使用量が約50%削減**と大幅な改善でありながら、潜在表現(latent)自体には手を加えていないため画質はオリジナルとほぼ変わらない。diffusersのLTX-2.3蒸留2段階パイプラインに対応しているほか、ComfyUIでも公開直後から利用可能になっている。

### MiniMax-H3 - タスクとモダリティの境界を壊すオープン動画生成モデル
[MiniMax公式ブログ](https://www.minimax.io/blog/minimax-h3) | [ModelScope](https://modelscope.cn/models/MiniMax/MiniMax-H3/summary)

MiniMaxが公開したオープンウェイトの動画生成モデル。最大の特徴は、テキスト・画像・動画・オーディオを1つのモデルで同時に理解し、映像と音声が揃った完成クリップを1回の生成で出力できる点。最大2K解像度・最長15秒・24fps（映画やテレビと同じフレームレート）でネイティブなステレオ音声付き動画を生成できる。既存動画の一部だけ編集したり、あるクリップのモーションを別のクリップへ転送したりする編集機能も搭載。価格は2K出力で1秒あたり0.14ドル、768pで0.10ドルと比較的低コストで、広告・ブランディング・EC・プロダクトデザイン・UI/UX・ゲーム制作など幅広い用途を想定している。
