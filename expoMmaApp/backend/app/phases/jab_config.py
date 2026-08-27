"""Centralized jab movement-phase thresholds.

Adapted from V1 `extractActiveMotionWindow` / attempt-quality checks in
`mma-trainer/src/app/training/live-demo/page.tsx`. Scoring, DTW, and
penalties were not ported.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JabPhaseConfig:
    # Landmark usability
    min_visibility: float = 0.3
    min_torso_length: float = 1e-6
    torso_median_window: int = 10

    # Smoothing: 5-frame centered moving average (~167 ms at 30 FPS).
    # A jab extension typically lasts a few hundred milliseconds, so this
    # window reduces MediaPipe jitter without flattening the peak.
    smoothing_window: int = 5
    smoothing_method: str = "moving_average"

    # Baseline = median of the lowest 20% of smoothed extension (V1 guard proxy).
    baseline_lowest_fraction: float = 0.20

    # Measurement gate, not a technique score. V1 EXT_MIN_DELTA = 0.20.
    min_extension_delta: float = 0.20

    # START: last pre-peak frame at or below baseline + 0.25 * delta (V1 window start).
    start_threshold_fraction: float = 0.25

    # EXTENSION: first pre-peak frame at or above baseline + 0.50 * delta.
    extension_threshold_fraction: float = 0.50

    # RETRACTION: first post-peak frame at or below baseline + 0.50 * delta.
    retraction_threshold_fraction: float = 0.50

    # RECOVERY: first frame after retraction at or below baseline + 0.20 * delta.
    # V1 active-window *end* used 0.35; V1 recoil used 0.20 of excursion.
    # Recovery is "back to guard", so the tighter recoil fraction is used.
    recovery_threshold_fraction: float = 0.20

    min_usable_samples: int = 8
    edge_margin: float = 0.02


JAB_PHASE_CONFIG = JabPhaseConfig()
