"""Shared comparison-video package used by Quick Comparison and Detailed Analysis.

Quick: one real-time-ish composite from RAW + canonical windows.
Detailed AI: one retiming of those same canonical windows to ~8 seconds.
The AI file is both the Gemini upload and the in-app Watch Comparison preview.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.config import (
    AI_COMPARISON_VIDEO_FILENAME,
    COMPARISON_POSE_VIDEO_FILENAME,
    COMPARISON_VIDEO_FILENAME,
)
from app.models.pose import PoseFrame
from app.video.composite import ComparisonVideoResult, render_synchronized_comparison
from app.video.errors import VideoCompositeError, VideoInvariantError, VideoStateError
from app.video.normalize import ai_target_duration_ms, quick_comparison_duration_ms
from app.video.state import VideoAsset, VideoStage
from app.video.store import comparison_video_url, resolve_comparison_dir
from app.video.validate import verify_ai_composite

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ComparisonPackage:
    analysis_id: str
    clean: ComparisonVideoResult | None
    pose: ComparisonVideoResult | None
    ai: ComparisonVideoResult | None
    comparison_video_url: str | None
    comparison_pose_video_url: str | None
    ai_video_path: Path | None
    preview_path: Path | None = None
    gemini_path: Path | None = None
    ai_retime_operations: int = 0
    preview_matches_gemini: bool = False

    @property
    def preview_filename(self) -> str | None:
        if self.preview_path is None:
            return None
        return self.preview_path.name


def build_comparison_package(
    *,
    analysis_id: str,
    reference_path: Path | VideoAsset,
    user_path: Path | VideoAsset,
    reference_start_ms: int,
    reference_end_ms: int,
    user_start_ms: int,
    user_end_ms: int,
    reference_pose_frames: Sequence[PoseFrame] | None = None,
    user_pose_frames: Sequence[PoseFrame] | None = None,
    include_pose: bool = True,
    include_ai: bool = False,
    windows_already_canonical: bool = False,
    highlight_body_part: str | None = None,
    highlight_progress_start: float | None = None,
    highlight_progress_end: float | None = None,
) -> ComparisonPackage:
    comparison_dir = resolve_comparison_dir(analysis_id)
    comparison_dir.mkdir(parents=True, exist_ok=True)
    user_duration = user_end_ms - user_start_ms
    reference_duration = reference_end_ms - reference_start_ms
    shared = dict(
        reference_path=reference_path,
        user_path=user_path,
        reference_start_ms=reference_start_ms,
        reference_end_ms=reference_end_ms,
        user_start_ms=user_start_ms,
        user_end_ms=user_end_ms,
        windows_already_canonical=windows_already_canonical,
        highlight_body_part=highlight_body_part,
        highlight_progress_start=highlight_progress_start,
        highlight_progress_end=highlight_progress_end,
    )

    if include_ai:
        return _build_ai_package(
            analysis_id=analysis_id,
            comparison_dir=comparison_dir,
            include_pose=include_pose,
            reference_pose_frames=reference_pose_frames,
            user_pose_frames=user_pose_frames,
            **shared,
        )

    quick_ms = quick_comparison_duration_ms(reference_duration, user_duration)
    clean = _try_render(
        **shared,
        output_path=comparison_dir / COMPARISON_VIDEO_FILENAME,
        target_duration_ms=quick_ms,
        left_label="REFERENCE",
        right_label="YOU",
        pose_overlay=False,
        output_stage=VideoStage.SYNCHRONIZED_COMPARISON,
    )
    pose = None
    if include_pose:
        pose = _try_render(
            **shared,
            output_path=comparison_dir / COMPARISON_POSE_VIDEO_FILENAME,
            target_duration_ms=quick_ms,
            left_label="REFERENCE",
            right_label="YOU",
            pose_overlay=True,
            reference_pose_frames=reference_pose_frames,
            user_pose_frames=user_pose_frames,
            output_stage=VideoStage.SYNCHRONIZED_COMPARISON,
        )
    preview = clean.path if clean else None
    return ComparisonPackage(
        analysis_id=analysis_id,
        clean=clean,
        pose=pose,
        ai=None,
        comparison_video_url=(
            comparison_video_url(analysis_id, COMPARISON_VIDEO_FILENAME) if clean else None
        ),
        comparison_pose_video_url=(
            comparison_video_url(analysis_id, COMPARISON_POSE_VIDEO_FILENAME) if pose else None
        ),
        ai_video_path=None,
        preview_path=preview,
        gemini_path=None,
        ai_retime_operations=0,
        preview_matches_gemini=False,
    )


def _build_ai_package(
    *,
    analysis_id: str,
    comparison_dir: Path,
    include_pose: bool,
    reference_pose_frames: Sequence[PoseFrame] | None,
    user_pose_frames: Sequence[PoseFrame] | None,
    **shared,
) -> ComparisonPackage:
    """Exactly one AI retiming. Preview bytes == Gemini bytes."""
    ai_path = comparison_dir / AI_COMPARISON_VIDEO_FILENAME
    if ai_path.exists():
        ai_path.unlink()
    ai = _try_render(
        **shared,
        output_path=ai_path,
        target_duration_ms=ai_target_duration_ms(),
        left_label="REFERENCE",
        right_label="USER",
        pose_overlay=False,
        output_stage=VideoStage.AI_RETIMER_OUTPUT,
        show_progress=True,
    )
    if ai is None:
        raise VideoCompositeError("The slowed AI comparison video could not be created.")
    if ai.retime_operations != 1:
        raise VideoStateError("AI comparison must be produced by exactly one retiming operation.")
    try:
        verified = verify_ai_composite(ai.path, expected_frame_count=ai.frame_count)
    except VideoInvariantError as error:
        raise VideoCompositeError(error.message) from error
    pose = None
    if include_pose:
        pose = _try_render(
            **shared,
            output_path=comparison_dir / COMPARISON_POSE_VIDEO_FILENAME,
            target_duration_ms=ai_target_duration_ms(),
            left_label="REFERENCE",
            right_label="USER",
            pose_overlay=True,
            reference_pose_frames=reference_pose_frames,
            user_pose_frames=user_pose_frames,
            output_stage=VideoStage.AI_RETIMER_OUTPUT,
            show_progress=True,
        )
    preview_url = comparison_video_url(analysis_id, AI_COMPARISON_VIDEO_FILENAME)
    return ComparisonPackage(
        analysis_id=analysis_id,
        clean=None,
        pose=pose,
        ai=ai,
        comparison_video_url=preview_url,
        comparison_pose_video_url=(
            comparison_video_url(analysis_id, COMPARISON_POSE_VIDEO_FILENAME) if pose else None
        ),
        ai_video_path=ai.path,
        preview_path=ai.path,
        gemini_path=ai.path,
        ai_retime_operations=ai.retime_operations,
        preview_matches_gemini=ai.path.resolve() == Path(verified.path).resolve(),
    )


def _try_render(**kwargs) -> ComparisonVideoResult | None:
    try:
        return render_synchronized_comparison(**kwargs)
    except (VideoCompositeError, VideoStateError) as error:
        logger.warning(
            "Comparison video render failed path=%s pose=%s error=%s",
            kwargs.get("output_path"),
            kwargs.get("pose_overlay"),
            error,
        )
        return None
