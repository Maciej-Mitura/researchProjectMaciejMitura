"""Optional pipeline check using a generated blank video (no person)."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from app.analysis.pipeline import analyze_attempt


def test_blank_video_does_not_claim_a_valid_jab(tmp_path: Path) -> None:
    path = tmp_path / "blank.mp4"
    width, height, fps, n_frames = 320, 240, 30, 45
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))
    if not writer.isOpened():
        pytest.skip("OpenCV could not create an MP4 writer in this environment.")
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    for _ in range(n_frames):
        writer.write(frame)
    writer.release()

    result = analyze_attempt(path, "simple_jab", output_dir=tmp_path / "out")
    assert result.analysisValid is False
    assert result.failureReason in {
        "no_pose_detected",
        "insufficient_pose_coverage",
        "key_landmarks_not_visible",
        "no_meaningful_extension_peak",
        "invalid_video",
        "recording_too_short",
    }
