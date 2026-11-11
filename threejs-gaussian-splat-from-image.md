# 一枚絵からGaussian Splatを生成してthree.jsで表示する

*公開: 2026-11-11*

## 要点

- **three.js単体では、一枚絵からスプラットは作れない**。three.jsが担うのは表示まで
- 生成は**サーバー側のAIモデル**（SHARPやTRELLISなど）で行い、`.ply`を書き出す
- 表示は**three.js＋Spark**（World Labs製のスプラット描画ライブラリ）で`.ply`を読み込むだけ
- 生成と表示を分けておけば、モデルを差し替えても表示側のコードはほぼそのまま使える

---

## 全体の構成

| 役割 | 担当 | 出力 |
| --- | --- | --- |
| 生成 | SHARP / TRELLIS など（GPUサーバー or ローカル） | `.ply` |
| 軽量化（任意） | SuperSplatなどで不要部分を削除 | 軽くした`.ply`など |
| 表示 | three.js＋Spark | ブラウザ上で回せる3D |

### モデルの選び方

- **SHARP（Apple）**：写真・イラストを**シーンとして**スプラット化する。出力は「近くの視点」からのレンダリング向けで、少し視点を動かす演出が得意。大きく回り込むと破綻しやすい
- **TRELLIS**：**オブジェクト単体**を、見えていない裏側まで含めて生成する。キャラや小物をぐるっと回したいならこちら

> ブラウザ内で生成まで完結させる方法（深度推定でピクセルをスプラット化する、生成モデルをWebGPUで動かすなど）もあるが、品質や配布サイズの面でまだ実験段階。安定させたいなら生成はサーバーに置くのが無難。

## 手順（SHARPの例）

TRELLISでも流れは同じ。

### 1. 生成環境を用意する

```bash
conda create -n sharp python=3.13
conda activate sharp
git clone https://github.com/apple/ml-sharp
cd ml-sharp
pip install -r requirements.txt
sharp --help   # 動作確認
```

### 2. 画像からスプラットを生成する

```bash
sharp predict -i input/ -o output/
```

- 初回実行時にチェックポイントが自動でダウンロードされる
- 出力は一般的な3DGSビューワーで読める`.ply`
- 推論自体はCPU / CUDA / MPSで動く。動画レンダリング（`--render`）だけはCUDA GPUが必要

### 3. 入力画像を整える

- シーン全体をスプラット化するならそのまま
- キャラ単体を回したいなら、背景を除去してから入れる（この用途はTRELLISの方が向いている）

### 4. API化する

- FastAPIなどで「画像を受け取る → 生成 → `.ply`のURLを返す」エンドポイントを1本作る
- ComfyUIに組み込む場合はカスタムノード化し、自作のWebUIからComfyUI API経由で呼ぶ

### 5. 軽量化する（任意）

- `.ply`はそのままだと重い。SuperSplatなどで不要なスプラットを削除してから書き出す
- Sparkは`.spz`・圧縮PLY・`.sog`などの軽量形式も読めるので、配信用はこれらに変換すると軽くなる

### 6. three.jsで表示する

```bash
npm install three @sparkjsdev/spark
```

```js
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// Sparkの描画担当をシーンに追加する
const spark = new SparkRenderer({ renderer });
scene.add(spark);

const splat = new SplatMesh({ url: "/output/result.ply" });
splat.quaternion.set(1, 0, 0, 0); // 上下反転して表示される場合の補正
splat.position.set(0, 0, -3);
scene.add(splat);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

- 視点操作はOrbitControlsなどを足す
- 通常のメッシュと同じシーンに混ぜられるので、ライトやUIとの合成も普通にできる

### 7. フロントとつなぐ

画像アップロード → APIへ送信 → 返ってきた`.ply`のURLを`SplatMesh`に渡す。

## 注意点

- **座標系**：SHARPの出力はOpenCV系（xが右、yが下、zが前）で、シーンの中心は前方（+z方向）にある。three.jsで表示するときは、回転と位置・スケールで調整する。上の`quaternion.set(1, 0, 0, 0)`はX軸まわりに180°回す補正
- **視点の範囲**：SHARPは近くの視点向け。大きく回り込む用途には向かない
- **ライセンス**：SHARPはコードとモデルの重みでライセンスファイルが分かれている。業務で使う前に`LICENSE_MODEL`を必ず確認する
- **WebGPU版**：Sparkには実験的なWebGPU版（Spark Radix）も出ている。現行の安定版はWebGL2ベース

## 関連記事

- [ComfyUI-Idol：画像1枚から3D Gaussian Splatを生成する](gaussian-splatting-comfyui-idol.html) — 生成側をComfyUIのローカル環境で回す例

## 参考

- [apple/ml-sharp](https://github.com/apple/ml-sharp)
- [Spark（sparkjsdev/spark）](https://github.com/sparkjsdev/spark)
- [Spark Radix Brings WebGPU Splat Rendering to three.js](https://radiancefields.com/spark-radix-brings-webgpu-splat-rendering-to-threejs)
