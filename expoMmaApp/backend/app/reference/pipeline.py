"""Analyze an uploaded reference recording into a reviewable draft.

Uses the shared generic whole-body analyzer, not jab wrist-to-shoulder extension.
Does not score technique quality.
"""

from __future__ import annotations

from pathlib import Path

from app.config import (
    MODEL_PATH,
    REFERENCE_DRAFT_METADATA_FILENAME,
    REFERENCE_KEYFRAMES_SUBDIR,
    REFERENCE_STRATEGY,
)
from app.keyframes.extract import extract_named_frames
from app.models.reference import (
    MovementWindow,
    ReferenceDebug,
    ReferenceDraftResponse,
    ReferenceKeyframeResult,
)
from app.reference.analyzer import analyze_generic_motion, video_metadata
from app.reference.models import ActiveWindowResult, ReferenceKeyframePick
from app.reference.motion_config import MOTION_CONFIG
from app.reference.store import utc_now_iso, write_json
from app.video.state import VideoStage


def analyze_reference_draft(
    video_path: Path,
    *,
    draft_id: str,
    output_dir: Path,
    name: str,
    slug: str,
    description: str | None,
    model_path: Path | None = None,
) -> ReferenceDraftResponse:
    output_dir.mkdir(parents=True, exist_ok=True)

    result = analyze_generic_motion(
        video_path,
        model_path=model_path or MODEL_PATH,
        raw_stage=VideoStage.RAW_REFERENCE,
    )
    if not result.valid or result.picks is None or result.window is None or result.video is None:
        response = _invalid(
            draft_id,
            name,
            slug,
            description,
            result.failure_reason or "analysis_failed",
            result.failure_message or "The recording could not be measured.",
            video=result.video,
            pose_coverage=result.pose_coverage,
            major_coverage=result.major_coverage,
            window=result.window,
            fps_fallback_used=result.fps_fallback_used,
        )
        _persist_draft(output_dir, response)
        return response

    keyframes_dir = output_dir / REFERENCE_KEYFRAMES_SUBDIR
    try:
        extract_named_frames(
            video_path,
            result.video.fps,
            [(pick.frame_index, pick.filename) for pick in result.picks],
            keyframes_dir,
        )
    except ValueError as error:
        response = _invalid(
            draft_id,
            name,
            slug,
            description,
            "keyframes_unavailable",
            str(error),
            video=result.video,
            pose_coverage=result.pose_coverage,
            major_coverage=result.major_coverage,
            window=result.window,
            fps_fallback_used=result.fps_fallback_used,
        )
        _persist_draft(output_dir, response)
        return response

    window = result.window
    assert window.start_ms is not None and window.end_ms is not None
    response = ReferenceDraftResponse(
        draftId=draft_id,
        name=name,
        description=description,
        slug=slug,
        analysisValid=True,
        failureReason=None,
        failureMessage=None,
        video=video_metadata(result.video),
        poseCoverage=result.pose_coverage,
        majorLandmarkCoverage=result.major_coverage,
        movementWindow=MovementWindow(
            startMs=window.start_ms,
            endMs=window.end_ms,
            durationMs=window.end_ms - window.start_ms,
        ),
        keyframes=[_keyframe_result(draft_id, pick) for pick in result.picks],
        debug=_debug(result.video, window, result.major_coverage, output_dir),
    )
    _persist_draft(output_dir, response)
    return response


def _persist_draft(output_dir: Path, response: ReferenceDraftResponse) -> None:
    payload = response.model_dump()
    payload["createdAt"] = utc_now_iso()
    write_json(output_dir / REFERENCE_DRAFT_METADATA_FILENAME, payload)


def _keyframe_result(draft_id: str, pick: ReferenceKeyframePick) -> ReferenceKeyframeResult:
    filename = f"{REFERENCE_KEYFRAMES_SUBDIR}/{pick.filename}"
    return ReferenceKeyframeResult(
        phase=pick.phase.value,
        frameIndex=pick.frame_index,
        timestampMs=pick.timestamp_ms,
        filename=filename,
        url=f"/api/reference-techniques/drafts/{draft_id}/keyframes/{pick.filename}",
    )


def _debug(
    video,
    window: ActiveWindowResult,
    major_coverage: float | None,
    output_dir: Path,
) -> ReferenceDebug:
    return ReferenceDebug(
        strategy=REFERENCE_STRATEGY,
        baseline=window.baseline,
        peakMotion=window.peak,
        motionDelta=window.motion_delta,
        smoothingMethod=MOTION_CONFIG.smoothing_method,
        smoothingWindow=MOTION_CONFIG.smoothing_window,
        fpsFallbackUsed=video.fps_fallback_used,
        majorLandmarkCoverage=major_coverage,
        draftDir=output_dir.name,
    )


def _invalid(
    draft_id: str,
    name: str,
    slug: str,
    description: str | None,
    reason: str,
    message: str,
    *,
    video=None,
    pose_coverage: float | None = None,
    major_coverage: float | None = None,
    window: ActiveWindowResult | None = None,
    fps_fallback_used: bool | None = None,
) -> ReferenceDraftResponse:
    fallback = video.fps_fallback_used if video is not None else bool(fps_fallback_used)
    return ReferenceDraftResponse(
        draftId=draft_id,
        name=name,
        description=description,
        slug=slug,
        analysisValid=False,
        failureReason=reason,
        failureMessage=message,
        video=video_metadata(video) if video is not None else None,
        poseCoverage=pose_coverage,
        majorLandmarkCoverage=major_coverage,
        movementWindow=None,
        keyframes=None,
        debug=ReferenceDebug(
            strategy=REFERENCE_STRATEGY,
            baseline=window.baseline if window else None,
            peakMotion=window.peak if window else None,
            motionDelta=window.motion_delta if window else None,
            smoothingMethod=MOTION_CONFIG.smoothing_method,
            smoothingWindow=MOTION_CONFIG.smoothing_window,
            fpsFallbackUsed=fallback,
            majorLandmarkCoverage=major_coverage,
            draftDir=None,
        ),
    )
