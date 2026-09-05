"""棒人間エディタのデータ構造(COCO18準拠の関節点)とプリセット。"""
from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

PRESETS_FILE = Path(__file__).resolve().parent / "presets.json"

# 関節名の並び順(左右ペアの対応関係含む)
JOINT_NAMES: List[str] = [
    "nose", "neck",
    "rShoulder", "rElbow", "rWrist",
    "lShoulder", "lElbow", "lWrist",
    "rHip", "rKnee", "rAnkle",
    "lHip", "lKnee", "lAnkle",
]

# 骨格の接続関係(親, 子)
SKELETON: List[Tuple[str, str]] = [
    ("neck", "nose"), ("neck", "rShoulder"), ("neck", "lShoulder"),
    ("rShoulder", "rElbow"), ("rElbow", "rWrist"),
    ("lShoulder", "lElbow"), ("lElbow", "lWrist"),
    ("neck", "rHip"), ("neck", "lHip"),
    ("rHip", "rKnee"), ("rKnee", "rAnkle"),
    ("lHip", "lKnee"), ("lKnee", "lAnkle"),
]

# 左右反転時に位置を入れ替えるペア
MIRROR_PAIRS: List[Tuple[str, str]] = [
    ("rShoulder", "lShoulder"),
    ("rElbow", "lElbow"),
    ("rWrist", "lWrist"),
    ("rHip", "lHip"),
    ("rKnee", "lKnee"),
    ("rAnkle", "lAnkle"),
]

CANVAS_WIDTH = 500
CANVAS_HEIGHT = 600

DEFAULT_PRESETS: List[dict] = [
    {
        "id": "standing",
        "name": "直立",
        "joints": {
            "nose": {"x": 400, "y": 80},
            "neck": {"x": 400, "y": 150},
            "rShoulder": {"x": 340, "y": 160},
            "lShoulder": {"x": 460, "y": 160},
            "rElbow": {"x": 300, "y": 250},
            "lElbow": {"x": 500, "y": 250},
            "rWrist": {"x": 280, "y": 340},
            "lWrist": {"x": 520, "y": 340},
            "rHip": {"x": 370, "y": 380},
            "lHip": {"x": 430, "y": 380},
            "rKnee": {"x": 360, "y": 500},
            "lKnee": {"x": 440, "y": 500},
            "rAnkle": {"x": 355, "y": 620},
            "lAnkle": {"x": 445, "y": 620},
        },
    },
    {
        "id": "crouching",
        "name": "しゃがみ",
        "joints": {
            "nose": {"x": 400, "y": 260},
            "neck": {"x": 400, "y": 320},
            "rShoulder": {"x": 350, "y": 330},
            "lShoulder": {"x": 450, "y": 330},
            "rElbow": {"x": 310, "y": 400},
            "lElbow": {"x": 490, "y": 400},
            "rWrist": {"x": 300, "y": 460},
            "lWrist": {"x": 500, "y": 460},
            "rHip": {"x": 370, "y": 460},
            "lHip": {"x": 430, "y": 460},
            "rKnee": {"x": 350, "y": 520},
            "lKnee": {"x": 450, "y": 520},
            "rAnkle": {"x": 355, "y": 600},
            "lAnkle": {"x": 445, "y": 600},
        },
    },
    {
        "id": "running",
        "name": "走る",
        "joints": {
            "nose": {"x": 420, "y": 90},
            "neck": {"x": 410, "y": 155},
            "rShoulder": {"x": 355, "y": 165},
            "lShoulder": {"x": 460, "y": 165},
            "rElbow": {"x": 300, "y": 130},
            "lElbow": {"x": 500, "y": 250},
            "rWrist": {"x": 340, "y": 90},
            "lWrist": {"x": 470, "y": 340},
            "rHip": {"x": 375, "y": 380},
            "lHip": {"x": 425, "y": 380},
            "rKnee": {"x": 320, "y": 460},
            "lKnee": {"x": 470, "y": 470},
            "rAnkle": {"x": 340, "y": 560},
            "lAnkle": {"x": 500, "y": 400},
        },
    },
]


def load_presets() -> List[dict]:
    """presets.json があればそれを、なければ組み込みデフォルトを返す。"""
    if PRESETS_FILE.exists():
        try:
            data = json.loads(PRESETS_FILE.read_text(encoding="utf-8"))
            if data:
                return data
        except (OSError, ValueError) as exc:
            logger.warning("presets.json の読み込みに失敗しました。デフォルトを使用します: %s", exc)
    return copy.deepcopy(DEFAULT_PRESETS)


def get_preset_joints(preset_id: str, presets: List[dict] | None = None) -> Dict[str, dict]:
    presets = presets if presets is not None else load_presets()
    for preset in presets:
        if preset["id"] == preset_id:
            return copy.deepcopy(preset["joints"])
    raise KeyError(f"Unknown preset id: {preset_id}")


def mirror_joints(joints: Dict[str, dict], canvas_width: int = CANVAS_WIDTH) -> Dict[str, dict]:
    """全関節のx座標を反転し、左右ペアの値を入れ替える。"""
    mirrored = {
        name: {"x": canvas_width - pos["x"], "y": pos["y"]}
        for name, pos in joints.items()
    }
    for right_name, left_name in MIRROR_PAIRS:
        mirrored[right_name], mirrored[left_name] = mirrored[left_name], mirrored[right_name]
    return mirrored
