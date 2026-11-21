"""
bpy モデラー（ローカルサーバー）

Blender（GUI なし、pip の bpy）をこのプロセスの中で動かし、Claude Code などの AI から
MCP で操作させる。API キーは使わない。AI の利用は、AI を動かしているアプリ側の契約で行う。

  AI がスクリプトを送る → Blender で実行 → トポロジー検査 → 結果を AI に返す
  → AI が結果（数値と画像）を見て直す、を AI 自身が繰り返す

ブラウザのビューアー（three.js）には、AI が実行した結果がそのまま出る。

起動:
  python server.py             ビューアー http://127.0.0.1:8000 と、AI の接続先 http://127.0.0.1:8000/mcp
  python server.py --stdio     Claude Desktop など、MCP サーバーを自分で起動するアプリ向け
                               （ビューアーは同じく http://127.0.0.1:8000）
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import os
import re
import shutil
import signal
import sys
import threading
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ---------------------------------------------------------------- 起動オプション
ap = argparse.ArgumentParser(description="bpy モデラー（AI に操作させるローカルサーバー）")
ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
ap.add_argument("--stdio", action="store_true", help="MCP を標準入出力で受ける（Claude Desktop 向け）")
ap.add_argument("--out", default=os.environ.get("BPY_MODELER_OUT", str(ROOT / "output")), help="結果を保存するフォルダ")
ap.add_argument("--timeout", type=float, default=float(os.environ.get("BPY_MODELER_TIMEOUT", "60")),
                help="スクリプト1回の制限時間（秒、macOS / Linux のみ）")
ARGS = ap.parse_args()

if ARGS.stdio:
    # MCP の通信は標準出力を使う。Blender が標準出力に書くログで通信が壊れないよう、
    # 元の標準出力は MCP 専用に取り分け、以降の出力（Blender の C 側のログを含む）は標準エラーへ流す
    _mcp_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = io.TextIOWrapper(os.fdopen(_mcp_fd, "wb"), encoding="utf-8", write_through=True)

import bpy  # noqa: E402  （addon_utils などは bpy を読み込んだ後でないと import できない）
import addon_utils  # noqa: E402
import bmesh  # noqa: E402
import mathutils  # noqa: E402
import uvicorn  # noqa: E402
from mcp.server.mcpserver import Image, MCPServer  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import FileResponse, JSONResponse, Response  # noqa: E402
from starlette.routing import Route  # noqa: E402

OUT = Path(ARGS.out).resolve()
RUNS_DIR = OUT / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
FORMATS = ("glb", "fbx", "obj")
TRI_LIMIT = 0.10      # 三角ポリゴンの割合がこれを超えたら問題として返す
FACE_LIMIT = 300_000  # 面がこれより多ければ問題として返す

RUNS: list[dict] = []      # 実行の履歴（新しいものが後ろ）
STATE = {"scene_run": None}  # いまシーンに入っている実行の番号
LOCK = threading.Lock()


# ================================================================ Blender 側

def log(*a) -> None:
    print(*a, file=sys.stderr, flush=True)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for mod in ("io_scene_gltf2", "io_scene_fbx"):
        try:
            addon_utils.enable(mod, default_set=True)
        except Exception:
            pass


class ScriptTimeout(Exception):
    pass


def run_code(code: str) -> tuple[bool, str]:
    """スクリプトを実行し、(成功したか, 出力とエラー) を返す"""
    ns = {"__name__": "__gen__", "bpy": bpy, "bmesh": bmesh, "mathutils": mathutils, "math": math}
    buf = io.StringIO()
    use_alarm = hasattr(signal, "setitimer") and threading.current_thread() is threading.main_thread() and ARGS.timeout > 0
    if use_alarm:
        def on_alarm(*_):
            raise ScriptTimeout(f"{ARGS.timeout:g} 秒たっても終わらないので止めました（無限ループや重すぎる処理の可能性）")
        old = signal.signal(signal.SIGALRM, on_alarm)
        signal.setitimer(signal.ITIMER_REAL, ARGS.timeout)
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<script>", "exec"), ns)
        ok = True
    except BaseException as e:  # noqa: BLE001  SystemExit なども AI に返す
        if isinstance(e, KeyboardInterrupt):
            raise
        buf.write(traceback.format_exc())
        ok = False
    finally:
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old)
    try:  # 編集モードのまま終わっていたら戻す
        obj = bpy.context.view_layer.objects.active
        if obj and obj.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass
    return ok, buf.getvalue()


def inspect_scene() -> tuple[dict, list[dict], list[float]]:
    """モディファイア適用後の見た目でトポロジーを数える。(合計, オブジェクトごと, ワイヤー用の辺)"""
    keys = ("verts", "faces", "quads", "tris", "ngons", "bad_edges", "flipped_edges", "boundary_edges",
            "loose_verts", "loose_edges", "dup_verts", "degenerate", "inward")
    total = dict(objects=0, **{k: 0 for k in keys})
    per: list[dict] = []
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
        q = {k: 0 for k in keys}
        q["name"] = o.name
        q["verts"] = len(bm.verts)
        q["faces"] = len(bm.faces)
        size = max((max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts)) for i in range(3)) if bm.verts else 1.0
        eps = max(size, 1e-6) * 1e-5
        for f in bm.faces:
            n = len(f.verts)
            q["tris" if n == 3 else "quads" if n == 4 else "ngons"] += 1
            if f.calc_area() < eps * eps:
                q["degenerate"] += 1
        for e in bm.edges:
            k = len(e.link_faces)
            if k > 2:
                q["bad_edges"] += 1
            elif k == 1:
                q["boundary_edges"] += 1
            elif k == 0:
                q["loose_edges"] += 1
            elif e.link_loops[0].vert == e.link_loops[1].vert:
                q["flipped_edges"] += 1  # となりの面と回り方が同じ ＝ 片方が裏返っている
            if len(wire) < 6 * 400_000:
                for v in e.verts:  # Blender(Z 上) → three.js(Y 上)
                    wire += (v.co.x, v.co.z, -v.co.y)
        q["loose_verts"] = sum(1 for v in bm.verts if not v.link_edges)
        if bm.verts:
            doubles = bmesh.ops.find_doubles(bm, verts=bm.verts, dist=eps)["targetmap"]
            q["dup_verts"] = len(doubles)
        closed = bm.faces and not q["boundary_edges"] and not q["bad_edges"] and not q["flipped_edges"]
        if closed and bm.calc_volume(signed=True) < 0:
            q["inward"] = 1  # 閉じているのに体積が負 ＝ 法線が内向き
        bm.free()
        ev.to_mesh_clear()
        total["objects"] += 1
        for k in keys:
            total[k] += q[k]
        per.append(q)
    return total, per, wire


def problems_of(q: dict, per: list[dict]) -> list[str]:
    def where(key: str) -> str:
        names = [p["name"] for p in per if p[key]]
        return f"（{', '.join(names[:6])}{' ほか' if len(names) > 6 else ''}）" if names else ""

    p = []
    if q["objects"] == 0 or q["faces"] == 0:
        p.append("メッシュがひとつもない")
    if q["ngons"]:
        p.append(f"Nゴン（5角形以上）が {q['ngons']} 枚ある{where('ngons')}。四角形に分割する")
    if q["faces"] and q["tris"] / q["faces"] > TRI_LIMIT:
        p.append(f"三角ポリゴンが {q['tris']} 枚（全体の {q['tris'] * 100 // q['faces']}%）ある{where('tris')}。できるだけ四角形にする")
    if q["bad_edges"]:
        p.append(f"3枚以上の面が共有している辺（非多様体）が {q['bad_edges']} 本ある{where('bad_edges')}")
    if q["flipped_edges"]:
        p.append(f"となりの面と向きが逆になっている辺が {q['flipped_edges']} 本ある{where('flipped_edges')}。"
                 "bmesh.ops.recalc_face_normals で向きをそろえる")
    if q["inward"]:
        p.append(f"法線が内向きのオブジェクトがある{where('inward')}。bmesh.ops.recalc_face_normals か面の反転で外向きにする")
    if q["dup_verts"]:
        p.append(f"同じ位置に重なった頂点が {q['dup_verts']} 個ある{where('dup_verts')}。共有するか bmesh.ops.remove_doubles でまとめる")
    if q["degenerate"]:
        p.append(f"面積がほぼゼロのつぶれた面が {q['degenerate']} 枚ある{where('degenerate')}")
    if q["loose_verts"] or q["loose_edges"]:
        p.append(f"面につながっていない頂点 {q['loose_verts']} 個・辺 {q['loose_edges']} 本がある"
                 f"{where('loose_verts') or where('loose_edges')}")
    if q["faces"] > FACE_LIMIT:
        p.append(f"面が {q['faces']:,} 枚と多すぎる。{FACE_LIMIT:,} 枚以下にする（サブディビジョンのレベルを下げる）")
    return p


def export_all(folder: Path) -> list[str]:
    errs = []
    if not any(o.type == "MESH" for o in bpy.context.scene.objects):
        return errs
    jobs = {
        "glb": lambda p: bpy.ops.export_scene.gltf(filepath=p, export_format="GLB", export_apply=True),
        # センチ単位で頂点に焼き込み、Maya / Unity で拡大率 1・回転 0 のまま正しい大きさになるようにする
        "fbx": lambda p: bpy.ops.export_scene.fbx(filepath=p, use_mesh_modifiers=True, object_types={"MESH"},
                                                  apply_scale_options="FBX_SCALE_NONE", apply_unit_scale=True,
                                                  bake_space_transform=True,
                                                  add_leaf_bones=False, bake_anim=False),
        "obj": lambda p: bpy.ops.wm.obj_export(filepath=p, apply_modifiers=True, export_materials=False),
    }
    for fmt, fn in jobs.items():
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                fn(str(folder / f"model.{fmt}"))
        except Exception as e:
            errs.append(f"{fmt.upper()} の書き出しに失敗: {e}")
    return errs


# ---------------------------------------------------------------- 画像（AI が形を目で確かめる用）

VIEWS = {  # 視線の向き（カメラ → 被写体）
    "persp": (-1.0, 1.25, -0.8),
    "front": (0.0, 1.0, 0.0),
    "side": (-1.0, 0.0, 0.0),
    "top": (0.0, 0.0, -1.0),
}


def _use_nodes(idblock) -> None:
    """Blender 5 では use_nodes が非推奨（常に有効）。古い版のために、あるときだけ設定する"""
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        if hasattr(idblock, "use_nodes"):
            idblock.use_nodes = True


def render_views(views: list[str], size: int) -> bytes:
    """Cycles（CPU）で粘土色＋ワイヤーの絵を描き、PNG のバイト列を返す。複数の視点は横に並べる"""
    import numpy as np

    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("シーンにメッシュがありません")
    temp: list = []
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        pts += [o.matrix_world @ v.co for v in ev.data.vertices]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 1e-3)

    def material(name, color, rough=0.6):
        m = bpy.data.materials.new(name)
        _use_nodes(m)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = rough
        temp.append(m)
        return m

    clay, edge = material("_clay", (0.62, 0.64, 0.68)), material("_edge", (0.03, 0.035, 0.045), 0.9)
    old_mats = {}
    for o in meshes:  # 本体は粘土色に、辺はワイヤーフレームの複製で描く
        old_mats[o.name] = [s.material for s in o.material_slots]
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = clay
        wm = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        wo = bpy.data.objects.new("_wire", wm)
        wo.matrix_world = o.matrix_world
        sc.collection.objects.link(wo)
        mod = wo.modifiers.new("w", "WIREFRAME")
        mod.thickness = radius * 3.2 / size  # 画面上でおよそ 1.5 ピクセル
        mod.use_replace = True
        mod.use_even_offset = False
        wm.materials.clear()
        wm.materials.append(edge)
        temp += [wo, wm]
    world = bpy.data.worlds.new("_world")
    _use_nodes(world)
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.22, 0.23, 0.26, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sun_d = bpy.data.lights.new("_sun", "SUN")
    sun_d.energy = 3.0
    sun = bpy.data.objects.new("_sun", sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam_d = bpy.data.cameras.new("_cam")
    cam_d.lens = 50
    cam = bpy.data.objects.new("_cam", cam_d)
    sc.collection.objects.link(cam)
    temp += [world, sun, sun_d, cam, cam_d]
    old = (sc.world, sc.camera, sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath)
    sc.world, sc.camera = world, cam
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 12
    sc.cycles.use_denoising = False
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = False
    tiles = []
    tmp = OUT / "_render.png"
    try:
        for name in views:
            d = mathutils.Vector(VIEWS[name]).normalized()
            dist = radius / math.tan(cam_d.angle / 2) * 1.15
            cam.location = center - d * dist
            # 真上からは向きが決まらないので、画面の上が +Y（奥）になるよう直接指定する
            cam.rotation_euler = (0, 0, 0) if name == "top" else d.to_track_quat("-Z", "Y").to_euler()
            cam_d.clip_start, cam_d.clip_end = dist / 100, dist * 10
            sc.render.filepath = str(tmp)
            with contextlib.redirect_stdout(io.StringIO()):
                bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(str(tmp))
            arr = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
            bpy.data.images.remove(img)
            tiles.append(arr)
    finally:
        sc.world, sc.camera, sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath = old
        for o in meshes:
            if o.name in old_mats:
                mats = old_mats[o.name]
                o.material_slots[0].link = "DATA"
                if not mats:
                    o.data.materials.clear()
        for t in temp:
            coll = {bpy.types.Object: bpy.data.objects, bpy.types.Mesh: bpy.data.meshes, bpy.types.Material: bpy.data.materials,
                    bpy.types.World: bpy.data.worlds, bpy.types.Camera: bpy.data.cameras}.get(type(t))
            if coll is None and isinstance(t, bpy.types.Light):
                coll = bpy.data.lights
            with contextlib.suppress(Exception):
                coll.remove(t)
    # 横に並べて1枚の PNG にする（pixels は下から上の順）
    sheet = np.concatenate(tiles, axis=1)
    h, w = sheet.shape[:2]
    out = bpy.data.images.new("_sheet", w, h, alpha=False)
    out.pixels = sheet.ravel()
    out.filepath_raw = str(tmp)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    data = tmp.read_bytes()
    tmp.unlink(missing_ok=True)
    return data


# ================================================================ 実行の記録

def first_comment(code: str) -> str:
    for line in code.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()[:60]
        if s:
            break
    return ""


def load_runs() -> None:
    for d in sorted(RUNS_DIR.iterdir(), key=lambda p: p.name):
        meta = d / "meta.json"
        if meta.exists():
            with contextlib.suppress(Exception):
                RUNS.append(json.loads(meta.read_text(encoding="utf-8")))
    RUNS.sort(key=lambda r: r["id"])


def get_run(run_id: int | None, ok_only: bool = True) -> dict | None:
    if run_id is None:
        cands = [r for r in RUNS if r["ok"] or not ok_only]
        return cands[-1] if cands else None
    return next((r for r in RUNS if r["id"] == run_id), None)


def ensure_scene(run: dict) -> None:
    """指定の実行の結果がシーンに入っていなければ、スクリプトを実行し直して作る"""
    if STATE["scene_run"] == run["id"]:
        return
    reset_scene()
    ok, _ = run_code((RUNS_DIR / f"{run['id']:04d}" / "script.py").read_text(encoding="utf-8"))
    STATE["scene_run"] = run["id"] if ok else None
    if not ok:
        raise RuntimeError(f"実行 {run['id']} を作り直せませんでした")


def execute(code: str, title: str) -> dict:
    with LOCK:
        run_id = (RUNS[-1]["id"] + 1) if RUNS else 1
        folder = RUNS_DIR / f"{run_id:04d}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "script.py").write_text(code, encoding="utf-8")
        t0 = time.time()
        reset_scene()
        ok, out = run_code(code)
        STATE["scene_run"] = None
        run = {"id": run_id, "title": title or first_comment(code) or f"実行 {run_id}", "time": time.strftime("%Y-%m-%d %H:%M:%S"),
               "ok": ok, "output": out[-6000:], "stats": None, "objects": [], "problems": [], "files": []}
        if ok:
            stats, per, wire = inspect_scene()
            (folder / "wire.json").write_text(json.dumps([round(x, 5) for x in wire]), encoding="utf-8")
            errs = export_all(folder)
            run.update(stats=stats, objects=per, problems=problems_of(stats, per) + errs,
                       files=[f for f in FORMATS if (folder / f"model.{f}").exists()])
            STATE["scene_run"] = run_id
        run["seconds"] = round(time.time() - t0, 2)
        (folder / "meta.json").write_text(json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
        RUNS.append(run)
        log(f"[run {run_id}] {'OK' if ok else 'ERROR'} {run['title']}")
        return run


def report(run: dict) -> str:
    lines = [f"実行 {run['id']}「{run['title']}」: {'成功' if run['ok'] else 'エラー'}（{run['seconds']} 秒）"]
    if not run["ok"]:
        lines += ["", "エラー:", run["output"].strip()[-3000:]]
        lines += ["", "直したスクリプト全体を run_script でもう一度実行してください。"]
        return "\n".join(lines)
    s = run["stats"]
    pct = s["quads"] * 100 // s["faces"] if s["faces"] else 0
    lines += ["",
              f"合計: オブジェクト {s['objects']} / 頂点 {s['verts']:,} / 面 {s['faces']:,}"
              f"（四角形 {s['quads']:,} = {pct}%、三角形 {s['tris']:,}、Nゴン {s['ngons']:,}）",
              f"開いている辺 {s['boundary_edges']:,}（穴や板状の部品の縁。意図したものなら問題ない）",
              "", "オブジェクトごと:"]
    for o in run["objects"][:40]:
        extra = [f"{label} {o[k]}" for k, label in (("ngons", "Nゴン"), ("bad_edges", "非多様体"), ("flipped_edges", "逆向きの辺"),
                                                    ("inward", "内向き"), ("dup_verts", "重複頂点"), ("degenerate", "つぶれた面"),
                                                    ("loose_verts", "孤立頂点")) if o[k]]
        if o["boundary_edges"]:
            extra.append(f"開いている辺 {o['boundary_edges']}")
        lines.append(f"- {o['name']}: 面 {o['faces']:,}（四角 {o['quads']:,} / 三角 {o['tris']:,}）" + (f" ⚠ {'、'.join(extra)}" if extra else ""))
    if len(run["objects"]) > 40:
        lines.append(f"- ほか {len(run['objects']) - 40} 個")
    if run["output"].strip():
        lines += ["", "print の出力:", run["output"].strip()[-1500:]]
    if run["problems"]:
        lines += ["", "検査で見つかった問題（形は保ったまま直してください）:"] + [f"- {p}" for p in run["problems"]]
    else:
        lines += ["", "トポロジー検査を通りました。"]
    lines += ["", f"ビューアー: http://127.0.0.1:{ARGS.port} に表示しています。形を目で確かめるには render を使ってください。"]
    return "\n".join(lines)


# ================================================================ MCP（AI の操作口）

GUIDE = """Blender（GUI なし）でメッシュを作るツールです。手作業で丁寧にモデリングしたような、
四角ポリゴン主体のきれいなメッシュを、bpy の Python スクリプトで作ってください。

