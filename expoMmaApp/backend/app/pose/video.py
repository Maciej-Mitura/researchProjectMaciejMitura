"""OpenCV video probing and chronological frame iteration."""

from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from app.config import FALLBACK_FPS
from app.models.pose import VideoInfo

BgrFrame = NDArray[np.uint8]


@dataclass(frozen=True)
class DecodedFrame:
    frame_index: int
    timestamp_ms: int
    bgr: BgrFrame


def resolve_fps(reported_fps: float) -> tuple[float, bool]:
    """Return (fps, used_fallback).

    OpenCV reports 0, NaN, or Inf for some mobile MP4s. A documented 30 FPS
    fallback is used instead of crashing.
    """
    if not math.isfinite(reported_fps) or reported_fps <= 1e-3:
        return FALLBACK_FPS, True
    return float(reported_fps), False


def probe_video(path: Path) -> VideoInfo:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        capture.release()
        raise ValueError(f"Could not open video: {path}")

    try:
        fps, fps_fallback_used = resolve_fps(float(capture.get(cv2.CAP_PROP_FPS)))
        reported_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        capture.release()

    if width <= 0 or height <= 0:
        raise ValueError("Video has invalid frame dimensions.")

    frame_count = reported_count if reported_count > 0 else 0
    duration_ms = (frame_count / fps) * 1000.0 if frame_count > 0 else 0.0
    return VideoInfo(
        fps=fps,
        fps_fallback_used=fps_fallback_used,
        frame_count=frame_count,
        width=width,
        height=height,
        duration_ms=duration_ms,
    )


def iter_video_frames(path: Path, fps: float) -> Iterator[DecodedFrame]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {path}")

    last_timestamp = -1
    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                break
            timestamp_ms = int(round((index * 1000.0) / fps))
            if timestamp_ms <= last_timestamp:
                timestamp_ms = last_timestamp + 1
            last_timestamp = timestamp_ms
            yield DecodedFrame(frame_index=index, timestamp_ms=timestamp_ms, bgr=frame)
            index += 1
    finally:
        capture.release()
