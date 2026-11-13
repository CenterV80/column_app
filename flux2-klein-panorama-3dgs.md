# FLUX.2 Klein パノラマ → 3DGS ワークフロー（ComfyUI）

*公開: 2026-11-13*

<a href="flux2-klein-panorama-3dgs.md" download>📥 手順書をMarkdown（.md）でダウンロード</a>

## 全体像

FLUX.2 Kleinで360°パノラマを作り、それを目的に合うルートで3DGS（3D Gaussian Splatting）にします。まずルートAで結果を確かめ、歩き回りたい場面だけルートBに回すのが効率的です。

| ルート | 中身 | 向いている用途 |
| --- | --- | --- |
| **A** ComfyUI-Sharp | パノラマを視点ごとに分けてSHARPで3DGSを予測し、結合する | 中心から見回す範囲。スカイボックスや背景 |
| **B** SplatKit → Spirula Studio | 歩く動画を作ってCOLMAPデータセットにし、別ツールで学習する | 重いが、中心から離れても破綻しにくい。メッシュ化も可 |
| **C** WorldGen（パノラマ入力） | WorldGenにパノラマを直接渡す | コード数行で済む。メッシュモードあり |

AとCは手早く終わります。BはWAN 2.1と学習を挟むので重いですが、歩き回れる範囲が広がります。どのルートも出力は3DGSの `.ply` です。

---

## Step 1：FLUX.2 Kleinで360°パノラマを作る

参照画像をERP（正距円筒）キャンバスに貼り、空いた部分をFLUX.2 Klein＋360 ERP Outpaint LoRAで埋めて、2:1のパノラマを出力します。

### インストール

