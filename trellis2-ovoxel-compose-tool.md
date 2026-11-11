# TRELLIS.2のO-VoxelをパーツごとにくっつけるツールをClaude Codeで作る

*公開: 2026-11-11*

<a href="trellis2-ovoxel-compose-tool.md" download>📥 手順書をMarkdown（.md）でダウンロード</a>

## 要点

- **TRELLIS.2**（Microsoft）は、一枚の画像からPBRマテリアル付きの3Dアセットを生成するモデル。内部では**O-Voxel**という疎なボクセル表現を使っている
- O-Voxelは**メッシュと高速に相互変換できる**ので、「O-Voxelの段階でパーツを組み合わせてからメッシュにする」という使い方ができる
- 合成は**O-Voxel層（明示的な操作）**と**潜在層（AIになじませてもらう）**の2段構えで考える
- ツール作りはClaude Codeに任せる。**調査 → 入出力 → 変換 → 合成 → 継ぎ目処理**の順に段階を切って指示するのがコツ

---

## TRELLIS.2とO-Voxel

| 項目 | 内容 |
| --- | --- |
| 開発 | Microsoft Research ほか |
| 入力 / 出力 | 画像1枚 / PBRマテリアル付きの3Dメッシュ |
| パラメータ数 | 4B（TRELLIS.2-4B） |
| 解像度 | 512³ 〜 1536³ |
| ライセンス | MIT（nvdiffrast・nvdiffrecなど依存パッケージは別ライセンス） |
| 動作要件 | Linuxで動作確認、NVIDIA GPU（VRAM 24GB以上）、CUDA 12.4推奨 |

### O-Voxelの中身

O-Voxel（Omni-Voxel）は、形状と見た目を一緒に持つ「フィールドフリー」な疎ボクセル構造。

- **形状（fshape）**：Flexible Dual Gridsで表現。開いた面・非多様体・内部構造など任意のトポロジーを扱え、シャープなエッジも保てる
- **材質（fmat）**：Base Color、Metallic、Roughness、Alpha（不透明度）のPBR属性

### メッシュとの相互変換

- テクスチャ付きメッシュ → O-Voxel：単一CPUで10秒未満
- O-Voxel → テクスチャ付きメッシュ：CUDAで100ms未満

どちらもレンダリングや最適化のループを挟まない。この変換を担うのが、リポジトリ同梱の**o-voxel**ライブラリ。

> MoGe-2（同じくMicrosoft）とは別物。MoGe-2は一枚絵から**見えている面の形状を推定する**回帰モデルで、裏側は作らない。TRELLIS.2は裏側まで含めて**生成する**モデル。

---

## O-Voxelで合成するときの考え方

### ① O-Voxel層：明示的に組む

O-Voxelは「座標＋属性」の集合なので、配置・コピー・ミラー・タイリング・足し引きはnumpyやPyTorchで直接書ける。

注意点：

- **回転・反転は座標だけ回しても崩れる可能性がある。** fshapeはボクセル内の頂点位置などを持つので、属性側も同じ変換に合わせる必要がある（具体的な持ち方はソースを読んで確認する）
- **パーツ同士の継ぎ目は形が合わないことが多い。** 気になる場合は、いったんメッシュにして合成し、O-Voxelに戻す（10秒未満）ほうが安全なこともある

### ② 潜在層：AIに継ぎ目をなじませる

TRELLIS.2はO-VoxelをSC-VAE（Sparse Compression VAE）で16倍に圧縮した潜在トークンに変換する（1024³で約9.6Kトークン）。

この潜在の段階でパーツを配置し、**継ぎ目の領域だけマスクして再生成**すれば、モデルに境界を自然につないでもらえる可能性がある。ただし公式のAPIは無いので、パイプラインに手を入れる研究寄りの実装になる。まずは①で作り、②は後回しにするのが現実的。

---

## リポジトリを用意する

Claude Codeに読ませるのは**TRELLIS.2**のリポジトリ。初代の`microsoft/TRELLIS`はO-Voxelではないので混ぜない。

