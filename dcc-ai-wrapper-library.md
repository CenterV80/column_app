# AIにDCCを操作させるなら「ラッパー」を作る（Blender bpy / Maya）

*公開: 2026-11-21*

<a href="dcc-ai-wrapper-library.md" download>📥 この記事をMarkdown（.md）でダウンロード</a>

## 要点

- AIにBlenderやMayaでモデリングさせるとき、**生のAPIをそのまま書かせるより、よく使う操作をまとめた「ラッパー」を用意する**ほうが速く、トークンも少なく済む
- ラッパーは特別な仕組みではなく、**既存のAPIを内側で呼んで、外側に使いやすい形を見せる関数**のこと。作り方は普通の関数と同じ
- 関数が増えたら、1つずつAPIやMCPツールにせず、**登録用のデコレーター＋1つの窓口**で名前から呼べるようにする
- Mayaでは、ラッパーをMaya側に常駐させ、**MCPは既存のものを使う**だけで十分なことが多い
- AIはラッパーの存在を自動では知らない。**「ラッパーがある」「`help()`で調べられる」の2点だけ**をAIに伝え、詳細は必要なときに引かせる

---

## bpyとは

**bpy**は、BlenderをPythonから操作するための公式APIです。UIでできることはほぼすべてスクリプトで実行できます。Houdiniの`hou`モジュールに近い位置づけです。

| モジュール | 役割 |
| --- | --- |
| `bpy.data` | シーン内のデータ（オブジェクト、メッシュ、マテリアルなど）に直接アクセスする |
| `bpy.context` | 選択中のオブジェクトなど「今の状態」を取得する |
| `bpy.ops` | UIの操作（オペレーター）を呼ぶ。手軽だがコンテキストに依存して壊れやすく、遅い |
| `bpy.types` | パネルやオペレーターなどのクラス定義。アドオン作成で使う |
| `bmesh` | 頂点・エッジ・面を細かく編集する別モジュール |

### ライセンスの注意

- Blender（bpyを含む）は**GNU GPL**
- Blenderで作ったもの（.blend、モデル、レンダー画像）は作った人のもの。自作スクリプトを使って作ったものも同じ扱い
- bpyを呼ぶスクリプトやアドオンを**公開・配布する場合はGPLにする必要がある**。販売はできるが、買った人もGPLで受け取る
- 公式のExtensionsプラットフォームでは、アドオンは**GPL v3.0以降**が必須
- 社内だけで使い、外部に配布しないツールなら、実務上はほとんど問題にならない（判断に迷う場合は法務に確認）

---

## なぜラッパーが効くのか

生のbpyをAIに書かせると、次のような問題が出やすくなります。

- 記述が長い（メッシュ作成、シーンへのリンク、マテリアル設定など）
- `bpy.ops`は遅く、コンテキスト由来のエラーで往復が増える

そこで、よく使う操作を短い関数にまとめておきます。AIは**関数の一覧だけ**を見て、呼び出しコードを数行書くだけで済みます。

### 設計のルール

- 関数名と引数は短く、デフォルト値を多めにする（`box(2,1,1)`だけで動く）
- 中身は`bpy.data`とbmeshで書き、`bpy.ops`はなるべく使わない
- 戻り値はオブジェクト名（文字列）に統一し、次の操作につなげやすくする
- 失敗したら短いエラーメッセージを返し、AIが自分で直せるようにする

### 最小のラッパー例

```python
import bpy, bmesh

def _obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob.name

def box(sx=1, sy=1, sz=1, at=(0,0,0), name="box"):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx,sy,sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=at, verts=bm.verts)
    return _obj(name, bm)

def cyl(r=0.5, h=1, seg=32, at=(0,0,0), name="cyl"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg,
        radius1=r, radius2=r, depth=h)
    bmesh.ops.translate(bm, vec=at, verts=bm.verts)
    return _obj(name, bm)

def _mod(o, t, **kw):
    m = bpy.data.objects[o].modifiers.new(t, t)
    for k, v in kw.items(): setattr(m, k, v)
    return o

def bevel(o, w=0.05, seg=3): return _mod(o, "BEVEL", width=w, segments=seg)
def array(o, n=3, off=(1.2,0,0)): return _mod(o, "ARRAY", count=n, relative_offset_displace=off)

def cut(o, tool):
    _mod(o, "BOOLEAN", object=bpy.data.objects[tool], operation="DIFFERENCE")
    t = bpy.data.objects[tool]
    t.hide_render = t.hide_viewport = True
    return o

def mat(o, rgb=(.8,.8,.8), rough=.5):
    m = bpy.data.materials.new(o + "_m"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    bpy.data.objects[o].data.materials.append(m)
    return o

def clear():
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
```

AIに渡すのは、シグネチャと1行説明だけです。

```
box(sx,sy,sz,at) / cyl(r,h,seg,at) / bevel(o,w,seg)
array(o,n,off) / cut(o,tool) / mat(o,rgb,rough) / clear()
全部オブジェクト名を返す
```

これでAIの出力はここまで短くなります。

```python
clear()
b = bevel(box(2,1,0.3), 0.03)
cut(b, cyl(0.2, 1, at=(0.5,0,0)))
mat(b, (.2,.3,.8))
```

### 「ただの関数化」では？

技術的には、その通りただの関数です。「ラッパー」は仕組みの名前ではなく、**役割の呼び方**です。`box()`は中でbmeshを何度も呼んでいますが、使う側からは1行に見えます。この「包んでいる」状態をラッパーと呼びます。

### 育て方

