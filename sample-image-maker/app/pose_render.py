"""棒人間データをimg2img入力用の画像に変換する。

編集用エディタ(視認性重視の配色)とは別に、黒背景+関節ごとに色分けした
パレットで再描画してからimg2imgの初期画像として渡す。配色はControlNet
構成時代の名残でOpenPose標準配色風にしているが、img2imgでは配色自体に
モデル側の意味はなく、単に骨格線・関節点を視覚的に判別しやすくするための
ものに過ぎない(技術仕様書5.3節参照)。
"""
from __future__ import annotations

from typing import Dict

from PIL import Image, ImageDraw

from .pose_data import CANVAS_HEIGHT, CANVAS_WIDTH, JOINT_NAMES, SKELETON

# OpenPose系実装で広く使われる配色(BODY_25/COCO)を、本プロジェクトの
# 13本の骨格接続 + 14関節に割り当てたもの。
_PALETTE = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0),
    (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85),
    (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255),
    (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255),
    (255, 0, 170), (255, 0, 85),
]

LIMB_COLORS = [_PALETTE[i % len(_PALETTE)] for i in range(len(SKELETON))]
JOINT_COLORS = {name: _PALETTE[i % len(_PALETTE)] for i, name in enumerate(JOINT_NAMES)}

LIMB_WIDTH = 4
JOINT_RADIUS = 4


def render_openpose_image(
    joints: Dict[str, dict],
    width: int = CANVAS_WIDTH,
    height: int = CANVAS_HEIGHT,
) -> Image.Image:
    """黒背景に色分けした骨格線・関節点を描画したPIL画像を返す。"""
    scale_x = width / CANVAS_WIDTH
    scale_y = height / CANVAS_HEIGHT

    image = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(image)

    def _pt(name: str) -> tuple[float, float]:
        pos = joints[name]
        return pos["x"] * scale_x, pos["y"] * scale_y

    for i, (start_name, end_name) in enumerate(SKELETON):
        if start_name not in joints or end_name not in joints:
            continue
        start = _pt(start_name)
        end = _pt(end_name)
        draw.line([start, end], fill=LIMB_COLORS[i], width=LIMB_WIDTH)

    for name in JOINT_NAMES:
        if name not in joints:
            continue
        x, y = _pt(name)
        color = JOINT_COLORS[name]
        draw.ellipse(
            [x - JOINT_RADIUS, y - JOINT_RADIUS, x + JOINT_RADIUS, y + JOINT_RADIUS],
            fill=color,
        )

    return image
