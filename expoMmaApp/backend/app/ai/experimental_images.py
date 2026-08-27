"""Experimental/legacy Phase 7 image-sequence Detailed Analysis.

Current OpenAI GPT vision models do not accept raw MP4 video. This path
samples dense stills and is retained for research comparison only.

Production Detailed Analysis uses `app.ai.pipeline.run_detailed_analysis`
(Gemini + synchronized video). Do not call this module from product routes.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from app.ai.assessment import finalize_assessment
from app.ai.client import AssessmentClient, OpenAIAssessmentClient
from app.ai.errors import AiPreprocessingError, DenseSampleError
from app.ai.frames import TimestampedFrame, pick_dense_frames
from app.ai.images import extract_prepared_frames
from app.ai.models import AiDebug, ComparisonTechnique, DetailedAssessmentResponse
from app.ai.prompt import INSTRUCTIONS, build_input_content
from app.config import DENSE_FRAME_COUNT, MODEL_PATH, openai_model
from app.models.reference import MovementWindow, ReferenceTechniqueMetadata
from app.pose.video import probe_video
from app.reference.analyzer import GenericMotionAnalysis, analyze_generic_motion
from app.reference.store import technique_video_path
from app.video.state import VideoStage

logger = logging.getLogger(__name__)


def run_experimental_image_analysis(
    user_video: Path,
    *,
    analysis_id: str,
    output_dir: Path,
    metadata: ReferenceTechniqueMetadata,
    assessor: AssessmentClient | None = None,
    model_path: Path | None = None,
) -> DetailedAssessmentResponse:
    """Legacy OpenAI still-image comparison. Not used by production routes."""
    technique = ComparisonTechnique(
        id=metadata.id,
        slug=metadata.slug,
        name=metadata.name,
        description=metadata.description,
    )
    started = time.perf_counter()
    pose_model = model_path or MODEL_PATH

    user_motion = analyze_generic_motion(
        user_video, model_path=pose_model, raw_stage=VideoStage.RAW_USER
    )
    if not user_motion.valid or user_motion.window is None:
        return _measurement_invalid(
            analysis_id,
            technique,
            user_motion,
            metadata.movementWindow,
        )

    reference_path = technique_video_path(metadata.slug)
    reference_motion = analyze_generic_motion(
        reference_path, model_path=pose_model, raw_stage=VideoStage.RAW_REFERENCE
    )
    if not reference_motion.valid or reference_motion.window is None:
        logger.warning(
            "Reference motion analysis failed for slug=%s reason=%s",
            metadata.slug,
            reference_motion.failure_reason,
        )
        raise AiPreprocessingError(
            "The stored reference recording could not be prepared for detailed analysis."
        )

    user_window = user_motion.window
    reference_window = reference_motion.window
    assert user_window.start_ms is not None and user_window.end_ms is not None
    assert reference_window.start_ms is not None and reference_window.end_ms is not None

    user_fps = user_motion.video.fps if user_motion.video is not None else probe_video(user_video).fps
    reference_fps = (
        reference_motion.video.fps
        if reference_motion.video is not None
        else probe_video(reference_path).fps
    )

    try:
        user_picks = pick_dense_frames(
            _timestamped_frames(user_video, user_fps),
            user_window.start_ms,
            user_window.end_ms,
            source="user",
        )
        reference_picks = pick_dense_frames(
            _timestamped_frames(reference_path, reference_fps),
            reference_window.start_ms,
            reference_window.end_ms,
            source="reference",
        )
        user_jpegs = extract_prepared_frames(
            user_video, user_fps, user_picks, output_dir / "frames"
        )
        reference_jpegs = extract_prepared_frames(
            reference_path, reference_fps, reference_picks, output_dir / "frames"
        )
    except DenseSampleError as error:
        return DetailedAssessmentResponse(
            analysisId=analysis_id,
            technique=technique,
            analysisValid=False,
            failureReason="movement_window_too_short",
            failureMessage=error.message,
            movementWindow=_window(user_window.start_ms, user_window.end_ms),
            referenceMovementWindow=_window(reference_window.start_ms, reference_window.end_ms),
        )
    except ValueError as error:
        logger.warning("AI frame extraction failed analysisId=%s", analysis_id)
        raise AiPreprocessingError("The recordings could not be prepared for detailed analysis.") from error

    content = build_input_content(
        technique_name=metadata.name,
        description=metadata.description,
        reference_picks=reference_picks,
        user_picks=user_picks,
        reference_jpegs=reference_jpegs,
        user_jpegs=user_jpegs,
    )
    client = assessor or OpenAIAssessmentClient()
    call = client.assess(instructions=INSTRUCTIONS, content=content)
    normalized, overall = finalize_assessment(call.assessment)
    latency_ms = int(round((time.perf_counter() - started) * 1000))

    debug = AiDebug(
        model=call.model or openai_model(),
        provider="openai-images-experimental",
        latencyMs=latency_ms,
        userFrameCount=len(user_picks),
        referenceFrameCount=len(reference_picks),
        userMovementDurationMs=user_window.end_ms - user_window.start_ms,
        referenceMovementDurationMs=reference_window.end_ms - reference_window.start_ms,
        analysisId=analysis_id,
        confidence=normalized.confidence,
        inputTokens=call.input_tokens,
        outputTokens=call.output_tokens,
    )
    logger.info(
        "Experimental image-sequence analysis finished analysisId=%s valid=%s score=%s latencyMs=%s frames=%s",
        analysis_id,
        normalized.comparisonValid,
        overall,
        latency_ms,
        DENSE_FRAME_COUNT,
    )

    if not normalized.comparisonValid:
        reason = normalized.invalidReason.strip() or (
            "The recordings could not be compared confidently from the available views."
        )
        return DetailedAssessmentResponse(
            analysisId=analysis_id,
            technique=technique,
            analysisValid=True,
            comparisonValid=False,
            invalidReason=reason,
            confidence=normalized.confidence,
            overallScore=None,
            phaseAssessments=list(normalized.phaseAssessments),
            strengths=list(normalized.strengths),
            mainCorrections=list(normalized.mainCorrections),
            summary=normalized.summary,
            movementWindow=_window(user_window.start_ms, user_window.end_ms),
            referenceMovementWindow=_window(reference_window.start_ms, reference_window.end_ms),
            debug=debug,
        )

    return DetailedAssessmentResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=True,
        comparisonValid=True,
        invalidReason=None,
        confidence=normalized.confidence,
        overallScore=overall,
        phaseAssessments=list(normalized.phaseAssessments),
        strengths=list(normalized.strengths),
        mainCorrections=list(normalized.mainCorrections),
        summary=normalized.summary,
        movementWindow=_window(user_window.start_ms, user_window.end_ms),
        referenceMovementWindow=_window(reference_window.start_ms, reference_window.end_ms),
        debug=debug,
    )


def _timestamped_frames(video_path: Path, fps: float) -> list[TimestampedFrame]:
    from app.pose.video import iter_video_frames

    return [
        TimestampedFrame(frame_index=decoded.frame_index, timestamp_ms=decoded.timestamp_ms)
        for decoded in iter_video_frames(video_path, fps)
    ]


def _window(start_ms: int, end_ms: int) -> MovementWindow:
    return MovementWindow(startMs=start_ms, endMs=end_ms, durationMs=end_ms - start_ms)


def _measurement_invalid(
    analysis_id: str,
    technique: ComparisonTechnique,
    motion: GenericMotionAnalysis,
    reference_window: MovementWindow,
) -> DetailedAssessmentResponse:
    return DetailedAssessmentResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=False,
        failureReason=motion.failure_reason or "analysis_failed",
        failureMessage=motion.failure_message or "The recording could not be measured.",
        comparisonValid=None,
        overallScore=None,
        movementWindow=None,
        referenceMovementWindow=reference_window,
    )
