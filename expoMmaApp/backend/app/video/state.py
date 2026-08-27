"""Typed video assets so RAW clips cannot be recropped or retimed by accident.

A function that expects RAW_REFERENCE / RAW_USER must not receive an already
cropped or AI-retimed file. Callers pass a VideoAsset (or a Path, which is
wrapped as RAW). Canonical active windows live on the analysis result; they are
timestamps into the RAW file, not a second on-disk crop.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from app.config import (
    AI_COMPARISON_VIDEO_FILENAME,
    COMPARISON_POSE_VIDEO_FILENAME,
    COMPARISON_VIDEO_FILENAME,
)
from app.models.pose import VideoInfo
from app.video.errors import VideoCompositeError, VideoStateError

DERIVED_FILENAMES = frozenset(
    {
        AI_COMPARISON_VIDEO_FILENAME,
        COMPARISON_POSE_VIDEO_FILENAME,
        COMPARISON_VIDEO_FILENAME,
    }
)


class VideoStage(StrEnum):
    RAW_REFERENCE = "raw_reference"
    RAW_USER = "raw_user"
    CANONICAL_ACTIVE_REFERENCE = "canonical_active_reference"
    CANONICAL_ACTIVE_USER = "canonical_active_user"
    SYNCHRONIZED_COMPARISON = "synchronized_comparison"
    AI_RETIMER_OUTPUT = "ai_retimer_output"


RAW_STAGES = frozenset({VideoStage.RAW_REFERENCE, VideoStage.RAW_USER})
CANONICAL_STAGES = frozenset(
    {VideoStage.CANONICAL_ACTIVE_REFERENCE, VideoStage.CANONICAL_ACTIVE_USER}
)


@dataclass(frozen=True)
class VideoAsset:
    path: Path
    stage: VideoStage
    fps: float
    frame_count: int
    duration_ms: float
    width: int
    height: int
    fps_fallback_used: bool = False
    analysis_id: str | None = None

    def require_stage(self, *stages: VideoStage) -> None:
        if self.stage not in stages:
            allowed = ", ".join(stage.value for stage in stages)
            raise VideoStateError(
                f"Video {self.path.name} is {self.stage.value}; expected {allowed}."
            )

    def require_raw(self) -> None:
        self.require_stage(*RAW_STAGES)

    def require_not_derived(self) -> None:
        """Segmentation and AI retiming only run on original recordings."""
        if self.stage not in RAW_STAGES:
            raise VideoStateError(
                f"Cannot reprocess {self.stage.value} video {self.path.name} as a raw recording."
            )


def asset_from_info(
    path: Path,
    stage: VideoStage,
    info: VideoInfo,
    *,
    analysis_id: str | None = None,
) -> VideoAsset:
    return VideoAsset(
        path=path,
        stage=stage,
        fps=info.fps,
        frame_count=info.frame_count,
        duration_ms=info.duration_ms,
        width=info.width,
        height=info.height,
        fps_fallback_used=info.fps_fallback_used,
        analysis_id=analysis_id,
    )


def as_raw_asset(
    video: Path | VideoAsset,
    stage: VideoStage,
    *,
    analysis_id: str | None = None,
) -> VideoAsset:
    """Wrap a Path as RAW, or verify an existing asset is still RAW.

    Never silently treat a canonical/retimed file as a new recording.
    """
    if stage not in RAW_STAGES:
        raise VideoStateError(f"{stage.value} is not a RAW video stage.")
    if isinstance(video, VideoAsset):
        video.require_stage(stage)
        _reject_derived_filename(video.path, stage)
        return video
    from app.pose.video import probe_video

    _reject_derived_filename(video, stage)
    try:
        info = probe_video(video)
    except ValueError as error:
        raise VideoCompositeError(f"Could not open video: {video.name}") from error
    return asset_from_info(video, stage, info, analysis_id=analysis_id)


def _reject_derived_filename(path: Path, stage: VideoStage) -> None:
    if stage in RAW_STAGES and path.name in DERIVED_FILENAMES:
        raise VideoStateError(
            f"Cannot treat derived file {path.name} as {stage.value}."
        )
