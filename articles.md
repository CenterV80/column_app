# 記事まとめ

気になる記事をここに追加していきます。

## 2026年7月

### MiniMax-H3 - タスクとモダリティの境界を壊すオープン動画生成モデル
[MiniMax公式ブログ](https://www.minimax.io/blog/minimax-h3) | [ModelScope](https://modelscope.cn/models/MiniMax/MiniMax-H3/summary)

MiniMaxが公開したオープンウェイトの動画生成モデル。最大の特徴は、テキスト・画像・動画・オーディオを1つのモデルで同時に理解し、映像と音声が揃った完成クリップを1回の生成で出力できる点。最大2K解像度・最長15秒・24fps（映画やテレビと同じフレームレート）でネイティブなステレオ音声付き動画を生成できる。既存動画の一部だけ編集したり、あるクリップのモーションを別のクリップへ転送したりする編集機能も搭載。価格は2K出力で1秒あたり0.14ドル、768pで0.10ドルと比較的低コストで、広告・ブランディング・EC・プロダクトデザイン・UI/UX・ゲーム制作など幅広い用途を想定している。

### 高速・省メモリなVAEデコーダ「PrunaVAED」登場、LTX-2.3向けにComfyUIも即対応
[Hugging Face - PrunaAI/PrunaVAED](https://huggingface.co/PrunaAI/PrunaVAED) | [ComfyUI Wiki](https://comfyui-wiki.com/ja/news/2026-07-28-pruna-vaed-ltx-vae-decoder)

PrunaAIが公開した、LTX-2.3系列の動画生成モデル向けVAEデコーダ。既存のデコーダをプルーニング（枝刈り）・再学習・蒸留することで効率化した「差し替えるだけで使える」高速版デコーダで、conv_inからup_blocks.0まではオリジナルとビット単位で同一の出力を保ちつつ、up_blocks.1以降を軽量化しているのが技術的なポイント。効果は**デコード速度が約1.7〜2.1倍、ピークVRAM使用量が約50%削減**と大幅な改善でありながら、潜在表現(latent)自体には手を加えていないため画質はオリジナルとほぼ変わらない。diffusersのLTX-2.3蒸留2段階パイプラインに対応しているほか、ComfyUIでも公開直後から利用可能になっている。

