"""Centralized Quick Movement Similarity constants.

Prototype heuristic weights, not scientifically validated. They emphasize
spatial execution (pose + path) over total execution speed (timing).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

# MediaPipe visibility floor. Joints below this are treated as unobserved.
MIN_VISIBILITY = 0.3
MIN_TORSO_LENGTH = 1e-6
MIN_JOINTS_PER_SAMPLE = 4
MIN_COMPARABLE_SAMPLES = 8
MIN_COMPARABLE_ANGLES = 2
MIN_PATH_JOINTS = 2

DEFAULT_SAMPLE_COUNT = 60
DEFAULT_WARP_FRACTION = 0.08
WARP_FRACTION_MIN = 0.02
WARP_FRACTION_MAX = 0.12

# Prototype overall mix. Must sum to 1.
POSE_WEIGHT = 0.45
PATH_WEIGHT = 0.40
TIMING_WEIGHT = 0.15

# Pose descriptor mix inside poseSimilarity.
POSE_ANGLE_WEIGHT = 0.65
POSE_GEOMETRY_WEIGHT = 0.35
# Torso-unit distance at which geometry error saturates to 1.0.
GEOMETRY_SATURATION = 0.80
# Exponential mapping: score = 100 * exp(-error / scale). Smaller scale = stricter.
POSE_ERROR_SCALE = 0.42
PATH_ERROR_SCALE = 0.38

# Timing: duration uses |ln(user/ref)|; warp uses mean |i-j| / N.
TIMING_LOG_SCALE = 0.55
TIMING_DURATION_WEIGHT = 0.75
TIMING_WARP_WEIGHT = 0.25

TIMELINE_BUCKETS = 10

COMPONENT_WEIGHTS = (POSE_WEIGHT, PATH_WEIGHT, TIMING_WEIGHT)


def _assert_weights() -> None:
    total = POSE_WEIGHT + PATH_WEIGHT + TIMING_WEIGHT
    if not math.isclose(total, 1.0, abs_tol=1e-9):
        raise RuntimeError(f"Quick similarity weights must sum to 1, got {total}.")
    inner = TIMING_DURATION_WEIGHT + TIMING_WARP_WEIGHT
    if not math.isclose(inner, 1.0, abs_tol=1e-9):
        raise RuntimeError(f"Timing sub-weights must sum to 1, got {inner}.")
    pose_inner = POSE_ANGLE_WEIGHT + POSE_GEOMETRY_WEIGHT
    if not math.isclose(pose_inner, 1.0, abs_tol=1e-9):
        raise RuntimeError(f"Pose sub-weights must sum to 1, got {pose_inner}.")


_assert_weights()


def quick_similarity_samples() -> int:
    raw = os.environ.get("QUICK_SIMILARITY_SAMPLES", "").strip()
    if not raw:
        return DEFAULT_SAMPLE_COUNT
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_SAMPLE_COUNT
    return max(MIN_COMPARABLE_SAMPLES, value)


def quick_similarity_warp_fraction() -> float:
    raw = os.environ.get("QUICK_SIMILARITY_WARP_FRACTION", "").strip()
    if not raw:
        return DEFAULT_WARP_FRACTION
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_WARP_FRACTION
    if not math.isfinite(value):
        return DEFAULT_WARP_FRACTION
    return min(WARP_FRACTION_MAX, max(WARP_FRACTION_MIN, value))


@dataclass(frozen=True)
class SimilaritySettings:
    sample_count: int
    warp_fraction: float
    pose_weight: float = POSE_WEIGHT
    path_weight: float = PATH_WEIGHT
    timing_weight: float = TIMING_WEIGHT


def similarity_settings() -> SimilaritySettings:
    return SimilaritySettings(
        sample_count=quick_similarity_samples(),
        warp_fraction=quick_similarity_warp_fraction(),
    )
