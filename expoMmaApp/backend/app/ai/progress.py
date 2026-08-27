"""Pipeline milestone progress for Detailed AI Analysis.

Percentages are completed application stages, not Gemini inference completion.
Do not invent a continuously increasing model-internal percentage.
"""

from __future__ import annotations

from enum import StrEnum

from app.ai.reliability import display_model_name


class AnalysisStage(StrEnum):
    UPLOADING = "UPLOADING"
    VALIDATING_VIDEO = "VALIDATING_VIDEO"
    DETECTING_MOVEMENT = "DETECTING_MOVEMENT"
    PREPARING_COMPARISON = "PREPARING_COMPARISON"
    PREPARING_AI_VIDEO = "PREPARING_AI_VIDEO"
    CONTACTING_PRIMARY_MODEL = "CONTACTING_PRIMARY_MODEL"
    RETRYING_PRIMARY_MODEL = "RETRYING_PRIMARY_MODEL"
    CONTACTING_FALLBACK_MODEL = "CONTACTING_FALLBACK_MODEL"
    RECEIVING_AI_RESPONSE = "RECEIVING_AI_RESPONSE"
    VALIDATING_AI_RESPONSE = "VALIDATING_AI_RESPONSE"
    CALCULATING_SCORE = "CALCULATING_SCORE"
    PREPARING_RESULTS = "PREPARING_RESULTS"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


# Milestone percentages for stages our application actually completes.
STAGE_PROGRESS: dict[AnalysisStage, int] = {
    AnalysisStage.UPLOADING: 10,
    AnalysisStage.VALIDATING_VIDEO: 18,
    AnalysisStage.DETECTING_MOVEMENT: 32,
    AnalysisStage.PREPARING_COMPARISON: 45,
    AnalysisStage.PREPARING_AI_VIDEO: 55,
    AnalysisStage.CONTACTING_PRIMARY_MODEL: 65,
    AnalysisStage.RETRYING_PRIMARY_MODEL: 70,
    AnalysisStage.CONTACTING_FALLBACK_MODEL: 75,
    AnalysisStage.RECEIVING_AI_RESPONSE: 85,
    AnalysisStage.VALIDATING_AI_RESPONSE: 91,
    AnalysisStage.CALCULATING_SCORE: 96,
    AnalysisStage.PREPARING_RESULTS: 98,
    AnalysisStage.COMPLETE: 100,
    AnalysisStage.FAILED: 0,
}

STAGE_ORDER: tuple[AnalysisStage, ...] = (
    AnalysisStage.UPLOADING,
    AnalysisStage.VALIDATING_VIDEO,
    AnalysisStage.DETECTING_MOVEMENT,
    AnalysisStage.PREPARING_COMPARISON,
    AnalysisStage.PREPARING_AI_VIDEO,
    AnalysisStage.CONTACTING_PRIMARY_MODEL,
    AnalysisStage.RETRYING_PRIMARY_MODEL,
    AnalysisStage.CONTACTING_FALLBACK_MODEL,
    AnalysisStage.RECEIVING_AI_RESPONSE,
    AnalysisStage.VALIDATING_AI_RESPONSE,
    AnalysisStage.CALCULATING_SCORE,
    AnalysisStage.PREPARING_RESULTS,
    AnalysisStage.COMPLETE,
)

CHECKLIST_ITEMS: tuple[tuple[AnalysisStage, str], ...] = (
    (AnalysisStage.UPLOADING, "Recording uploaded"),
    (AnalysisStage.DETECTING_MOVEMENT, "Movement detected"),
    (AnalysisStage.PREPARING_COMPARISON, "Comparison prepared"),
    (AnalysisStage.CONTACTING_PRIMARY_MODEL, "AI analysis"),
    (AnalysisStage.VALIDATING_AI_RESPONSE, "Feedback validation"),
    (AnalysisStage.PREPARING_RESULTS, "Results"),
)

PROGRESS_CAPTION = (
    "This percentage is application pipeline progress, not Gemini inference completion."
)


