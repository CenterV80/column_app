"""棒人間エディタ本体(1ポーズ分)。QGraphicsView/Sceneベース。"""
from __future__ import annotations

from typing import Dict, Optional

from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QBrush, QPainter, QPen
from PySide6.QtWidgets import (
    QComboBox,
    QGraphicsEllipseItem,
    QGraphicsLineItem,
    QGraphicsScene,
    QGraphicsView,
    QHBoxLayout,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from .pose_data import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    JOINT_NAMES,
    SKELETON,
    get_preset_joints,
    load_presets,
    mirror_joints,
)

JOINT_RADIUS = 8

# 編集用は視認性重視(白背景+コントラストのはっきりした色)
EDITOR_JOINT_BRUSH = QBrush(Qt.GlobalColor.red)
EDITOR_JOINT_PEN = QPen(Qt.GlobalColor.black, 1.5)
EDITOR_LINE_PEN = QPen(Qt.GlobalColor.blue, 3)


class _JointItem(QGraphicsEllipseItem):
    """ドラッグ可能な関節点。移動時にシーンへ再描画を依頼する。"""

    def __init__(self, name: str, scene_ref: "PoseEditorScene"):
        super().__init__(-JOINT_RADIUS, -JOINT_RADIUS, JOINT_RADIUS * 2, JOINT_RADIUS * 2)
        self.name = name
        self._scene_ref = scene_ref
        self.setBrush(EDITOR_JOINT_BRUSH)
        self.setPen(EDITOR_JOINT_PEN)
        self.setFlags(
            QGraphicsEllipseItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsEllipseItem.GraphicsItemFlag.ItemIsSelectable
            | QGraphicsEllipseItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setZValue(10)

    def itemChange(self, change, value):
        if change == QGraphicsEllipseItem.GraphicsItemChange.ItemPositionHasChanged:
            self._scene_ref.on_joint_moved()
        return super().itemChange(change, value)


class PoseEditorScene(QGraphicsScene):
    """1ポーズ分の関節点・骨格線を保持するシーン。"""

    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, parent)
        self._joint_items: Dict[str, _JointItem] = {}
        self._lines: list[tuple[QGraphicsLineItem, str, str]] = []
        self.setBackgroundBrush(QBrush(Qt.GlobalColor.white))

    def load_joints(self, joints: Dict[str, dict]) -> None:
        self.clear()
        self._joint_items.clear()
        self._lines.clear()

        for start_name, end_name in SKELETON:
            line = QGraphicsLineItem()
            line.setPen(EDITOR_LINE_PEN)
            line.setZValue(0)
            self.addItem(line)
            self._lines.append((line, start_name, end_name))

        for name in JOINT_NAMES:
            pos = joints.get(name, {"x": CANVAS_WIDTH / 2, "y": CANVAS_HEIGHT / 2})
            item = _JointItem(name, self)
            item.setPos(pos["x"], pos["y"])
            self.addItem(item)
            self._joint_items[name] = item

        self.on_joint_moved()

    def on_joint_moved(self) -> None:
        for line, start_name, end_name in self._lines:
            start_item = self._joint_items.get(start_name)
            end_item = self._joint_items.get(end_name)
            if start_item is None or end_item is None:
                continue
            line.setLine(
                start_item.pos().x(), start_item.pos().y(),
                end_item.pos().x(), end_item.pos().y(),
            )

    def get_joints(self) -> Dict[str, dict]:
        return {
            name: {"x": item.pos().x(), "y": item.pos().y()}
            for name, item in self._joint_items.items()
        }


class PoseEditorWidget(QWidget):
    """プリセット選択・左右反転ボタン付きの棒人間エディタセル。"""

    pose_changed = Signal()

    def __init__(self, cell_label: str, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.cell_label = cell_label
        self._presets = load_presets()

        self.scene = PoseEditorScene(self)
        self.view = QGraphicsView(self.scene, self)
        self.view.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.view.setFixedSize(CANVAS_WIDTH // 2 + 20, CANVAS_HEIGHT // 2 + 20)
        self.view.scale(0.5, 0.5)
        self.view.setSceneRect(QRectF(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT))

        self.preset_combo = QComboBox(self)
        for preset in self._presets:
            self.preset_combo.addItem(preset["name"], preset["id"])
        self.preset_combo.currentIndexChanged.connect(self._on_preset_selected)

        self.mirror_button = QPushButton("左右反転", self)
        self.mirror_button.clicked.connect(self._on_mirror_clicked)

        controls = QHBoxLayout()
        controls.addWidget(self.preset_combo)
        controls.addWidget(self.mirror_button)

        layout = QVBoxLayout(self)
        layout.addWidget(self.view)
        layout.addLayout(controls)
        layout.setContentsMargins(4, 4, 4, 4)

        self.scene.load_joints(get_preset_joints(self._presets[0]["id"], self._presets))
        self.scene.changed.connect(lambda *_: self.pose_changed.emit())

    def _on_preset_selected(self, index: int) -> None:
        preset_id = self.preset_combo.itemData(index)
        self.scene.load_joints(get_preset_joints(preset_id, self._presets))
        self.pose_changed.emit()

    def _on_mirror_clicked(self) -> None:
        mirrored = mirror_joints(self.scene.get_joints())
        self.scene.load_joints(mirrored)
        self.pose_changed.emit()

    def get_joints(self) -> Dict[str, dict]:
        return self.scene.get_joints()
