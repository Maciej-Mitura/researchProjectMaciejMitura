"""API DTOs for generic USER ↔ REFERENCE comparison preparation.

This is measurement pairing, not technique scoring and not an AI assessment.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.models.api import VideoMetadata
from app.models.reference import MovementWindow


class ComparisonTechnique(BaseModel):
    id: str
    slug: str
    name: str
    description: str | None = None


class ComparisonSide(BaseModel):
    timestampMs: int
    keyframeUrl: str


class ComparisonPair(BaseModel):
    """One normalized-progress pair. USER START always maps to REFERENCE START."""

    phase: str
    normalizedPosition: float
    user: ComparisonSide
    reference: ComparisonSide


class SimilarityComponents(BaseModel):
    poseSimilarity: int
    movementPathSimilarity: int
    timingSimilarity: int


class SimilarityLargestDeviation(BaseModel):
    bodyPart: str
    progressStart: float
    progressEnd: float


class SimilarityDiagnostics(BaseModel):
    referenceDurationMs: int | None = None
    userDurationMs: int | None = None
    largestDeviation: SimilarityLargestDeviation | None = None
    upperBodySimilarity: int | None = None
    lowerBodySimilarity: int | None = None
    timeline: list[int] | None = None


class SimilarityFeedback(BaseModel):
    strongest: str
    mainDifference: str


class ProcessingLatency(BaseModel):
    """Observable pipeline stage timings for research documentation."""

    poseAnalysisMs: int | None = None
    comparisonVideoMs: int | None = None
    quickSimilarityMs: int | None = None
    aiVideoPreparationMs: int | None = None
    geminiProviderMs: int | None = None
    totalQuickMs: int | None = None
    totalDetailedMs: int | None = None


class MovementSimilarityResult(BaseModel):
    """Deterministic pose-sequence similarity. Not an expert MMA score."""

    similarityValid: bool
    invalidReason: str | None = None
    movementSimilarity: int | None = None
    components: SimilarityComponents | None = None
    diagnostics: SimilarityDiagnostics | None = None
    feedback: SimilarityFeedback | None = None


class AnalyzeGenericAttemptResponse(BaseModel):
    analysisId: str
    technique: ComparisonTechnique
    analysisValid: bool
    failureReason: str | None = None
    failureMessage: str | None = None
    poseCoverage: float | None = None
    majorLandmarkCoverage: float | None = None
    movementWindow: MovementWindow | None = None
    referenceMovementWindow: MovementWindow | None = None
    movementRegionCount: int | None = None
    referenceMovementRegionCount: int | None = None
    video: VideoMetadata | None = None
    pairs: list[ComparisonPair] | None = None
    comparisonVideoUrl: str | None = None
    comparisonPoseVideoUrl: str | None = None
    comparisonDurationMs: int | None = None
    movementSimilarity: MovementSimilarityResult | None = None
    poseOverlayAvailable: bool = False
    processingLatency: ProcessingLatency | None = None
    normalizedSampleCount: int | None = None
