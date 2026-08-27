"""Complete-technique window: first meaningful movement through last recovery.

The motion signal is frame-to-frame speed. A combo's loudest burst is often
the last action, not the whole technique. This module therefore does not crop
to the strongest isolated peak.

Instead:
1. Smooth and normalize movement energy against the recording baseline/peak.
2. Detect every meaningful activity region (not only the global onset).
3. Reject tiny isolated noise.
4. Merge nearby regions separated by short combo pauses.
5. Choose one complete technique envelope (longest merged cluster).
6. Extend through recovery / held end pose after the last region.
7. Callers add a small start/end padding once (canonical clip).
"""

from __future__ import annotations

from collections.abc import Sequence

from app.phases.smoothing import moving_average
from app.reference.models import ActiveWindowResult, MotionRegion, MotionSample
from app.reference.motion_config import MotionConfig, motion_config


INCOMPLETE_MOVEMENT_REASON = "incomplete_movement_window"
INCOMPLETE_MOVEMENT_MESSAGE = (
    "The complete movement could not be prepared from this recording. Please retry the recording."
)


def detect_active_window(
    samples: Sequence[MotionSample],
    config: MotionConfig | None = None,
) -> ActiveWindowResult:
    cfg = config if config is not None else motion_config()
    raw = tuple(sample.raw for sample in samples)
    smoothed = tuple(moving_average(raw, cfg.smoothing_window))
    valid_values = [value for value in smoothed if value is not None]

    if len(samples) < cfg.min_usable_samples or len(valid_values) < cfg.min_usable_samples:
        return _invalid(
            "insufficient_motion_samples",
            "Not enough usable pose frames to measure movement.",
            raw,
            smoothed,
        )

    ordered = sorted(valid_values)
    lowest_count = max(1, int(round(len(ordered) * cfg.baseline_lowest_fraction)))
    baseline = _median(ordered[:lowest_count])
    peak = max(valid_values)
    delta = peak - baseline
    if delta < cfg.min_motion_delta:
        return _invalid(
            "no_meaningful_movement",
            "No meaningful movement was detected. Perform the technique once, then hold still.",
            raw,
            smoothed,
            baseline=baseline,
            peak=peak,
            motion_delta=delta,
        )

    energy = _normalized_energy(smoothed, baseline, delta)
    moving = _hysteresis_moving(
        energy,
        cfg.region_energy_threshold,
        cfg.region_still_energy_threshold,
    )
    regions = _meaningful_regions(samples, moving, cfg.min_onset_ms)
    if not regions:
        return _invalid(
            "no_meaningful_movement",
            "No contiguous movement window was found.",
            raw,
            smoothed,
            baseline=baseline,
            peak=peak,
            motion_delta=delta,
        )

    clusters = cluster_regions(regions, cfg.max_gap_ms)
    chosen = _select_cluster(clusters)
    start_i = chosen[0].start_frame_index
    end_i = chosen[-1].end_frame_index
    next_start = _next_cluster_start(clusters, chosen)

    start_i = _index_for_frame(samples, start_i)
    end_i = _index_for_frame(samples, end_i)
    hold_limit = None if next_start is None else _index_for_frame(samples, next_start)
    hold_i = _first_sustained_hold(samples, moving, end_i, cfg.hold_still_ms, before_index=hold_limit)
    if hold_i is not None:
        end_i = hold_i
    else:
        last = _last_movement(moving, end_i, before_index=hold_limit)
        if last is not None:
            end_i = last

    if end_i < start_i:
        return _invalid(
            "no_meaningful_movement",
            "No contiguous movement window was found.",
            raw,
            smoothed,
            baseline=baseline,
            peak=peak,
            motion_delta=delta,
            regions=tuple(chosen),
        )

    window_frames = end_i - start_i + 1
    if window_frames < cfg.min_window_frames:
        return _invalid(
            "movement_window_too_short",
            "The detected movement was too short to extract five keyframes.",
            raw,
            smoothed,
            baseline=baseline,
            peak=peak,
            motion_delta=delta,
            regions=tuple(chosen),
        )

    sanity = validate_envelope(regions, chosen, samples[start_i], samples[end_i], cfg.max_gap_ms)
    if sanity is not None:
        reason, message = sanity
        return _invalid(
            reason,
            message,
            raw,
            smoothed,
            baseline=baseline,
            peak=peak,
            motion_delta=delta,
            regions=tuple(regions),
        )

    start = samples[start_i]
    end = samples[end_i]
    return ActiveWindowResult(
        valid=True,
        failure_reason=None,
        failure_message=None,
        baseline=baseline,
        peak=peak,
        motion_delta=delta,
        start_ms=start.timestamp_ms,
        end_ms=end.timestamp_ms,
        start_frame_index=start.frame_index,
        end_frame_index=end.frame_index,
        raw_values=raw,
        smoothed_values=smoothed,
        regions=tuple(chosen),
        canonical_start_ms=start.timestamp_ms,
        canonical_end_ms=end.timestamp_ms,
        padding_applied=False,
        canonical=False,
    )