- ComfyUI Managerで **ComfyUI-Panorama-Stickers**（nomadoor）を入れる（[日本語解説](https://comfyui.nomadoor.net/ja/notes/panorama-stickers/)）

### モデル配置（4B版の例）

| フォルダ | ファイル |
| --- | --- |
| `models/diffusion_models` | `flux-2-klein-base-4b.safetensors` |
| `models/loras` | `flux-2-klein-4B-360-erp-outpaint-lora_V1.safetensors` |
| `models/text_encoders` | `qwen_3_4b.safetensors` |
| `models/vae` | FLUX.2用VAE（ファイル名は作者のサンプルワークフローで確認） |

9B版は名前の4Bを9Bに読み替え、テキストエンコーダはQwen3 8B系（ComfyUI公式ドキュメントでは `qwen_3_8b_fp8mixed.safetensors`）を使います。

- 必ず **base** モデルを使う。Distilled版ではLoRAがほとんど効かないと、作者の日本語解説に既知の問題として書かれている
- LoRA：[9B](https://huggingface.co/nomadoor/flux-2-klein-9B-360-erp-outpaint-lora) / [4B](https://huggingface.co/nomadoor/flux-2-klein-4B-360-erp-outpaint-lora)

### ノードの流れ

1. **Panorama Stickers**：モーダルUIで参照画像をERPキャンバスに配置する（ドラッグで視点移動、ホイールでFOV）
2. 空き部分が緑（既定は `#00ff00`）のERP画像を、LoRAを当てたFLUX.2 Kleinの編集に渡す。プロンプトはモデルカードのトリガー文（"Fill the green spaces according to the image." から始まる文）をそのまま使う
3. **Panorama Seam Prep**：左右端の継ぎ目を整える
4. **Panorama Preview / Cutout**：見回して確認し、任意の視点を切り出す

### 設定の目安

- 解像度は2048×1024（2K ERP）。粗ければアップスケールする
- steps・CFG・サンプラーの推奨値は見当たらない。作者のサンプルワークフローの値から始める
- 継ぎ目を完全に合わせるのはまだ難しく、出力によってはインペイントなどの後処理が要るとモデルカードに書かれている

**参照画像なしで、テキストだけから作りたい場合**：[SpheRoPE](https://github.com/orhir/spherope)ならFLUX.2-devで2048×1024（幅×高さ）のERPを、追加学習なしに生成できます。ComfyUIではなく、Pythonスクリプト（`generate_panorama.py`）またはPython APIで使います。

---

## ルートA：ComfyUI-Sharpですぐに3DGS化する

AppleのSHARP（1枚の画像から3DGSを予測するモデル）をComfyUIで使うノードです。パノラマを透視カメラの画像に切り分けて、それぞれから3DGSを予測し、1つのPLYにまとめます。ComfyUIの中で完結するのが利点です。

### インストール

- Managerで「Sharp」を検索して入れる。手動なら `custom_nodes` に `git clone https://github.com/PozzettiAndrea/ComfyUI-Sharp.git` → `pip install -r requirements.txt --upgrade` → `python install.py`
- インストールには実験的な `comfy-env` パッケージが使われ、pixiパッケージマネージャーがダウンロードされる
- モデルは初回実行で自動ダウンロード。オフラインなら `ComfyUI/models/sharp/sharp_2572gikvuh.pt` に置く
- PLYの出力だけならそのまま動く。ノード上で3DGSを見る（Gaussian Viewer）には ComfyUI-GeometryPack も必要

### パノラマ用のノード

パノラマ向けには次のようなノードが用意されています。

- **Sharp Panorama Cube Split** / **Sample Panorama (Equirect -> Perspective)**：ERPを透視カメラの画像に切り分ける
- **SHARP Predict** 系：各画像から3DGSを予測する（深度を外から渡す **SHARP Predict Gaussians (Image + Metric Depth)** もある）
- **Align Depth Maps (Global Optimization)**：視点ごとの深度のずれを揃える
- **Merge Gaussians (PLY Files)**：1つのPLYにまとめる

リポジトリ同梱のパノラマ用サンプル（`workflows/pano.json`）は、MoGe-2でパノラマの深度を推定し、パノラマを分割して **SHARP Predict Gaussians (Image + Metric Depth)** に渡し、**Merge Gaussians** で結合する構成になっています。配線はこのサンプルを読み込んで確認するのが確実です。

**向き不向き**：1枚からの予測なので、中心の視点から見回す範囲はきれいです。大きく歩くと、裏側や遮蔽部分が破綻します。スカイボックスや背景用と割り切ると使いやすいです。

---

## ルートB：SplatKitで学習データを作り、Spirula Studioで学習する

歩ける範囲を広げたい場合の本命です。[ComfyUI-SplatKit](https://github.com/mickmumpitz/ComfyUI-SplatKit)（mickmumpitz）は、1枚の360°パノラマから空間を歩く動画を作り、COLMAP形式のデータセットにします。READMEにも「学習済みスプラットではなくデータセットを作る」とある通り、学習自体は別のツールに任せます。

### SplatKitの中で起きること

1. MoGeがパノラマの深度を推定し、メッシュにする
2. カメラパスでそのメッシュをレンダリングし、制御動画と未撮影部分のマスクを作る
3. WAN 2.1 i2v＋Matrix-3DパノラマLoRAが、その穴を埋める
4. SphereSfMがSfMを解いてCOLMAP形式で書き出す

### 準備

- 導入は `install_splatkit.bat` をComfyUIフォルダに置いて実行するか、`custom_nodes` にクローンして `requirements.txt` をpipで入れる（現状Managerには未登録）
- WAN 2.1 i2vのチェックポイントは自分で用意する。Matrix-3D LoRAは `tools/convert_pano_lora.py` でComfyUI向けのキー名に変換して使う
- MoGeとSphereSfMは初回使用時に、RAFTはHiRes Compositeを `base_mode=wan` で回したときに自動でダウンロードされる
- GPUでの特徴点マッチングにはNVIDIA Turing以降が必要（なければCPUにフォールバックし、遅いが結果は同じ）。macOSはビルドがなく、SphereSfMのバイナリを自前で用意する必要がある
- 作者の例では、第1段のパノラマ生成にKrea 2 Turbo（テキスト→パノラマ）やQwen-Image-Edit＋360 LoRA（画像→パノラマ）を使っている。ここをStep 1のFLUX.2 Kleinの出力に差し替える

### Spirula Studioで学習する

[Spirula Studio](https://github.com/harry7557558/spirula-studio)は、写真や動画から3DGSを学習し、テクスチャ付きメッシュまで作れるツールです。Python不要の単体バイナリで、VulkanによりNVIDIA・AMD・Intel・AppleのGPUで動きます。

- SplatKitの出力データセットをSpirulaのGUIか `spirula train` に渡す（引数は `spirula --help` で確認）
- SplatKitの **Build Equirect Dataset** は、正距円筒カメラに対応した学習器が必要。Spirulaは360°・正距円筒カメラにネイティブ対応しているので、このモードも試せる
- HiRes Composite（元の8192×4096パノラマをシーンの形状に投影し直し、WANには形状で埋まらない部分だけを任せるモード）のデータセットでは、ガウシアン数の上限を300万前後に上げる。既定の100万だと再構成が頭打ちになり、解像度の向上が見えなくなると作者が書いている
- メッシュが欲しければ、Spirulaのメッシュ化でテクスチャ付きメッシュも取れる

---

## ルートC：WorldGenにパノラマを直接渡す

[WorldGen](https://github.com/ZiYang-xie/WorldGen)はテキストや画像から3Dシーンを作るツールで、360°パノラマを直接受け取る入口もあります。FLUX.2のパノラマを渡すだけなので、コードを書き換える必要はありません。

```python
from PIL import Image
from worldgen import WorldGen

worldgen = WorldGen(mode="i2s", device="cuda", low_vram=True)  # VRAM 24GB未満なら True
pano_image = Image.open("flux2_pano.png")  # 2:1 のERP
pano_image = pano_image.resize((2048, 1024))  # 必要に応じて
splat = worldgen._generate_world(pano_image=pano_image)
```

- アスペクト比は2:1にする
- `_generate_world` は先頭に `_` が付く内部的なメソッド。更新で変わる可能性がある
- `--use_sharp` の実験モード（ml-sharpバックエンド）は、既定モードより良い結果になる場合があるとされる。使うには `--recursive` でクローンし、`pip install -e submodules/ml-sharp` が必要（このオプションは[okkann/worldgen](https://github.com/okkann/worldgen)のREADMEに記載）
- `return_mesh=True`（デモでは `--return_mesh`）でメッシュも出せる。作者は「スプラットより良い結果になるはず」と書いているので、UEに持ち込むならこちらも比較する
- 使う前に、Hugging FaceでFLUX.1-devのライセンスに同意してログインしておく必要がある

---

## 確認とUE / Unityへの持ち込み

| 用途 | ツール |
| --- | --- |
| すぐ見る | [SuperSplat](https://superspl.at/editor)（ブラウザにドラッグ） |
| ComfyUI内で扱う | ComfyUI v0.23.0以降のネイティブ3DGSノード（[レンダリング・メッシュ化・変形など](https://radiancefields.com/comfyui-adds-native-gaussian-splat-manipulation-nodes-for-rendering-meshing-and-transformation)） |
| Unity | [Unity Gaussian Splatting 2.0.0](https://radiancefields.com/unity-gaussian-splatting-2-0-0-loads-ply-and-spz-directly)（PLY / SPZを直接読み込み） |
| UEFN | [43.00でPLY / SPZの実験的インポートに対応](https://radiancefields.com/uefn-43-00-adds-experimental-gaussian-splat-import) |
| UE | 3DGS用のプラグインを使うか、SpirulaやWorldGenでメッシュ化して持ち込む |

---

## ライセンスと注意点

仕事で使うなら、パイプライン中で一番厳しいライセンスが全体の条件になります。採用前に各モデルのページで確認してください。

| 部品 | ライセンス | 商用 |
| --- | --- | --- |
| FLUX.2 Klein 4B（base含む） | Apache 2.0 | 可 |
| FLUX.2 Klein 9B / FLUX.2-dev | FLUX Non-Commercial License | 不可（別契約が必要） |
| 360 ERP Outpaint LoRA | ベースモデルの条件に従う想定 | ベース次第 |
| ComfyUI-Sharp | ラッパーはGPL-3.0。SHARPのコード・重みはAppleのライセンス（重みはApple ML Research Model License） | 重みは研究用途向け。要確認 |
| SplatKit | 自前コードはMIT。上流由来のコードは各ライセンス | 部品次第 |
| WAN 2.1 / Matrix-3D LoRA | 各配布元で確認 | — |
| WorldGen | コードはApache-2.0。内部で使うFLUX.1-devは非商用ライセンス | 経路次第 |
| Spirula Studio | GPL-3.0（マスク用のSAMモデルは別途Metaのライセンス） | 可（配布時はGPLの条件） |

### そのほかの注意

- パノラマ由来の3DGSは、中心から離れるほど破綻します。歩き回る前提ならルートBを検討します
- SplatKitのVRAM要件は見当たりません。WAN 2.1を回すので、もっとも重いルートです

---

## 出典

- [ComfyUI Panorama Stickers（日本語解説）](https://comfyui.nomadoor.net/ja/notes/panorama-stickers/)
- [FLUX.2 Klein 9B 360 ERP Outpaint LoRA](https://huggingface.co/nomadoor/flux-2-klein-9B-360-erp-outpaint-lora)
- [FLUX.2 Klein（ComfyUI公式ドキュメント）](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [FLUX.2 [klein]（Black Forest Labs）](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)
- [SpheRoPE](https://github.com/orhir/spherope)
- [ComfyUI-Sharp](https://github.com/PozzettiAndrea/ComfyUI-Sharp)
- [ComfyUI-SplatKit](https://github.com/mickmumpitz/ComfyUI-SplatKit)
- [WorldGen](https://github.com/ZiYang-xie/WorldGen) / [フォーク版README](https://github.com/okkann/worldgen)
- [Spirula Studio](https://github.com/harry7557558/spirula-studio)
- [ComfyUIネイティブ3DGSノード（Radiance Fields）](https://radiancefields.com/comfyui-adds-native-gaussian-splat-manipulation-nodes-for-rendering-meshing-and-transformation)
