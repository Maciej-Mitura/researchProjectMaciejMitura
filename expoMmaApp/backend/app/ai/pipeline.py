"""Production Detailed AI analysis pipeline.

API route → this module → video comparison package → Gemini provider →
backend-owned score aggregation.

Quick Comparison does not call this pipeline.
The experimental OpenAI still-image path lives in `experimental_images`.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from app.ai.assessment import finalize_video_assessment
from app.ai.errors import (
    AiPreprocessingError,
    COMPARISON_VIDEO_INVALID_CODE,
    COMPARISON_VIDEO_INVALID_MESSAGE,
)
from app.ai.models import (
    AiDebug,
    ComparisonTechnique,
    DetailedAssessmentResponse,
    MotionRegionDebug,
    VideoSideDebug,
)
from app.ai.progress import AnalysisStage
from app.ai.providers import ProgressCallback, VideoAssessmentProvider
from app.ai.providers.gemini_video import GeminiVideoProvider
from app.ai.reliability import load_retry_settings
from app.config import (
    AI_COMPARISON_VIDEO_FILENAME,
    MIN_CANONICAL_DURATION_MS,
    MODEL_PATH,
    REFERENCE_VIDEO_FILENAME,
    ai_comparison_duration_ms,
    gemini_model,
    gemini_video_fps,
)
from app.models.reference import MovementWindow, ReferenceTechniqueMetadata
from app.reference.analyzer import GenericMotionAnalysis, analyze_generic_motion
from app.reference.models import ActiveWindowResult
from app.reference.store import technique_video_path
from app.reference.window import video_crop_ms
from app.similarity.engine import compare_active_movements
from app.validation.context import AiComparisonContext, write_ai_context
from app.validation.timing import StageTimer
from app.video.errors import VideoCompositeError
from app.video.package import ComparisonPackage, build_comparison_package
from app.video.state import VideoStage
from app.models.comparison import ProcessingLatency

logger = logging.getLogger(__name__)


def run_detailed_analysis(
    user_video: Path,
    *,
    analysis_id: str,
    output_dir: Path,
    metadata: ReferenceTechniqueMetadata,
    provider: VideoAssessmentProvider | None = None,
    model_path: Path | None = None,
    on_progress: ProgressCallback | None = None,
) -> DetailedAssessmentResponse:
    technique = ComparisonTechnique(
        id=metadata.id,
        slug=metadata.slug,
        name=metadata.name,
        description=metadata.description,
    )
    started = time.perf_counter()
    timer = StageTimer()
    pose_model = model_path or MODEL_PATH
    assessor = provider or GeminiVideoProvider()
    settings = load_retry_settings()

    def report(
        stage: AnalysisStage,
        *,
        model: str | None = None,
        attempt: int | None = None,
        max_attempts: int | None = None,
        fallback_used: bool | None = None,
    ) -> None:
        if on_progress is None:
            return
        on_progress(
            stage,
            model=model or settings.primary_model,
            attempt=attempt,
            max_attempts=max_attempts or settings.max_attempts,
            fallback_used=fallback_used,
        )

    report(AnalysisStage.VALIDATING_VIDEO)
    with timer.measure("poseUserMs"):
        user_motion = analyze_generic_motion(
            user_video,
            model_path=pose_model,
            raw_stage=VideoStage.RAW_USER,
        )
    if not user_motion.valid or user_motion.window is None:
        return _measurement_invalid(
            analysis_id,
            technique,
            user_motion,
            metadata.movementWindow,
        )

    reference_path = technique_video_path(metadata.slug)
    with timer.measure("poseReferenceMs"):
        reference_motion = analyze_generic_motion(
            reference_path,
            model_path=pose_model,
            raw_stage=VideoStage.RAW_REFERENCE,
        )
    timer.marks["poseAnalysisMs"] = (timer.get("poseUserMs") or 0) + (timer.get("poseReferenceMs") or 0)
    if not reference_motion.valid or reference_motion.window is None:
        logger.warning(
            "Reference motion analysis failed for slug=%s reason=%s",
            metadata.slug,
            reference_motion.failure_reason,
        )
        raise AiPreprocessingError(
            "The stored reference recording could not be prepared for detailed analysis."
        )

    report(AnalysisStage.DETECTING_MOVEMENT)
    user_window = user_motion.window
    reference_window = reference_motion.window
    if not _windows_ready(user_window, reference_window):
        return _evidence_invalid(
            analysis_id,
            technique,
            user_motion,
            reference_motion,
            metadata.movementWindow,
        )

    user_crop = video_crop_ms(user_window)
    reference_crop = video_crop_ms(reference_window)
    assert user_window.start_ms is not None and user_window.end_ms is not None
    assert reference_window.start_ms is not None and reference_window.end_ms is not None

    report(AnalysisStage.PREPARING_COMPARISON)
    similarity = compare_active_movements(
        reference_frames=reference_motion.pose_frames,
        user_frames=user_motion.pose_frames,
        reference_start_ms=reference_window.start_ms,
        reference_end_ms=reference_window.end_ms,
        user_start_ms=user_window.start_ms,
        user_end_ms=user_window.end_ms,
    )
    try:
        with timer.measure("aiVideoPreparationMs"):
            package = build_comparison_package(
                analysis_id=analysis_id,
                reference_path=reference_path,
                user_path=user_video,
                reference_start_ms=reference_crop[0],
                reference_end_ms=reference_crop[1],
                user_start_ms=user_crop[0],
                user_end_ms=user_crop[1],
                reference_pose_frames=reference_motion.pose_frames,
                user_pose_frames=user_motion.pose_frames,
                include_pose=True,
                include_ai=True,
                windows_already_canonical=True,
                highlight_body_part=similarity.largest_body_part if similarity.valid else None,
                highlight_progress_start=similarity.progress_start if similarity.valid else None,
                highlight_progress_end=similarity.progress_end if similarity.valid else None,
            )
        timer.marks["comparisonVideoMs"] = timer.get("aiVideoPreparationMs")
    except VideoCompositeError as error:
        logger.warning(
            "AI comparison package failed analysisId=%s error=%s",
            analysis_id,
            error,
        )
        return _evidence_invalid(
            analysis_id,
            technique,
            user_motion,
            reference_motion,
            metadata.movementWindow,
            message=COMPARISON_VIDEO_INVALID_MESSAGE,
        )

    if not _package_ready_for_gemini(package):
        return _evidence_invalid(
            analysis_id,
            technique,
            user_motion,
            reference_motion,
            metadata.movementWindow,
        )

    report(AnalysisStage.PREPARING_AI_VIDEO)
    user_duration_ms = user_window.end_ms - user_window.start_ms
    reference_duration_ms = reference_window.end_ms - reference_window.start_ms
    write_ai_context(
        AiComparisonContext(
            analysisId=analysis_id,
            slug=metadata.slug,
            techniqueName=metadata.name,
            description=metadata.description,
            referenceDurationMs=reference_duration_ms,
            userDurationMs=user_duration_ms,
        )
    )
    _log_pipeline(analysis_id, user_motion, reference_motion, package)

    report(AnalysisStage.CONTACTING_PRIMARY_MODEL)
    with timer.measure("geminiProviderMs"):
        call = assessor.assess_video(
            video_path=package.ai_video_path,
            technique_name=metadata.name,
            description=metadata.description,
            reference_duration_ms=reference_duration_ms,
            user_duration_ms=user_duration_ms,
            on_progress=on_progress,
        )
    if call.provider_latency_ms is not None:
        timer.marks["geminiProviderMs"] = call.provider_latency_ms
    report(AnalysisStage.RECEIVING_AI_RESPONSE)
    report(AnalysisStage.VALIDATING_AI_RESPONSE)
    normalized, overall = finalize_video_assessment(call.assessment)
    report(AnalysisStage.CALCULATING_SCORE)
    latency_ms = int(round((time.perf_counter() - started) * 1000))
    report(AnalysisStage.PREPARING_RESULTS)

    debug = _debug(
        analysis_id=analysis_id,
        call=call,
        settings=settings,
        latency_ms=latency_ms,
        user_motion=user_motion,
        reference_motion=reference_motion,
        package=package,
        user_duration_ms=user_duration_ms,
        reference_duration_ms=reference_duration_ms,
        confidence=normalized.confidence,
    )
    logger.info(
        "Detailed AI analysis finished analysisId=%s valid=%s score=%s latencyMs=%s provider=%s previewMatchesGemini=%s",
        analysis_id,
        normalized.comparisonValid,
        overall,
        latency_ms,
        call.provider,
        package.preview_matches_gemini,
    )

    payload = dict(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=True,
        comparisonValid=normalized.comparisonValid,
        invalidReason=(
            None
            if normalized.comparisonValid
            else (normalized.invalidReason.strip() or "The recordings could not be compared confidently from the available views.")
        ),
        confidence=normalized.confidence,
        overallScore=overall if normalized.comparisonValid else None,
        criteria=list(normalized.criteria),
        strengths=list(normalized.strengths),
        mainCorrections=list(normalized.mainCorrections),
        summary=normalized.summary,
        movementWindow=_window(user_window.start_ms, user_window.end_ms),
        referenceMovementWindow=_window(reference_window.start_ms, reference_window.end_ms),
        movementRegionCount=len(user_window.regions),
        referenceMovementRegionCount=len(reference_window.regions),
        comparisonVideoUrl=package.comparison_video_url,
        comparisonPoseVideoUrl=package.comparison_pose_video_url,
        poseOverlayAvailable=package.comparison_pose_video_url is not None,
        processingLatency=ProcessingLatency(
            poseAnalysisMs=timer.get("poseAnalysisMs"),
            comparisonVideoMs=timer.get("comparisonVideoMs"),
            aiVideoPreparationMs=timer.get("aiVideoPreparationMs"),
            geminiProviderMs=timer.get("geminiProviderMs"),
            totalDetailedMs=latency_ms,
        ),
        debug=debug,
    )
    if not normalized.comparisonValid:
        payload["invalidReason"] = payload["invalidReason"] or (
            "The recordings could not be compared confidently from the available views."
        )
    return DetailedAssessmentResponse(**payload)


def _windows_ready(user: ActiveWindowResult, reference: ActiveWindowResult) -> bool:
    if not user.valid or not reference.valid:
        return False
    if user.start_ms is None or user.end_ms is None:
        return False
    if reference.start_ms is None or reference.end_ms is None:
        return False
    if (user.end_ms - user.start_ms) < MIN_CANONICAL_DURATION_MS:
        return False
    if (reference.end_ms - reference.start_ms) < MIN_CANONICAL_DURATION_MS:
        return False
    return True


def _package_ready_for_gemini(package: ComparisonPackage) -> bool:
    if package.ai_video_path is None or package.ai is None:
        return False
    if package.gemini_path is None or package.preview_path is None:
        return False
    if package.ai_retime_operations != 1:
        return False
    if package.preview_path.resolve() != package.gemini_path.resolve():
        return False
    if package.preview_path.name != AI_COMPARISON_VIDEO_FILENAME:
        return False
    if not package.ai_video_path.is_file():
        return False
    return True


def _debug(
    *,
    analysis_id: str,
    call,
    settings,
    latency_ms: int,
    user_motion: GenericMotionAnalysis,
    reference_motion: GenericMotionAnalysis,
    package: ComparisonPackage,
    user_duration_ms: int,
    reference_duration_ms: int,
    confidence: float,
) -> AiDebug:
    encoded_ms = package.ai.duration_ms if package.ai else None
    return AiDebug(
        model=call.model or gemini_model(),
        provider=call.provider,
        uploadMethod=call.upload_method,
        latencyMs=call.provider_latency_ms if call.provider_latency_ms is not None else latency_ms,
        userMovementDurationMs=user_duration_ms,
        referenceMovementDurationMs=reference_duration_ms,
        userFrameCount=user_motion.video.frame_count if user_motion.video else None,
        referenceFrameCount=reference_motion.video.frame_count if reference_motion.video else None,
        aiVideoDurationMs=encoded_ms,
        comparisonDurationMs=encoded_ms,
        geminiVideoFps=gemini_video_fps(),
        analysisId=analysis_id,
        confidence=confidence,
        inputTokens=call.input_tokens,
        outputTokens=call.output_tokens,
        requestedModel=call.requested_model or settings.primary_model,
        primaryAttempts=call.primary_attempts,
        fallbackUsed=call.fallback_used,
        fallbackAttempts=call.fallback_attempts,
        fallbackModel=settings.fallback_model if call.fallback_used else None,
        referencePipeline=_side_debug(reference_motion, VideoStage.RAW_REFERENCE),
        userPipeline=_side_debug(user_motion, VideoStage.RAW_USER),
        aiTargetDurationMs=ai_comparison_duration_ms(),
        aiOutputFps=package.ai.fps if package.ai else None,
        aiOutputFrameCount=package.ai.frame_count if package.ai else None,
        aiEncodedDurationMs=encoded_ms,
        previewMatchesGemini=package.preview_matches_gemini,
        compositeId=f"comparisons/{analysis_id}/{AI_COMPARISON_VIDEO_FILENAME}",
        referenceSource=REFERENCE_VIDEO_FILENAME,
    )


def _side_debug(motion: GenericMotionAnalysis, raw_kind: VideoStage) -> VideoSideDebug:
    window = motion.window
    video = motion.video
    regions = tuple(window.regions) if window is not None else ()
    canonical_start = window.canonical_start_ms if window else None
    canonical_end = window.canonical_end_ms if window else None
    canonical_duration = None
    canonical_frames = None
    if canonical_start is not None and canonical_end is not None:
        canonical_duration = canonical_end - canonical_start
        if video is not None and video.fps > 0:
            canonical_frames = max(1, int(round((canonical_duration / 1000.0) * video.fps)))
    return VideoSideDebug(
        rawKind=raw_kind.value,
        rawDurationMs=video.duration_ms if video else None,
        rawFps=video.fps if video else None,
        rawFrameCount=video.frame_count if video else None,
        regionCount=len(regions),
        regions=[MotionRegionDebug(startMs=item.start_ms, endMs=item.end_ms) for item in regions],
        canonicalStartMs=canonical_start,
        canonicalEndMs=canonical_end,
        canonicalDurationMs=canonical_duration,
        canonicalFrameCount=canonical_frames,
    )


def _log_pipeline(
    analysis_id: str,
    user_motion: GenericMotionAnalysis,
    reference_motion: GenericMotionAnalysis,
    package: ComparisonPackage,
) -> None:
    def line(label: str, motion: GenericMotionAnalysis) -> str:
        video = motion.video
        window = motion.window
        if video is None or window is None:
            return f"{label} unavailable"
        start = window.canonical_start_ms if window.canonical_start_ms is not None else window.start_ms
        end = window.canonical_end_ms if window.canonical_end_ms is not None else window.end_ms
        duration = (end - start) if start is not None and end is not None else 0
        return (
            f"{label} raw={video.duration_ms / 1000:.2f}s @{video.fps:.0f}fps / {video.frame_count} frames "
            f"regions={len(window.regions)} canonical={start / 1000 if start is not None else 0:.2f}–"
            f"{end / 1000 if end is not None else 0:.2f}s canonicalDuration={duration / 1000:.2f}s"
        )

    logger.info(
        "AI video pipeline analysisId=%s %s | %s | AI target=%.2fs actual=%.2fs fps=%s frames=%s previewMatchesGemini=%s",
        analysis_id,
        line("REFERENCE", reference_motion),
        line("USER", user_motion),
        ai_comparison_duration_ms() / 1000,
        (package.ai.duration_ms / 1000) if package.ai else 0.0,
        package.ai.fps if package.ai else None,
        package.ai.frame_count if package.ai else None,
        package.preview_matches_gemini,
    )


def _window(start_ms: int, end_ms: int) -> MovementWindow:
    return MovementWindow(startMs=start_ms, endMs=end_ms, durationMs=end_ms - start_ms)


def _measurement_invalid(
    analysis_id: str,
    technique: ComparisonTechnique,
    motion: GenericMotionAnalysis,
    reference_window: MovementWindow,
) -> DetailedAssessmentResponse:
    reason = motion.failure_reason or "analysis_failed"
    message = motion.failure_message or "The recording could not be measured."
    if reason in {COMPARISON_VIDEO_INVALID_CODE, "incomplete_movement_window", "double_processing"}:
        message = COMPARISON_VIDEO_INVALID_MESSAGE
        reason = COMPARISON_VIDEO_INVALID_CODE
    return DetailedAssessmentResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=False,
        failureReason=reason,
        failureMessage=message,
        comparisonValid=None,
        overallScore=None,
        movementWindow=None,
        referenceMovementWindow=reference_window,
        movementRegionCount=len(motion.window.regions) if motion.window else None,
    )


def _evidence_invalid(
    analysis_id: str,
    technique: ComparisonTechnique,
    user_motion: GenericMotionAnalysis,
    reference_motion: GenericMotionAnalysis,
    reference_window: MovementWindow,
    *,
    message: str = COMPARISON_VIDEO_INVALID_MESSAGE,
) -> DetailedAssessmentResponse:
    user_window = user_motion.window
    ref_window = reference_motion.window
    return DetailedAssessmentResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=False,
        failureReason=COMPARISON_VIDEO_INVALID_CODE,
        failureMessage=message,
        comparisonValid=None,
        overallScore=None,
        movementWindow=(
            _window(user_window.start_ms, user_window.end_ms)
            if user_window and user_window.start_ms is not None and user_window.end_ms is not None
            else None
        ),
        referenceMovementWindow=(
            _window(ref_window.start_ms, ref_window.end_ms)
            if ref_window and ref_window.start_ms is not None and ref_window.end_ms is not None
            else reference_window
        ),
        movementRegionCount=len(user_window.regions) if user_window else None,
        referenceMovementRegionCount=len(ref_window.regions) if ref_window else None,
    )
