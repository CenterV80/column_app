# ローカルMiniMax H3 R2V ComfyUI構成まとめ(2026年8月時点)

RTX5080(VRAM16GB)、参照画像を多用するR2V用途を前提にした構成です。

## モデル構成

| パーツ | 選定 | 補足 |
|---|---|---|
| DiT | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | R2V専用の公式pruned INT8。量子化(GGUF)は見送り |
| Turbo LoRA | `minimax_h3_turbo_v4_step600_ema` | 6〜8step / Sampler: Euler / Scheduler: Beta |
| VAE | `minimax_h3_video_vae_fp16` + `minimax_h3_audio_vae_fp32` | 標準構成のまま |
| テキストエンコーダー | ClipProj(Qwen3-VL-8B) | Qwen3-VL-32Bから置き換え。DiT/VAE/サンプラーは無変更 |
| 参照画像設定 | `ref_image_size: match` | 最大9枚。生成解像度にダウンスケールしてVRAM節約 |
| 想定GPU | RTX5080(16GB) | |

### ポイント

- **DiTは量子化しない**：H3のdenoiser本体はhidden width 2688で256の倍数ではないため、真のK-quantがほぼ効かない。Q4_K_MはQ4_0と同サイズになり、Q6は「Q8より軽いはずが画質はQ8未満、容量もさほど減らない」中途半端な位置になる。INT8 prunedのままで十分。
- **VAEも標準のまま**：fp32版は「画質向上ほぼなし、遅いだけ」と公式が明言している。軽量int8_convrot VAEは黒画面バグの報告あり。冒険する場所ではない。
- **VRAM節約はテキストエンコーダーで**：DiTを削ると生成品質そのものが落ちるが、テキストエンコーダーはプロンプトを条件付けテンソルに変換するだけなので、ClipProjでQwen3-VL-8Bに置き換えても参照画像側の忠実度への影響は小さい。浮いたVRAMを参照画像枚数に回せる。
- **Turbo LoRAはckpt850ではなくstep600_ema**：公式デフォルトの`ckpt850`(4step)は作者自身が「のっぺりした質感になりやすい」と注意書きしている。アニメ系は線やセルの境界の再現性が重要なため、6〜8stepで画質寄りの`step600_ema`を採用。速度は落ちるが、参照画像のアイデンティティ再現とディテール優先で妥当なトレードオフと判断。

---

## おまけ：決定までの簡単なログ

1. **R2V構成の基本形を確認**：DiT(ref2va pruned INT8)、VAE(video fp16 + audio fp32)、テキストエンコーダー(Qwen3-VL-32B nvfp4_awq)が現状のComfyUI公式構成。15秒生成が重いという相談から、Turbo LoRAでの高速化を提案。
2. **GGUF量子化を検討 → 見送り**：Q4〜Q8の劣化度合いを確認。H3特有のK-quant非対応の問題からQ6は「恩恵が薄い」と判明し、RTX5080であれば量子化不要と判断。
3. **VAEの代替を確認 → 標準のままで決定**：fp32版・軽量int8_convrot版を検討したが、画質向上なし/不具合報告ありでどちらも採用見送り。
4. **テキストエンコーダーの代替を確認**：ClipProj(Qwen3-VL-4B/8B)の存在を確認。当初は「参照画像を多く使いたい」という目的が出てきたため、DiTではなくテキストエンコーダー側でVRAMを削る方針に転換。8B版を採用し、`ref_image_size: match`と組み合わせ。
5. **Turbo LoRAのバージョンを再検討**：当初`ckpt850`(4step)で決めていたが、アニメ系用途での「のっぺり感」リスクを懸念し、コミュニティで評価の高い`step600_ema`(6〜8step)に変更して最終決定。