def stage_progress(stage: AnalysisStage, *, attempt: int | None = None, max_attempts: int | None = None) -> int:
    if stage is AnalysisStage.FAILED:
        return 0
    if stage is AnalysisStage.RETRYING_PRIMARY_MODEL and attempt and max_attempts and max_attempts > 1:
        span = 10
        ratio = min(1.0, max(0.0, (attempt - 1) / max(1, max_attempts - 1)))
        return min(74, 65 + int(round(span * ratio)))
    return STAGE_PROGRESS[stage]


def stage_index(stage: AnalysisStage) -> int:
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


def stage_message(
    stage: AnalysisStage,
    *,
    model: str | None = None,
    fallback_model: str | None = None,
    attempt: int | None = None,
    max_attempts: int | None = None,
) -> str:
    primary = display_model_name(model) if model else "the primary AI model"
    backup = display_model_name(fallback_model) if fallback_model else "the backup AI model"
    if stage is AnalysisStage.UPLOADING:
        return "Uploading your recording…"
    if stage is AnalysisStage.VALIDATING_VIDEO:
        return "Validating the recording…"
    if stage is AnalysisStage.DETECTING_MOVEMENT:
        return "Detecting movement…"
    if stage is AnalysisStage.PREPARING_COMPARISON:
        return "Preparing synchronized comparison…"
    if stage is AnalysisStage.PREPARING_AI_VIDEO:
        return "Preparing the AI comparison video…"
    if stage is AnalysisStage.CONTACTING_PRIMARY_MODEL:
        return f"Analyzing with {primary}…"
    if stage is AnalysisStage.RETRYING_PRIMARY_MODEL:
        current = attempt or 1
        total = max_attempts or current
        return f"{primary} is busy — retrying ({current}/{total})…"
    if stage is AnalysisStage.CONTACTING_FALLBACK_MODEL:
        return f"Trying backup model: {backup}…"
    if stage is AnalysisStage.RECEIVING_AI_RESPONSE:
        return "Receiving AI feedback…"
    if stage is AnalysisStage.VALIDATING_AI_RESPONSE:
        return "Validating feedback…"
    if stage is AnalysisStage.CALCULATING_SCORE:
        return "Calculating your score…"
    if stage is AnalysisStage.PREPARING_RESULTS:
        return "Preparing results…"
    if stage is AnalysisStage.COMPLETE:
        return "Analysis complete."
    if stage is AnalysisStage.FAILED:
        return "Detailed AI Analysis could not be completed."
    return "Working on your analysis…"


def checklist_for(stage: AnalysisStage) -> list[dict[str, str]]:
    current = stage_index(stage)
    if stage is AnalysisStage.FAILED:
        current = max(current, 0)
    items: list[dict[str, str]] = []
    for required, label in CHECKLIST_ITEMS:
        required_index = stage_index(required)
        if stage is AnalysisStage.COMPLETE:
            state = "complete"
        elif current > required_index:
            state = "complete"
        elif _checklist_active(stage, required):
            state = "active"
        else:
            state = "pending"
        items.append({"id": required.value, "label": label, "state": state})
    return items


def _checklist_active(stage: AnalysisStage, required: AnalysisStage) -> bool:
    if required is AnalysisStage.CONTACTING_PRIMARY_MODEL:
        return stage in {
            AnalysisStage.CONTACTING_PRIMARY_MODEL,
            AnalysisStage.RETRYING_PRIMARY_MODEL,
            AnalysisStage.CONTACTING_FALLBACK_MODEL,
            AnalysisStage.RECEIVING_AI_RESPONSE,
        }
    if required is AnalysisStage.VALIDATING_AI_RESPONSE:
        return stage in {
            AnalysisStage.VALIDATING_AI_RESPONSE,
            AnalysisStage.CALCULATING_SCORE,
        }
    if required is AnalysisStage.PREPARING_RESULTS:
        return stage is AnalysisStage.PREPARING_RESULTS
    return stage is required