進め方:
1. run_script にスクリプト全体を渡して実行する（毎回まっさらな空のシーンから実行される）
2. 返ってくるトポロジーの検査結果を読み、問題があれば形を保ったまま直して、スクリプト全体をもう一度実行する
3. render で絵を見て、頼まれた形になっているかを確かめる。違えば直す
4. 問題がなくなったら、ユーザーに結果を伝える。保存先を頼まれたら export を使う

実行環境:
- bpy, bmesh, mathutils, math は import 済み。3D ビューや UI はない
- 単位はメートルで実寸。Z が上。接地するものは原点を底面の中心に置く
- メッシュは bmesh か bpy.data で直接組み立てる。bpy.ops は 3D ビューがないと動かないものがあるので、
  プリミティブ追加・モディファイア・オブジェクトモードの操作程度にとどめる
- オブジェクトには分かりやすい英語の名前を付ける。ライト・カメラ・マテリアルは不要
- ファイルの読み書き、ネットワーク、レンダリングはしない（書き出しはサーバーが自動で行う）

トポロジーの品質（最重要）:
- 四角ポリゴン主体にする。Nゴンは作らない。三角形は避けられない箇所（極など）だけ（全体の 10% 未満）
- エッジの流れを形状に沿わせ、間隔はなるべく均等にする
- サブディビジョンで丸めるなら、角を保ちたい所にサポートエッジループを入れる
- 円柱などのフタは Nゴンにせず、四角形のグリッド状か、少なくとも三角ファンにする
- 法線は外向き、重複頂点なし、孤立頂点なし、非多様体なし
- モディファイア（Subdivision Surface, Mirror, Solidify, Bevel など）は使ってよい。
  書き出し時に適用された形が最終結果になるので、面数が膨らみすぎないようにする（目安は合計 5 万面まで）"""

mcp = MCPServer("bpy-modeler", instructions=GUIDE)


@mcp.tool(structured_output=False)
async def run_script(code: str, title: str = "") -> str:
    """bpy の Python スクリプトを、まっさらな空のシーンで実行し、トポロジーの検査結果を返す。
    結果はビューアーに表示され、GLB / FBX / OBJ にも自動で書き出される。
    code: スクリプト全体（bpy, bmesh, mathutils, math は import 済み。Z が上、メートル単位）
    title: この実行の短い説明（省略時はスクリプト1行目のコメント）"""
    return report(execute(code, title))


@mcp.tool(structured_output=False)
async def render(views: list[str] | None = None, size: int = 384, run: int | None = None) -> list:
    """結果を絵にして見る（粘土色の面に、黒い線でポリゴンの辺を描いたもの）。
    views: "persp"（斜め前）, "front"（正面 -Y 側から）, "side"（右 +X 側から）, "top"（真上）から選ぶ。
           省略時は ["persp", "front", "side"]。複数なら横に並べる
    size: 1視点あたりの大きさ（128〜768 ピクセル）
    run: 何番目の実行を描くか（省略時は最後に成功した実行）"""
    views = views or ["persp", "front", "side"]
    bad = [v for v in views if v not in VIEWS]
    if bad:
        return [f"views に使えるのは {', '.join(VIEWS)} です（{', '.join(bad)} は使えません）"]
    with LOCK:
        target = get_run(run)
        if not target or not target["ok"]:
            return ["描ける実行がありません。先に run_script で形を作ってください"]
        ensure_scene(target)
        png = render_views(views[:4], max(128, min(int(size), 768)))
    return [f"実行 {target['id']}「{target['title']}」: 左から {', '.join(views[:4])}", Image(data=png, format="png")]


@mcp.tool(structured_output=False)
async def list_runs(limit: int = 20) -> str:
    """これまでの実行の一覧（番号・説明・成否・面数・問題の数）"""
    if not RUNS:
        return "まだ実行がありません"
    rows = []
    for r in RUNS[-limit:]:
        s = r["stats"] or {}
        state = "OK" if r["ok"] and not r["problems"] else ("問題あり" if r["ok"] else "エラー")
        rows.append(f"{r['id']}: {r['title']} ／ {state} ／ 面 {s.get('faces', '-')} ／ {r['time']}")
    return "\n".join(rows)


@mcp.tool(structured_output=False)
async def get_script(run: int | None = None) -> str:
    """指定した実行のスクリプトを返す（省略時は最後に成功した実行）。前の版から作り直すときに使う"""
    r = get_run(run, ok_only=run is None)
    if not r:
        return "その実行は見つかりません"
    return (RUNS_DIR / f"{r['id']:04d}" / "script.py").read_text(encoding="utf-8")


@mcp.tool(structured_output=False)
async def export(directory: str, name: str = "model", formats: list[str] | None = None, run: int | None = None) -> str:
    """書き出したファイルを指定のフォルダにコピーする（ユーザーに保存先を頼まれたとき）。
    directory: 保存先のフォルダ（なければ作る）
    name: ファイル名（拡張子なし）
    formats: "fbx", "obj", "glb" から選ぶ（省略時はすべて）
    run: 何番目の実行か（省略時は最後に成功した実行）"""
    r = get_run(run)
    if not r or not r["ok"]:
        return "書き出せる実行がありません"
    formats = formats or list(FORMATS)
    safe = re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "model"
    dest = Path(directory).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    done = []
    for f in formats:
        src = RUNS_DIR / f"{r['id']:04d}" / f"model.{f}"
        if src.exists():
            shutil.copyfile(src, dest / f"{safe}.{f}")
            done.append(str(dest / f"{safe}.{f}"))
    return "保存しました:\n" + "\n".join(done) if done else "該当するファイルがありません"


# ================================================================ ビューアー（ブラウザ）

def run_public(r: dict) -> dict:
    return {k: r[k] for k in ("id", "title", "time", "ok", "stats", "problems", "files", "seconds")}


async def page_index(_: Request):
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-store"})


async def api_runs(_: Request):
    return JSONResponse({"runs": [run_public(r) for r in RUNS], "port": ARGS.port, "stdio": ARGS.stdio},
                        headers={"Cache-Control": "no-store"})


async def api_run(req: Request):
    r = get_run(int(req.path_params["run_id"]), ok_only=False)
    if not r:
        return Response(status_code=404)
    code = (RUNS_DIR / f"{r['id']:04d}" / "script.py").read_text(encoding="utf-8")
    return JSONResponse({**r, "code": code, "report": report(r)}, headers={"Cache-Control": "no-store"})


async def api_file(req: Request):
    run_id, name = int(req.path_params["run_id"]), req.path_params["name"]
    if name not in ("wire.json", *(f"model.{f}" for f in FORMATS)):
        return Response(status_code=404)
    f = RUNS_DIR / f"{run_id:04d}" / name
    if not f.exists():
        return Response(status_code=404)
    media = {"glb": "model/gltf-binary", "fbx": "application/octet-stream", "obj": "text/plain", "json": "application/json"}
    download = name.endswith((".fbx", ".obj"))
    return FileResponse(f, media_type=media[name.rsplit(".", 1)[1]], filename=f"run{run_id:04d}_{name}" if download else None,
                        headers={"Cache-Control": "no-store"})


VIEW_ROUTES = [
    ("/", page_index),
    ("/api/runs", api_runs),
    ("/api/runs/{run_id:int}", api_run),
    ("/api/runs/{run_id:int}/{name}", api_file),
]


def main() -> None:
    load_runs()
    reset_scene()
    url = f"http://127.0.0.1:{ARGS.port}"
    if ARGS.stdio:
        # ビューアーは別スレッドで動かす（ファイルを配るだけで Blender には触れない）
        viewer = Starlette(routes=[Route(p, fn) for p, fn in VIEW_ROUTES])
        cfg = uvicorn.Config(viewer, host="127.0.0.1", port=ARGS.port, log_level="warning")
        threading.Thread(target=uvicorn.Server(cfg).run, daemon=True).start()
        log(f"bpy モデラー（stdio）: ビューアー {url}")
        mcp.run("stdio")  # Blender はメインスレッドで動く
    else:
        for p, fn in VIEW_ROUTES:
            mcp.custom_route(p, ["GET"])(fn)
        app = mcp.streamable_http_app(host="127.0.0.1")
        log(f"bpy モデラー: ビューアー {url} ／ AI の接続先 {url}/mcp")
        # 生成されたコードを実行するサーバーなので、自分の PC からだけ受け付ける
        uvicorn.run(app, host="127.0.0.1", port=ARGS.port, log_level="warning")


if __name__ == "__main__":
    main()
