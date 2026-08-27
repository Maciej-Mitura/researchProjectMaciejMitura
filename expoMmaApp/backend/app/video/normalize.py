"""Temporal normalization for USER ↔ REFERENCE comparison.

Absolute timestamps are not compared. Both executions are mapped onto the
same 0–100% progress axis, then sampled into a shared output duration.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import (
    MIN_COMPARISON_DURATION_MS,
    active_window_padding_ms,
    ai_comparison_duration_ms,
)


@dataclass(frozen=True)
class TimeWindow:
    start_ms: int
    end_ms: int

    @property
    def duration_ms(self) -> int:
        return max(0, self.end_ms - self.start_ms)


def clamp_window(start_ms: int, end_ms: int, video_duration_ms: float) -> TimeWindow:
    duration = max(0, int(round(video_duration_ms)))
    start = max(0, min(start_ms, duration))
    end = max(start, min(end_ms, duration))
    if end <= start:
        end = min(duration, start + 1)
    return TimeWindow(start_ms=start, end_ms=end)


def padded_active_window(
    start_ms: int,
    end_ms: int,
    video_duration_ms: float,
    *,
    padding_ms: int | None = None,
) -> TimeWindow:
    """Expand an active-movement window by a small configurable padding.

    Canonical analysis already pads once. Comparison rendering must pass
    padding_ms=0 when the incoming window is already canonical.
    """
    pad = active_window_padding_ms() if padding_ms is None else max(0, padding_ms)
    return clamp_window(start_ms - pad, end_ms + pad, video_duration_ms)


def crop_window_from_canonical(
    start_ms: int,
    end_ms: int,
    video_duration_ms: float,
    *,
    already_canonical: bool,
    padding_ms: int | None = None,
) -> TimeWindow:
    if already_canonical:
        return clamp_window(start_ms, end_ms, video_duration_ms)
    return padded_active_window(start_ms, end_ms, video_duration_ms, padding_ms=padding_ms)


def normalized_progress(index: int, frame_count: int) -> float:
    if frame_count <= 1:
        return 0.0
    if index <= 0:
        return 0.0
    if index >= frame_count - 1:
        return 1.0
    return index / (frame_count - 1)


def mapped_timestamp_ms(window: TimeWindow, progress: float) -> int:
    progress = min(1.0, max(0.0, progress))
    return int(round(window.start_ms + progress * window.duration_ms))


def output_frame_count(duration_ms: int, fps: float) -> int:
    if fps <= 0:
        raise ValueError("Output FPS must be positive.")
    return max(2, int(round((duration_ms / 1000.0) * fps)))


def quick_comparison_duration_ms(reference_active_ms: int, user_active_ms: int) -> int:
    """Keep an understandable real-time length. Both sides still share 0–100%."""
    return max(reference_active_ms, user_active_ms, MIN_COMPARISON_DURATION_MS)


def ai_target_duration_ms() -> int:
    return ai_comparison_duration_ms()
