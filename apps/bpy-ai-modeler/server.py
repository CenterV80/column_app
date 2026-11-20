"""
bpy モデル生成サーバー

「作りたいもの」を受け取り、
  AI がスクリプトを書く → Blender（GUIなし）で実行 → トポロジーを検査
  → エラーや問題があれば AI に直させる
を自動で繰り返して、四角ポリゴン主体のメッシュを FBX / OBJ / GLB で返す。

起動:  python server.py   →  http://127.0.0.1:8000
"""
import asyncio
import contextlib
import io
import json
import math
import os
import re
import tempfile
import traceback
import urllib.error
import urllib.request
from pathlib import Path

import addon_utils
import bmesh
import bpy
import mathutils
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).parent
OUT = Path(tempfile.mkdtemp(prefix="bpy_modeler_"))
FILES = {"glb": OUT / "model.glb", "fbx": OUT / "model.fbx", "obj": OUT / "model.obj"}
WIRE = OUT / "wire.json"
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "4"))
TRI_LIMIT = 0.10  # 三角ポリゴンの割合がこれを超えたら直させる

app = FastAPI()


# ================================================================ Blender 側

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for mod in ("io_scene_gltf2", "io_scene_fbx"):
        try:
            addon_utils.enable(mod, default_set=True)
        except Exception:
            pass


def run_code(code: str) -> tuple[bool, str]:
    ns = {"__name__": "__gen__", "bpy": bpy, "bmesh": bmesh, "mathutils": mathutils, "math": math}
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<script>", "exec"), ns)
        ok = True
    except Exception:
        buf.write(traceback.format_exc())
        ok = False
    try:  # 編集モードのまま終わっていたら戻す
        obj = bpy.context.view_layer.objects.active
        if obj and obj.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass
    return ok, buf.getvalue()


def inspect() -> dict:
    """モディファイア適用後の見た目でトポロジーを数え、ワイヤー表示用の辺も書き出す。"""
    q = dict(objects=0, verts=0, faces=0, quads=0, tris=0, ngons=0,
             bad_edges=0, boundary_edges=0, loose_verts=0)
    wire: list[float] = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(o.matrix_world)
        q["objects"] += 1
        q["verts"] += len(bm.verts)
        q["faces"] += len(bm.faces)
        for f in bm.faces:
            n = len(f.verts)
            q["tris" if n == 3 else "quads" if n == 4 else "ngons"] += 1
        for e in bm.edges:
            k = len(e.link_faces)
            if k > 2:
                q["bad_edges"] += 1
            elif k == 1:
                q["boundary_edges"] += 1
            if len(wire) < 6 * 300_000:
                for v in e.verts:  # Blender(Z上) → three.js(Y上)
                    wire += (v.co.x, v.co.z, -v.co.y)
        q["loose_verts"] += sum(1 for v in bm.verts if not v.link_edges)
        bm.free()
        ev.to_mesh_clear()
    WIRE.write_text(json.dumps([round(x, 5) for x in wire]))
    return q


def problems_of(q: dict) -> list[str]:
    p = []
    if q["objects"] == 0:
        p.append("メッシュがひとつもない")
    if q["ngons"]:
        p.append(f"Nゴン（5角形以上）が {q['ngons']} 枚ある。四角形に分割する")
    if q["faces"] and q["tris"] / q["faces"] > TRI_LIMIT:
        p.append(f"三角ポリゴンが {q['tris']} 枚（全体の {q['tris'] * 100 // q['faces']}%）ある。できるだけ四角形にする")
    if q["bad_edges"]:
        p.append(f"3枚以上の面が共有している辺が {q['bad_edges']} 本ある（非多様体）")
    if q["loose_verts"]:
        p.append(f"どの辺にもつながっていない頂点が {q['loose_verts']} 個ある")
    return p


def export_all() -> list[str]:
    errs = []
    for f in FILES.values():
        f.unlink(missing_ok=True)
    if not any(o.type == "MESH" for o in bpy.context.scene.objects):
        return errs
    jobs = {
        "glb": lambda p: bpy.ops.export_scene.gltf(filepath=p, export_format="GLB", export_apply=True),
        "fbx": lambda p: bpy.ops.export_scene.fbx(filepath=p, use_mesh_modifiers=True, object_types={"MESH"}),
        "obj": lambda p: bpy.ops.wm.obj_export(filepath=p, apply_modifiers=True, export_materials=False),
    }
    for fmt, fn in jobs.items():
        try:
            fn(str(FILES[fmt]))
        except Exception as e:
            errs.append(f"{fmt.upper()} の書き出しに失敗: {e}")
    return errs


# ================================================================ AI 側

