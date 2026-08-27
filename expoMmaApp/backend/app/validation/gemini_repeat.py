"""Gemini prototype-stability repeats against a frozen AI comparison MP4."""

from __future__ import annotations

from app.ai.assessment import finalize_video_assessment
from app.ai.models import CriterionAssessment
from app.ai.providers import VideoAssessmentProvider
from app.ai.providers.gemini_video import GeminiVideoProvider
from app.config import AI_COMPARISON_VIDEO_FILENAME
from app.validation.context import ai_comparison_video_path, load_ai_context, sha256_file
from app.validation.models import (
    GeminiCriteriaScores,
    RepeatabilityResult,
    RepeatabilityRun,
    RepeatabilityStats,
    bound_repeat_count,
    criteria_from_assessments,
)


def run_gemini_repeatability(
    *,
    analysis_id: str,
    run_count: int,
    provider: VideoAssessmentProvider | None = None,
) -> RepeatabilityResult:
    count = bound_repeat_count(run_count)
    context = load_ai_context(analysis_id)
    video_path = ai_comparison_video_path(analysis_id)
    if video_path.name != AI_COMPARISON_VIDEO_FILENAME:
        raise ValueError("Repeatability must reuse the prepared ai-comparison.mp4.")
    original_digest = sha256_file(video_path)
    assessor = provider or GeminiVideoProvider()
    runs: list[RepeatabilityRun] = []
    for index in range(count):
        before = sha256_file(video_path)
        call = assessor.assess_video(
            video_path=video_path,
            technique_name=context.techniqueName,
            description=context.description,
            reference_duration_ms=context.referenceDurationMs,
            user_duration_ms=context.userDurationMs,
        )
        after = sha256_file(video_path)
        if before != original_digest or after != original_digest:
            raise RuntimeError("AI comparison video changed between Gemini repeatability runs.")
        normalized, overall = finalize_video_assessment(call.assessment)
        score = overall if normalized.comparisonValid else None
        runs.append(
            RepeatabilityRun(
                index=index + 1,
                overallScore=score,
                criteria=_criteria_payload(list(normalized.criteria)),
                model=call.model,
                fallbackUsed=call.fallback_used,
                latencyMs=call.provider_latency_ms,
                summary=normalized.summary,
                videoSha256=after,
            )
        )
    scores = [run.overallScore for run in runs if run.overallScore is not None]
    return RepeatabilityResult(
        analysisId=analysis_id,
        assetFilename=video_path.name,
        assetSha256=original_digest,
        identicalAssetEachRun=all(run.videoSha256 == original_digest for run in runs),
        reusedExistingAiVideo=True,
        runs=runs,
        overall=_stats(count, scores),
    )


def _criteria_payload(items: list[CriterionAssessment]) -> GeminiCriteriaScores | None:
    return criteria_from_assessments(items)


def _stats(run_count: int, scores: list[int]) -> RepeatabilityStats:
    if not scores:
        return RepeatabilityStats(runCount=run_count)
    minimum = float(min(scores))
    maximum = float(max(scores))
    return RepeatabilityStats(
        runCount=run_count,
        minimum=minimum,
        maximum=maximum,
        mean=round(sum(scores) / len(scores), 2),
        scoreRange=round(maximum - minimum, 2),
    )
