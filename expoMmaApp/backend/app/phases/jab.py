"""Deterministic jab movement-phase detector.

Ports V1 *concepts* from extractActiveMotionWindow (baseline, peak, start
threshold) without DTW, scoring, window padding, or fallback-to-frame-0.
If a five-phase order cannot be established, the result is invalid.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.models.phases import (
    ExtensionSample,
    MovementPhase,
    PhaseDetectionResult,
    PhasePick,
)
from app.phases.jab_config import JAB_PHASE_CONFIG, JabPhaseConfig
from app.phases.smoothing import moving_average


def detect_jab_phases(
    samples: Sequence[ExtensionSample],
    config: JabPhaseConfig = JAB_PHASE_CONFIG,
) -> PhaseDetectionResult:
    raw_values = tuple(sample.raw for sample in samples)
    smoothed_values = tuple(moving_average(raw_values, config.smoothing_window))

    usable = [
        (index, sample, smoothed)
        for index, (sample, smoothed) in enumerate(zip(samples, smoothed_values, strict=True))
        if smoothed is not None
    ]
    empty = PhaseDetectionResult(
        valid=False,
        failure_reason=None,
        failure_message=None,
        baseline=None,
        peak_extension=None,
        extension_delta=None,
        phases=(),
        raw_values=raw_values,
        smoothed_values=smoothed_values,
    )
    if len(usable) < config.min_usable_samples:
        return _fail(
            empty,
            "insufficient_pose_coverage",
            "Not enough frames with a usable lead-arm extension signal.",
        )

    smoothed_only = [value for _, _, value in usable]
    baseline = _baseline(smoothed_only, config.baseline_lowest_fraction)
    peak_local, peak_smoothed = _argmax(smoothed_only)
    if baseline is None or peak_smoothed is None:
        return _fail(
            empty,
            "no_meaningful_extension_peak",
            "Could not compute a baseline or peak from the extension signal.",
        )

    delta = peak_smoothed - baseline
    if delta < config.min_extension_delta:
        return _fail(
            empty,
            "no_meaningful_extension_peak",
            (
                "No meaningful lead-arm extension peak was detected "
                f"(delta={delta:.3f}, min={config.min_extension_delta:.3f})."
            ),
            baseline,
            peak_smoothed,
            delta,
        )

    peak_sample = usable[peak_local][1]
    start_threshold = baseline + config.start_threshold_fraction * delta
    extension_threshold = baseline + config.extension_threshold_fraction * delta
    retraction_threshold = baseline + config.retraction_threshold_fraction * delta
    recovery_threshold = baseline + config.recovery_threshold_fraction * delta

    start_pick = _last_at_or_below(usable, peak_local, start_threshold)
    if start_pick is None:
        return _fail(
            empty,
            "phase_order_unresolved",
            "Could not locate START before the extension peak.",
            baseline,
            peak_smoothed,
            delta,
        )

    extension_pick = _first_at_or_above(
        usable,
        after_exclusive=start_pick[0],
        before_exclusive=peak_local,
        threshold=extension_threshold,
    )
    if extension_pick is None:
        return _fail(
            empty,
            "phase_order_unresolved",
            "Could not locate EXTENSION between START and PEAK.",
            baseline,
            peak_smoothed,
            delta,
        )

    retraction_pick = _first_at_or_below(
        usable,
        after_exclusive=peak_local,
        threshold=retraction_threshold,
    )
    if retraction_pick is None:
        return _fail(
            empty,
            "arm_does_not_return",
            "Lead arm did not retract after peak extension.",
            baseline,
            peak_smoothed,
            delta,
        )

    recovery_pick = _first_at_or_below(
        usable,
        after_exclusive=retraction_pick[0],
        threshold=recovery_threshold,
    )
    if recovery_pick is None:
        return _fail(
            empty,
            "arm_does_not_return",
            "Lead arm did not return close to the guard/baseline after retraction.",
            baseline,
            peak_smoothed,
            delta,
        )

    phases = (
        _pick(MovementPhase.START, start_pick[1], start_pick[2]),
        _pick(MovementPhase.EXTENSION, extension_pick[1], extension_pick[2]),
        _pick(MovementPhase.PEAK, peak_sample, peak_smoothed),
        _pick(MovementPhase.RETRACTION, retraction_pick[1], retraction_pick[2]),
        _pick(MovementPhase.RECOVERY, recovery_pick[1], recovery_pick[2]),
    )
    if not _strictly_increasing(phases):
        return _fail(
            empty,
            "phase_order_unresolved",
            "Detected phases are not strictly ordered by timestamp.",
            baseline,
            peak_smoothed,
            delta,
        )

    return PhaseDetectionResult(
        valid=True,
        failure_reason=None,
        failure_message=None,
        baseline=baseline,
        peak_extension=peak_smoothed,
        extension_delta=delta,
        phases=phases,
        raw_values=raw_values,
        smoothed_values=smoothed_values,
    )


def _pick(phase: MovementPhase, sample: ExtensionSample, smoothed: float) -> PhasePick:
    return PhasePick(
        phase=phase,
        frame_index=sample.frame_index,
        timestamp_ms=sample.timestamp_ms,
        smoothed_extension=smoothed,
    )


def _fail(
    empty: PhaseDetectionResult,
    reason: str,
    message: str,
    baseline: float | None = None,
    peak: float | None = None,
    delta: float | None = None,
) -> PhaseDetectionResult:
    return PhaseDetectionResult(
        valid=False,
        failure_reason=reason,
        failure_message=message,
        baseline=baseline,
        peak_extension=peak,
        extension_delta=delta,
        phases=(),
        raw_values=empty.raw_values,
        smoothed_values=empty.smoothed_values,
    )


def _baseline(values: Sequence[float], lowest_fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    count = max(1, int(len(ordered) * lowest_fraction))
    lowest = ordered[:count]
    mid = len(lowest) // 2
    if len(lowest) % 2 == 1:
        return lowest[mid]
    return (lowest[mid - 1] + lowest[mid]) / 2.0


def _argmax(values: Sequence[float]) -> tuple[int, float]:
    best_index = 0
    best_value = values[0]
    for index, value in enumerate(values):
        if value > best_value:
            best_index = index
            best_value = value
    return best_index, best_value


def _last_at_or_below(
    usable: Sequence[tuple[int, ExtensionSample, float]],
    before_exclusive: int,
    threshold: float,
) -> tuple[int, ExtensionSample, float] | None:
    found: tuple[int, ExtensionSample, float] | None = None
    for local, item in enumerate(usable):
        if local >= before_exclusive:
            break
        if item[2] <= threshold:
            found = (local, item[1], item[2])
    return found


def _first_at_or_above(
    usable: Sequence[tuple[int, ExtensionSample, float]],
    after_exclusive: int,
    before_exclusive: int,
    threshold: float,
) -> tuple[int, ExtensionSample, float] | None:
    for local, item in enumerate(usable):
        if local <= after_exclusive:
            continue
        if local >= before_exclusive:
            break
        if item[2] >= threshold:
            return (local, item[1], item[2])
    return None


def _first_at_or_below(
    usable: Sequence[tuple[int, ExtensionSample, float]],
    after_exclusive: int,
    threshold: float,
) -> tuple[int, ExtensionSample, float] | None:
    for local, item in enumerate(usable):
        if local <= after_exclusive:
            continue
        if item[2] <= threshold:
            return (local, item[1], item[2])
    return None


def _strictly_increasing(phases: Sequence[PhasePick]) -> bool:
    for previous, current in zip(phases, phases[1:], strict=False):
        if not (
            previous.timestamp_ms < current.timestamp_ms
            and previous.frame_index < current.frame_index
        ):
            return False
    return True
