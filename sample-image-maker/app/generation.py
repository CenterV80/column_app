"""SDXL + ControlNet OpenPose による6ポーズ生成と3x2合成。"""
from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass
from typing import Callable, List, Optional

from PIL import Image

from .config import ModelPaths, resolve_model_paths

logger = logging.getLogger(__name__)

GRID_COLS = 3
GRID_ROWS = 2
MAX_SEED = 2**32 - 1

ProgressCallback = Optional[Callable[[int, int, str], None]]


@dataclass
class GenerationResult:
    combined_image: Image.Image
    individual_images: List[Image.Image]
    seed_used: int
    generation_time_sec: float


class ModelManager:
    """SDXL base + VAE + ControlNet OpenPose を1度だけロードして保持する。

    プロセス内で直接diffusersを呼び出す構成のため、GUIとは別スレッド
    (QThread)からロード・推論を行うことを想定している。
    """

    def __init__(self) -> None:
        self._pipeline = None
        self.model_paths: Optional[ModelPaths] = None

    @property
    def is_loaded(self) -> bool:
        return self._pipeline is not None

    def load(self) -> None:
        import torch
        from diffusers import AutoencoderKL, ControlNetModel, StableDiffusionXLControlNetPipeline

        logger.info("モデル探索を開始します(Stability Matrixフォルダ階層)")
        self.model_paths = resolve_model_paths()

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        if device == "cpu":
            logger.warning("CUDAが利用できません。CPUで動作しますが非常に低速です。")

        logger.info("VAEをロード中... (%s)", self.model_paths.vae.name)
        vae = AutoencoderKL.from_single_file(str(self.model_paths.vae), torch_dtype=dtype)

        logger.info("ControlNet OpenPoseをロード中... (%s)", self.model_paths.controlnet_openpose.name)
        controlnet = ControlNetModel.from_single_file(
            str(self.model_paths.controlnet_openpose), torch_dtype=dtype
        )

        logger.info("SDXL baseをロード中... (%s)", self.model_paths.sdxl_base.name)
        pipeline = StableDiffusionXLControlNetPipeline.from_single_file(
            str(self.model_paths.sdxl_base),
            vae=vae,
            controlnet=controlnet,
            torch_dtype=dtype,
        )
        pipeline = pipeline.to(device)
        pipeline.enable_attention_slicing()

        self._pipeline = pipeline
        logger.info("モデルロード完了 (device=%s)", device)

    def unload(self) -> None:
        self._pipeline = None

    def generate(
        self,
        poses: List[Image.Image],
        prompt: str,
        negative_prompt: str = "",
        controlnet_scale: float = 1.0,
        seed: int = -1,
        width: int = 1024,
        height: int = 1024,
        progress_callback: ProgressCallback = None,
    ) -> GenerationResult:
        if self._pipeline is None:
            raise RuntimeError("モデルがロードされていません。先にload()を呼んでください。")
        if len(poses) != GRID_COLS * GRID_ROWS:
            raise ValueError(f"poses must contain exactly {GRID_COLS * GRID_ROWS} images, got {len(poses)}")

        import torch

        seed_used = random.randint(0, MAX_SEED) if seed is None or seed < 0 else seed
        logger.info("生成開始 seed=%s size=%sx%s controlnet_scale=%s", seed_used, width, height, controlnet_scale)

        device = self._pipeline.device
        start_time = time.time()
        individual_images: List[Image.Image] = []

        # 逐次処理・バッチサイズ1固定(低VRAM機での安全性を優先)
        for i, pose_image in enumerate(poses):
            if progress_callback:
                progress_callback(i, len(poses), f"ポーズ{i + 1}/{len(poses)}を生成中...")

            generator = torch.Generator(device=device).manual_seed(seed_used + i)
            result = self._pipeline(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                image=pose_image,
                controlnet_conditioning_scale=controlnet_scale,
                width=width,
                height=height,
                generator=generator,
                num_images_per_prompt=1,
            )
            individual_images.append(result.images[0])
            logger.debug("ポーズ%s/%s 生成完了", i + 1, len(poses))

        if progress_callback:
            progress_callback(len(poses), len(poses), "合成画像を作成中...")

        combined_image = compose_grid(individual_images, GRID_COLS, GRID_ROWS)
        elapsed = time.time() - start_time
        logger.info("生成完了 所要時間=%.1f秒", elapsed)

        return GenerationResult(
            combined_image=combined_image,
            individual_images=individual_images,
            seed_used=seed_used,
            generation_time_sec=elapsed,
        )


def compose_grid(images: List[Image.Image], cols: int = GRID_COLS, rows: int = GRID_ROWS) -> Image.Image:
    """個別画像を3x2レイアウトで1枚に合成する。"""
    if len(images) != cols * rows:
        raise ValueError(f"expected {cols * rows} images, got {len(images)}")

    cell_w, cell_h = images[0].size
    combined = Image.new("RGB", (cell_w * cols, cell_h * rows), (255, 255, 255))
    for i, image in enumerate(images):
        col = i % cols
        row = i // cols
        combined.paste(image, (col * cell_w, row * cell_h))
    return combined
