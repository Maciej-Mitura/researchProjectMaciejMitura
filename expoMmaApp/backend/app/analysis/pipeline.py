"""Shared attempt-analysis pipeline used by the API and the CLI."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import (
    MIN_FRAME_COUNT,
    MIN_RECORDING_DURATION_MS,
    MODEL_PATH,
    TMP_DIR,
)
from app.keyframes.extract import extract_phase_keyframes
from app.models.api import (
    AnalysisDebug,
    AnalyzeAttemptResponse,
    PhaseResult,
    VideoMetadata,
)
from app.models.phases import ExtensionSample, PhaseDetectionResult
from app.models.pose import PoseFrame, VideoInfo
from app.phases.jab import detect_jab_phases
from app.phases.jab_config import JAB_PHASE_CONFIG
from app.phases.signal import compute_lead_arm_extension
from app.pose.landmarks import UPPER_BODY_INDICES, lead_arm_indices
from app.pose.landmarker import PoseVideoLandmarker
from app.pose.video import probe_video
from app.techniques.catalog import LeadSide, TechniqueConfig, require_supported_technique

MIN_POSE_COVERAGE = 0.70
MIN_KEY_LANDMARK_COVERAGE = 0.60


@dataclass(frozen=True)
class AnalysisContext:
    analysis_id: str
    output_dir: Path


def analyze_attempt(
    video_path: Path,
    technique_id: str,
    *,
    analysis_id: str | None = None,
    output_dir: Path | None = None,
    model_path: Path | None = None,
) -> AnalyzeAttemptResponse:
    """Run pose → jab phases → keyframe extraction.

    This is the single production entry point for the built-in Jab detector
    (START / EXTENSION / PEAK / RETRACTION / RECOVERY). Recorded custom
    techniques use `analyze_generic_motion` instead. The HTTP API and CLI
    both call this function for `simple_jab`.
    """
    technique = require_supported_technique(technique_id)
    context = _make_context(analysis_id, output_dir)

    try:
        video = probe_video(video_path)
    except ValueError as error:
        return _invalid(
            context,
            technique,
            "invalid_video",
            str(error),
            fps_fallback_used=False,
        )

    with PoseVideoLandmarker(model_path or MODEL_PATH) as landmarker:
        pose_frames = landmarker.detect_video(video_path, video.fps)

    video = _with_actual_frame_count(video, len(pose_frames))
    if video.frame_count < MIN_FRAME_COUNT or video.duration_ms < MIN_RECORDING_DURATION_MS:
        return _invalid(
            context,
            technique,
            "recording_too_short",
            (
                "Recording is too short to analyze "
                f"({video.frame_count} frames, {video.duration_ms:.0f} ms)."
            ),
            video=video,
        )

    pose_coverage = _pose_coverage(pose_frames)
    key_coverage = _key_landmark_coverage(pose_frames)

    if pose_coverage <= 0.0:
        return _invalid(
            context,
            technique,
            "no_pose_detected",
            "No pose was detected in any video frame.",
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
        )
    if pose_coverage < MIN_POSE_COVERAGE:
        return _invalid(
            context,
            technique,
            "insufficient_pose_coverage",
            (
                "Insufficient pose coverage for reliable analysis "
                f"({pose_coverage:.0%}; need {MIN_POSE_COVERAGE:.0%})."
            ),
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
        )
    if key_coverage < MIN_KEY_LANDMARK_COVERAGE:
        return _invalid(
            context,
            technique,
            "key_landmarks_not_visible",
            (
                "Key upper-body landmarks were not visible enough "
                f"({key_coverage:.0%})."
            ),
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
        )

    samples = compute_lead_arm_extension(pose_frames, technique.lead_side)
    outside = _movement_outside_frame(pose_frames, samples, technique.lead_side)
    if outside:
        return _invalid(
            context,
            technique,
            "movement_outside_frame",
            "Lead wrist left the frame during the apparent movement.",
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
        )

    detection = detect_jab_phases(samples, JAB_PHASE_CONFIG)
    if not detection.valid:
        return _invalid(
            context,
            technique,
            detection.failure_reason or "phase_order_unresolved",
            detection.failure_message or "Could not establish jab movement phases.",
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
            detection=detection,
        )

    try:
        filenames = extract_phase_keyframes(
            video_path,
            video.fps,
            list(detection.phases),
            context.output_dir,
        )
    except ValueError as error:
        return _invalid(
            context,
            technique,
            "invalid_video",
            str(error),
            video=video,
            pose_coverage=pose_coverage,
            key_coverage=key_coverage,
            detection=detection,
        )

    phases = [
        PhaseResult(
            phase=pick.phase.value,
            frameIndex=pick.frame_index,
            timestampMs=pick.timestamp_ms,
            keyframeFilename=filenames[pick.phase.value],
            keyframeUrl=_keyframe_url(context.analysis_id, filenames[pick.phase.value]),
        )
        for pick in detection.phases
    ]
    return AnalyzeAttemptResponse(
        analysisId=context.analysis_id,
        techniqueId=technique.id,
        analysisValid=True,
        failureReason=None,
        failureMessage=None,
        video=_video_metadata(video),
        poseCoverage=pose_coverage,
        phases=phases,
        debug=_debug(technique, video, detection, key_coverage, context.output_dir),
    )


def _make_context(analysis_id: str | None, output_dir: Path | None) -> AnalysisContext:
    resolved_id = analysis_id or str(uuid.uuid4())
    resolved_dir = output_dir or (TMP_DIR / resolved_id)
    resolved_dir.mkdir(parents=True, exist_ok=True)
    return AnalysisContext(analysis_id=resolved_id, output_dir=resolved_dir)


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


def _pose_coverage(frames: list[PoseFrame]) -> float:
    if not frames:
        return 0.0
    detected = sum(1 for frame in frames if frame.pose_detected)
    return detected / len(frames)


def _key_landmark_coverage(frames: list[PoseFrame]) -> float:
    if not frames:
        return 0.0
    ok = 0
    for frame in frames:
        if not frame.pose_detected or frame.landmarks is None:
            continue
        if all(_visible(frame, index) for index in UPPER_BODY_INDICES):
            ok += 1
    return ok / len(frames)


def _visible(frame: PoseFrame, index: int) -> bool:
    if frame.landmarks is None or index >= len(frame.landmarks):
        return False
    landmark = frame.landmarks[index]
    visibility = 1.0 if landmark.visibility is None else landmark.visibility
    return visibility >= JAB_PHASE_CONFIG.min_visibility


def _movement_outside_frame(
    frames: list[PoseFrame],
    samples: list[ExtensionSample],
    lead_side: LeadSide,
) -> bool:
    """True when a usable extension sample has the lead wrist near the image edge."""
    wrist_index, _ = lead_arm_indices(lead_side)
    by_index = {frame.frame_index: frame for frame in frames}
    for sample in samples:
        if sample.raw is None:
            continue
        frame = by_index.get(sample.frame_index)
        if frame is None or frame.landmarks is None:
            continue
        if wrist_index >= len(frame.landmarks):
            continue
        wrist = frame.landmarks[wrist_index]
        if (
            wrist.x < JAB_PHASE_CONFIG.edge_margin
            or wrist.x > 1.0 - JAB_PHASE_CONFIG.edge_margin
            or wrist.y < JAB_PHASE_CONFIG.edge_margin
            or wrist.y > 1.0 - JAB_PHASE_CONFIG.edge_margin
        ):
            return True
    return False


def _invalid(
    context: AnalysisContext,
    technique: TechniqueConfig,
    reason: str,
    message: str,
    *,
    video: VideoInfo | None = None,
    pose_coverage: float | None = None,
    key_coverage: float | None = None,
    detection: PhaseDetectionResult | None = None,
    fps_fallback_used: bool | None = None,
) -> AnalyzeAttemptResponse:
    fallback = video.fps_fallback_used if video is not None else bool(fps_fallback_used)
    return AnalyzeAttemptResponse(
        analysisId=context.analysis_id,
        techniqueId=technique.id,
        analysisValid=False,
        failureReason=reason,
        failureMessage=message,
        video=_video_metadata(video) if video is not None else None,
        poseCoverage=pose_coverage,
        phases=None,
        debug=AnalysisDebug(
            leadSide=technique.lead_side.value,
            baseline=detection.baseline if detection else None,
            peakExtension=detection.peak_extension if detection else None,
            extensionDelta=detection.extension_delta if detection else None,
            smoothingMethod=JAB_PHASE_CONFIG.smoothing_method,
            smoothingWindow=JAB_PHASE_CONFIG.smoothing_window,
            fpsFallbackUsed=fallback,
            keyLandmarkCoverage=key_coverage,
            keyframeDir=None,
        ),
    )


def _video_metadata(video: VideoInfo) -> VideoMetadata:
    return VideoMetadata(
        fps=video.fps,
        durationMs=video.duration_ms,
        width=video.width,
        height=video.height,
        frameCount=video.frame_count,
    )


def _debug(
    technique: TechniqueConfig,
    video: VideoInfo,
    detection: PhaseDetectionResult,
    key_coverage: float,
    output_dir: Path,
) -> AnalysisDebug:
    return AnalysisDebug(
        leadSide=technique.lead_side.value,
        baseline=detection.baseline,
        peakExtension=detection.peak_extension,
        extensionDelta=detection.extension_delta,
        smoothingMethod=JAB_PHASE_CONFIG.smoothing_method,
        smoothingWindow=JAB_PHASE_CONFIG.smoothing_window,
        fpsFallbackUsed=video.fps_fallback_used,
        keyLandmarkCoverage=key_coverage,
        keyframeDir=str(output_dir.name),
    )


def _keyframe_url(analysis_id: str, filename: str) -> str:
    return f"/api/debug/analyses/{analysis_id}/keyframes/{filename}"
