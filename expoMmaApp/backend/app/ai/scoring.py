"""Deterministic overall score. The model never chooses the 0–100 result."""

from __future__ import annotations

from collections.abc import Sequence

from app.ai.models import (
    ASSESSMENT_CRITERIA,
    ASSESSMENT_PHASES,
    CRITERION_SCORE_MAX,
    HOLISTIC_OVERALL_SIMILARITY_ID,
    OVERALL_SCORE_MAX,
    PHASE_SCORE_MAX,
    AssessmentCriterionId,
    AssessmentPhase,
    CriterionAssessment,
    ModelVideoAssessment,
    ModelVisualAssessment,
    PhaseAssessment,
)


class ScoreError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def round_overall_score(earned: float, maximum: float) -> int:
    """Single rounding rule: nearest integer of (earned / maximum) * 100."""
    if maximum <= 0:
        raise ScoreError("Overall score requires a positive maximum.")
    return int(round((earned / maximum) * OVERALL_SCORE_MAX))


def overall_score_from_phases(scores: Sequence[int]) -> int:
    """sum(phase scores) / (5 * 4) * 100, rounded to the nearest integer."""
    if len(scores) != len(ASSESSMENT_PHASES):
        raise ScoreError("Overall score requires exactly five phase scores.")
    for value in scores:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ScoreError("Phase scores must be integers.")
        if value < 0 or value > PHASE_SCORE_MAX:
            raise ScoreError(f"Phase scores must be between 0 and {PHASE_SCORE_MAX}.")
    maximum = PHASE_SCORE_MAX * len(ASSESSMENT_PHASES)
    return round_overall_score(sum(scores), maximum)


def ordered_phase_assessments(items: Sequence[PhaseAssessment]) -> tuple[PhaseAssessment, ...]:
    by_phase: dict[AssessmentPhase, PhaseAssessment] = {}
    for item in items:
        if item.phase in by_phase:
            raise ScoreError(f"Duplicate phase assessment for {item.phase.value}.")
        by_phase[item.phase] = item
    missing = [phase.value for phase in ASSESSMENT_PHASES if phase not in by_phase]
    if missing:
        raise ScoreError(f"Missing phase assessments: {', '.join(missing)}.")
    extra = [item.phase.value for item in items if item.phase not in ASSESSMENT_PHASES]
    if extra:
        raise ScoreError(f"Unexpected phase assessments: {', '.join(extra)}.")
    return tuple(by_phase[phase] for phase in ASSESSMENT_PHASES)


def score_valid_assessment(assessment: ModelVisualAssessment) -> int:
    ordered = ordered_phase_assessments(assessment.phaseAssessments)
    return overall_score_from_phases([item.score for item in ordered])


def ordered_criterion_assessments(
    items: Sequence[CriterionAssessment],
) -> tuple[CriterionAssessment, ...]:
    by_id: dict[AssessmentCriterionId, CriterionAssessment] = {}
    extras: list[str] = []
    for item in items:
        criterion_id = _criterion_id(item)
        if criterion_id == HOLISTIC_OVERALL_SIMILARITY_ID:
            continue
        if item.criterion not in ASSESSMENT_CRITERIA:
            extras.append(criterion_id)
            continue
        if item.criterion in by_id:
            raise ScoreError(f"Duplicate criterion assessment for {item.criterion.value}.")
        by_id[item.criterion] = item
    if extras:
        raise ScoreError(f"Unexpected criterion assessments: {', '.join(extras)}.")
    missing = [item.value for item in ASSESSMENT_CRITERIA if item not in by_id]
    if missing:
        raise ScoreError(f"Missing criterion assessments: {', '.join(missing)}.")
    return tuple(by_id[item] for item in ASSESSMENT_CRITERIA)


def applicable_criterion_scores(items: Sequence[CriterionAssessment]) -> tuple[int, ...]:
    ordered = ordered_criterion_assessments(items)
    scores: list[int] = []
    for item in ordered:
        if item.notApplicable:
            continue
        if item.score is None:
            raise ScoreError(f"Applicable criterion {item.criterion.value} is missing a score.")
        if not isinstance(item.score, int) or isinstance(item.score, bool):
            raise ScoreError("Criterion scores must be integers.")
        if item.score < 0 or item.score > CRITERION_SCORE_MAX:
            raise ScoreError(f"Criterion scores must be between 0 and {CRITERION_SCORE_MAX}.")
        scores.append(item.score)
    if not scores:
        raise ScoreError("At least one criterion must be applicable to compute a score.")
    return tuple(scores)


def overall_score_from_criteria(items: Sequence[CriterionAssessment]) -> int:
    """sum(applicable scores) / (4 × applicable count) × 100, nearest integer."""
    scores = applicable_criterion_scores(items)
    maximum = CRITERION_SCORE_MAX * len(scores)
    return round_overall_score(sum(scores), maximum)


def score_valid_video_assessment(assessment: ModelVideoAssessment) -> int:
    return overall_score_from_criteria(assessment.criteria)


def _criterion_id(item: CriterionAssessment) -> str:
    criterion = item.criterion
    value = getattr(criterion, "value", criterion)
    return str(value)
