"""Local prototype validation records. No database. No videos. No pose arrays."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.ai.models import AssessmentCriterionId, CriterionAssessment
from app.config import MAX_GEMINI_REPEAT_COUNT
from app.models.comparison import AnalyzeGenericAttemptResponse, ProcessingLatency
from app.similarity.config import DEFAULT_SAMPLE_COUNT

ALLOWED_GEMINI_REPEAT_COUNTS = frozenset({1, MAX_GEMINI_REPEAT_COUNT})


class ValidationScenario(StrEnum):
    SELF_COMPARISON = "self_comparison"
    CLEAN_REPRODUCTION = "clean_reproduction"
    MINOR_DELIBERATE_ERROR = "minor_deliberate_error"
    MAJOR_DELIBERATE_ERROR = "major_deliberate_error"
    BAD_CAMERA = "bad_camera"
    MULTI_ACTION = "multi_action"
    CUSTOM = "custom"


SCENARIO_LABELS: dict[ValidationScenario, str] = {
    ValidationScenario.SELF_COMPARISON: "Reference self-test",
    ValidationScenario.CLEAN_REPRODUCTION: "Clean attempt",
    ValidationScenario.MINOR_DELIBERATE_ERROR: "Deliberate difference — small",
    ValidationScenario.MAJOR_DELIBERATE_ERROR: "Deliberate difference — major",
    ValidationScenario.BAD_CAMERA: "Poor recording test",
    ValidationScenario.MULTI_ACTION: "Multi-action validation (legacy)",
    ValidationScenario.CUSTOM: "Custom (legacy)",
}

QUICK_METHOD_LABEL = "deterministic MediaPipe comparison"
NOTES_MAX_LENGTH = 500
EXPORT_FORBIDDEN_SUBSTRINGS = (
    "apikey",
    "api_key",
    "prompt",
    "landmarks",
    "poseframe",
    "pose_frame",
    "posearray",
    "keyframes",
    "videobytes",
    "videourl",
    "video_url",
    "secret",
)


class GeminiCriteriaScores(BaseModel):
    model_config = ConfigDict(extra="ignore")

    movementPath: int | None = None
    rangeOfMotion: int | None = None
    bodyPositioning: int | None = None
    sequencingAndTiming: int | None = None
    balanceAndControl: int | None = None
    recoveryOrCompletion: int | None = None


class RepeatabilityRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    index: int
    overallScore: int | None = None
    criteria: GeminiCriteriaScores | None = None
    model: str | None = None
    fallbackUsed: bool | None = None
    latencyMs: int | None = None
    summary: str | None = None
    videoSha256: str | None = None


class RepeatabilityStats(BaseModel):
    """Prototype stability check. Not scientific statistical validation."""

    model_config = ConfigDict(extra="ignore")

    runCount: int
    minimum: float | None = None
    maximum: float | None = None
    mean: float | None = None
    scoreRange: float | None = None


class RepeatabilityResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    analysisId: str
    assetFilename: str
    assetSha256: str
    identicalAssetEachRun: bool
    reusedExistingAiVideo: bool = True
    runs: list[RepeatabilityRun] = Field(default_factory=list)
    overall: RepeatabilityStats | None = None


class DeterministicRepeatResult(BaseModel):
    passed: bool
    label: str
    firstOverall: int | None = None
    secondOverall: int | None = None
    identical: bool = False


class ValidationRecord(BaseModel):
    """One researcher-labelled prototype validation run."""

    model_config = ConfigDict(extra="ignore")

    id: str
    timestamp: str
    techniqueSlug: str
    techniqueName: str
    scenarioType: ValidationScenario
    comparisonValid: bool
    invalidReason: str | None = None
    poseCoverage: float | None = None
    majorLandmarkCoverage: float | None = None
    quickOverall: int | None = None
    quickPose: int | None = None
    quickPath: int | None = None
    quickTiming: int | None = None
    referenceMovementDurationMs: int | None = None
    userMovementDurationMs: int | None = None
    userMovementRegionCount: int | None = None
    referenceMovementRegionCount: int | None = None
    geminiOverall: int | None = None
    geminiCriteria: GeminiCriteriaScores | None = None
    geminiModel: str | None = None
    geminiFallbackUsed: bool | None = None
    geminiLatencyMs: int | None = None
    geminiAnalysisId: str | None = None
    totalAnalysisLatencyMs: int | None = None
    latency: ProcessingLatency | None = None
    notes: str | None = None
    repeatability: RepeatabilityResult | None = None
    selfComparison: bool = False
    quickMethod: str = QUICK_METHOD_LABEL
    normalizedSampleCount: int = DEFAULT_SAMPLE_COUNT

    @field_validator("notes")
    @classmethod
    def _trim_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            return None
        return trimmed[:NOTES_MAX_LENGTH]

    @model_validator(mode="after")
    def _no_fake_scores_when_invalid(self) -> ValidationRecord:
        if self.comparisonValid:
            return self
        self.quickOverall = None
        self.quickPose = None
        self.quickPath = None
        self.quickTiming = None
        self.geminiOverall = None
        self.geminiCriteria = None
        return self


class ValidationRecordCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    techniqueSlug: str
    techniqueName: str
    scenarioType: ValidationScenario
    comparisonValid: bool
    invalidReason: str | None = None
    poseCoverage: float | None = None
    majorLandmarkCoverage: float | None = None
    quickOverall: int | None = None
    quickPose: int | None = None
    quickPath: int | None = None
    quickTiming: int | None = None
    referenceMovementDurationMs: int | None = None
    userMovementDurationMs: int | None = None
    userMovementRegionCount: int | None = None
    referenceMovementRegionCount: int | None = None
    geminiOverall: int | None = None
    geminiCriteria: GeminiCriteriaScores | None = None
    geminiModel: str | None = None
    geminiFallbackUsed: bool | None = None
    geminiLatencyMs: int | None = None
    geminiAnalysisId: str | None = None
    totalAnalysisLatencyMs: int | None = None
    latency: ProcessingLatency | None = None
    notes: str | None = None
    repeatability: RepeatabilityResult | None = None
    selfComparison: bool = False


class ScenarioAggregate(BaseModel):
    scenarioType: ValidationScenario
    label: str
    count: int
    invalidCount: int
    quickMean: float | None = None
    geminiMean: float | None = None


class ValidationSummary(BaseModel):
    runCount: int
    invalidCount: int
    records: list[ValidationRecord]
    perScenario: list[ScenarioAggregate]


class SelfCompareResponse(BaseModel):
    comparison: AnalyzeGenericAttemptResponse
    deterministicRepeat: DeterministicRepeatResult
    processingLatency: ProcessingLatency | None = None


class GeminiRepeatabilityRequest(BaseModel):
    analysisId: str
    runCount: int = 1

    @field_validator("runCount")
    @classmethod
    def _bound_count(cls, value: int) -> int:
        return bound_repeat_count(value)


def bound_repeat_count(value: int) -> int:
    if value not in ALLOWED_GEMINI_REPEAT_COUNTS:
        raise ValueError("Repeat count must be 1 or 3.")
    return value


def criteria_from_assessments(
    items: list[CriterionAssessment] | None,
) -> GeminiCriteriaScores | None:
    if not items:
        return None
    payload: dict[str, int | None] = {}
    for item in items:
        key = item.criterion.value if isinstance(item.criterion, AssessmentCriterionId) else str(item.criterion)
        payload[key] = None if item.notApplicable else item.score
    return GeminiCriteriaScores.model_validate(payload)


def record_to_export_dict(record: ValidationRecord) -> dict[str, Any]:
    """Allowlisted numeric/text metrics only. No media, landmarks, or secrets."""
    data = record.model_dump(mode="json")
    return _strip_forbidden(data)


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            compact = key.lower().replace("-", "").replace("_", "")
            if any(token in compact or token in key.lower() for token in EXPORT_FORBIDDEN_SUBSTRINGS):
                if key in {"geminiAnalysisId"}:
                    cleaned[key] = item
                    continue
                continue
            cleaned[key] = _strip_forbidden(item)
        return cleaned
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value