```bash
git clone -b main https://github.com/microsoft/TRELLIS.2.git --recursive
cd TRELLIS.2
```

サブモジュールがあるので`--recursive`を忘れない。依存関係は`setup.sh`で入れる。O-Voxel関連は`--o-voxel`オプション。

```bash
. ./setup.sh --new-env --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
```

### 読ませる場所

- **`o-voxel/`**：O-Voxelのデータ構造とメッシュとの相互変換。今回の本丸
- **`trellis2/`のパイプライン・VAE周り**：生成結果がどうO-Voxelになるか、潜在へのエンコード方法（継ぎ目処理で必要）
- **論文（arXiv 2512.14692）**：Flexible Dual Gridsはコードだけだと読み取りにくいので、PDFも一緒に渡す

範囲を「`o-voxel/`中心に」と絞っておくと、無関係なコードを読んで寄り道しにくい。

---

## Claude Codeに渡す指示（たたき台）

```
TRELLIS.2 の O-Voxel をパーツ単位で組み合わせるツールを作りたい。
段階ごとに作って、各段階の完了時に報告して止まって。

## Phase 0: 調査
- microsoft/TRELLIS.2 の o-voxel ライブラリのソースを読み、O-Voxel のデータ構造
  （座標、fshape=Flexible Dual Grids の属性、fmat=PBR属性）を docs/ovoxel_format.md にまとめる
- メッシュ⇔O-Voxel の変換 API の使い方も記載

## Phase 1: 入出力
- O-Voxel を .npz で保存・読み込み
- GLB へ書き出してプレビューできる CLI

## Phase 2: 変換
- グリッド単位の平行移動、XYZ ミラー、90°回転
- 座標だけでなく fshape の頂点オフセット・エッジ情報も正しく変換すること
- テスト: 「メッシュ変換→O-Voxel化」と「O-Voxel化→変換」の結果を比較し、一致を確認

## Phase 3: 合成
- 複数パーツを JSON のレイアウト定義（パーツ名、位置、回転、ミラー）で配置
- 重複ボクセルの解決ルール（上書き / 優先度）を選べるようにする
- 合成結果を GLB で出力

## Phase 4（後回し）: 継ぎ目処理
- SC-VAE の潜在に変換し、継ぎ目領域だけマスクして再生成する方式を検討
```

### うまく進めるコツ

- **最初に調査させる**：o-voxelのドキュメントは薄いので、まずソースからフォーマット資料を作らせる。以降の段階はその資料を前提に進められる
- **検証方法を先に決める**：「メッシュを変換してからO-Voxel化」と「O-Voxel化してから変換」を比べるテストを作らせると、回転・反転の属性処理のバグを自動で見つけられる
- **段階ごとに止める**：一気に作らせると、データ構造の誤解が後ろの段階まで広がる
- **GPU環境で作業させる**：TRELLIS.2とo-voxelはCUDA前提。動かすマシン上でClaude Codeを走らせる

### レイアウトの作り方

Phase 3のレイアウトJSONは、手書きのほか、Houdiniなどで配置を組んで書き出したり、WFC（Wave Function Collapse）で自動生成したりもできる。配置ロジックをツールの外に出しておくと、合成ツール側はシンプルに保てる。

---

## 書き出し時の注意

- GLBは既定で`OPAQUE`モードで書き出される。アルファはテクスチャ内に残っているが、透過させるには3Dソフト側で設定が必要
- TRELLIS.2のメッシュは必ずしも水密ではない。3Dプリントなど水密性が要る用途向けに、穴埋めなどの後処理スクリプトが用意されている
- ゲームエンジンに持っていく場合は、別途リトポやリダクションを考える

---

## 参考

- [TRELLIS.2 プロジェクトページ](https://microsoft.github.io/TRELLIS.2)
- [TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2)
- [論文 arXiv:2512.14692](https://arxiv.org/abs/2512.14692)
- [TRELLIS.2-4B（Hugging Face）](https://huggingface.co/microsoft/TRELLIS.2-4B)
