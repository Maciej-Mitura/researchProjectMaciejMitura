from __future__ import annotations

from pydantic import BaseModel, Field


class VideoMetadata(BaseModel):
    fps: float
    durationMs: float
    width: int
    height: int
    frameCount: int


class PhaseResult(BaseModel):
    phase: str
    frameIndex: int
    timestampMs: int
    keyframeFilename: str | None = None
    keyframeUrl: str | None = None


class AnalysisDebug(BaseModel):
    """Development-only algorithm details. Not a technique score."""

    leadSide: str
    baseline: float | None = None
    peakExtension: float | None = None
    extensionDelta: float | None = None
    smoothingMethod: str
    smoothingWindow: int
    fpsFallbackUsed: bool
    keyLandmarkCoverage: float | None = None
    keyframeDir: str | None = None


class AnalyzeAttemptResponse(BaseModel):
    analysisId: str
    techniqueId: str
    analysisValid: bool
    failureReason: str | None = None
    failureMessage: str | None = None
    video: VideoMetadata | None = None
    poseCoverage: float | None = None
    phases: list[PhaseResult] | None = None
    debug: AnalysisDebug | None = Field(
        default=None,
        description="Phase 3 research fields for inspecting the detector.",
    )
