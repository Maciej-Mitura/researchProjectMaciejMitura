"""Post-analysis MediaPipe skeleton overlay.

This is NOT live camera pose. Landmarks come from the same server-side
VIDEO-mode landmarker already used for active-window detection.
"""

from __future__ import annotations

from collections.abc import Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import PoseLandmarkIndex

BgrFrame = NDArray[np.uint8]

# Conventional MediaPipe Pose connections (33-landmark BlazePose topology).
POSE_CONNECTIONS: tuple[tuple[PoseLandmarkIndex, PoseLandmarkIndex], ...] = (
    (PoseLandmarkIndex.NOSE, PoseLandmarkIndex.LEFT_EYE_INNER),
    (PoseLandmarkIndex.LEFT_EYE_INNER, PoseLandmarkIndex.LEFT_EYE),
    (PoseLandmarkIndex.LEFT_EYE, PoseLandmarkIndex.LEFT_EYE_OUTER),
    (PoseLandmarkIndex.LEFT_EYE_OUTER, PoseLandmarkIndex.LEFT_EAR),
    (PoseLandmarkIndex.NOSE, PoseLandmarkIndex.RIGHT_EYE_INNER),
    (PoseLandmarkIndex.RIGHT_EYE_INNER, PoseLandmarkIndex.RIGHT_EYE),
    (PoseLandmarkIndex.RIGHT_EYE, PoseLandmarkIndex.RIGHT_EYE_OUTER),
    (PoseLandmarkIndex.RIGHT_EYE_OUTER, PoseLandmarkIndex.RIGHT_EAR),
    (PoseLandmarkIndex.MOUTH_LEFT, PoseLandmarkIndex.MOUTH_RIGHT),
    (PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.RIGHT_SHOULDER),
    (PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_ELBOW),
    (PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.LEFT_WRIST),
    (PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.LEFT_PINKY),
    (PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.LEFT_INDEX),
    (PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.LEFT_THUMB),
    (PoseLandmarkIndex.LEFT_PINKY, PoseLandmarkIndex.LEFT_INDEX),
    (PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_ELBOW),
    (PoseLandmarkIndex.RIGHT_ELBOW, PoseLandmarkIndex.RIGHT_WRIST),
    (PoseLandmarkIndex.RIGHT_WRIST, PoseLandmarkIndex.RIGHT_PINKY),
    (PoseLandmarkIndex.RIGHT_WRIST, PoseLandmarkIndex.RIGHT_INDEX),
    (PoseLandmarkIndex.RIGHT_WRIST, PoseLandmarkIndex.RIGHT_THUMB),
    (PoseLandmarkIndex.RIGHT_PINKY, PoseLandmarkIndex.RIGHT_INDEX),
    (PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_HIP),
    (PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_HIP),
    (PoseLandmarkIndex.LEFT_HIP, PoseLandmarkIndex.RIGHT_HIP),
    (PoseLandmarkIndex.LEFT_HIP, PoseLandmarkIndex.LEFT_KNEE),
    (PoseLandmarkIndex.LEFT_KNEE, PoseLandmarkIndex.LEFT_ANKLE),
    (PoseLandmarkIndex.LEFT_ANKLE, PoseLandmarkIndex.LEFT_HEEL),
    (PoseLandmarkIndex.LEFT_ANKLE, PoseLandmarkIndex.LEFT_FOOT_INDEX),
    (PoseLandmarkIndex.LEFT_HEEL, PoseLandmarkIndex.LEFT_FOOT_INDEX),
    (PoseLandmarkIndex.RIGHT_HIP, PoseLandmarkIndex.RIGHT_KNEE),
    (PoseLandmarkIndex.RIGHT_KNEE, PoseLandmarkIndex.RIGHT_ANKLE),
    (PoseLandmarkIndex.RIGHT_ANKLE, PoseLandmarkIndex.RIGHT_HEEL),
    (PoseLandmarkIndex.RIGHT_ANKLE, PoseLandmarkIndex.RIGHT_FOOT_INDEX),
    (PoseLandmarkIndex.RIGHT_HEEL, PoseLandmarkIndex.RIGHT_FOOT_INDEX),
)

