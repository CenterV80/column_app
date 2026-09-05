"""GUI組み込みのデバッグログ機能。"""
from __future__ import annotations

import logging
import sys

from PySide6.QtCore import QObject, Signal


class QtLogHandler(logging.Handler, QObject):
    """logging のレコードをQtシグナル経由でGUIスレッドに流すハンドラ。"""

    log_signal = Signal(str, int)  # (整形済みメッセージ, levelno)

    def __init__(self) -> None:
        logging.Handler.__init__(self)
        QObject.__init__(self)

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        self.log_signal.emit(msg, record.levelno)


def setup_logging(handler: QtLogHandler, debug: bool = False) -> None:
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s",
                                   datefmt="%H:%M:%S")
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    root.addHandler(handler)

    # コンソールにも出力しておく(GUIが起動しない致命的エラーの調査用)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)


def install_excepthook() -> None:
    """未処理例外でGUIをクラッシュさせず、ログパネルに表示する。"""
    logger = logging.getLogger("unhandled")

    def _hook(exc_type, exc_value, exc_tb):
        logger.critical("未処理の例外が発生しました", exc_info=(exc_type, exc_value, exc_tb))

    sys.excepthook = _hook
