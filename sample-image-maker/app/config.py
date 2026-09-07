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

MODEL_EXTENSIONS = (".safetensors", ".ckpt", ".bin")


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


def _load_config_path(key: str, env_var: str) -> Path | None:
    env_value = os.environ.get(env_var)
    if env_value:
        return Path(env_value)

    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            value = data.get(key)
            if value:
                return Path(value)
        except (OSError, ValueError) as exc:
            logger.warning("config.local.json の読み込みに失敗しました: %s", exc)
    return None


def find_image_encoder_dir() -> Path:
    """IP-Adapter用CLIP画像エンコーダのHF形式フォルダを取得する。

    他のモデルと違いStability Matrixからの単一ファイル自動検出はできない
    (diffusersのCLIPVisionModelWithProjectionがconfig.jsonを含むHF形式
    フォルダを要求するため)。設定で明示的にフォルダを指定してもらう。
    """
    encoder_dir = _load_config_path("image_encoder_dir", "SAMPLE_IMAGE_MAKER_IMAGE_ENCODER_DIR")
    if encoder_dir is None:
        raise FileNotFoundError(
            "IP-Adapter用CLIP画像エンコーダのフォルダが未設定です。"
            "「設定 → 画像エンコーダフォルダを設定」から、h94/IP-Adapter の "
            "models/image_encoder(ViT-H, config.jsonを含むフォルダ)のパスを指定してください。"
        )
    if not (encoder_dir / "config.json").is_file():
        raise FileNotFoundError(
            f"画像エンコーダフォルダに config.json が見つかりません: {encoder_dir}。"
            "単一の.safetensorsファイルではなく、config.jsonと重みを含むHF形式のフォルダを指定してください。"
        )
    return encoder_dir


@dataclass
class ModelPaths:
    sdxl_base: Path
    vae: Path
    controlnet_openpose: Path
    ip_adapter: Path
    ip_adapter_image_encoder_dir: Path


def resolve_model_paths() -> ModelPaths:
    """モデル一式のパスを解決する。

    SDXL base / VAE / ControlNet OpenPose / IP-Adapter はStability Matrixの
    フォルダ階層から単一ファイルとして自動検出する。CLIP画像エンコーダのみ
    HF形式フォルダが必要なため、設定で指定されたパスを使う(find_image_encoder_dir)。
    いずれも解決できない場合は例外を送出し、呼び出し側で起動停止
    (エラーダイアログ表示)させる想定。
    """
    models_dir = _load_config_path("models_dir", "SAMPLE_IMAGE_MAKER_MODELS_DIR") or DEFAULT_MODELS_DIR
    logger.info("モデル検索ディレクトリ: %s", models_dir)

    sdxl_base = find_model_file(models_dir / "StableDiffusion", keyword="xl")
    vae = find_model_file(models_dir / "VAE")
    controlnet_openpose = find_model_file(models_dir / "ControlNet", keyword="openpose")
    ip_adapter = find_model_file(models_dir / "IpAdaptersXl", keyword="vit-h")
    ip_adapter_image_encoder_dir = find_image_encoder_dir()

    logger.info("SDXL base: %s", sdxl_base.name)
    logger.info("VAE: %s", vae.name)
    logger.info("ControlNet OpenPose: %s", controlnet_openpose.name)
    logger.info("IP-Adapter: %s", ip_adapter.name)
    logger.info("IP-Adapter image encoder: %s", ip_adapter_image_encoder_dir)

    return ModelPaths(
        sdxl_base=sdxl_base,
        vae=vae,
        controlnet_openpose=controlnet_openpose,
        ip_adapter=ip_adapter,
        ip_adapter_image_encoder_dir=ip_adapter_image_encoder_dir,
    )
