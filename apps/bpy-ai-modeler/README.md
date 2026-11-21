# AIモデル生成（bpy × three.js）

Blender（GUI なし）を持ったローカルサーバーを自分の PC で起動し、Claude Code などの AI に
MCP で操作させて、手作業でモデリングしたような四角ポリゴン主体のメッシュを作るツール。
**Claude の API キーは使いません。** AI は、ふだん使っている Claude Code / Claude Desktop がそのまま担当します。

```
あなた ──「スツールを作って」──▶ AI（Claude Code など）
                                    │  run_script（bpy のスクリプト）
                                    ▼
                         ローカルサーバー（このフォルダ）
                         Blender で実行 → トポロジー検査 → GLB/FBX/OBJ に書き出し
                                    │  検査結果・render の絵
                                    ▼
                         AI が結果を見て直す（エラー・Nゴン・三角形・法線の向き など）
                                    │
                                    ▼
                         ブラウザのビューアー（three.js）に結果がそのまま出る
```

## セットアップ

`bpy` は Blender のバージョンごとに対応する Python が決まっています。いまの bpy 5.3 は **Python 3.13** 専用です
（PyPI の bpy のページで確認してください）。

```bash
cd apps/bpy-ai-modeler
uv venv --python 3.13
source .venv/bin/activate        # Windows: .venv\Scripts\activate
uv pip install -r requirements.txt
```

## 起動

```bash
python server.py
```

- ビューアー: http://127.0.0.1:8000
- AI の接続先（MCP）: http://127.0.0.1:8000/mcp

## AI をつなぐ

### Claude Code

サーバーを起動したまま、一度だけ実行します。

```bash
claude mcp add --transport http bpy-modeler http://127.0.0.1:8000/mcp
```

あとは Claude Code に頼むだけです。

```
bpy-modeler で木製のスツールを作って。座面は直径35cmの円形で縁を丸く、脚は4本で少し外に開く。高さ45cm
```

### Claude Desktop など（MCP サーバーを自分で起動するアプリ）

`--stdio` を付けると、アプリがこのサーバーを起動して標準入出力でやり取りします（ビューアーは同じく http://127.0.0.1:8000）。
Claude Desktop なら `claude_desktop_config.json` に次のように書きます。パスは自分の環境に合わせてください。

```json
{
  "mcpServers": {
    "bpy-modeler": {
      "command": "<このフォルダ>/.venv/bin/python",
      "args": ["<このフォルダ>/server.py", "--stdio"]
    }
  }
}
```

Windows では `command` を `<このフォルダ>\\.venv\\Scripts\\python.exe` にします。

## AI が使える道具（MCP ツール）

| ツール | 内容 |
|---|---|
| `run_script` | bpy のスクリプトを空のシーンで実行し、トポロジーの検査結果を返す。結果はビューアーに出て、GLB / FBX / OBJ にも書き出される |
| `render` | 結果を絵にして返す（粘土色の面＋ポリゴンの辺。斜め・正面・横・真上から）。AI が形を目で確かめる |
| `list_runs` | これまでの実行の一覧 |
| `get_script` | 前の実行のスクリプトを取り出す（前の版から作り直すとき） |
| `export` | 書き出したファイルを指定のフォルダにコピーする |

モデリングのルール（四角ポリゴン主体、Z が上、メートル単位など）は、接続したときにサーバーから AI に伝わります（`server.py` の `GUIDE`）。

## トポロジー検査の基準

次のどれかに当てはまると「問題」として AI に返し、直させます（`server.py` の `problems_of()` で変更できます）。

- Nゴン（5角形以上）がある
- 三角ポリゴンが全体の 10% を超える
- 3枚以上の面が共有している辺（非多様体）がある
- となりの面と向きが逆の辺がある／閉じた形なのに法線が内向き
- 同じ位置に重なった頂点がある／面積がほぼゼロの面がある
- 面につながっていない頂点・辺がある
- 面が 30 万枚を超える

開いている辺（穴や板の縁）は、意図した形のこともあるので問題には数えず、オブジェクトごとの数だけを返します。
穴があいていないかは `render` の絵で確かめさせます。

## 起動オプション

| オプション | 既定値 | 内容 |
|---|---|---|
| `--port` | `8000` | ポート（環境変数 `PORT` でも可） |
| `--stdio` | なし | MCP を標準入出力で受ける |
| `--out` | `./output` | 結果の保存先（実行ごとに `runs/0001/` のようなフォルダができる） |
| `--timeout` | `60` | スクリプト1回の制限時間（秒）。macOS / Linux のみ。Windows では効かないので、止まったら Ctrl+C で再起動する |

## 注意

- AI が書いたコードを `exec()` でそのまま実行します。`127.0.0.1` でだけ待ち受けているので、外部には公開しないでください。
- `render` は Cycles（CPU）で描きます。GPU がなくても動きますが、1 視点に 1〜数秒かかります。
- 検査も書き出しも、モディファイアを適用した後の形に対して行います。
- FBX はセンチ単位・Y が上で、頂点に寸法を焼き込んで書き出します。Maya や Unity では、拡大率 1・回転 0 のまま正しい大きさになります。
- 実行の履歴は `output/` に残るので、サーバーを再起動しても続きから使えます。