def cluster_regions(regions: Sequence[MotionRegion], max_gap_ms: int) -> list[list[MotionRegion]]:
    """Group regions whose separating gaps are short combo pauses."""
    if not regions:
        return []
    ordered = sorted(regions, key=lambda item: item.start_ms)
    clusters: list[list[MotionRegion]] = [[ordered[0]]]
    for region in ordered[1:]:
        gap = region.start_ms - clusters[-1][-1].end_ms
        if gap <= max_gap_ms:
            clusters[-1].append(region)
        else:
            clusters.append([region])
    return clusters


def validate_envelope(
    all_regions: Sequence[MotionRegion],
    chosen: Sequence[MotionRegion],
    start: MotionSample,
    end: MotionSample,
    max_gap_ms: int,
) -> tuple[str, str] | None:
    """Fail closed when the envelope dropped nearby meaningful regions.

    Example: four short-gap bursts exist but the window only covers the last one.
    """
    if not chosen:
        return INCOMPLETE_MOVEMENT_REASON, INCOMPLETE_MOVEMENT_MESSAGE

    window_start = start.timestamp_ms
    window_end = end.timestamp_ms
    for region in all_regions:
        inside = region.start_ms >= window_start - 1 and region.end_ms <= window_end + 1
        if inside:
            continue
        if region.end_ms < window_start:
            gap = window_start - region.end_ms
        elif region.start_ms > window_end:
            gap = region.start_ms - window_end
        else:
            gap = 0
        if gap <= max_gap_ms:
            return INCOMPLETE_MOVEMENT_REASON, INCOMPLETE_MOVEMENT_MESSAGE

    if len(all_regions) >= 2:
        mergeable = cluster_regions(all_regions, max_gap_ms)
        if len(mergeable) == 1:
            span = all_regions[-1].end_ms - all_regions[0].start_ms
            duration = window_end - window_start
            if span > 0 and duration < int(round(0.35 * span)):
                return INCOMPLETE_MOVEMENT_REASON, INCOMPLETE_MOVEMENT_MESSAGE
            if chosen[0].start_ms > all_regions[0].start_ms + max_gap_ms:
                return INCOMPLETE_MOVEMENT_REASON, INCOMPLETE_MOVEMENT_MESSAGE
            if chosen[-1].end_ms + max_gap_ms < all_regions[-1].end_ms:
                return INCOMPLETE_MOVEMENT_REASON, INCOMPLETE_MOVEMENT_MESSAGE
    return None


def video_crop_ms(window: ActiveWindowResult) -> tuple[int, int]:
    """Timestamps into the RAW file for comparison rendering.

    Uses the padded canonical span when padding has already been applied.
    """
    if window.canonical_start_ms is not None and window.canonical_end_ms is not None:
        return window.canonical_start_ms, window.canonical_end_ms
    if window.start_ms is None or window.end_ms is None:
        raise ValueError("Active window has no timestamps.")
    return window.start_ms, window.end_ms


def apply_canonical_padding(
    window: ActiveWindowResult,
    video_duration_ms: float,
    *,
    padding_ms: int,
) -> ActiveWindowResult:
    """Pad the envelope once and mark it canonical. Do not pad again later."""
    if not window.valid or window.start_ms is None or window.end_ms is None:
        return window
    if window.padding_applied:
        return window
    duration = max(0, int(round(video_duration_ms)))
    pad = max(0, padding_ms)
    start = max(0, min(window.start_ms - pad, duration))
    end = max(start, min(window.end_ms + pad, duration))
    if end <= start:
        end = min(duration, start + 1)
    return ActiveWindowResult(
        valid=window.valid,
        failure_reason=window.failure_reason,
        failure_message=window.failure_message,
        baseline=window.baseline,
        peak=window.peak,
        motion_delta=window.motion_delta,
        start_ms=window.start_ms,
        end_ms=window.end_ms,
        start_frame_index=window.start_frame_index,
        end_frame_index=window.end_frame_index,
        raw_values=window.raw_values,
        smoothed_values=window.smoothed_values,
        regions=window.regions,
        canonical_start_ms=start,
        canonical_end_ms=end,
        padding_applied=True,
        canonical=True,
    )


