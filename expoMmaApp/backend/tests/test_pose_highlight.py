"""Pose-overlay highlight tests. No Gemini. No live camera pose."""

from __future__ import annotations

import numpy as np

from app.pose.landmarks import PoseLandmarkIndex
from app.video.highlight import resolve_highlight
from app.video.pose_overlay import USER_HIGHLIGHT_JOINT, overlay_pose
from tests.reference_helpers import standing_landmarks


def _frame() -> np.ndarray:
    return np.zeros((120, 160, 3), dtype=np.uint8)


def test_pose_overlay_works_without_highlight_data() -> None:
    frame = _frame()
    drawn = overlay_pose(frame, standing_landmarks())
    assert drawn.shape == frame.shape
    assert drawn.dtype == frame.dtype
    # Default joints are cyan (BGR 0,255,255), not the orange user highlight.
    assert (drawn == USER_HIGHLIGHT_JOINT).all(axis=2).sum() == 0
    assert drawn.sum() > 0


def test_user_highlight_paints_requested_joint() -> None:
    spec = resolve_highlight("right_wrist")
    assert spec is not None
    landmarks = standing_landmarks()
    normal = overlay_pose(_frame(), landmarks)
    highlighted = overlay_pose(
        _frame(),
        landmarks,
        highlight_joint=spec.joint_index,
        highlight_connections=spec.connections,
        mode="user",
    )
    wrist = landmarks[int(PoseLandmarkIndex.RIGHT_WRIST)]
    x = int(round(wrist.x * 160))
    y = int(round(wrist.y * 120))
    assert tuple(highlighted[y, x]) == USER_HIGHLIGHT_JOINT
    assert tuple(normal[y, x]) != USER_HIGHLIGHT_JOINT


def test_highlight_does_not_apply_in_normal_mode() -> None:
    spec = resolve_highlight("right_wrist")
    assert spec is not None
    drawn = overlay_pose(
        _frame(),
        standing_landmarks(),
        highlight_joint=spec.joint_index,
        highlight_connections=spec.connections,
        mode="normal",
    )
    assert (drawn == USER_HIGHLIGHT_JOINT).all(axis=2).sum() == 0
