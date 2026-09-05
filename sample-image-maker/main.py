"""sample-image-maker エントリポイント。

キャラクターシート画像を入力に、ポーズ違いの画像を6パターン自動生成し、
3x2レイアウトで出力するデスクトップツール。
"""
from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from app.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
