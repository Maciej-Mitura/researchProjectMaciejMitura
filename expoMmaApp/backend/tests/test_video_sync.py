"""Tests for active-window crop, temporal normalization, and side-by-side video.

These tests never call Gemini or OpenAI.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.config import (
    COMPARISON_OUTPUT_FPS,
    DEFAULT_AI_COMPARISON_DURATION_MS,
    DEFAULT_ACTIVE_WINDOW_PADDING_MS,
)
from app.video.layout import fit_frame, stack_side_by_side
from app.video.normalize import (
    TimeWindow,
    mapped_timestamp_ms,
    normalized_progress,
    padded_active_window,
    quick_comparison_duration_ms,
)
from app.video.package import build_comparison_package
from app.video.store import discard_comparison, resolve_comparison_dir, sweep_stale_comparisons
from app.pose.video import probe_video


def _solid_video(path: Path, *, color: tuple[int, int, int], width: int, height: int, n: int, fps: float = 30.0) -> Path:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))
    if not writer.isOpened():
        pytest.skip("OpenCV could not create an MP4 writer in this environment.")
    frame = np.full((height, width, 3), color, dtype=np.uint8)
    for _ in range(n):
        writer.write(frame)
    writer.release()
    return path


def test_padded_active_window_uses_central_padding() -> None:
    window = padded_active_window(500, 1700, 3000.0, padding_ms=DEFAULT_ACTIVE_WINDOW_PADDING_MS)
    assert window.start_ms == 400
    assert window.end_ms == 1800


def test_padded_window_does_not_leave_the_clip() -> None:
    window = padded_active_window(20, 80, 100.0, padding_ms=100)
    assert window.start_ms == 0
    assert window.end_ms == 100


def test_quick_duration_uses_the_longer_execution() -> None:
    assert quick_comparison_duration_ms(1240, 1230) == 1240
    assert quick_comparison_duration_ms(800, 1500) == 1500


def test_normalized_progress_maps_0_and_100() -> None:
    assert normalized_progress(0, 10) == 0.0
    assert normalized_progress(9, 10) == 1.0
    assert abs(normalized_progress(5, 11) - 0.5) < 1e-9


def test_mapped_timestamp_ignores_absolute_clock() -> None:
    reference = TimeWindow(start_ms=400, end_ms=1640)
    user = TimeWindow(start_ms=10, end_ms=1240)
    assert mapped_timestamp_ms(reference, 0.0) == 400
    assert mapped_timestamp_ms(user, 0.0) == 10
    assert mapped_timestamp_ms(reference, 1.0) == 1640
    assert mapped_timestamp_ms(user, 1.0) == 1240
    assert mapped_timestamp_ms(reference, 0.5) == 1020
    assert mapped_timestamp_ms(user, 0.5) == 625


def test_letterbox_preserves_aspect_ratio() -> None:
    frame = np.zeros((1920, 1080, 3), dtype=np.uint8)
    fitted = fit_frame(frame, 360, 640)
    assert fitted.shape[0] == 640
    assert fitted.shape[1] == 360
    assert fitted.shape == (640, 360, 3)


def test_side_by_side_is_reference_left_user_right(tmp_path: Path) -> None:
    left = np.zeros((80, 40, 3), dtype=np.uint8)
    left[:] = (0, 0, 255)  # red in BGR
    right = np.zeros((80, 40, 3), dtype=np.uint8)
    right[:] = (255, 0, 0)  # blue in BGR
    composite = stack_side_by_side(left, right, left_label="REFERENCE", right_label="YOU")
    mid = composite.shape[1] // 2
    left_panel = composite[:, :mid]
    right_panel = composite[:, mid:]
    # Labels occupy the top bar; sample the lower half.
    assert left_panel[50:, :, 2].mean() > left_panel[50:, :, 0].mean()
    assert right_panel[50:, :, 0].mean() > right_panel[50:, :, 2].mean()
    assert composite.shape[1] == left_panel.shape[1] + right_panel.shape[1]


def test_synchronized_composite_and_ai_duration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    comparisons.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)

    reference = _solid_video(tmp_path / "ref.mp4", color=(0, 0, 255), width=64, height=96, n=45)
    user = _solid_video(tmp_path / "user.mp4", color=(255, 0, 0), width=80, height=120, n=36)
    analysis_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    package = build_comparison_package(
        analysis_id=analysis_id,
        reference_path=reference,
        user_path=user,
        reference_start_ms=200,
        reference_end_ms=1400,
        user_start_ms=100,
        user_end_ms=1300,
        include_pose=False,
        include_ai=True,
    )
    assert package.ai is not None
    assert package.clean is None
    assert package.preview_path == package.ai.path
    assert package.gemini_path == package.ai.path
    assert package.preview_matches_gemini is True
    assert package.ai_retime_operations == 1
    assert package.comparison_video_url.endswith("/ai-comparison.mp4")
    assert package.ai.left_label == "REFERENCE"
    assert package.ai.right_label == "USER"

    ai_info = probe_video(package.ai.path)
    assert ai_info.width == package.ai.width
    assert ai_info.height == package.ai.height
    assert abs(ai_info.duration_ms - DEFAULT_AI_COMPARISON_DURATION_MS) <= 250
    expected_ai_frames = round((DEFAULT_AI_COMPARISON_DURATION_MS / 1000.0) * COMPARISON_OUTPUT_FPS)
    assert abs(package.ai.frame_count - expected_ai_frames) <= 1

    first = next(iter_first_frame(package.ai.path))
    mid = first.shape[1] // 2
    assert first[40:, :mid, 2].mean() > first[40:, :mid, 0].mean()
    assert first[40:, mid:, 0].mean() > first[40:, mid:, 2].mean()


def iter_first_frame(path: Path):
    capture = cv2.VideoCapture(str(path))
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        pytest.fail("Could not read encoded comparison video.")
    yield frame


def test_comparison_temp_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "comparisons"
    root.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", root)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", root)
    analysis_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    folder = resolve_comparison_dir(analysis_id)
    folder.mkdir()
    (folder / "comparison.mp4").write_bytes(b"video")
    discard_comparison(analysis_id)
    assert not folder.exists()


def test_stale_comparison_sweep(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "comparisons"
    root.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", root)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", root)
    old_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    new_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    old_dir = root / old_id
    new_dir = root / new_id
    old_dir.mkdir()
    new_dir.mkdir()
    (old_dir / "comparison.mp4").write_bytes(b"old")
    (new_dir / "comparison.mp4").write_bytes(b"new")
    past = time.time() - 10_000
    os.utime(old_dir, (past, past))
    removed = sweep_stale_comparisons(max_age_seconds=60)
    assert removed == 1
    assert not old_dir.exists()
    assert new_dir.exists()


def test_write_mp4_falls_back_when_first_codec_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.video.encode import write_mp4

    frames = [np.zeros((32, 32, 3), dtype=np.uint8) for _ in range(4)]
    path = tmp_path / "out.mp4"
    state = {"n": 0}

    class FakeWriter:
        def __init__(self, output: str, _fourcc: int, _fps: float, _size: tuple[int, int]) -> None:
            state["n"] += 1
            self.path = Path(output)
            self.opened = state["n"] > 1
            self.written = 0

        def isOpened(self) -> bool:
            return self.opened

        def write(self, _frame: object) -> None:
            self.written += 1

        def release(self) -> None:
            if self.opened and self.written:
                self.path.write_bytes(b"mp4-bytes" * 400)

    monkeypatch.setattr("app.video.encode.cv2.VideoWriter", FakeWriter)
    result = write_mp4(path, frames, 30.0)
    assert result == path
    assert path.is_file()
    assert path.stat().st_size >= 2048
    assert state["n"] >= 2


def test_pose_failure_does_not_remove_clean_video(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    comparisons.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)

    reference = _solid_video(tmp_path / "ref.mp4", color=(0, 0, 255), width=64, height=96, n=20)
    user = _solid_video(tmp_path / "user.mp4", color=(255, 0, 0), width=64, height=96, n=20)

    from app.video.composite import render_synchronized_comparison
    from app.video.errors import VideoCompositeError

    def fake_render(**kwargs):
        if kwargs.get("pose_overlay"):
            raise VideoCompositeError("libopenh264 Unable to create encoder")
        return render_synchronized_comparison(**kwargs)

    monkeypatch.setattr("app.video.package.render_synchronized_comparison", fake_render)
    analysis_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    package = build_comparison_package(
        analysis_id=analysis_id,
        reference_path=reference,
        user_path=user,
        reference_start_ms=0,
        reference_end_ms=400,
        user_start_ms=0,
        user_end_ms=400,
        include_pose=True,
        include_ai=False,
    )
    assert package.clean is not None
    assert package.clean.path.is_file()
    assert package.pose is None
    assert package.comparison_video_url is not None
    assert package.comparison_pose_video_url is None
