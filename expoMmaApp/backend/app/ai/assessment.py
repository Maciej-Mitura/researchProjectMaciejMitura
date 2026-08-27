"""Validate a model assessment and attach the backend-owned overall score."""

from __future__ import annotations

from app.ai.errors import MalformedAssessmentError
from app.ai.models import ModelVideoAssessment, ModelVisualAssessment
from app.ai.scoring import (
    ScoreError,
    ordered_criterion_assessments,
    ordered_phase_assessments,
    score_valid_assessment,
    score_valid_video_assessment,
)


def finalize_assessment(
    assessment: ModelVisualAssessment,
) -> tuple[ModelVisualAssessment, int | None]:
    """Experimental still-image path. Return (normalized assessment, overall or None)."""
    try:
        ordered = ordered_phase_assessments(assessment.phaseAssessments)
    except ScoreError as error:
        raise MalformedAssessmentError() from error

    normalized = assessment.model_copy(update={"phaseAssessments": list(ordered)})
    if not normalized.comparisonValid:
        return normalized, None
    try:
        return normalized, score_valid_assessment(normalized)
    except ScoreError as error:
        raise MalformedAssessmentError() from error


def finalize_video_assessment(
    assessment: ModelVideoAssessment,
) -> tuple[ModelVideoAssessment, int | None]:
    """Production video path. N/A criteria are excluded from the 0–100 result."""
    try:
        ordered = ordered_criterion_assessments(assessment.criteria)
    except ScoreError as error:
        raise MalformedAssessmentError() from error

    normalized = assessment.model_copy(update={"criteria": list(ordered)})
    if not normalized.comparisonValid:
        return normalized, None
    try:
        return normalized, score_valid_video_assessment(normalized)
    except ScoreError as error:
        raise MalformedAssessmentError() from error
