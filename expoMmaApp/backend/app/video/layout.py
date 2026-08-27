"""Letterbox panels and draw comparison labels without stretching the body."""

from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray

from app.config import COMPARISON_PANEL_HEIGHT

BgrFrame = NDArray[np.uint8]

LABEL_BAR_HEIGHT = 36
LABEL_FILL = (18, 18, 18)
LABEL_TEXT = (255, 255, 255)
LETTERBOX_FILL = (0, 0, 0)


def even(value: int) -> int:
    value = max(2, int(value))
    return value if value % 2 == 0 else value + 1


def fit_frame(frame: BgrFrame, panel_width: int, panel_height: int) -> BgrFrame:
    """Scale uniformly to fit the panel, then letterbox. Never stretch axes independently."""
    height, width = frame.shape[:2]
    if width <= 0 or height <= 0:
        raise ValueError("Frame has invalid dimensions.")
    scale = min(panel_width / width, panel_height / height)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(frame, (new_width, new_height), interpolation=interpolation)
    canvas = np.full((panel_height, panel_width, 3), LETTERBOX_FILL, dtype=np.uint8)
    x = (panel_width - new_width) // 2
    y = (panel_height - new_height) // 2
    canvas[y : y + new_height, x : x + new_width] = resized
    return canvas


def panel_size_for_frames(left: BgrFrame, right: BgrFrame, *, panel_height: int | None = None) -> tuple[int, int]:
    height = even(panel_height or COMPARISON_PANEL_HEIGHT)
    widths: list[int] = []
    for frame in (left, right):
        src_h, src_w = frame.shape[:2]
        scale = height / src_h
        widths.append(even(int(round(src_w * scale))))
    panel_width = max(widths)
    return panel_width, height


def draw_label(panel: BgrFrame, text: str) -> BgrFrame:
    labeled = panel.copy()
    cv2.rectangle(labeled, (0, 0), (labeled.shape[1], LABEL_BAR_HEIGHT), LABEL_FILL, thickness=-1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.7
    thickness = 2
    (text_w, text_h), _ = cv2.getTextSize(text, font, scale, thickness)
    x = max(8, (labeled.shape[1] - text_w) // 2)
    y = (LABEL_BAR_HEIGHT + text_h) // 2
    cv2.putText(labeled, text, (x, y), font, scale, LABEL_TEXT, thickness, cv2.LINE_AA)
    return labeled


def draw_progress(frame: BgrFrame, progress: float) -> BgrFrame:
    """Small corner progress so LEFT/RIGHT synchronization can be inspected."""
    labeled = frame.copy()
    percent = int(round(min(1.0, max(0.0, progress)) * 100.0))
    text = f"{percent}%"
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.55
    thickness = 1
    (text_w, text_h), _ = cv2.getTextSize(text, font, scale, thickness)
    x = 8
    y = labeled.shape[0] - 10
    cv2.rectangle(
        labeled,
        (x - 4, y - text_h - 6),
        (x + text_w + 4, y + 4),
        LABEL_FILL,
        thickness=-1,
    )
    cv2.putText(labeled, text, (x, y), font, scale, LABEL_TEXT, thickness, cv2.LINE_AA)
    return labeled


def stack_side_by_side(
    left: BgrFrame,
    right: BgrFrame,
    *,
    left_label: str,
    right_label: str,
    progress: float | None = None,
) -> BgrFrame:
    panel_width, panel_height = panel_size_for_frames(left, right)
    left_panel = draw_label(fit_frame(left, panel_width, panel_height), left_label)
    right_panel = draw_label(fit_frame(right, panel_width, panel_height), right_label)
    composed = np.concatenate([left_panel, right_panel], axis=1)
    if progress is None:
        return composed
    return draw_progress(composed, progress)
