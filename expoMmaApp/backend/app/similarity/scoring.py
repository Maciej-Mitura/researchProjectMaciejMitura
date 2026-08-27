"""Deterministic error-to-score mapping for Quick Movement Similarity."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

from app.similarity.config import (
    GEOMETRY_SATURATION,
    PATH_ERROR_SCALE,
    PATH_WEIGHT,
    POSE_ANGLE_WEIGHT,
    POSE_ERROR_SCALE,
    POSE_GEOMETRY_WEIGHT,
    POSE_WEIGHT,
    TIMING_DURATION_WEIGHT,
    TIMING_LOG_SCALE,
    TIMING_WARP_WEIGHT,
    TIMING_WEIGHT,
)
from app.similarity.geometry import (
    PATH_JOINTS,
    euclidean,
)
from app.similarity.sequence import NormalizedSample


def similarity_from_error(error: float, *, scale: float) -> float:
    """Map a non-negative error to 0–100. error=0 → 100. No penalty cliffs."""
    if not math.isfinite(error) or error <= 0.0:
        return 100.0
    if scale <= 0.0:
        return 0.0
    return 100.0 * math.exp(-error / scale)


def round_score(value: float) -> int:
    if not math.isfinite(value):
        return 0
    return int(round(max(0.0, min(100.0, value))))


def pose_distance(reference: NormalizedSample, user: NormalizedSample) -> float | None:
    angle_errors: list[float] = []
    shared_angles = set(reference.angles) & set(user.angles)
    for name in shared_angles:
        angle_errors.append(abs(reference.angles[name] - user.angles[name]) / math.pi)
    geom_errors: list[float] = []
    shared_points = set(reference.points) & set(user.points)
    for joint in shared_points:
        geom_errors.append(euclidean(reference.points[joint], user.points[joint]) / GEOMETRY_SATURATION)

    parts: list[tuple[float, float]] = []
    if angle_errors:
        parts.append((POSE_ANGLE_WEIGHT, sum(angle_errors) / len(angle_errors)))
    if geom_errors:
        parts.append((POSE_GEOMETRY_WEIGHT, min(1.0, sum(geom_errors) / len(geom_errors))))
    if not parts:
        return None
    weight_sum = sum(weight for weight, _error in parts)
    if weight_sum <= 0:
        return None
    return sum(weight * error for weight, error in parts) / weight_sum


def path_distance(
    reference: NormalizedSample,
    user: NormalizedSample,
    weights: Mapping[int, float],
) -> float | None:
    weighted = 0.0
    used = 0.0
    for joint, weight in weights.items():
        if weight <= 0:
            continue
        a = reference.points.get(joint)
        b = user.points.get(joint)
        if a is None or b is None:
            continue
        weighted += weight * euclidean(a, b)
        used += weight
    if used <= 0:
        return None
    return weighted / used


def moving_joint_weights(reference: Sequence[NormalizedSample]) -> dict[int, float]:
    """Weight extremities by how far they travel in the REFERENCE sequence."""
    lengths: dict[int, float] = {int(joint): 0.0 for joint in PATH_JOINTS}
    for previous, current in zip(reference, reference[1:], strict=False):
        for joint in PATH_JOINTS:
            index = int(joint)
            a = previous.points.get(index)
            b = current.points.get(index)
            if a is None or b is None:
                continue
            lengths[index] += euclidean(a, b)
    total = sum(lengths.values())
    if total <= 1e-9:
        visible = [
            int(joint)
            for joint in PATH_JOINTS
            if any(int(joint) in sample.points for sample in reference)
        ]
        if not visible:
            return {}
        share = 1.0 / len(visible)
        return {joint: share for joint in visible}
    return {joint: length / total for joint, length in lengths.items() if length > 0.0}


def timing_similarity(
    *,
    reference_duration_ms: int,
    user_duration_ms: int,
    warp_fraction: float,
) -> float:
    duration_score = duration_similarity(reference_duration_ms, user_duration_ms)
    warp_score = 100.0 * max(0.0, 1.0 - max(0.0, warp_fraction) / 0.12)
    return TIMING_DURATION_WEIGHT * duration_score + TIMING_WARP_WEIGHT * warp_score


def duration_similarity(reference_duration_ms: int, user_duration_ms: int) -> float:
    ref = max(1.0, float(reference_duration_ms))
    user = max(1.0, float(user_duration_ms))
    log_ratio = abs(math.log(user / ref))
    return similarity_from_error(log_ratio, scale=TIMING_LOG_SCALE)


def overall_similarity(pose: float, path: float, timing: float) -> float:
    return POSE_WEIGHT * pose + PATH_WEIGHT * path + TIMING_WEIGHT * timing


def pose_score_from_error(error: float) -> float:
    return similarity_from_error(error, scale=POSE_ERROR_SCALE)


def path_score_from_error(error: float) -> float:
    return similarity_from_error(error, scale=PATH_ERROR_SCALE)


def region_path_distance(
    reference: NormalizedSample,
    user: NormalizedSample,
    joints: Sequence[int],
) -> float | None:
    errors: list[float] = []
    for joint in joints:
        a = reference.points.get(joint)
        b = user.points.get(joint)
        if a is None or b is None:
            continue
        errors.append(euclidean(a, b))
    if not errors:
        return None
    return sum(errors) / len(errors)
