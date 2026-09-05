"""メインウィンドウ。左パネル・6ポーズエディタ・結果プレビュー・ログパネルを配置する。"""
from __future__ import annotations

import io
import logging
import zipfile
from pathlib import Path
from typing import List, Optional

from PIL import Image
from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QColor, QTextCharFormat
from PySide6.QtWidgets import (
    QDockWidget,
    QDoubleSpinBox,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from .config import CONFIG_FILE
from .generation import GenerationResult, ModelManager
from .generation_worker import GenerationWorker, ModelLoadWorker
from .logging_setup import QtLogHandler, install_excepthook, setup_logging
from .pose_editor_widget import PoseEditorWidget
from .pose_render import render_openpose_image
from .qt_image import pil_to_qpixmap

logger = logging.getLogger(__name__)

NUM_POSES = 6
THUMBNAIL_SIZE = 160

_LEVEL_COLORS = {
    logging.ERROR: QColor("#c0392b"),
    logging.CRITICAL: QColor("#c0392b"),
    logging.WARNING: QColor("#b8860b"),
}


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("sample-image-maker")
        self.resize(1980, 1400)

        self.model_manager = ModelManager()
        self.character_sheet_image: Optional[Image.Image] = None
        self.last_result: Optional[GenerationResult] = None
        self._model_load_worker: Optional[ModelLoadWorker] = None
        self._generation_worker: Optional[GenerationWorker] = None

        self._log_handler = QtLogHandler()

        self._build_ui()
        self._connect_logging()
        install_excepthook()

        self._start_model_load()

    # ------------------------------------------------------------------
    # UI構築
    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        self._build_menu()

        top_splitter = QSplitter(Qt.Orientation.Horizontal, self)
        top_splitter.addWidget(self._build_left_panel())
        top_splitter.addWidget(self._build_pose_grid())
        top_splitter.setStretchFactor(0, 0)
        top_splitter.setStretchFactor(1, 1)

        main_splitter = QSplitter(Qt.Orientation.Vertical, self)
        main_splitter.addWidget(top_splitter)
        main_splitter.addWidget(self._build_results_panel())
        main_splitter.setStretchFactor(0, 3)
        main_splitter.setStretchFactor(1, 2)

        self.setCentralWidget(main_splitter)
        self.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, self._build_log_dock())

    def _build_menu(self) -> None:
        file_menu = self.menuBar().addMenu("ファイル(&F)")

        open_action = QAction("キャラクターシートを開く...", self)
        open_action.triggered.connect(self._on_upload_character_sheet)
        file_menu.addAction(open_action)

        file_menu.addSeparator()
        exit_action = QAction("終了", self)
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

        settings_menu = self.menuBar().addMenu("設定(&S)")
        models_dir_action = QAction("モデルフォルダを設定...", self)
        models_dir_action.triggered.connect(self._on_settings_models_dir)
        settings_menu.addAction(models_dir_action)

    def _build_left_panel(self) -> QWidget:
        panel = QWidget(self)
        layout = QVBoxLayout(panel)

        layout.addWidget(QLabel("<b>キャラクターシート</b>"))
        self.character_thumbnail = QLabel("未アップロード")
        self.character_thumbnail.setFixedSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
        self.character_thumbnail.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.character_thumbnail.setStyleSheet("border: 1px solid #999;")
        layout.addWidget(self.character_thumbnail)

        upload_button = QPushButton("アップロード", panel)
        upload_button.clicked.connect(self._on_upload_character_sheet)
        layout.addWidget(upload_button)

        layout.addWidget(QLabel("<b>プロンプト</b>"))
        self.prompt_edit = QTextEdit(panel)
        self.prompt_edit.setPlaceholderText("キャラの特徴・スタイル指定")
        self.prompt_edit.setFixedHeight(100)
        layout.addWidget(self.prompt_edit)

        layout.addWidget(QLabel("<b>ネガティブプロンプト</b>"))
        self.negative_prompt_edit = QTextEdit(panel)
        self.negative_prompt_edit.setFixedHeight(70)
        layout.addWidget(self.negative_prompt_edit)

        size_row = QHBoxLayout()
        self.width_spin = QSpinBox(panel)
        self.width_spin.setRange(256, 2048)
        self.width_spin.setSingleStep(64)
        self.width_spin.setValue(1024)
        self.height_spin = QSpinBox(panel)
        self.height_spin.setRange(256, 2048)
        self.height_spin.setSingleStep(64)
        self.height_spin.setValue(1024)
        size_row.addWidget(QLabel("W"))
        size_row.addWidget(self.width_spin)
        size_row.addWidget(QLabel("H"))
        size_row.addWidget(self.height_spin)
        layout.addLayout(size_row)

        strength_row = QHBoxLayout()
        strength_row.addWidget(QLabel("変化の強さ(denoising strength)"))
        self.denoising_strength_spin = QDoubleSpinBox(panel)
        self.denoising_strength_spin.setRange(0.0, 1.0)
        self.denoising_strength_spin.setSingleStep(0.05)
        self.denoising_strength_spin.setValue(0.65)
        self.denoising_strength_spin.setToolTip(
            "低いほど棒人間の構図に忠実(絵として崩れやすい)、"
            "高いほど自然な絵になるがポーズの再現度が下がります。"
        )
        strength_row.addWidget(self.denoising_strength_spin)
        layout.addLayout(strength_row)

        seed_row = QHBoxLayout()
        seed_row.addWidget(QLabel("Seed(-1でランダム)"))
        self.seed_spin = QSpinBox(panel)
        self.seed_spin.setRange(-1, 2**31 - 1)
        self.seed_spin.setValue(-1)
        seed_row.addWidget(self.seed_spin)
        layout.addLayout(seed_row)

        self.status_label = QLabel("モデルロード中...")
        layout.addWidget(self.status_label)

        self.generate_button = QPushButton("生成", panel)
        self.generate_button.setEnabled(False)
        self.generate_button.clicked.connect(self._on_generate_clicked)
        layout.addWidget(self.generate_button)

        self.progress_bar = QProgressBar(panel)
        self.progress_bar.setRange(0, NUM_POSES)
        self.progress_bar.setValue(0)
        layout.addWidget(self.progress_bar)

        layout.addStretch(1)
        return panel

    def _build_pose_grid(self) -> QWidget:
        panel = QWidget(self)
        grid = QGridLayout(panel)
        self.pose_editors: List[PoseEditorWidget] = []
        for i in range(NUM_POSES):
            editor = PoseEditorWidget(f"Pose{i + 1}", panel)
            row, col = divmod(i, 3)
            grid.addWidget(editor, row, col)
            self.pose_editors.append(editor)
        return panel

    def _build_results_panel(self) -> QWidget:
        panel = QWidget(self)
        layout = QVBoxLayout(panel)

        toolbar = QHBoxLayout()
        self.save_combined_button = QPushButton("合成画像を保存", panel)
        self.save_combined_button.setEnabled(False)
        self.save_combined_button.clicked.connect(self._on_save_combined)
        toolbar.addWidget(self.save_combined_button)

        self.save_zip_button = QPushButton("6枚まとめてZIP保存", panel)
        self.save_zip_button.setEnabled(False)
        self.save_zip_button.clicked.connect(self._on_save_zip)
        toolbar.addWidget(self.save_zip_button)
        toolbar.addStretch(1)
        layout.addLayout(toolbar)

        scroll = QScrollArea(panel)
        scroll.setWidgetResizable(True)
        self.results_container = QWidget()
        self.results_layout = QVBoxLayout(self.results_container)

        self.combined_preview_label = QLabel("生成結果はまだありません")
        self.combined_preview_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.results_layout.addWidget(self.combined_preview_label)

        self.individual_row = QHBoxLayout()
        self.results_layout.addLayout(self.individual_row)
        self.results_layout.addStretch(1)

        scroll.setWidget(self.results_container)
        layout.addWidget(scroll)
        return panel

    def _build_log_dock(self) -> QDockWidget:
        dock = QDockWidget("デバッグログ", self)
        dock.setFeatures(
            QDockWidget.DockWidgetFeature.DockWidgetClosable
            | QDockWidget.DockWidgetFeature.DockWidgetMovable
            | QDockWidget.DockWidgetFeature.DockWidgetFloatable
        )

        content = QWidget(dock)
        layout = QVBoxLayout(content)

        self.log_text_edit = QTextEdit(content)
        self.log_text_edit.setReadOnly(True)
        self.log_text_edit.setFixedHeight(180)
        layout.addWidget(self.log_text_edit)

        controls = QHBoxLayout()
        self.debug_checkbox = QPushButton("DEBUGログ表示: OFF", content)
        self.debug_checkbox.setCheckable(True)
        self.debug_checkbox.toggled.connect(self._on_debug_toggle)
        controls.addWidget(self.debug_checkbox)

        copy_button = QPushButton("ログをコピー", content)
        copy_button.clicked.connect(self._on_copy_log)
        controls.addWidget(copy_button)

        save_button = QPushButton("ログをファイル保存", content)
        save_button.clicked.connect(self._on_save_log)
        controls.addWidget(save_button)

        clear_button = QPushButton("クリア", content)
        clear_button.clicked.connect(self._on_clear_log)
        controls.addWidget(clear_button)

        controls.addStretch(1)
        layout.addLayout(controls)

        dock.setWidget(content)
        return dock

    # ------------------------------------------------------------------
    # ログ
    # ------------------------------------------------------------------
    def _connect_logging(self) -> None:
        setup_logging(self._log_handler, debug=False)
        self._log_handler.log_signal.connect(self._append_log)

    def _append_log(self, message: str, levelno: int) -> None:
        color = _LEVEL_COLORS.get(levelno)
        if color is not None:
            fmt = QTextCharFormat()
            fmt.setForeground(color)
            cursor = self.log_text_edit.textCursor()
            cursor.movePosition(cursor.MoveOperation.End)
            cursor.insertText(message + "\n", fmt)
            self.log_text_edit.setTextCursor(cursor)
        else:
            self.log_text_edit.append(message)

    def _on_debug_toggle(self, checked: bool) -> None:
        logging.getLogger().setLevel(logging.DEBUG if checked else logging.INFO)
        self.debug_checkbox.setText(f"DEBUGログ表示: {'ON' if checked else 'OFF'}")

    def _on_copy_log(self) -> None:
        self.log_text_edit.selectAll()
        self.log_text_edit.copy()
        cursor = self.log_text_edit.textCursor()
        cursor.clearSelection()
        self.log_text_edit.setTextCursor(cursor)
        logger.info("ログをクリップボードにコピーしました")

    def _on_save_log(self) -> None:
        import datetime

        default_name = f"sample-image-maker_{datetime.datetime.now():%Y%m%d_%H%M%S}.log"
        path, _ = QFileDialog.getSaveFileName(self, "ログをファイル保存", default_name, "Log Files (*.log)")
        if not path:
            return
        Path(path).write_text(self.log_text_edit.toPlainText(), encoding="utf-8")
        logger.info("ログをファイルに保存しました: %s", path)

    def _on_clear_log(self) -> None:
        self.log_text_edit.clear()

    # ------------------------------------------------------------------
    # モデルロード
    # ------------------------------------------------------------------
    def _start_model_load(self) -> None:
        self.status_label.setText("モデルロード中...")
        self._model_load_worker = ModelLoadWorker(self.model_manager, self)
        self._model_load_worker.finished_ok.connect(self._on_model_loaded)
        self._model_load_worker.failed.connect(self._on_model_load_failed)
        self._model_load_worker.start()

    def _on_model_loaded(self) -> None:
        self.status_label.setText("Ready")
        self._update_generate_button_enabled()

    def _on_model_load_failed(self, message: str) -> None:
        self.status_label.setText("モデルロード失敗")
        QMessageBox.critical(self, "モデルロードエラー", message)

    def _on_settings_models_dir(self) -> None:
        text, ok = QInputDialog.getText(
            self,
            "モデルフォルダを設定",
            "StabilityMatrix の Models フォルダのパスを入力してください\n"
            "(例: C:/StabilityMatrix/Data/Models)",
        )
        if not ok or not text.strip():
            return
        import json

        CONFIG_FILE.write_text(json.dumps({"models_dir": text.strip()}, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("モデルフォルダ設定を保存しました: %s", text.strip())
        QMessageBox.information(self, "設定を保存しました", "再起動後に新しいモデルフォルダが使用されます。")

    # ------------------------------------------------------------------
    # キャラクターシート
    # ------------------------------------------------------------------
    def _on_upload_character_sheet(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "キャラクターシートを開く", "", "Images (*.png *.jpg *.jpeg *.webp)"
        )
        if not path:
            return
        try:
            self.character_sheet_image = Image.open(path).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            logger.exception("キャラクターシートの読み込みに失敗しました")
            QMessageBox.critical(self, "読み込みエラー", str(exc))
            return

        pixmap = pil_to_qpixmap(self.character_sheet_image).scaled(
            THUMBNAIL_SIZE, THUMBNAIL_SIZE, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation
        )
        self.character_thumbnail.setPixmap(pixmap)
        logger.info("キャラクターシートを読み込みました: %s", path)
        self._update_generate_button_enabled()

    def _update_generate_button_enabled(self) -> None:
        ready = self.model_manager.is_loaded and self.character_sheet_image is not None
        self.generate_button.setEnabled(ready)

    # ------------------------------------------------------------------
    # 生成
    # ------------------------------------------------------------------
    def _on_generate_clicked(self) -> None:
        width = self.width_spin.value()
        height = self.height_spin.value()
        poses = [render_openpose_image(editor.get_joints(), width, height) for editor in self.pose_editors]

        self.generate_button.setEnabled(False)
        self.progress_bar.setValue(0)
        self.status_label.setText("生成中...")

        self._generation_worker = GenerationWorker(
            self.model_manager,
            poses=poses,
            prompt=self.prompt_edit.toPlainText(),
            negative_prompt=self.negative_prompt_edit.toPlainText(),
            denoising_strength=self.denoising_strength_spin.value(),
            seed=self.seed_spin.value(),
            width=width,
            height=height,
            parent=self,
        )
        self._generation_worker.progress.connect(self._on_generation_progress)
        self._generation_worker.finished_ok.connect(self._on_generation_finished)
        self._generation_worker.failed.connect(self._on_generation_failed)
        self._generation_worker.start()

    def _on_generation_progress(self, done: int, total: int, message: str) -> None:
        self.progress_bar.setRange(0, total)
        self.progress_bar.setValue(done)
        self.status_label.setText(message)

    def _on_generation_finished(self, result: GenerationResult) -> None:
        self.last_result = result
        self.status_label.setText(
            f"完了 (seed={result.seed_used}, {result.generation_time_sec:.1f}秒)"
        )
        self.progress_bar.setValue(self.progress_bar.maximum())
        self._render_results(result)
        self.generate_button.setEnabled(True)
        self.save_combined_button.setEnabled(True)
        self.save_zip_button.setEnabled(True)

    def _on_generation_failed(self, message: str) -> None:
        self.status_label.setText("生成失敗")
        self.generate_button.setEnabled(True)
        QMessageBox.critical(self, "生成エラー", message)

    def _render_results(self, result: GenerationResult) -> None:
        combined_pixmap = pil_to_qpixmap(result.combined_image).scaledToWidth(
            900, Qt.TransformationMode.SmoothTransformation
        )
        self.combined_preview_label.setPixmap(combined_pixmap)

        while self.individual_row.count():
            item = self.individual_row.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        for i, image in enumerate(result.individual_images):
            cell = QWidget(self.results_container)
            cell_layout = QVBoxLayout(cell)

            thumb = QLabel(cell)
            pixmap = pil_to_qpixmap(image).scaled(
                THUMBNAIL_SIZE, THUMBNAIL_SIZE, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation
            )
            thumb.setPixmap(pixmap)
            cell_layout.addWidget(thumb)

            save_button = QPushButton(f"Pose{i + 1}を保存", cell)
            save_button.clicked.connect(lambda _checked=False, idx=i: self._on_save_individual(idx))
            cell_layout.addWidget(save_button)

            self.individual_row.addWidget(cell)

    # ------------------------------------------------------------------
    # 保存
    # ------------------------------------------------------------------
    def _on_save_combined(self) -> None:
        if self.last_result is None:
            return
        path, _ = QFileDialog.getSaveFileName(self, "合成画像を保存", "combined.png", "PNG (*.png)")
        if not path:
            return
        self.last_result.combined_image.save(path)
        logger.info("合成画像を保存しました: %s", path)

    def _on_save_individual(self, index: int) -> None:
        if self.last_result is None:
            return
        path, _ = QFileDialog.getSaveFileName(
            self, f"Pose{index + 1}を保存", f"pose_{index + 1}.png", "PNG (*.png)"
        )
        if not path:
            return
        self.last_result.individual_images[index].save(path)
        logger.info("個別画像を保存しました: %s", path)

    def _on_save_zip(self) -> None:
        if self.last_result is None:
            return
        path, _ = QFileDialog.getSaveFileName(self, "ZIPで保存", "poses.zip", "ZIP (*.zip)")
        if not path:
            return

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, image in enumerate(self.last_result.individual_images):
                image_buffer = io.BytesIO()
                image.save(image_buffer, format="PNG")
                zf.writestr(f"pose_{i + 1}.png", image_buffer.getvalue())

        Path(path).write_bytes(buffer.getvalue())
        logger.info("ZIPを保存しました: %s", path)
