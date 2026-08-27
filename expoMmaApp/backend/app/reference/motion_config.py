"""Thresholds for generic whole-body active-movement detection.

These are measurement gates, not MMA technique scores. They only answer
whether a recording contains a measurable burst of motion.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS, generic_movement_max_gap_ms


@dataclass(frozen=True)
class MotionConfig:
    min_visibility: float = 0.3
    min_torso_length: float = 1e-6
    torso_median_window: int = 10
    min_joints_per_frame: int = 4

    smoothing_window: int = 5
    smoothing_method: str = "moving_average"

    # Stillness proxy: median of the lowest 25% of the smoothed signal.
    baseline_lowest_fraction: float = 0.25

    # Peak-minus-baseline in body-scale units (displacement / torso length).
    # MediaPipe jitter on a still person is much smaller than a strike/kick.
    min_motion_delta: float = 0.020

    # First movement: smoothed signal rises above baseline + this fraction of delta.
    onset_threshold_fraction: float = 0.30

    # Held pose: after onset, signal stays below baseline + this fraction of delta.
    stillness_threshold_fraction: float = 0.15

    # Normalized energy (0–1 vs peak-baseline) for *all* meaningful regions.
    # Lower than onset_threshold_fraction so weaker early combo hits are kept.
    region_energy_threshold: float = 0.15
    region_still_energy_threshold: float = 0.08

    # Ignore one- or two-frame jitters before treating motion as the technique.
    min_onset_ms: int = 150

    # End the technique on the first pose held this long, otherwise use last motion.
    hold_still_ms: int = 1000

    # Merge combo pauses shorter than this; do not join multi-second idle gaps.
    # Prototype default: 500 ms (15 frames at 30 FPS). Overridable via env.
    max_gap_ms: int = DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS

    min_usable_samples: int = 8
    min_window_frames: int = 5
    min_pose_coverage: float = 0.70
    min_major_landmark_coverage: float = 0.50


def motion_config() -> MotionConfig:
    """Runtime config so GENERIC_MOVEMENT_MAX_GAP_MS can be overridden in env."""
    return MotionConfig(max_gap_ms=generic_movement_max_gap_ms())


MOTION_CONFIG = MotionConfig()