AIが生のAPIで書いてしまった処理や、何度も出てくるパターンを見つけたら、関数として追加していきます。レンダー（`render(path)`）やエクスポート（`export(path)`）も入れておくと、「生成 → 画像で確認 → 修正」のループを回しやすくなります。

---

## 大量の関数をAPIで呼べるようにする

関数を1つずつエンドポイントにするのではなく、**デコレーターで自動登録して、1つの窓口から名前で呼ぶ**のが定番です。

```python
# registry.py
import inspect
FUNCS = {}
def api(f):
    FUNCS[f.__name__] = f
    return f

def spec():
    return {n: {"args": str(inspect.signature(f)),
                "doc": (f.__doc__ or "").strip()}
            for n, f in FUNCS.items()}
```

```python
# m.py（ラッパー側には @api を付けるだけ）
from registry import api

@api
def box(sx=1, sy=1, sz=1, at=(0,0,0), name="box"):
    "直方体を作る"
    ...
```

```python
# server.py（pipのbpy＋FastAPIの例）
from fastapi import FastAPI
from registry import FUNCS, spec
import m  # importした時点で関数が登録される

app = FastAPI()

@app.get("/functions")
def functions():
    return spec()

@app.post("/call")
def call(req: dict):
    try:
        return {"ok": True, "result": FUNCS[req["fn"]](**req.get("args", {}))}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
```

呼び出しは`{"fn": "box", "args": {"sx": 2}}`の形です。関数を増やしても、サーバー側は変更不要です。

### AIから使うときの注意

- **関数を1つずつMCPツールにしない**。ツールが増えると、スキーマだけで大量のトークンを使う
- ツールは`list_functions`（一覧）、`call`（1回の呼び出し）、`run`（ラッパーを使った短いスクリプトをまとめて実行）程度に絞る。`run`があると往復が減る
- 一覧が長くなったら、`list_functions("modifier")`のようにカテゴリで絞る

### bpy側の注意

- bpyはスレッドセーフではない。リクエストは1つずつ順番に処理する
- GUIのBlenderの中でサーバーを動かす場合は、処理をキューに入れ、`bpy.app.timers`でメインスレッドから実行する

---

## Mayaの場合

考え方は同じですが、事情が少し違います。

- `maya.cmds`はもともと高レベルで短く書けて、LLMもよく知っている。汎用的な操作をラップしても得は小さい
- 効果が大きいのは次の2つ
  - **チーム固有の処理**：命名規則、階層構造、リグ設定、エクスポート手順、プロジェクトのパスなど。AIは知らないので、毎回説明するか間違えるかになる
  - **重い・長い処理**：頂点単位の処理はOpenMaya API 2.0のほうが速いが、コードが長い。ここをラップすると速度とトークンの両方で得をする

### 毎回AIに関数を書かせる方式との違い

AIに毎回関数ごと書かせてMCPで送る方式では、関数本体の出力トークンと、書くたびに入るバグの修正の往復が毎回かかります。ラッパーをMaya側に常駐させておけば（`userSetup.py`やPYTHONPATHで読み込む）、AIは呼び出し部分の数行を送るだけです。

進め方の例です。

1. AIに作らせた関数のうち、何度も出てくるもの・正しく動いたものをライブラリに昇格させる
2. MCPのツールは`list_functions`と`run(script)`程度に絞る
3. 単発の処理は、これまで通りAIに生のスクリプトを書かせる

ラッパーは「個別ツール群」、MCPはAIがそれを束ねる層、という分担になります。

### Maya MCPは自作が必要？

必ずしも必要ありません。既存のMaya MCPの多くはPythonを実行するツールを持っているので、ラッパーをMaya側に読み込んでおけば、AIは`import studio_lib as s; s.box(...)`のような短いコードを送るだけで済みます。

- **chadrik版 maya-mcp-server**：起動中のMayaセッションを見つけて接続し、Pythonの実行や再利用できる仮想Pythonモジュールの作成ができる。ラッパーの考え方に近い
- **PatrickPalmer版 MayaMCP**：Pythonファイルを追加するだけで操作を増やせる。ただし関数がそのままツールになるので、数が増えるとツール定義のトークンが増える

自作を考えるのは、次のような場合です。

- セキュリティ要件で、実行できる操作を制限したい（任意コードの実行を禁止するなど）
- ラッパーに合わせた専用のツール構成にしたい
- 社内パイプラインと連携させたい

MCPサーバー自体は「コマンドポートにコードを送って結果を返す」だけの薄いものなので、自作しても小さく済みます。まず既存MCP＋ラッパーで検証し、足りない部分が見えてから自作に切り替えるのが効率的です。

---

## AIにラッパーの存在を知らせる

AIが知っているのは、会話のコンテキストに入っている情報だけです。ラッパーを置いただけでは、AIは生の`maya.cmds`や`bpy`を書き始めます。伝え方は主に4つあります。

| 方法 | 特徴 |
| --- | --- |
| 指示ファイル（`CLAUDE.md`やプロジェクトの指示） | 毎回自動で読まれる。関数が増えるとその分トークンも増える |
| スキル（SKILL.md） | 該当する作業のときだけ読み込まれる |
| MCPツールの説明文 | 「`studio_lib`が読み込み済み。`s.help()`で一覧を取得できる」と1行書く |
| 一覧を返す関数 | `help(category)`でdocstringから一覧を自動生成し、AIが必要なときに引く |

**おすすめの組み合わせ**は、指示ファイルかツールの説明文に「ラッパーがある」「`help()`で調べられる」の2点だけを書き、詳細は`help()`で必要な分だけ取得させる形です。関数が何百個に増えても、常にコンテキストに入るのは数行で済みます。
