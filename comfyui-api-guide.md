# ComfyUI API まとめ

*公開: 2026-09-14*

ワークフローを自作WebUIから実行するための整理メモ。
誤解しやすいポイントを中心にまとめる。

---

## 1. よくある誤解

### 誤解① 「API化」でワークフローが独立したAPIになる

**思っていたこと**

ワークフローを書き出すと `POST /my-workflow` のような専用エンドポイントが生える。

**実際**

APIはComfyUI本体に最初から組み込まれていて、固定。
ワークフローを書き出そうが書き出すまいが存在する。
サーバーにワークフローが登録・保存されることもない。

**なぜ誤解しやすいか**

ComfyUI側のメニュー名が "Save (API Format)" だから。
あれは *API化する機能* ではなく、*既存のAPIに送れる形式で保存する機能*。
日本語にするなら「APIリクエスト用に書き出し」が実態に近い。

---

### 誤解② ワークフローがAPIそのもの

正しい関係は以下。

| | 役割 |
|---|---|
| ComfyUIのAPI | 窓口（固定・共通） |
| `workflow_api.json` | **APIに渡す引数（データ）** |
| 自作WebUI | データを組み立てて叩く側 |

Photoshopで言えば、jsxから機能を呼べる仕組みがAPI、`.psd` がデータ。
ワークフローJSONは `.psd` 側のポジション。

---

### 誤解③ "prompt" はテキストプロンプトのこと

ComfyUI内部では「実行1回分の依頼」を prompt と呼ぶ。
中身はワークフローのグラフ全体。
CLIPTextEncodeに入れる文字列とは完全に別物。

---

### 誤解④ APIだけ繋げば本体なしで動く

APIは窓口にすぎず、モデルのロードもサンプリングもGPU処理も本体の中にある。
サーバーが落ちていれば接続エラーになるだけ。

ただし **ブラウザUIは不要**。

```bash
python main.py --disable-auto-launch
```

で起動しておけば、ブラウザを一切開かずPythonから叩ける。
「起動せずに」がこの意味なら可能。

---

## 2. 合っていたこと

- バックエンドはAPIを持っている
- そこにJSONを渡している
- JSONはAPIの引数として受け取られる
- 実行に使う窓口は `POST /prompt` の1つだけ

---

## 3. エンドポイント

ベースURLは `http://127.0.0.1:8188`（起動時に表示されるアドレス）。

| パス | 役割 |
|---|---|
| `POST /prompt` | 実行依頼。引数は `prompt` と `client_id` |
| `GET /history/{prompt_id}` | 結果の取得 |
| `GET /view` | 出力ファイルの取得 |
| `POST /upload/image` | 画像の送信 |
| `GET /queue` | キューの状態確認 |
| `POST /interrupt` | 実行の中断 |

同じパスでもメソッドが違えば別のAPI。
`POST /prompt` は実行依頼、`GET /prompt` はキュー状態を返す。

---

## 4. JSONの用意

1. 設定 → **Dev mode** を ON
2. メニューに出る **Save (API Format)** で書き出し
3. `workflow_api.json` が得られる

> メニュー名はフロントエンドのバージョンで変わる。
> 新しめのフロントエンドでは Workflow（File）メニューの **Export (API)** に移っていて、
> その場合はDev modeをONにしなくても出てくる。書き出される中身は同じ。

通常のワークフローJSONとの違い。

- 座標やリンク情報が落ちる
- ノードIDをキーにしたフラットな辞書になる
- 各ノードは `class_type` と `inputs` を持つ
- `inputs` の値は固定値か `["ノードID", 出力index]` の参照
- ミュート / バイパスされたノードは書き出し時点で解決・除外される

---

## 5. パラメータの差し替え

スキーマもデフォルト値もバリデーションの親切さもない。
対象ノードIDの `inputs` を直接書き換える。

```js
const PARAM_MAP = {
  prompt:   ["6",  "text"],
  seed:     ["31", "noise_seed"],
  steps:    ["31", "steps"],
  refImage: ["12", "image"],
};
```

- ノードIDはワークフロー編集でズレるため、`_meta.title` で引くか自前マッピングを持つ
- 書き換え可能なキーは、そのノードのPythonクラスの `INPUT_TYPES` と一致する
- このマッピングが実質的なAPI仕様書になる

---

## 6. 実行フロー（非同期）

`POST /prompt` は受付だけして `prompt_id` を返す。画像は返らない。

```
1. POST /prompt                       → prompt_id を取得
2. ws://host/ws?clientId=xxx          → 進捗・完了を受信
3. GET /history/{prompt_id}           → 出力ファイル名を取得
4. GET /view?filename=...&type=output → 実体を取得
```

呼んだら結果が返る関数ではなく、ジョブ投入に近い。

---

## 7. 注意点

- ブラウザから直接叩くなら、ComfyUIを `--enable-cors-header` 付きで起動
- キューに積まれるため、複数リクエストの順番待ちを考慮する
- 入力画像は先に `POST /upload/image`（multipart）で送っておく

---

## 8. 最小サンプル

```python
import json, requests

BASE = "http://127.0.0.1:8188"

with open("workflow_api.json", encoding="utf-8") as f:
    wf = json.load(f)

# パラメータ差し替え
wf["6"]["inputs"]["text"] = "a cat on the roof"
wf["31"]["inputs"]["noise_seed"] = 12345

res = requests.post(f"{BASE}/prompt", json={
    "prompt": wf,
    "client_id": "my-client-id",
})
prompt_id = res.json()["prompt_id"]

# 完了後
hist = requests.get(f"{BASE}/history/{prompt_id}").json()
```
