"""Canonical full-technique video pipeline.

These tests never call Gemini or OpenAI.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from app.ai.errors import COMPARISON_VIDEO_INVALID_CODE, COMPARISON_VIDEO_INVALID_MESSAGE
from app.ai.models import DetailedAssessmentResponse
from app.config import (
    AI_COMPARISON_VIDEO_FILENAME,
    COMPARISON_OUTPUT_FPS,
    DEFAULT_AI_COMPARISON_DURATION_MS,
    DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS,
)
from app.pose.video import probe_video, resolve_fps
from app.reference.analyzer import analyze_generic_motion
from app.reference.window import detect_active_window
from app.video.composite import render_synchronized_comparison
from app.video.errors import VideoStateError
from app.video.normalize import output_frame_count
from app.video.package import build_comparison_package
from app.video.state import VideoAsset, VideoStage
from tests.reference_helpers import samples_from_values


def _solid_video(
    path: Path,
    *,
    color: tuple[int, int, int],
    width: int,
    height: int,
    n: int,
    fps: float,
) -> Path:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))
    if not writer.isOpened():
        pytest.skip("OpenCV could not create an MP4 writer in this environment.")
    frame = np.full((height, width, 3), color, dtype=np.uint8)
    for _ in range(n):
        writer.write(frame)
    writer.release()
    return path


def test_reference_and_user_share_detect_active_window() -> None:
    from app.ai import pipeline as ai_pipeline
    from app.comparison import pipeline as comparison_pipeline
    from app.reference import pipeline as reference_pipeline

    assert reference_pipeline.analyze_generic_motion is analyze_generic_motion
    assert comparison_pipeline.analyze_generic_motion is analyze_generic_motion
    assert ai_pipeline.analyze_generic_motion is analyze_generic_motion
    assert DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS == 500


def test_canonical_clip_cannot_be_analyzed_again(tmp_path: Path) -> None:
    fake = tmp_path / "clip.mp4"
    fake.write_bytes(b"not-a-video")
    asset = VideoAsset(
        path=fake,
        stage=VideoStage.CANONICAL_ACTIVE_USER,
        fps=30.0,
        frame_count=40,
        duration_ms=1300.0,
        width=64,
        height=96,
    )
    result = analyze_generic_motion(asset, raw_stage=VideoStage.RAW_USER)
    assert result.valid is False
    assert result.failure_reason == "double_processing"


def test_derived_filename_cannot_be_treated_as_raw(tmp_path: Path) -> None:
    derived = tmp_path / AI_COMPARISON_VIDEO_FILENAME
    derived.write_bytes(b"not-a-video")
    result = analyze_generic_motion(derived, raw_stage=VideoStage.RAW_REFERENCE)
    assert result.valid is False
    assert result.failure_reason == "double_processing"


def test_ai_retime_rejects_already_retimed_asset(tmp_path: Path) -> None:
    source = _solid_video(tmp_path / "raw.mp4", color=(0, 0, 255), width=64, height=96, n=30, fps=30.0)
    raw = VideoAsset(
        path=source,
        stage=VideoStage.RAW_REFERENCE,
        fps=30.0,
        frame_count=30,
        duration_ms=1000.0,
        width=64,
        height=96,
    )
    user = VideoAsset(
        path=source,
        stage=VideoStage.RAW_USER,
        fps=30.0,
        frame_count=30,
        duration_ms=1000.0,
        width=64,
        height=96,
    )
    first = render_synchronized_comparison(
        reference_path=raw,
        user_path=user,
        reference_start_ms=0,
        reference_end_ms=800,
        user_start_ms=0,
        user_end_ms=800,
        output_path=tmp_path / AI_COMPARISON_VIDEO_FILENAME,
        target_duration_ms=DEFAULT_AI_COMPARISON_DURATION_MS,
        windows_already_canonical=True,
        output_stage=VideoStage.AI_RETIMER_OUTPUT,
    )
    assert first.retime_operations == 1
    retimed = VideoAsset(
        path=first.path,
        stage=VideoStage.AI_RETIMER_OUTPUT,
        fps=first.fps,
        frame_count=first.frame_count,
        duration_ms=float(first.duration_ms),
        width=first.width,
        height=first.height,
    )
    with pytest.raises(VideoStateError):
        render_synchronized_comparison(
            reference_path=retimed,
            user_path=user,
            reference_start_ms=0,
            reference_end_ms=800,
            user_start_ms=0,
            user_end_ms=800,
            output_path=tmp_path / "again.mp4",
            target_duration_ms=DEFAULT_AI_COMPARISON_DURATION_MS,
            windows_already_canonical=True,
            output_stage=VideoStage.AI_RETIMER_OUTPUT,
        )


def test_known_30fps_duration_math() -> None:
    fps, fallback = resolve_fps(30.0)
    assert fallback is False
    assert fps == 30.0
    assert abs((145 / fps) * 1000.0 - 4833.333) < 1.0
    assert output_frame_count(8000, 30.0) == 240


def test_zero_fps_is_not_silently_used_as_zero() -> None:
    fps, fallback = resolve_fps(0.0)
    assert fallback is True
    assert fps == 30.0


def test_different_source_fps_normalize_to_same_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    comparisons.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)

    reference = _solid_video(
        tmp_path / "ref.mp4", color=(0, 0, 255), width=64, height=96, n=90, fps=30.0
    )
    user = _solid_video(
        tmp_path / "user.mp4", color=(255, 0, 0), width=64, height=96, n=180, fps=60.0
    )
    analysis_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    package = build_comparison_package(
        analysis_id=analysis_id,
        reference_path=reference,
        user_path=user,
        reference_start_ms=200,
        reference_end_ms=2200,
        user_start_ms=200,
        user_end_ms=2200,
        include_pose=False,
        include_ai=True,
        windows_already_canonical=True,
    )
    assert package.ai is not None
    assert package.ai_retime_operations == 1
    assert abs(package.ai.duration_ms - DEFAULT_AI_COMPARISON_DURATION_MS) <= 250
    expected = output_frame_count(DEFAULT_AI_COMPARISON_DURATION_MS, COMPARISON_OUTPUT_FPS)
    assert abs(package.ai.frame_count - expected) <= 1
    reopened = probe_video(package.ai.path)
    assert reopened.fps > 0
    duration = (reopened.frame_count / reopened.fps) * 1000.0 if reopened.frame_count else reopened.duration_ms
    assert abs(duration - DEFAULT_AI_COMPARISON_DURATION_MS) <= 400


def test_preview_artifact_is_gemini_input(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    comparisons.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)
    reference = _solid_video(
        tmp_path / "ref.mp4", color=(0, 0, 255), width=64, height=96, n=40, fps=30.0
    )
    user = _solid_video(
        tmp_path / "user.mp4", color=(255, 0, 0), width=64, height=96, n=40, fps=30.0
    )
    package = build_comparison_package(
        analysis_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        reference_path=reference,
        user_path=user,
        reference_start_ms=0,
        reference_end_ms=1000,
        user_start_ms=0,
        user_end_ms=1000,
        include_pose=False,
        include_ai=True,
        windows_already_canonical=True,
    )
    assert package.ai_video_path is not None
    assert package.preview_path == package.gemini_path == package.ai_video_path
    assert package.preview_path.name == AI_COMPARISON_VIDEO_FILENAME
    assert package.preview_path.read_bytes() == package.ai_video_path.read_bytes()
    assert package.comparison_video_url.endswith(f"/{AI_COMPARISON_VIDEO_FILENAME}")


def test_new_analysis_does_not_reuse_previous_derived_video(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons = tmp_path / "comparisons"
    comparisons.mkdir()
    monkeypatch.setattr("app.config.COMPARISONS_DIR", comparisons)
    monkeypatch.setattr("app.video.store.config.COMPARISONS_DIR", comparisons)
    reference = _solid_video(
        tmp_path / "ref.mp4", color=(0, 0, 255), width=64, height=96, n=30, fps=30.0
    )
    user = _solid_video(
        tmp_path / "user.mp4", color=(255, 0, 0), width=64, height=96, n=30, fps=30.0
    )
    first_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    second_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    first = build_comparison_package(
        analysis_id=first_id,
        reference_path=reference,
        user_path=user,
        reference_start_ms=0,
        reference_end_ms=800,
        user_start_ms=0,
        user_end_ms=800,
        include_pose=False,
        include_ai=True,
        windows_already_canonical=True,
    )
    marker = b"stale-bytes-should-not-be-reused"
    assert first.ai_video_path is not None
    first.ai_video_path.write_bytes(marker)
    second = build_comparison_package(
        analysis_id=second_id,
        reference_path=reference,
        user_path=user,
        reference_start_ms=0,
        reference_end_ms=800,
        user_start_ms=0,
        user_end_ms=800,
        include_pose=False,
        include_ai=True,
        windows_already_canonical=True,
    )
    assert second.ai_video_path is not None
    assert first.ai_video_path.parent != second.ai_video_path.parent
    assert second.ai_video_path.read_bytes() != marker
    assert second.ai_video_path.is_file()


def test_malformed_evidence_does_not_call_gemini(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.ai.pipeline import run_detailed_analysis
    from app.ai.providers import ProviderCallResult
    from app.models.pose import VideoInfo
    from app.models.reference import MovementWindow, ReferenceKeyframeMeta, ReferenceTechniqueMetadata
    from app.reference.analyzer import GenericMotionAnalysis
    from app.reference.models import ActiveWindowResult

    class BoomProvider:
        name = "boom"

        def assess_video(self, **_kwargs: object) -> ProviderCallResult:
            raise AssertionError("Gemini must not be called when video evidence is invalid.")

    metadata = ReferenceTechniqueMetadata(
        id="combo",
        name="Combo",
        slug="combo",
        description=None,
        createdAt="2026-08-27T12:00:00Z",
        referenceVideo="reference.mp4",
        referenceStrategy="generic-motion-window-v1",
        movementWindow=MovementWindow(startMs=400, endMs=1600, durationMs=1200),
        poseCoverage=0.9,
        majorLandmarkCoverage=0.9,
        keyframes=[
            ReferenceKeyframeMeta(
                phase=phase,
                filename=f"keyframes/0{index}-x.jpg",
                timestampMs=400 + index * 100,
                frameIndex=index,
            )
            for index, phase in enumerate(("START", "EARLY", "MIDDLE", "LATE", "END"), start=1)
        ],
    )
    window = ActiveWindowResult(
        valid=True,
        failure_reason=None,
        failure_message=None,
        baseline=0.01,
        peak=0.2,
        motion_delta=0.19,
        start_ms=10,
        end_ms=40,
        start_frame_index=1,
        end_frame_index=2,
        raw_values=(),
        smoothed_values=(),
        regions=(),
        canonical_start_ms=10,
        canonical_end_ms=40,
        padding_applied=True,
        canonical=True,
    )
    motion = GenericMotionAnalysis(
        valid=True,
        failure_reason=None,
        failure_message=None,
        video=VideoInfo(
            fps=30.0,
            fps_fallback_used=False,
            frame_count=90,
            width=64,
            height=96,
            duration_ms=3000.0,
        ),
        pose_coverage=0.96,
        major_coverage=0.92,
        window=window,
        picks=None,
        fps_fallback_used=False,
    )
    monkeypatch.setattr("app.ai.pipeline.analyze_generic_motion", lambda *_a, **_k: motion)
    monkeypatch.setattr(
        "app.ai.pipeline.technique_video_path",
        lambda *_a, **_k: tmp_path / "reference.mp4",
    )
    result = run_detailed_analysis(
        tmp_path / "attempt.mp4",
        analysis_id="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        output_dir=tmp_path,
        metadata=metadata,
        provider=BoomProvider(),
    )
    assert isinstance(result, DetailedAssessmentResponse)
    assert result.analysisValid is False
    assert result.failureReason == COMPARISON_VIDEO_INVALID_CODE
    assert result.failureMessage == COMPARISON_VIDEO_INVALID_MESSAGE
    assert result.overallScore is None


def test_inspect_tool_does_not_import_gemini() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    source = (backend_root / "app/tools/inspect_video_pipeline.py").read_text(encoding="utf-8")
    assert "google.genai" not in source
    assert "GeminiVideoProvider" not in source
    assert "run_detailed_analysis" not in source


def test_gap_threshold_is_centralized() -> None:
    from app.config import generic_movement_max_gap_ms
    from app.reference.motion_config import motion_config

    assert generic_movement_max_gap_ms() == DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS
    assert motion_config().max_gap_ms == DEFAULT_GENERIC_MOVEMENT_MAX_GAP_MS


def test_partial_segmentation_fails_closed() -> None:
    values: list[float | None] = [0.002] * 180
    for index in range(20, 28):
        values[index] = 0.12
    for index in range(34, 42):
        values[index] = 0.12
    for index in range(48, 56):
        values[index] = 0.12
    for index in range(62, 70):
        values[index] = 0.22
    result = detect_active_window(samples_from_values(values))
    assert result.valid is True
    assert result.start_frame_index is not None
    assert result.start_frame_index <= 22
    assert len(result.regions) == 4
