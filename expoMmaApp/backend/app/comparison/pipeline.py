"""Analyze a USER attempt against a recorded reference technique.

Reuses `analyze_generic_motion` from reference capture. Builds a synchronized
side-by-side comparison video and a deterministic Movement Similarity from the
complete pose sequences. Does not call Gemini or OpenAI.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.comparison.pairing import build_comparison_pairs
from app.config import MODEL_PATH
from app.keyframes.extract import extract_named_frames
from app.models.comparison import (
    AnalyzeGenericAttemptResponse,
    ComparisonTechnique,
    MovementSimilarityResult,
    ProcessingLatency,
    SimilarityComponents,
    SimilarityDiagnostics,
    SimilarityFeedback,
    SimilarityLargestDeviation,
)
from app.models.reference import MovementWindow, ReferenceTechniqueMetadata
from app.reference.analyzer import GenericMotionAnalysis, analyze_generic_motion, video_metadata
from app.reference.models import ActiveWindowResult
from app.reference.store import technique_video_path
from app.reference.window import video_crop_ms
from app.similarity.config import DEFAULT_SAMPLE_COUNT
from app.similarity.engine import SimilarityOutcome, compare_active_movements
from app.validation.timing import StageTimer
from app.video.package import build_comparison_package
from app.video.state import VideoStage

logger = logging.getLogger(__name__)


def analyze_generic_attempt(
    video_path: Path,
    *,
    analysis_id: str,
    output_dir: Path,
    metadata: ReferenceTechniqueMetadata,
    model_path: Path | None = None,
) -> AnalyzeGenericAttemptResponse:
    output_dir.mkdir(parents=True, exist_ok=True)
    timer = StageTimer()
    technique = ComparisonTechnique(
        id=metadata.id,
        slug=metadata.slug,
        name=metadata.name,
        description=metadata.description,
    )
    pose_model = model_path or MODEL_PATH

    with timer.measure("poseUserMs"):
        result = analyze_generic_motion(video_path, model_path=pose_model, raw_stage=VideoStage.RAW_USER)
    if not result.valid or result.picks is None or result.window is None:
        return _invalid(
            analysis_id,
            technique,
            result.failure_reason or "analysis_failed",
            result.failure_message or "The recording could not be measured.",
            video=result.video,
            pose_coverage=result.pose_coverage,
            major_coverage=result.major_coverage,
            reference_window=metadata.movementWindow,
            latency=_quick_latency(timer),
        )

    try:
        extract_named_frames(
            video_path,
            result.video.fps if result.video is not None else 30.0,
            [(pick.frame_index, pick.filename) for pick in result.picks],
            output_dir,
        )
    except ValueError as error:
        return _invalid(
            analysis_id,
            technique,
            "keyframes_unavailable",
            str(error),
            video=result.video,
            pose_coverage=result.pose_coverage,
            major_coverage=result.major_coverage,
            window=result.window,
            reference_window=metadata.movementWindow,
            latency=_quick_latency(timer),
        )

    pairs = build_comparison_pairs(
        result.picks,
        metadata.keyframes,
        analysis_id=analysis_id,
        slug=metadata.slug,
    )
    window = result.window
    assert window.start_ms is not None and window.end_ms is not None

    reference_path = technique_video_path(metadata.slug)
    with timer.measure("poseReferenceMs"):
        reference_motion = analyze_generic_motion(
            reference_path,
            model_path=pose_model,
            raw_stage=VideoStage.RAW_REFERENCE,
        )
    timer.marks["poseAnalysisMs"] = (timer.get("poseUserMs") or 0) + (timer.get("poseReferenceMs") or 0)
    reference_window = _reference_window(reference_motion, metadata.movementWindow)
    user_crop = video_crop_ms(window)
    if reference_motion.window is not None and reference_motion.window.valid:
        reference_crop = video_crop_ms(reference_motion.window)
    else:
        reference_crop = (reference_window.startMs, reference_window.endMs)

    with timer.measure("quickSimilarityMs"):
        similarity = compare_active_movements(
            reference_frames=reference_motion.pose_frames if reference_motion.valid else None,
            user_frames=result.pose_frames,
            reference_start_ms=reference_window.startMs,
            reference_end_ms=reference_window.endMs,
            user_start_ms=window.start_ms,
            user_end_ms=window.end_ms,
        )

    with timer.measure("comparisonVideoMs"):
        package = build_comparison_package(
            analysis_id=analysis_id,
            reference_path=reference_path,
            user_path=video_path,
            reference_start_ms=reference_crop[0],
            reference_end_ms=reference_crop[1],
            user_start_ms=user_crop[0],
            user_end_ms=user_crop[1],
            reference_pose_frames=reference_motion.pose_frames if reference_motion.valid else None,
            user_pose_frames=result.pose_frames,
            include_pose=True,
            include_ai=False,
            windows_already_canonical=bool(
                reference_motion.valid
                and reference_motion.window is not None
                and reference_motion.window.padding_applied
                and window.padding_applied
            ),
            highlight_body_part=similarity.largest_body_part if similarity.valid else None,
            highlight_progress_start=similarity.progress_start if similarity.valid else None,
            highlight_progress_end=similarity.progress_end if similarity.valid else None,
        )

    return AnalyzeGenericAttemptResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=True,
        failureReason=None,
        failureMessage=None,
        poseCoverage=result.pose_coverage,
        majorLandmarkCoverage=result.major_coverage,
        movementWindow=MovementWindow(
            startMs=window.start_ms,
            endMs=window.end_ms,
            durationMs=window.end_ms - window.start_ms,
        ),
        referenceMovementWindow=MovementWindow(
            startMs=reference_window.startMs,
            endMs=reference_window.endMs,
            durationMs=reference_window.endMs - reference_window.startMs,
        ),
        movementRegionCount=len(window.regions),
        referenceMovementRegionCount=(
            len(reference_motion.window.regions)
            if reference_motion.valid and reference_motion.window is not None
            else None
        ),
        video=video_metadata(result.video) if result.video is not None else None,
        pairs=pairs,
        comparisonVideoUrl=package.comparison_video_url,
        comparisonPoseVideoUrl=package.comparison_pose_video_url,
        comparisonDurationMs=package.clean.duration_ms if package.clean else None,
        movementSimilarity=_similarity_payload(similarity),
        poseOverlayAvailable=package.comparison_pose_video_url is not None,
        processingLatency=_quick_latency(timer),
        normalizedSampleCount=DEFAULT_SAMPLE_COUNT,
    )


def _reference_window(
    motion: GenericMotionAnalysis,
    stored: MovementWindow,
) -> MovementWindow:
    if motion.valid and motion.window is not None and motion.window.start_ms is not None:
        start = motion.window.start_ms
        end = motion.window.end_ms if motion.window.end_ms is not None else stored.endMs
        return MovementWindow(startMs=start, endMs=end, durationMs=end - start)
    logger.warning("Reference motion re-analysis failed; using stored active window.")
    return stored


def _invalid(
    analysis_id: str,
    technique: ComparisonTechnique,
    reason: str,
    message: str,
    *,
    video=None,
    pose_coverage: float | None = None,
    major_coverage: float | None = None,
    window: ActiveWindowResult | None = None,
    reference_window: MovementWindow | None = None,
    latency: ProcessingLatency | None = None,
) -> AnalyzeGenericAttemptResponse:
    _ = window
    return AnalyzeGenericAttemptResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=False,
        failureReason=reason,
        failureMessage=message,
        poseCoverage=pose_coverage,
        majorLandmarkCoverage=major_coverage,
        movementWindow=None,
        referenceMovementWindow=reference_window,
        video=video_metadata(video) if video is not None else None,
        pairs=None,
        comparisonVideoUrl=None,
        comparisonPoseVideoUrl=None,
        comparisonDurationMs=None,
        movementSimilarity=None,
        poseOverlayAvailable=False,
        processingLatency=latency,
        normalizedSampleCount=DEFAULT_SAMPLE_COUNT,
    )


def _quick_latency(timer: StageTimer) -> ProcessingLatency:
    return ProcessingLatency(
        poseAnalysisMs=timer.get("poseAnalysisMs") or timer.get("poseUserMs"),
        comparisonVideoMs=timer.get("comparisonVideoMs"),
        quickSimilarityMs=timer.get("quickSimilarityMs"),
        totalQuickMs=timer.elapsed_ms(),
    )


def _similarity_payload(outcome: SimilarityOutcome) -> MovementSimilarityResult:
    if not outcome.valid:
        return MovementSimilarityResult(
            similarityValid=False,
            invalidReason=outcome.invalid_reason,
            movementSimilarity=None,
            components=None,
            diagnostics=SimilarityDiagnostics(
                referenceDurationMs=outcome.reference_duration_ms,
                userDurationMs=outcome.user_duration_ms,
            ),
            feedback=None,
        )
    largest = None
    if (
        outcome.largest_body_part
        and outcome.progress_start is not None
        and outcome.progress_end is not None
    ):
        largest = SimilarityLargestDeviation(
            bodyPart=outcome.largest_body_part,
            progressStart=outcome.progress_start,
            progressEnd=outcome.progress_end,
        )
    components = None
    if (
        outcome.pose_similarity is not None
        and outcome.path_similarity is not None
        and outcome.timing_similarity is not None
    ):
        components = SimilarityComponents(
            poseSimilarity=outcome.pose_similarity,
            movementPathSimilarity=outcome.path_similarity,
            timingSimilarity=outcome.timing_similarity,
        )
    feedback = None
    if outcome.strongest and outcome.main_difference:
        feedback = SimilarityFeedback(
            strongest=outcome.strongest,
            mainDifference=outcome.main_difference,
        )
    return MovementSimilarityResult(
        similarityValid=True,
        invalidReason=None,
        movementSimilarity=outcome.movement_similarity,
        components=components,
        diagnostics=SimilarityDiagnostics(
            referenceDurationMs=outcome.reference_duration_ms,
            userDurationMs=outcome.user_duration_ms,
            largestDeviation=largest,
            upperBodySimilarity=outcome.upper_body_similarity,
            lowerBodySimilarity=outcome.lower_body_similarity,
            timeline=list(outcome.timeline) if outcome.timeline is not None else None,
        ),
        feedback=feedback,
    )
