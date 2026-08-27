"""Normalized whole-body movement signal from pose frames.

For each usable frame, take visible major joints, convert their image-normalized
(x, y) positions into body-scale units using torso length, then measure the
mean frame-to-frame displacement of joints that are visible in both frames.

Standing closer to the camera scales both joint motion and torso length, so
the ratio stays body-relative. Landmark z is not used: MediaPipe depth is
noisier than x/y for this purpose.

This is not a technique score.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import (
    MAJOR_BODY_INDICES,
    PoseLandmarkIndex,
    dist3,
    midpoint,
)
from app.reference.models import MotionSample
from app.reference.motion_config import MOTION_CONFIG, MotionConfig


def compute_body_motion(
    frames: Sequence[PoseFrame],
    config: MotionConfig = MOTION_CONFIG,
) -> list[MotionSample]:
    """Return one motion sample per frame. Frame 0 always has raw=None."""
    previous_points: dict[int, tuple[float, float]] | None = None
    previous_scale: float | None = None
    torso_history: list[float] = []
    samples: list[MotionSample] = []

    for frame in frames:
        points, scale = _normalized_joints(frame, torso_history, config)
        raw: float | None = None
        if (
            points is not None
            and scale is not None
            and previous_points is not None
            and previous_scale is not None
        ):
            raw = _mean_displacement(previous_points, points, previous_scale, scale)
        samples.append(
            MotionSample(
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                raw=raw,
            )
        )
        if points is not None and scale is not None:
            previous_points = points
            previous_scale = scale

    return samples


def pose_coverage(frames: Sequence[PoseFrame]) -> float:
    if not frames:
        return 0.0
    detected = sum(1 for frame in frames if frame.pose_detected)
    return detected / len(frames)


def major_landmark_coverage(
    frames: Sequence[PoseFrame],
    config: MotionConfig = MOTION_CONFIG,
) -> float:
    """Fraction of frames where enough major joints are visible."""
    if not frames:
        return 0.0
    ok = 0
    needed = max(config.min_joints_per_frame, 6)
    for frame in frames:
        points, _scale = _normalized_joints(frame, [], config)
        if points is not None and len(points) >= needed:
            ok += 1
    return ok / len(frames)


def _normalized_joints(
    frame: PoseFrame,
    torso_history: list[float],
    config: MotionConfig,
) -> tuple[dict[int, tuple[float, float]] | None, float | None]:
    if not frame.pose_detected or frame.landmarks is None:
        return None, None

    scale = _stable_torso_length(frame, torso_history, config)
    if scale is None:
        return None, None

    points: dict[int, tuple[float, float]] = {}
    for index in MAJOR_BODY_INDICES:
        landmark = _usable(frame.landmarks, index, config.min_visibility)
        if landmark is None:
            continue
        points[int(index)] = (landmark.x / scale, landmark.y / scale)

    if len(points) < config.min_joints_per_frame:
        return None, None
    return points, scale


def _stable_torso_length(
    frame: PoseFrame,
    torso_history: list[float],
    config: MotionConfig,
) -> float | None:
    if frame.landmarks is None:
        return None
    left_shoulder = _usable(frame.landmarks, PoseLandmarkIndex.LEFT_SHOULDER, config.min_visibility)
    right_shoulder = _usable(frame.landmarks, PoseLandmarkIndex.RIGHT_SHOULDER, config.min_visibility)
    left_hip = _usable(frame.landmarks, PoseLandmarkIndex.LEFT_HIP, config.min_visibility)
    right_hip = _usable(frame.landmarks, PoseLandmarkIndex.RIGHT_HIP, config.min_visibility)
    if left_shoulder is None or right_shoulder is None or left_hip is None or right_hip is None:
        return None

    length = dist3(midpoint(left_shoulder, right_shoulder), midpoint(left_hip, right_hip))
    if length < config.min_torso_length:
        return None
    torso_history.append(length)
    stable = _median(torso_history[-config.torso_median_window :])
    if stable is None or stable < config.min_torso_length:
        return None
    return stable


def _mean_displacement(
    previous: dict[int, tuple[float, float]],
    current: dict[int, tuple[float, float]],
    previous_scale: float,
    current_scale: float,
) -> float | None:
    shared = set(previous) & set(current)
    if len(shared) < MOTION_CONFIG.min_joints_per_frame:
        return None
    _ = previous_scale, current_scale
    distances: list[float] = []
    for index in shared:
        x0, y0 = previous[index]
        x1, y1 = current[index]
        dx = x1 - x0
        dy = y1 - y0
        distances.append((dx * dx + dy * dy) ** 0.5)
    distances.sort(reverse=True)
    # Mean of the four most-moving joints so a punch or kick is not diluted
    # by the many still landmarks on the rest of the body.
    leading = distances[:4]
    return sum(leading) / len(leading)


def _usable(
    landmarks: Sequence[Landmark],
    index: PoseLandmarkIndex,
    min_visibility: float,
) -> Landmark | None:
    if index >= len(landmarks):
        return None
    point = landmarks[index]
    visibility = 1.0 if point.visibility is None else point.visibility
    if visibility < min_visibility:
        return None
    return point


def _median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0