def _normalized_energy(
    smoothed: Sequence[float | None],
    baseline: float,
    delta: float,
) -> list[float | None]:
    if delta <= 0:
        return [None if value is None else 0.0 for value in smoothed]
    energy: list[float | None] = []
    for value in smoothed:
        if value is None:
            energy.append(None)
            continue
        energy.append(max(0.0, min(1.0, (value - baseline) / delta)))
    return energy


def _meaningful_regions(
    samples: Sequence[MotionSample],
    moving: Sequence[bool],
    min_onset_ms: int,
) -> list[MotionRegion]:
    regions: list[MotionRegion] = []
    for state, start, end in _boolean_runs(moving):
        if not state:
            continue
        if _span_ms(samples, start, end) < min_onset_ms:
            continue
        regions.append(
            MotionRegion(
                start_ms=samples[start].timestamp_ms,
                end_ms=samples[end].timestamp_ms,
                start_frame_index=samples[start].frame_index,
                end_frame_index=samples[end].frame_index,
            )
        )
    return regions


def _select_cluster(clusters: Sequence[Sequence[MotionRegion]]) -> list[MotionRegion]:
    def key(cluster: Sequence[MotionRegion]) -> tuple[int, int]:
        active = sum(region.duration_ms for region in cluster)
        span = cluster[-1].end_ms - cluster[0].start_ms
        return (active, span)

    chosen = max(clusters, key=key)
    return list(chosen)


def _next_cluster_start(
    clusters: Sequence[Sequence[MotionRegion]],
    chosen: Sequence[MotionRegion],
) -> int | None:
    chosen_end = chosen[-1].end_ms
    later = [cluster[0].start_frame_index for cluster in clusters if cluster[0].start_ms > chosen_end]
    if not later:
        return None
    return min(later)


def _index_for_frame(samples: Sequence[MotionSample], frame_index: int) -> int:
    for index, sample in enumerate(samples):
        if sample.frame_index == frame_index:
            return index
    return min(max(0, frame_index), len(samples) - 1)


def _hysteresis_moving(
    smoothed: Sequence[float | None],
    onset_threshold: float,
    still_threshold: float,
) -> list[bool]:
    moving = False
    mask: list[bool] = []
    for value in smoothed:
        if value is None:
            mask.append(moving)
            continue
        if moving:
            if value < still_threshold:
                moving = False
        elif value >= onset_threshold:
            moving = True
        mask.append(moving)
    return mask


def _boolean_runs(mask: Sequence[bool]) -> list[tuple[bool, int, int]]:
    if not mask:
        return []
    runs: list[tuple[bool, int, int]] = []
    state = mask[0]
    start = 0
    for index in range(1, len(mask)):
        if mask[index] != state:
            runs.append((state, start, index - 1))
            state = mask[index]
            start = index
    runs.append((state, start, len(mask) - 1))
    return runs


def _span_ms(samples: Sequence[MotionSample], start: int, end: int) -> int:
    if end < start:
        return 0
    return max(0, samples[end].timestamp_ms - samples[start].timestamp_ms)


def _first_sustained_hold(
    samples: Sequence[MotionSample],
    moving: Sequence[bool],
    after_index: int,
    hold_still_ms: int,
    *,
    before_index: int | None = None,
) -> int | None:
    limit = len(moving) if before_index is None else min(before_index, len(moving))
    for state, start, end in _boolean_runs(moving):
        if state or end < after_index or start >= limit:
            continue
        hold_start = max(start, after_index)
        hold_end = min(end, limit - 1)
        if hold_end < hold_start:
            continue
        if _span_ms(samples, hold_start, hold_end) >= hold_still_ms:
            return hold_start
    return None


def _last_movement(
    moving: Sequence[bool],
    after_index: int,
    *,
    before_index: int | None = None,
) -> int | None:
    last: int | None = None
    limit = len(moving) if before_index is None else min(before_index, len(moving))
    for index in range(after_index, limit):
        if moving[index]:
            last = index
    return last


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _invalid(
    reason: str,
    message: str,
    raw: tuple[float | None, ...],
    smoothed: tuple[float | None, ...],
    *,
    baseline: float | None = None,
    peak: float | None = None,
    motion_delta: float | None = None,
    regions: tuple[MotionRegion, ...] = (),
) -> ActiveWindowResult:
    return ActiveWindowResult(
        valid=False,
        failure_reason=reason,
        failure_message=message,
        baseline=baseline,
        peak=peak,
        motion_delta=motion_delta,
        start_ms=None,
        end_ms=None,
        start_frame_index=None,
        end_frame_index=None,
        raw_values=raw,
        smoothed_values=smoothed,
        regions=regions,
        canonical_start_ms=None,
        canonical_end_ms=None,
        padding_applied=False,
        canonical=False,
    )
