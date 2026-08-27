"""Developer-only REFERENCE vs same REFERENCE Quick comparison.

Does not call Gemini. Does not require a new physical recording.
"""

from __future__ import annotations

from pathlib import Path

from app.comparison.pipeline import _similarity_payload
from app.config import MODEL_PATH
from app.models.comparison import (
    AnalyzeGenericAttemptResponse,
    ComparisonTechnique,
    ProcessingLatency,
)
from app.models.reference import MovementWindow, ReferenceTechniqueMetadata
from app.reference.analyzer import analyze_generic_motion
from app.reference.store import load_complete_reference, technique_video_path
from app.reference.window import video_crop_ms
from app.similarity.config import DEFAULT_SAMPLE_COUNT
from app.validation.models import SelfCompareResponse
from app.validation.repeat import compare_sequence_with_itself, deterministic_repeat_check
from app.validation.timing import StageTimer
from app.video.package import build_comparison_package
from app.video.state import VideoStage
from app.comparison.store import new_analysis_id, resolve_attempt_dir


def run_self_comparison(
    slug: str,
    *,
    render_video: bool = True,
    model_path: Path | None = None,
) -> SelfCompareResponse:
    metadata = load_complete_reference(slug)
    reference_path = technique_video_path(slug)
    timer = StageTimer()
    analysis_id = new_analysis_id()
    output_dir = resolve_attempt_dir(analysis_id)
    output_dir.mkdir(parents=True, exist_ok=True)

    with timer.measure("poseAnalysisMs"):
        motion = analyze_generic_motion(
            reference_path,
            model_path=model_path or MODEL_PATH,
            raw_stage=VideoStage.RAW_REFERENCE,
        )

    technique = ComparisonTechnique(
        id=metadata.id,
        slug=metadata.slug,
        name=metadata.name,
        description=metadata.description,
    )
    if not motion.valid or motion.window is None or motion.pose_frames is None:
        latency = ProcessingLatency(
            poseAnalysisMs=timer.get("poseAnalysisMs"),
            totalQuickMs=timer.elapsed_ms(),
        )
        comparison = AnalyzeGenericAttemptResponse(
            analysisId=analysis_id,
            technique=technique,
            analysisValid=False,
            failureReason=motion.failure_reason or "analysis_failed",
            failureMessage=motion.failure_message or "The reference recording could not be measured.",
            poseCoverage=motion.pose_coverage,
            majorLandmarkCoverage=motion.major_coverage,
            referenceMovementWindow=metadata.movementWindow,
            processingLatency=latency,
            normalizedSampleCount=DEFAULT_SAMPLE_COUNT,
        )
        return SelfCompareResponse(
            comparison=comparison,
            deterministicRepeat=_failed_repeat(),
            processingLatency=latency,
        )

    window = motion.window
    assert window.start_ms is not None and window.end_ms is not None
    frames = motion.pose_frames

    with timer.measure("quickSimilarityMs"):
        first, _second, repeat = deterministic_repeat_check(
            reference_frames=frames,
            user_frames=frames,
            reference_start_ms=window.start_ms,
            reference_end_ms=window.end_ms,
            user_start_ms=window.start_ms,
            user_end_ms=window.end_ms,
        )
        similarity = first

    package = None
    if render_video:
        crop = video_crop_ms(window)
        with timer.measure("comparisonVideoMs"):
            package = build_comparison_package(
                analysis_id=analysis_id,
                reference_path=reference_path,
                user_path=reference_path,
                reference_start_ms=crop[0],
                reference_end_ms=crop[1],
                user_start_ms=crop[0],
                user_end_ms=crop[1],
                reference_pose_frames=frames,
                user_pose_frames=frames,
                include_pose=True,
                include_ai=False,
                windows_already_canonical=bool(window.padding_applied),
                highlight_body_part=similarity.largest_body_part if similarity.valid else None,
                highlight_progress_start=similarity.progress_start if similarity.valid else None,
                highlight_progress_end=similarity.progress_end if similarity.valid else None,
            )

    latency = ProcessingLatency(
        poseAnalysisMs=timer.get("poseAnalysisMs"),
        comparisonVideoMs=timer.get("comparisonVideoMs"),
        quickSimilarityMs=timer.get("quickSimilarityMs"),
        totalQuickMs=timer.elapsed_ms(),
    )
    comparison = AnalyzeGenericAttemptResponse(
        analysisId=analysis_id,
        technique=technique,
        analysisValid=True,
        poseCoverage=motion.pose_coverage,
        majorLandmarkCoverage=motion.major_coverage,
        movementWindow=MovementWindow(
            startMs=window.start_ms,
            endMs=window.end_ms,
            durationMs=window.end_ms - window.start_ms,
        ),
        referenceMovementWindow=MovementWindow(
            startMs=window.start_ms,
            endMs=window.end_ms,
            durationMs=window.end_ms - window.start_ms,
        ),
        movementRegionCount=len(window.regions),
        referenceMovementRegionCount=len(window.regions),
        comparisonVideoUrl=package.comparison_video_url if package else None,
        comparisonPoseVideoUrl=package.comparison_pose_video_url if package else None,
        comparisonDurationMs=package.clean.duration_ms if package and package.clean else None,
        movementSimilarity=_similarity_payload(similarity),
        poseOverlayAvailable=bool(package and package.comparison_pose_video_url),
        processingLatency=latency,
        normalizedSampleCount=DEFAULT_SAMPLE_COUNT,
    )
    return SelfCompareResponse(
        comparison=comparison,
        deterministicRepeat=repeat,
        processingLatency=latency,
    )


def run_self_similarity_only(
    metadata: ReferenceTechniqueMetadata,
    frames,
    *,
    start_ms: int,
    end_ms: int,
):
    """Unit-test helper: no filesystem video render, no Gemini."""
    _ = metadata
    return compare_sequence_with_itself(frames, start_ms=start_ms, end_ms=end_ms)


def _failed_repeat():
    from app.validation.models import DeterministicRepeatResult

    return DeterministicRepeatResult(
        passed=False,
        label="Deterministic repeat check: FAIL",
        identical=False,
    )
