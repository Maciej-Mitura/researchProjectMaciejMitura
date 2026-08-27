"""Pydantic models for Detailed AI Analysis.

`ModelVideoAssessment` is the production Gemini schema.
`ModelVisualAssessment` is the experimental/legacy OpenAI still-image schema.
`DetailedAssessmentResponse` is the API payload after backend scoring.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.models.comparison import ComparisonTechnique, ProcessingLatency
from app.models.reference import MovementWindow


class AssessmentPhase(StrEnum):
    START = "START"
    EARLY = "EARLY"
    MIDDLE = "MIDDLE"
    LATE = "LATE"
    END = "END"


ASSESSMENT_PHASES: tuple[AssessmentPhase, ...] = (
    AssessmentPhase.START,
    AssessmentPhase.EARLY,
    AssessmentPhase.MIDDLE,
    AssessmentPhase.LATE,
    AssessmentPhase.END,
)


class AssessmentCriterionId(StrEnum):
    MOVEMENT_PATH = "movementPath"
    RANGE_OF_MOTION = "rangeOfMotion"
    BODY_POSITIONING = "bodyPositioning"
    # Relative sequencing / coordination in the normalized video — not absolute speed.
    SEQUENCING_AND_TIMING = "sequencingAndTiming"
    BALANCE_AND_CONTROL = "balanceAndControl"
    RECOVERY_OR_COMPLETION = "recoveryOrCompletion"


# Production Gemini schema and backend averaging use these six criteria only.
# A model-provided numeric overallSimilarity is never requested or aggregated;
# overallScore (0–100) is computed by the backend.
ASSESSMENT_CRITERIA: tuple[AssessmentCriterionId, ...] = (
    AssessmentCriterionId.MOVEMENT_PATH,
    AssessmentCriterionId.RANGE_OF_MOTION,
    AssessmentCriterionId.BODY_POSITIONING,
    AssessmentCriterionId.SEQUENCING_AND_TIMING,
    AssessmentCriterionId.BALANCE_AND_CONTROL,
    AssessmentCriterionId.RECOVERY_OR_COMPLETION,
)

# Legacy holistic id. Ignored if a model still emits it; never part of the 0–100.
HOLISTIC_OVERALL_SIMILARITY_ID = "overallSimilarity"

PHASE_SCORE_MIN = 0
PHASE_SCORE_MAX = 4
CRITERION_SCORE_MIN = 0
CRITERION_SCORE_MAX = 4
OVERALL_SCORE_MAX = 100


class PhaseAssessment(BaseModel):
    phase: AssessmentPhase
    score: int = Field(ge=PHASE_SCORE_MIN, le=PHASE_SCORE_MAX)
    observation: str


class CriterionAssessment(BaseModel):
    criterion: AssessmentCriterionId
    notApplicable: bool = False
    score: int | None = Field(default=None, ge=CRITERION_SCORE_MIN, le=CRITERION_SCORE_MAX)
    observation: str


class MainCorrection(BaseModel):
    title: str
    explanation: str
    relevantPhase: AssessmentPhase | None = None
    relevantCriterion: AssessmentCriterionId | None = None


class ModelVisualAssessment(BaseModel):
    """Experimental still-image schema. Not the production 0–100 score."""

    comparisonValid: bool
    invalidReason: str
    confidence: float = Field(ge=0.0, le=1.0)
    phaseAssessments: list[PhaseAssessment]
    strengths: list[str]
    mainCorrections: list[MainCorrection]
    summary: str


class ModelVideoAssessment(BaseModel):
    """Structured continuous-video comparison. Not the final 0–100 score."""

    comparisonValid: bool
    invalidReason: str
    confidence: float = Field(ge=0.0, le=1.0)
    criteria: list[CriterionAssessment]
    strengths: list[str]
    mainCorrections: list[MainCorrection]
    summary: str


class MotionRegionDebug(BaseModel):
    startMs: int
    endMs: int


class VideoSideDebug(BaseModel):
    rawKind: str
    rawDurationMs: float | None = None
    rawFps: float | None = None
    rawFrameCount: int | None = None
    regionCount: int | None = None
    regions: list[MotionRegionDebug] | None = None
    canonicalStartMs: int | None = None
    canonicalEndMs: int | None = None
    canonicalDurationMs: int | None = None
    canonicalFrameCount: int | None = None


class AiDebug(BaseModel):
    """Developer diagnostics. Expo hides this unless running a development build."""

    model: str
    latencyMs: int
    analysisId: str
    provider: str | None = None
    uploadMethod: str | None = None
    userFrameCount: int | None = None
    referenceFrameCount: int | None = None
    userMovementDurationMs: int | None = None
    referenceMovementDurationMs: int | None = None
    aiVideoDurationMs: int | None = None
    comparisonDurationMs: int | None = None
    geminiVideoFps: float | None = None
    confidence: float | None = None
    inputTokens: int | None = None
    outputTokens: int | None = None
    requestedModel: str | None = None
    primaryAttempts: int | None = None
    fallbackUsed: bool | None = None
    fallbackAttempts: int | None = None
    fallbackModel: str | None = None
    referencePipeline: VideoSideDebug | None = None
    userPipeline: VideoSideDebug | None = None
    aiTargetDurationMs: int | None = None
    aiOutputFps: float | None = None
    aiOutputFrameCount: int | None = None
    aiEncodedDurationMs: int | None = None
    previewMatchesGemini: bool | None = None
    compositeId: str | None = None
    referenceSource: str | None = None


class DenseFrameMeta(BaseModel):
    sequenceIndex: int
    normalizedPosition: float
    timestampMs: int
    source: Literal["user", "reference"]


class DetailedAssessmentResponse(BaseModel):
    analysisId: str
    technique: ComparisonTechnique
    analysisValid: bool
    failureReason: str | None = None
    failureMessage: str | None = None
    comparisonValid: bool | None = None
    invalidReason: str | None = None
    confidence: float | None = None
    overallScore: int | None = None
    overallMax: int = OVERALL_SCORE_MAX
    criteria: list[CriterionAssessment] | None = None
    phaseAssessments: list[PhaseAssessment] | None = None
    strengths: list[str] | None = None
    mainCorrections: list[MainCorrection] | None = None
    summary: str | None = None
    movementWindow: MovementWindow | None = None
    referenceMovementWindow: MovementWindow | None = None
    movementRegionCount: int | None = None
    referenceMovementRegionCount: int | None = None
    comparisonVideoUrl: str | None = None
    comparisonPoseVideoUrl: str | None = None
    poseOverlayAvailable: bool = False
    processingLatency: ProcessingLatency | None = None
    debug: AiDebug | None = None


class AnalysisJobError(BaseModel):
    code: str
    message: str


class AnalysisChecklistItem(BaseModel):
    id: str
    label: str
    state: str


class AnalysisJobCreated(BaseModel):
    jobId: str
    status: str
    pollPath: str


class AnalysisJobResponse(BaseModel):
    """Polling payload. progress is pipeline-milestone percent, not Gemini inference."""

    jobId: str
    status: str
    stage: str
    progress: int
    message: str
    progressCaption: str
    model: str | None = None
    requestedModel: str | None = None
    modelLabel: str | None = None
    attempt: int | None = None
    maxAttempts: int | None = None
    fallbackUsed: bool = False
    elapsedMs: int
    checklist: list[AnalysisChecklistItem] = []
    result: DetailedAssessmentResponse | None = None
    error: AnalysisJobError | None = None