SYSTEM = """あなたは熟練の3Dモデラーです。Blender の bpy で、手作業で丁寧にモデリングしたような
きれいなメッシュを作る Python スクリプトを書きます。

実行環境:
- Blender を GUI なしで動かしている（pip の bpy モジュール）。3D ビューも UI もない
- 毎回まっさらな空シーンから、スクリプト全体を最初から実行する
- bpy, bmesh, mathutils, math は import 済み

トポロジーの品質（最重要）:
- 四角ポリゴン主体にする。Nゴンは作らない。三角形は避けられない箇所（極など）だけ
- エッジの流れを形状に沿わせ、間隔はなるべく均等にする
- サブディビジョンで丸めるなら、角を保ちたい所にサポートエッジループを入れる
- 円柱などのフタは Nゴンにせず、四角形のグリッド状か、少なくとも三角ファンにする
- 法線は外向き、重複頂点なし、孤立頂点なし、非多様体なし
- モディファイア（Subdivision Surface, Mirror, Solidify, Bevel など）は使ってよい。
  書き出し時に適用された形が最終結果になるので、ポリゴン数が膨らみすぎないようにする

書き方:
- コードだけを出力する（説明文なし）。1行目に「# 」で始まる短い日本語の説明を入れる
- メッシュは bmesh か bpy.data で直接組み立てる。bpy.ops は 3D ビューがないと動かないものがあるので、
  使うのはプリミティブ追加・モディファイア・オブジェクトモードの操作程度にとどめる
- 単位はメートルで実寸。Z が上。接地するものは原点を底面の中心に置く
- オブジェクトには分かりやすい名前を付ける。ライト・カメラ・マテリアルは不要
- ファイルの読み書き、ネットワーク、レンダリングはしない
"""


def call_claude(user: str) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("環境変数 ANTHROPIC_API_KEY が設定されていません")
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 8192,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"API エラー {e.code}: {e.read().decode(errors='replace')}") from None
    text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip()


def build_prompt(want: str, base: str | None, prev: str | None,
                 error: str | None, problems: list[str] | None) -> str:
    parts = []
    if base:
        parts.append(f"前回作ったスクリプト（これを元に手直しする）:\n{base}")
    parts.append(f"作りたいもの:\n{want}")
    if prev and error:
        parts.append(f"直前に書いたスクリプト:\n{prev}\n\n実行したら次のエラーになりました。"
                     f"直したスクリプト全体を出してください。\n{error[-3000:]}")
    elif prev and problems:
        parts.append(f"直前に書いたスクリプト:\n{prev}\n\nトポロジー検査で次の問題が見つかりました。"
                     f"形は保ったまま直したスクリプト全体を出してください。\n- " + "\n- ".join(problems))
    return "\n\n".join(parts)


# ================================================================ API

class MakeReq(BaseModel):
    prompt: str
    base_code: str | None = None


def ev(kind: str, **kw) -> str:
    return json.dumps({"type": kind, **kw}, ensure_ascii=False) + "\n"


@app.post("/make")
async def make(req: MakeReq):
    async def steps():
        code = error = None
        problems: list[str] | None = None
        best = None  # これまでで一番よかった結果 (問題数, code, stats, problems)

        for n in range(1, MAX_ATTEMPTS + 1):
            yield ev("status", text=f"{n}回目：AIがスクリプトを書いています…")
            try:
                # 通信だけ別スレッド。bpy は必ずメインスレッドで触る
                code = await asyncio.to_thread(
                    call_claude, build_prompt(req.prompt, req.base_code, code, error, problems))
            except Exception as e:
                yield ev("status", text=f"生成に失敗しました：{e}", level="ng")
                break

            yield ev("status", text="Blender で実行しています…")
            await asyncio.sleep(0)
            reset_scene()
            ok, out = run_code(code)
            if not ok:
                error, problems = out, None
                last = out.strip().splitlines()[-1] if out.strip() else ""
                yield ev("status", text=f"エラーが出ました → 直させます（{last}）", level="warn")
                continue

            error = None
            stats = inspect()
            problems = problems_of(stats)
            score = len(problems)
            if best is None or score <= best[0]:
                best = (score, code, stats, problems)
                export_all()
                yield ev("preview", code=code, stats=stats, problems=problems)

            if not problems:
                yield ev("status", text="トポロジー検査を通りました", level="ok")
                break
            if n < MAX_ATTEMPTS:
                yield ev("status", text="気になる点があるので直させます：" + " / ".join(problems), level="warn")

        if best is None:
            yield ev("done", ok=False, text="形にできませんでした。指示を変えてもう一度試してください")
            return
        # 最後の試行が失敗していたら、一番よかった結果に戻しておく
        score, code, stats, problems = best
        reset_scene()
        run_code(code)
        inspect()
        errs = export_all()
        yield ev("done", ok=True, code=code, stats=stats, problems=problems + errs,
                 text="完成しました" if not problems else "完成しましたが、残っている問題があります")

    return StreamingResponse(steps(), media_type="application/x-ndjson")


@app.get("/file/{fmt}")
async def file(fmt: str):
    f = FILES.get(fmt)
    if not f or not f.exists():
        return Response(status_code=204)
    media = {"glb": "model/gltf-binary", "fbx": "application/octet-stream", "obj": "text/plain"}[fmt]
    return FileResponse(f, media_type=media, filename=f.name, headers={"Cache-Control": "no-store"})


@app.get("/wire.json")
async def wire():
    if not WIRE.exists():
        return JSONResponse([])
    return FileResponse(WIRE, media_type="application/json", headers={"Cache-Control": "no-store"})


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


if __name__ == "__main__":
    reset_scene()
    # 生成されたコードを実行するサーバーなので、自分の PC からだけ受け付ける
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
