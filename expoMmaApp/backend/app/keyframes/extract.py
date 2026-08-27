"""Save original video frames as JPEG keyframes. No pose overlay."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import cv2

from app.config import JPEG_QUALITY, KEYFRAME_FILENAMES
from app.models.phases import PhasePick
from app.pose.video import iter_video_frames


def extract_named_frames(
    video_path: Path,
    fps: float,
    frames_to_save: list[tuple[int, str]],
    output_dir: Path,
) -> dict[str, str]:
    """Write original source frames as JPEGs. No pose overlay.

    `frames_to_save` is a list of `(frame_index, filename)` with distinct indices.
    `filename` is a bare file name (no directories).
    """
    if not frames_to_save:
        raise ValueError("No frames requested for extraction.")

    indices = [index for index, _filename in frames_to_save]
    if len(set(indices)) != len(indices):
        raise ValueError("Keyframe frame indices must be distinct.")

    for _index, filename in frames_to_save:
        if Path(filename).name != filename or "/" in filename or "\\" in filename:
            raise ValueError(f"Unsafe keyframe filename: {filename}")

    wanted = {index: filename for index, filename in frames_to_save}
    output_dir.mkdir(parents=True, exist_ok=True)

    saved: dict[str, str] = {}
    for decoded in iter_video_frames(video_path, fps):
        filename = wanted.get(decoded.frame_index)
        if filename is None:
            continue
        destination = output_dir / filename
        ok = cv2.imwrite(
            str(destination),
            decoded.bgr,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )
        if not ok:
            raise ValueError(f"Failed to write keyframe {destination}")
        saved[filename] = filename
        if len(saved) == len(wanted):
            break

    missing = [name for name in wanted.values() if name not in saved]
    if missing:
        raise ValueError(f"Could not extract keyframes: {', '.join(missing)}")
    return saved


def extract_phase_keyframes(
    video_path: Path,
    fps: float,
    phases: Mapping[str, PhasePick] | list[PhasePick],
    output_dir: Path,
) -> dict[str, str]:
    picks = list(phases.values()) if isinstance(phases, dict) else list(phases)
    wanted = {pick.frame_index: pick.phase.value for pick in picks}
    output_dir.mkdir(parents=True, exist_ok=True)

    saved: dict[str, str] = {}
    for decoded in iter_video_frames(video_path, fps):
        phase_name = wanted.get(decoded.frame_index)
        if phase_name is None:
            continue
        filename = KEYFRAME_FILENAMES[phase_name]
        destination = output_dir / filename
        ok = cv2.imwrite(
            str(destination),
            decoded.bgr,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )
        if not ok:
            raise ValueError(f"Failed to write keyframe {destination}")
        saved[phase_name] = filename
        if len(saved) == len(wanted):
            break

    missing = [name for name in wanted.values() if name not in saved]
    if missing:
        raise ValueError(f"Could not extract keyframes for phases: {', '.join(missing)}")
    return saved
