"""Build a synchronized side-by-side comparison MP4.

LEFT = REFERENCE, RIGHT = USER. Both sides share normalized 0–100% progress.

Inputs must be RAW recordings plus already-canonical active windows.
This module does not detect movement and does not retime an already-retimed file.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.config import COMPARISON_OUTPUT_FPS, COMPARISON_VIDEO_FILENAME
from app.models.pose import PoseFrame
from app.pose.video import probe_video
from app.video.encode import write_mp4
from app.video.errors import VideoCompositeError, VideoStateError
from app.video.frames import load_window_frames, sample_frame_at_progress
from app.video.layout import stack_side_by_side
from app.video.normalize import (
    TimeWindow,
    crop_window_from_canonical,
    normalized_progress,
    output_frame_count,
)
from app.video.highlight import highlight_is_active, resolve_highlight
from app.video.pose_overlay import nearest_pose_landmarks, overlay_pose
from app.video.state import DERIVED_FILENAMES, RAW_STAGES, VideoAsset, VideoStage
from app.video.validate import assert_canonical_window, assert_sane_source_fps, verify_encoded_video


@dataclass(frozen=True)
class ComparisonVideoResult:
    path: Path
    duration_ms: int
    fps: float
    width: int
    height: int
    frame_count: int
    left_label: str
    right_label: str
    reference_window: TimeWindow
    user_window: TimeWindow
    pose_overlay: bool
    output_stage: VideoStage
    retime_operations: int


def render_synchronized_comparison(
    *,
    reference_path: Path | VideoAsset,
    user_path: Path | VideoAsset,
    reference_start_ms: int,
    reference_end_ms: int,
    user_start_ms: int,
    user_end_ms: int,
    output_path: Path,
    target_duration_ms: int,
    left_label: str = "REFERENCE",
    right_label: str = "YOU",
    fps: float = COMPARISON_OUTPUT_FPS,
    padding_ms: int | None = None,
    pose_overlay: bool = False,
    reference_pose_frames: Sequence[PoseFrame] | None = None,
    user_pose_frames: Sequence[PoseFrame] | None = None,
    windows_already_canonical: bool = False,
    output_stage: VideoStage = VideoStage.SYNCHRONIZED_COMPARISON,
    show_progress: bool = False,
    highlight_body_part: str | None = None,
    highlight_progress_start: float | None = None,
    highlight_progress_end: float | None = None,
) -> ComparisonVideoResult:
    reference_asset = _raw_source(reference_path, VideoStage.RAW_REFERENCE)
    user_asset = _raw_source(user_path, VideoStage.RAW_USER)
    if output_stage in RAW_STAGES or output_stage in {
        VideoStage.CANONICAL_ACTIVE_REFERENCE,
        VideoStage.CANONICAL_ACTIVE_USER,
    }:
        raise VideoStateError("Comparison output cannot reuse a raw/canonical source stage.")

    try:
        reference_info = probe_video(reference_asset.path)
        user_info = probe_video(user_asset.path)
    except ValueError as error:
        raise VideoCompositeError("The recordings could not be opened for comparison.") from error

    assert_sane_source_fps(reference_info.fps, fallback_used=reference_info.fps_fallback_used)
    assert_sane_source_fps(user_info.fps, fallback_used=user_info.fps_fallback_used)

    reference_window = crop_window_from_canonical(
        reference_start_ms,
        reference_end_ms,
        reference_info.duration_ms,
        already_canonical=windows_already_canonical,
        padding_ms=padding_ms,
    )
    user_window = crop_window_from_canonical(
        user_start_ms,
        user_end_ms,
        user_info.duration_ms,
        already_canonical=windows_already_canonical,
        padding_ms=padding_ms,
    )
    assert_canonical_window(reference_window, label="REFERENCE")
    assert_canonical_window(user_window, label="USER")
    reference_frames = load_window_frames(
        reference_asset.path, reference_window, fps=reference_info.fps
    )
    user_frames = load_window_frames(user_asset.path, user_window, fps=user_info.fps)

    frame_count = output_frame_count(target_duration_ms, fps)
    highlight = resolve_highlight(highlight_body_part) if pose_overlay else None
    composed = []
    for index in range(frame_count):
        progress = normalized_progress(index, frame_count)
        reference = sample_frame_at_progress(reference_frames, reference_window, progress)
        user = sample_frame_at_progress(user_frames, user_window, progress)
        left = reference.bgr
        right = user.bgr
        if pose_overlay:
            active = bool(
                highlight
                and highlight_is_active(progress, highlight_progress_start, highlight_progress_end)
            )
            left = overlay_pose(
                left,
                nearest_pose_landmarks(reference_pose_frames or (), reference.timestamp_ms),
                highlight_joint=highlight.joint_index if active and highlight else None,
                highlight_connections=highlight.connections if active and highlight else None,
                mode="reference" if active else "normal",
            )
            right = overlay_pose(
                right,
                nearest_pose_landmarks(user_pose_frames or (), user.timestamp_ms),
                highlight_joint=highlight.joint_index if active and highlight else None,
                highlight_connections=highlight.connections if active and highlight else None,
                mode="user" if active else "normal",
            )
        composed.append(
            stack_side_by_side(
                left,
                right,
                left_label=left_label,
                right_label=right_label,
                progress=progress if show_progress else None,
            )
        )

    write_mp4(output_path, composed, fps)
    encoded = verify_encoded_video(
        output_path,
        expected_fps=fps,
        expected_duration_ms=int(round((len(composed) / fps) * 1000.0)),
        expected_frame_count=len(composed),
    )
    height, width = composed[0].shape[:2]
    return ComparisonVideoResult(
        path=output_path,
        duration_ms=int(round(encoded.duration_ms)),
        fps=encoded.fps,
        width=width,
        height=height,
        frame_count=encoded.frame_count,
        left_label=left_label,
        right_label=right_label,
        reference_window=reference_window,
        user_window=user_window,
        pose_overlay=pose_overlay,
        output_stage=output_stage,
        retime_operations=1,
    )


def default_comparison_path(directory: Path) -> Path:
    return directory / COMPARISON_VIDEO_FILENAME


def _raw_source(video: Path | VideoAsset, expected: VideoStage) -> VideoAsset:
    if isinstance(video, VideoAsset):
        video.require_not_derived()
        video.require_stage(expected)
        return video
    if video.name in DERIVED_FILENAMES:
        raise VideoStateError(f"Cannot treat derived file {video.name} as {expected.value}.")
    return VideoAsset(
        path=video,
        stage=expected,
        fps=0.0,
        frame_count=0,
        duration_ms=0.0,
        width=0,
        height=0,
    )
