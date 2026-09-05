"""Stability Matrix 配下のモデルフォルダ自動検出まわり。"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.local.json"

DEFAULT_MODELS_DIR = Path.home() / "StabilityMatrix" / "Data" / "Models"

MODEL_EXTENSIONS = (".safetensors", ".ckpt")


def find_model_file(category_dir: Path, keyword: str | None = None,
                     extensions=MODEL_EXTENSIONS) -> Path:
    """カテゴリフォルダから条件に合う単一のモデルファイルを検出する。

    0件・複数件はどちらもエラー(意図しないモデルでの生成事故防止のため)。
    """
    if not category_dir.is_dir():
        raise FileNotFoundError(f"Model directory not found: {category_dir}")

    candidates = [
        f for f in category_dir.iterdir()
        if f.suffix.lower() in extensions and f.is_file()
    ]
    if keyword:
        candidates = [f for f in candidates if keyword.lower() in f.name.lower()]

    if not candidates:
        raise FileNotFoundError(f"No model file found in {category_dir}")
    if len(candidates) > 1:
        names = ", ".join(f.name for f in candidates)
        raise RuntimeError(
            f"Multiple candidates found in {category_dir}: {names}. "
            "Please remove extras or narrow the keyword."
        )
    return candidates[0]


def _load_models_dir_override() -> Path | None:
    env_value = os.environ.get("SAMPLE_IMAGE_MAKER_MODELS_DIR")
    if env_value:
        return Path(env_value)

    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            value = data.get("models_dir")
            if value:
                return Path(value)
        except (OSError, ValueError) as exc:
            logger.warning("config.local.json の読み込みに失敗しました: %s", exc)
    return None


@dataclass
class ModelPaths:
    sdxl_base: Path
    vae: Path


def resolve_model_paths() -> ModelPaths:
    """Stability Matrixのフォルダ階層からモデル2種を自動検出する。

    img2img構成(ControlNet不採用)のため、SDXL base と VAE のみ検出する。
    該当ファイルが0件・複数件の場合は例外を送出し、呼び出し側で
    起動停止(エラーダイアログ表示)させる想定。
    """
    models_dir = _load_models_dir_override() or DEFAULT_MODELS_DIR
    logger.info("モデル検索ディレクトリ: %s", models_dir)

    sdxl_base = find_model_file(models_dir / "StableDiffusion", keyword="xl")
    vae = find_model_file(models_dir / "VAE")

    logger.info("SDXL base: %s", sdxl_base.name)
    logger.info("VAE: %s", vae.name)

    return ModelPaths(
        sdxl_base=sdxl_base,
        vae=vae,
    )
