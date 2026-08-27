"""Shared generic whole-body motion analysis.

Used for BOTH recorded-reference capture and USER training attempts.
Do not copy this algorithm into a second "training" implementation.

Input must be a RAW recording. Canonical active windows are timestamps into
that same file. This function must not be pointed at an already cropped or
retimed clip.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.config import (
    MAX_REFERENCE_DURATION_MS,
    MIN_CANONICAL_DURATION_MS,
    MIN_FRAME_COUNT,
    MIN_RECORDING_DURATION_MS,
    MODEL_PATH,
    active_window_padding_ms,
)
from app.models.api import VideoMetadata
from app.models.pose import PoseFrame, VideoInfo
from app.pose.landmarker import PoseVideoLandmarker
from app.pose.video import probe_video
from app.reference.keyframes import KeyframeSelectionError, pick_generic_keyframes
from app.reference.models import ActiveWindowResult, ReferenceKeyframePick
from app.reference.motion import compute_body_motion, major_landmark_coverage, pose_coverage
from app.reference.motion_config import MOTION_CONFIG
from app.reference.window import apply_canonical_padding, detect_active_window
from app.video.errors import VideoStateError
from app.video.state import VideoAsset, VideoStage, as_raw_asset


@dataclass(frozen=True)
class GenericMotionAnalysis:
    """Measurement result for one video. Not a technique score."""

    valid: bool
    failure_reason: str | None
    failure_message: str | None
    video: VideoInfo | None
    pose_coverage: float | None
    major_coverage: float | None
    window: ActiveWindowResult | None
    picks: tuple[ReferenceKeyframePick, ...] | None
    fps_fallback_used: bool
    pose_frames: tuple[PoseFrame, ...] | None = None
    raw_stage: VideoStage | None = None


def analyze_generic_motion(
    video_path: Path | VideoAsset,
    *,
    model_path: Path | None = None,
    max_duration_ms: float = MAX_REFERENCE_DURATION_MS,
    raw_stage: VideoStage = VideoStage.RAW_USER,
) -> GenericMotionAnalysis:
    """Pose → body-motion signal → complete-technique window → 0/25/50/75/100% keyframes.

    JPEG extraction is the caller's job so reference drafts and USER attempts
    can store frames in different directories.
    """
    try:
        asset = as_raw_asset(video_path, raw_stage)
    except VideoStateError as error:
        return _invalid(
            "double_processing",
            str(error),
            fps_fallback_used=False,
            raw_stage=raw_stage if isinstance(video_path, VideoAsset) else raw_stage,
        )
    except Exception as error:
        return _invalid(
            "invalid_video",
            str(error),
            fps_fallback_used=False,
            raw_stage=raw_stage,
        )

    try:
        video = probe_video(asset.path)
    except ValueError as error:
        return _invalid(
            "invalid_video",
            str(error),
            fps_fallback_used=False,
            raw_stage=asset.stage,
        )

    with PoseVideoLandmarker(model_path or MODEL_PATH) as landmarker:
        pose_frames = landmarker.detect_video(asset.path, video.fps)

    video = _with_actual_frame_count(video, len(pose_frames))
    coverage = pose_coverage(pose_frames)
    major_coverage = major_landmark_coverage(pose_frames)

    if video.frame_count < MIN_FRAME_COUNT or video.duration_ms < MIN_RECORDING_DURATION_MS:
        return _invalid(
            "recording_too_short",
            (
                "Recording is too short to use "
                f"({video.frame_count} frames, {video.duration_ms:.0f} ms)."
            ),
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            raw_stage=asset.stage,
        )

    if video.duration_ms > max_duration_ms:
        return _invalid(
            "recording_too_long",
            "Recording is longer than the capture limit.",
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            raw_stage=asset.stage,
        )

    if coverage <= 0.0:
        return _invalid(
            "no_pose_detected",
            "No pose was detected in any video frame.",
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            raw_stage=asset.stage,
        )

    if coverage < MOTION_CONFIG.min_pose_coverage:
        return _invalid(
            "insufficient_pose_coverage",
            (
                "Insufficient pose coverage for a measurable recording "
                f"({coverage:.0%}; need {MOTION_CONFIG.min_pose_coverage:.0%})."
            ),
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            raw_stage=asset.stage,
        )

    if major_coverage < MOTION_CONFIG.min_major_landmark_coverage:
        return _invalid(
            "key_landmarks_not_visible",
            (
                "Major body landmarks were not visible enough "
                f"({major_coverage:.0%}). Keep your full body in frame."
            ),
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            raw_stage=asset.stage,
        )

    samples = compute_body_motion(pose_frames)
    window = detect_active_window(samples)
    if not window.valid:
        return _invalid(
            window.failure_reason or "no_meaningful_movement",
            window.failure_message or "No meaningful movement was detected.",
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            window=window,
            raw_stage=asset.stage,
        )

    window = apply_canonical_padding(
        window,
        video.duration_ms,
        padding_ms=active_window_padding_ms(),
    )
    assert window.start_ms is not None and window.end_ms is not None
    assert window.canonical_start_ms is not None and window.canonical_end_ms is not None
    canonical_duration = window.canonical_end_ms - window.canonical_start_ms
    if canonical_duration < MIN_CANONICAL_DURATION_MS:
        return _invalid(
            "incomplete_movement_window",
            "The complete movement could not be prepared from this recording. Please retry the recording.",
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            window=window,
            raw_stage=asset.stage,
        )

    try:
        picks = pick_generic_keyframes(pose_frames, window.start_ms, window.end_ms)
    except KeyframeSelectionError as error:
        return _invalid(
            "keyframes_unavailable",
            error.message,
            video=video,
            pose_coverage=coverage,
            major_coverage=major_coverage,
            window=window,
            raw_stage=asset.stage,
        )

    return GenericMotionAnalysis(
        valid=True,
        failure_reason=None,
        failure_message=None,
        video=video,
        pose_coverage=coverage,
        major_coverage=major_coverage,
        window=window,
        picks=picks,
        fps_fallback_used=video.fps_fallback_used,
        pose_frames=tuple(pose_frames),
        raw_stage=asset.stage,
    )


def video_metadata(video: VideoInfo) -> VideoMetadata:
    return VideoMetadata(
        fps=video.fps,
        durationMs=video.duration_ms,
        width=video.width,
        height=video.height,
        frameCount=video.frame_count,
    )


def _with_actual_frame_count(video: VideoInfo, actual_count: int) -> VideoInfo:
    duration_ms = (actual_count / video.fps) * 1000.0 if video.fps > 0 else 0.0
    return VideoInfo(
        fps=video.fps,
        fps_fallback_used=video.fps_fallback_used,
        frame_count=actual_count,
        width=video.width,
        height=video.height,
        duration_ms=duration_ms,
    )


def _invalid(
    reason: str,
    message: str,
    *,
    video: VideoInfo | None = None,
    pose_coverage: float | None = None,
    major_coverage: float | None = None,
    window: ActiveWindowResult | None = None,
    fps_fallback_used: bool | None = None,
    raw_stage: VideoStage | None = None,
) -> GenericMotionAnalysis:
    fallback = video.fps_fallback_used if video is not None else bool(fps_fallback_used)
    return GenericMotionAnalysis(
        valid=False,
        failure_reason=reason,
        failure_message=message,
        video=video,
        pose_coverage=pose_coverage,
        major_coverage=major_coverage,
        window=window,
        picks=None,
        fps_fallback_used=fallback,
        pose_frames=None,
        raw_stage=raw_stage,
    )
