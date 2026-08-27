"""API DTOs for the recorded-reference technique library."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.api import VideoMetadata


class ReferenceKeyframeResult(BaseModel):
    phase: str
    frameIndex: int
    timestampMs: int
    filename: str
    url: str | None = None


class MovementWindow(BaseModel):
    startMs: int
    endMs: int
    durationMs: int


class ReferenceDebug(BaseModel):
    """Algorithm details for inspecting generic motion detection. Not a score."""

    strategy: str
    baseline: float | None = None
    peakMotion: float | None = None
    motionDelta: float | None = None
    smoothingMethod: str
    smoothingWindow: int
    fpsFallbackUsed: bool
    majorLandmarkCoverage: float | None = None
    draftDir: str | None = None


class ReferenceDraftResponse(BaseModel):
    draftId: str
    name: str
    description: str | None = None
    slug: str
    analysisValid: bool
    failureReason: str | None = None
    failureMessage: str | None = None
    video: VideoMetadata | None = None
    poseCoverage: float | None = None
    majorLandmarkCoverage: float | None = None
    movementWindow: MovementWindow | None = None
    keyframes: list[ReferenceKeyframeResult] | None = None
    debug: ReferenceDebug | None = Field(
        default=None,
        description="Phase 5 research fields for inspecting generic motion detection.",
    )


class RecordedTechniqueSummary(BaseModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    source: str = "recorded"
    referenceStatus: str = "available"
    createdAt: str
    referenceStrategy: str
    keyframeCount: int
    recordingDurationSeconds: int | None = None


class ConfirmReferenceResponse(BaseModel):
    technique: RecordedTechniqueSummary


class ReferenceKeyframeMeta(BaseModel):
    phase: str
    filename: str
    timestampMs: int
    frameIndex: int


class ReferenceTechniqueMetadata(BaseModel):
    """On-disk metadata.json for a confirmed recorded technique.

    Paths are relative to the technique directory. No machine-specific
    absolute paths.
    """

    id: str
    name: str
    slug: str
    description: str | None = None
    source: str = "recorded"
    referenceStatus: str = "available"
    createdAt: str
    referenceVideo: str
    referenceStrategy: str
    movementWindow: MovementWindow
    poseCoverage: float
    majorLandmarkCoverage: float
    keyframes: list[ReferenceKeyframeMeta]
    recordingDurationSeconds: int | None = None
