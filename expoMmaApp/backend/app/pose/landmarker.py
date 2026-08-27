"""MediaPipe Tasks Pose Landmarker in VIDEO running mode."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)
from mediapipe.tasks.python.vision.pose_landmarker import PoseLandmarkerResult

from app.config import MODEL_PATH
from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import POSE_LANDMARK_COUNT
from app.pose.video import DecodedFrame, iter_video_frames


class PoseVideoLandmarker:
    """One-pose VIDEO-mode landmarker bound to the V2-owned .task model."""

    def __init__(self, model_path: Path | None = None) -> None:
        path = model_path or MODEL_PATH
        if not path.is_file():
            raise FileNotFoundError(f"Pose landmarker model not found: {path}")
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = PoseLandmarker.create_from_options(options)

    def close(self) -> None:
        closer = getattr(self._landmarker, "close", None)
        if callable(closer):
            closer()

    def __enter__(self) -> PoseVideoLandmarker:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def detect_frame(self, frame: DecodedFrame) -> PoseFrame:
        rgb = cv2.cvtColor(frame.bgr, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(image, frame.timestamp_ms)
        return _pose_frame_from_result(frame, result)

    def detect_video(self, video_path: Path, fps: float) -> list[PoseFrame]:
        frames: list[PoseFrame] = []
        for decoded in iter_video_frames(video_path, fps):
            frames.append(self.detect_frame(decoded))
        return frames


def _pose_frame_from_result(frame: DecodedFrame, result: PoseLandmarkerResult) -> PoseFrame:
    poses: Sequence[Sequence[object]] = result.pose_landmarks or ()
    if not poses:
        return PoseFrame(
            frame_index=frame.frame_index,
            timestamp_ms=frame.timestamp_ms,
            landmarks=None,
            pose_detected=False,
        )

    raw = poses[0]
    landmarks = tuple(_to_landmark(item) for item in raw)
    if len(landmarks) != POSE_LANDMARK_COUNT:
        return PoseFrame(
            frame_index=frame.frame_index,
            timestamp_ms=frame.timestamp_ms,
            landmarks=None,
            pose_detected=False,
        )
    return PoseFrame(
        frame_index=frame.frame_index,
        timestamp_ms=frame.timestamp_ms,
        landmarks=landmarks,
        pose_detected=True,
    )


def _to_landmark(item: object) -> Landmark:
    x = float(getattr(item, "x", 0.0) or 0.0)
    y = float(getattr(item, "y", 0.0) or 0.0)
    z = float(getattr(item, "z", 0.0) or 0.0)
    visibility = _optional_float(getattr(item, "visibility", None))
    presence = _optional_float(getattr(item, "presence", None))
    return Landmark(x=x, y=y, z=z, visibility=visibility, presence=presence)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number
