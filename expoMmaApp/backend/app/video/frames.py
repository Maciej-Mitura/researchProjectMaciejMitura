"""Load and sample frames inside a cropped active-movement window."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from app.pose.video import iter_video_frames, probe_video
from app.video.errors import VideoCompositeError
from app.video.normalize import TimeWindow, mapped_timestamp_ms

BgrFrame = NDArray[np.uint8]


@dataclass(frozen=True)
class WindowFrame:
    timestamp_ms: int
    bgr: BgrFrame


def load_window_frames(path: Path, window: TimeWindow, *, fps: float | None = None) -> list[WindowFrame]:
    if not path.is_file():
        raise VideoCompositeError(f"Video file is missing: {path.name}")
    try:
        video_fps = probe_video(path).fps if fps is None else fps
    except ValueError as error:
        raise VideoCompositeError("The recording could not be opened for comparison.") from error

    frames: list[WindowFrame] = []
    try:
        for decoded in iter_video_frames(path, video_fps):
            if decoded.timestamp_ms < window.start_ms:
                continue
            if decoded.timestamp_ms > window.end_ms:
                break
            frames.append(WindowFrame(timestamp_ms=decoded.timestamp_ms, bgr=decoded.bgr.copy()))
    except ValueError as error:
        raise VideoCompositeError("The recording could not be decoded for comparison.") from error

    if not frames:
        raise VideoCompositeError("No frames were found in the detected movement window.")
    return frames


def sample_frame_at_progress(frames: Sequence[WindowFrame], window: TimeWindow, progress: float) -> WindowFrame:
    if not frames:
        raise VideoCompositeError("Cannot sample an empty movement clip.")
    target_ms = mapped_timestamp_ms(window, progress)
    nearest = min(frames, key=lambda item: abs(item.timestamp_ms - target_ms))
    return nearest