JOINT_COLOR = (0, 255, 255)
BONE_COLOR = (0, 200, 80)
VISIBILITY_MIN = 0.35
USER_HIGHLIGHT_JOINT = (0, 90, 255)
USER_HIGHLIGHT_BONE = (0, 140, 255)
REFERENCE_MARKER = (40, 200, 255)


def overlay_pose(
    frame: BgrFrame,
    landmarks: Sequence[Landmark] | None,
    *,
    highlight_joint: int | None = None,
    highlight_connections: tuple[tuple[int, int], ...] | None = None,
    mode: str = "normal",
) -> BgrFrame:
    """Draw a post-processed skeleton. ``mode`` is normal, user, or reference.

    ``user`` emphasizes the measured joint/segment. ``reference`` adds a small
    corresponding marker. ``normal`` is the existing overlay.
    """
    drawn = frame.copy()
    if not landmarks:
        return drawn
    height, width = drawn.shape[:2]
    points: list[tuple[int, int] | None] = []
    for landmark in landmarks:
        if not _visible(landmark):
            points.append(None)
            continue
        x = int(round(landmark.x * width))
        y = int(round(landmark.y * height))
        points.append((x, y))

    for start, end in POSE_CONNECTIONS:
        a = points[int(start)] if int(start) < len(points) else None
        b = points[int(end)] if int(end) < len(points) else None
        if a is None or b is None:
            continue
        cv2.line(drawn, a, b, BONE_COLOR, 2, cv2.LINE_AA)

    for point in points:
        if point is None:
            continue
        cv2.circle(drawn, point, 4, JOINT_COLOR, thickness=-1, lineType=cv2.LINE_AA)

    if mode == "normal" or highlight_joint is None:
        return drawn
    if mode == "user":
        _draw_user_highlight(drawn, points, highlight_joint, highlight_connections or ())
    elif mode == "reference":
        _draw_reference_marker(drawn, points, highlight_joint)
    return drawn


def _draw_user_highlight(
    drawn: BgrFrame,
    points: list[tuple[int, int] | None],
    joint_index: int,
    connections: tuple[tuple[int, int], ...],
) -> None:
    for start, end in connections:
        a = points[start] if start < len(points) else None
        b = points[end] if end < len(points) else None
        if a is None or b is None:
            continue
        cv2.line(drawn, a, b, USER_HIGHLIGHT_BONE, 5, cv2.LINE_AA)
    if 0 <= joint_index < len(points) and points[joint_index] is not None:
        cv2.circle(
            drawn,
            points[joint_index],
            9,
            USER_HIGHLIGHT_JOINT,
            thickness=-1,
            lineType=cv2.LINE_AA,
        )


def _draw_reference_marker(
    drawn: BgrFrame,
    points: list[tuple[int, int] | None],
    joint_index: int,
) -> None:
    if joint_index < 0 or joint_index >= len(points):
        return
    point = points[joint_index]
    if point is None:
        return
    cv2.circle(drawn, point, 7, REFERENCE_MARKER, thickness=2, lineType=cv2.LINE_AA)


def nearest_pose_landmarks(pose_frames: Sequence[PoseFrame], timestamp_ms: int) -> tuple[Landmark, ...] | None:
    detected = [frame for frame in pose_frames if frame.pose_detected and frame.landmarks]
    if not detected:
        return None
    nearest = min(detected, key=lambda frame: abs(frame.timestamp_ms - timestamp_ms))
    return nearest.landmarks


def _visible(landmark: Landmark) -> bool:
    visibility = landmark.visibility
    if visibility is None:
        return True
    return visibility >= VISIBILITY_MIN
