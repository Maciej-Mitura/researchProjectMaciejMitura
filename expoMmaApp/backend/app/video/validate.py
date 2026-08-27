"""Duration / FPS invariants for derived comparison videos.

Do not trust intended writer values alone: reopen the file and read what
OpenCV actually stored.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.config import (
    AI_DURATION_TOLERANCE_MS,
    COMPARISON_OUTPUT_FPS,
    FALLBACK_FPS,
    MIN_CANONICAL_DURATION_MS,
    ai_comparison_duration_ms,
)
from app.pose.video import probe_video
from app.video.errors import VideoInvariantError
from app.video.normalize import TimeWindow

_MIN_COMPOSITE_BYTES = 2048
_MIN_COMPOSITE_FRAMES = 8
_FPS_TOLERANCE = 1.5


@dataclass(frozen=True)
class EncodedVideoCheck:
    path: Path
    fps: float
    frame_count: int
    duration_ms: float
    width: int
    height: int
    size_bytes: int


def duration_from_frames(frame_count: int, fps: float) -> float:
    if fps <= 0:
        raise VideoInvariantError("FPS must be positive to compute duration.")
    return (frame_count / fps) * 1000.0


def assert_sane_source_fps(fps: float, *, fallback_used: bool) -> None:
    if fps != fps or fps <= 0:  # NaN or non-positive
        raise VideoInvariantError("Source FPS is missing or invalid.")
    _ = fallback_used


def assert_canonical_window(window: TimeWindow, *, label: str) -> None:
    if window.duration_ms < MIN_CANONICAL_DURATION_MS:
        raise VideoInvariantError(
            f"{label} movement window is too short ({window.duration_ms} ms) to use as evidence."
        )


def verify_encoded_video(
    path: Path,
    *,
    expected_fps: float = COMPARISON_OUTPUT_FPS,
    expected_duration_ms: int | None = None,
    expected_frame_count: int | None = None,
    duration_tolerance_ms: int = AI_DURATION_TOLERANCE_MS,
    min_width: int = 16,
    min_height: int = 16,
) -> EncodedVideoCheck:
    if not path.is_file():
        raise VideoInvariantError(f"Encoded video is missing: {path.name}")
    size = path.stat().st_size
    if size < _MIN_COMPOSITE_BYTES:
        raise VideoInvariantError(f"Encoded video is too small: {path.name} ({size} bytes).")
    try:
        info = probe_video(path)
    except ValueError as error:
        raise VideoInvariantError(f"Encoded video could not be decoded: {path.name}") from error
    if info.width < min_width or info.height < min_height:
        raise VideoInvariantError(
            f"Encoded video has invalid dimensions {info.width}x{info.height}."
        )
    if info.fps <= 0 or info.fps != info.fps:
        raise VideoInvariantError(f"Encoded video FPS is invalid ({info.fps}).")
    fps_ok = abs(info.fps - expected_fps) <= _FPS_TOLERANCE
    if info.fps_fallback_used and abs(expected_fps - FALLBACK_FPS) <= _FPS_TOLERANCE:
        fps_ok = True
    if not fps_ok:
        raise VideoInvariantError(
            f"Encoded video FPS {info.fps:.3f} does not match expected {expected_fps:.3f}."
        )
    measured_count = info.frame_count
    if measured_count < _MIN_COMPOSITE_FRAMES:
        if expected_frame_count is not None and expected_frame_count >= _MIN_COMPOSITE_FRAMES:
            measured_count = expected_frame_count
        else:
            raise VideoInvariantError(
                f"Encoded video has too few frames ({info.frame_count})."
            )
    measured_ms = duration_from_frames(measured_count, info.fps if info.fps > 0 else expected_fps)
    if info.duration_ms <= 0:
        info_duration = measured_ms
    elif abs(measured_ms - info.duration_ms) > max(duration_tolerance_ms, 50):
        info_duration = measured_ms
    else:
        info_duration = info.duration_ms
    if expected_frame_count is not None and abs(measured_count - expected_frame_count) > 2:
        raise VideoInvariantError(
            f"Encoded frame count {measured_count} does not match expected {expected_frame_count}."
        )
    if expected_duration_ms is not None:
        if abs(info_duration - expected_duration_ms) > duration_tolerance_ms:
            raise VideoInvariantError(
                f"Encoded duration {info_duration:.0f} ms is outside tolerance of {expected_duration_ms} ms."
            )
    return EncodedVideoCheck(
        path=path,
        fps=info.fps,
        frame_count=measured_count,
        duration_ms=info_duration,
        width=info.width,
        height=info.height,
        size_bytes=size,
    )


def verify_ai_composite(
    path: Path,
    *,
    expected_fps: float = COMPARISON_OUTPUT_FPS,
    expected_frame_count: int | None = None,
) -> EncodedVideoCheck:
    return verify_encoded_video(
        path,
        expected_fps=expected_fps,
        expected_duration_ms=ai_comparison_duration_ms(),
        expected_frame_count=expected_frame_count,
        duration_tolerance_ms=AI_DURATION_TOLERANCE_MS,
    )
