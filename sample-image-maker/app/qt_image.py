"""PIL.Image と Qt画像系クラスの相互変換ユーティリティ。"""
from __future__ import annotations

from PIL import Image
from PySide6.QtGui import QImage, QPixmap


def pil_to_qpixmap(image: Image.Image) -> QPixmap:
    rgb_image = image.convert("RGB")
    data = rgb_image.tobytes("raw", "RGB")
    qimage = QImage(data, rgb_image.width, rgb_image.height, rgb_image.width * 3, QImage.Format.Format_RGB888)
    # tobytes()で作った一時バッファへの参照切れを防ぐためコピーする
    return QPixmap.fromImage(qimage.copy())


def qimage_to_pil(qimage: QImage) -> Image.Image:
    qimage = qimage.convertToFormat(QImage.Format.Format_RGB888)
    width, height = qimage.width(), qimage.height()
    ptr = qimage.constBits()
    buffer = bytes(ptr)[: width * height * 3]
    return Image.frombytes("RGB", (width, height), buffer)
