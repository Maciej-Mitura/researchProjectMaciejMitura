"""Write comparison MP4s. Prefers H.264 when the local OpenCV build supports it.

On Windows, `avc1`/`H264` may open a writer then fail inside libopenh264.
This module therefore tries a full encode per codec and falls back when the
output file is missing, empty, or too small. `reference.mp4` is never rewritten.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from app.video.errors import VideoCompositeError
from app.video.layout import even

logger = logging.getLogger(__name__)

BgrFrame = NDArray[np.uint8]

# avc1/H264 play on phones; mp4v is the reliable OpenCV fallback used in tests
# and when libopenh264 cannot create an encoder.
_FOURCC_CANDIDATES = ("avc1", "H264", "X264", "mp4v")
_MIN_OUTPUT_BYTES = 2048


def write_mp4(path: Path, frames: Sequence[BgrFrame], fps: float) -> Path:
    if not frames:
        raise VideoCompositeError("Cannot write an empty comparison video.")
    if fps <= 0:
        raise VideoCompositeError("Comparison video FPS must be positive.")

    height, width = frames[0].shape[:2]
    width = even(width)
    height = even(height)
    path.parent.mkdir(parents=True, exist_ok=True)
    _unlink_quietly(path)

    last_error: Exception | None = None
    for code in _FOURCC_CANDIDATES:
        try:
            if _encode_with_fourcc(path, frames, fps=fps, width=width, height=height, fourcc_name=code):
                logger.info("Wrote comparison video fourcc=%s bytes=%s name=%s", code, path.stat().st_size, path.name)
                return path
        except Exception as error:
            last_error = error
            logger.warning("Comparison encode failed fourcc=%s name=%s error=%s", code, path.name, error)
            _unlink_quietly(path)

    raise VideoCompositeError("Could not create a comparison MP4 writer on this machine.") from last_error


def _encode_with_fourcc(
    path: Path,
    frames: Sequence[BgrFrame],
    *,
    fps: float,
    width: int,
    height: int,
    fourcc_name: str,
) -> bool:
    fourcc = cv2.VideoWriter_fourcc(*fourcc_name)
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))
    if not writer.isOpened():
        writer.release()
        return False
    try:
        for frame in frames:
            output = _fit_writer_size(frame, width, height)
            writer.write(output)
    finally:
        writer.release()

    if not path.is_file():
        return False
    if path.stat().st_size < _MIN_OUTPUT_BYTES:
        logger.warning(
            "Comparison encode produced a tiny file fourcc=%s bytes=%s name=%s",
            fourcc_name,
            path.stat().st_size,
            path.name,
        )
        _unlink_quietly(path)
        return False
    return True


def _unlink_quietly(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def _fit_writer_size(frame: BgrFrame, width: int, height: int) -> BgrFrame:
    if frame.shape[0] == height and frame.shape[1] == width:
        return frame
    resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(resized)
