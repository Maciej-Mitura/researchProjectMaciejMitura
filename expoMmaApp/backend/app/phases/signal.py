"""Lead-arm extension signal from pose frames.

extension(t) = distance(lead_wrist, lead_shoulder) / torso_length

torso_length is the 3D distance between shoulder-center and hip-center.
A short running median (V1) keeps the denominator stable when a single
torso landmark jitters.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.models.phases import ExtensionSample
from app.models.pose import Landmark, PoseFrame
from app.phases.jab_config import JAB_PHASE_CONFIG, JabPhaseConfig
from app.pose.landmarks import (
    PoseLandmarkIndex,
    dist3,
    lead_arm_indices,
    midpoint,
)
from app.techniques.catalog import LeadSide


def compute_lead_arm_extension(
    frames: Sequence[PoseFrame],
    lead_side: LeadSide,
    config: JabPhaseConfig = JAB_PHASE_CONFIG,
) -> list[ExtensionSample]:
    wrist_index, shoulder_index = lead_arm_indices(lead_side)
    torso_lengths: list[float] = []
    samples: list[ExtensionSample] = []

    for frame in frames:
        raw = _extension_for_frame(
            frame,
            wrist_index,
            shoulder_index,
            torso_lengths,
            config,
        )
        samples.append(
            ExtensionSample(
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                raw=raw,
            )
        )
    return samples


def _extension_for_frame(
    frame: PoseFrame,
    wrist_index: PoseLandmarkIndex,
    shoulder_index: PoseLandmarkIndex,
    torso_history: list[float],
    config: JabPhaseConfig,
) -> float | None:
    if not frame.pose_detected or frame.landmarks is None:
        return None

    required = (
        wrist_index,
        shoulder_index,
        PoseLandmarkIndex.LEFT_SHOULDER,
        PoseLandmarkIndex.RIGHT_SHOULDER,
        PoseLandmarkIndex.LEFT_HIP,
        PoseLandmarkIndex.RIGHT_HIP,
    )
    points: list[Landmark] = []
    for index in required:
        point = _get_usable(frame.landmarks, index, config.min_visibility)
        if point is None:
            return None
        points.append(point)

    wrist, shoulder, left_shoulder, right_shoulder, left_hip, right_hip = points
    torso_length = dist3(midpoint(left_shoulder, right_shoulder), midpoint(left_hip, right_hip))
    if torso_length < config.min_torso_length:
        return None

    torso_history.append(torso_length)
    stable = _median(torso_history[-config.torso_median_window :])
    if stable is None or stable < config.min_torso_length:
        return None

    extension = dist3(wrist, shoulder) / stable
    if extension != extension or extension < 0:
        return None
    return extension


def _get_usable(
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
