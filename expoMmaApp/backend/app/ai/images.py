"""JPEG preparation for multimodal analysis. No pose overlay."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from app.ai.frames import DenseFramePick
from app.config import AI_IMAGE_MAX_DIMENSION, AI_JPEG_QUALITY
from app.pose.video import iter_video_frames

BgrFrame = NDArray[np.uint8]


def prepare_analysis_bgr(
    bgr: BgrFrame,
    *,
    max_dimension: int = AI_IMAGE_MAX_DIMENSION,
) -> BgrFrame:
    """Downscale so the longest side is at most `max_dimension`. Aspect ratio is kept.

    No cropping. Body proportions are not stretched. Small frames are left as-is.
    """
    if max_dimension < 1:
        raise ValueError("max_dimension must be positive.")
    height, width = bgr.shape[:2]
    longest = max(height, width)
    if longest <= max_dimension:
        return bgr
    scale = max_dimension / float(longest)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    return cv2.resize(bgr, (new_width, new_height), interpolation=cv2.INTER_AREA)


def encode_analysis_jpeg(
    bgr: BgrFrame,
    *,
    quality: int = AI_JPEG_QUALITY,
) -> bytes:
    prepared = prepare_analysis_bgr(bgr)
    ok, encoded = cv2.imencode(
        ".jpg",
        prepared,
        [int(cv2.IMWRITE_JPEG_QUALITY), quality],
    )
    if not ok:
        raise ValueError("Failed to encode analysis JPEG.")
    return bytes(encoded)


def extract_prepared_frames(
    video_path: Path,
    fps: float,
    picks: Sequence[DenseFramePick],
    output_dir: Path,
) -> dict[str, bytes]:
    """Write prepared JPEGs and return filename → bytes. No skeleton overlay."""
    if not picks:
        raise ValueError("No frames requested for extraction.")

    indices = [pick.frame_index for pick in picks]
    if len(set(indices)) != len(indices):
        raise ValueError("Dense frame indices must be distinct.")

    wanted = {pick.frame_index: pick for pick in picks}
    output_dir.mkdir(parents=True, exist_ok=True)
    saved: dict[str, bytes] = {}

    for decoded in iter_video_frames(video_path, fps):
        pick = wanted.get(decoded.frame_index)
        if pick is None:
            continue
        payload = encode_analysis_jpeg(decoded.bgr)
        destination = output_dir / pick.filename
        destination.write_bytes(payload)
        saved[pick.filename] = payload
        if len(saved) == len(wanted):
            break

    missing = [pick.filename for pick in picks if pick.filename not in saved]
    if missing:
        raise ValueError(f"Could not extract analysis frames: {', '.join(missing)}")
    return saved
