"""推論処理をGUIスレッドから切り離すためのQThreadラッパー。"""
from __future__ import annotations

import logging
from typing import List

from PIL import Image
from PySide6.QtCore import QThread, Signal

from .generation import GenerationResult, ModelManager

logger = logging.getLogger(__name__)


class ModelLoadWorker(QThread):
    finished_ok = Signal()
    failed = Signal(str)

    def __init__(self, model_manager: ModelManager, parent=None):
        super().__init__(parent)
        self._model_manager = model_manager

    def run(self) -> None:
        try:
            self._model_manager.load()
        except Exception as exc:  # noqa: BLE001 - GUIへのエラー伝搬が目的
            logger.exception("モデルロードに失敗しました")
            self.failed.emit(str(exc))
        else:
            self.finished_ok.emit()


class GenerationWorker(QThread):
    progress = Signal(int, int, str)
    finished_ok = Signal(object)  # GenerationResult
    failed = Signal(str)

    def __init__(
        self,
        model_manager: ModelManager,
        poses: List[Image.Image],
        prompt: str,
        negative_prompt: str,
        controlnet_scale: float,
        seed: int,
        width: int,
        height: int,
        parent=None,
    ):
        super().__init__(parent)
        self._model_manager = model_manager
        self._poses = poses
        self._prompt = prompt
        self._negative_prompt = negative_prompt
        self._controlnet_scale = controlnet_scale
        self._seed = seed
        self._width = width
        self._height = height

    def run(self) -> None:
        try:
            result: GenerationResult = self._model_manager.generate(
                poses=self._poses,
                prompt=self._prompt,
                negative_prompt=self._negative_prompt,
                controlnet_scale=self._controlnet_scale,
                seed=self._seed,
                width=self._width,
                height=self._height,
                progress_callback=lambda done, total, msg: self.progress.emit(done, total, msg),
            )
        except Exception as exc:  # noqa: BLE001 - GUIへのエラー伝搬が目的
            logger.exception("生成処理に失敗しました")
            self.failed.emit(str(exc))
        else:
            self.finished_ok.emit(result)
