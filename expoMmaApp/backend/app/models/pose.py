from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Landmark:
    """One MediaPipe pose landmark in image-normalized coordinates."""

    x: float
    y: float
    z: float
    visibility: float | None
    presence: float | None


@dataclass(frozen=True)
class PoseFrame:
    frame_index: int
    timestamp_ms: int
    landmarks: tuple[Landmark, ...] | None
    pose_detected: bool


@dataclass(frozen=True)
class VideoInfo:
    fps: float
    fps_fallback_used: bool
    frame_count: int
    width: int
    height: int
    duration_ms: float
