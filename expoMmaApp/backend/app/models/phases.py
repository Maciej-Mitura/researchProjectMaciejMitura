from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class MovementPhase(StrEnum):
    START = "START"
    EXTENSION = "EXTENSION"
    PEAK = "PEAK"
    RETRACTION = "RETRACTION"
    RECOVERY = "RECOVERY"


@dataclass(frozen=True)
class ExtensionSample:
    """Lead-arm extension at one video frame."""

    frame_index: int
    timestamp_ms: int
    raw: float | None


@dataclass(frozen=True)
class PhasePick:
    phase: MovementPhase
    frame_index: int
    timestamp_ms: int
    smoothed_extension: float


@dataclass(frozen=True)
class PhaseDetectionResult:
    valid: bool
    failure_reason: str | None
    failure_message: str | None
    baseline: float | None
    peak_extension: float | None
    extension_delta: float | None
    phases: tuple[PhasePick, ...]
    raw_values: tuple[float | None, ...]
    smoothed_values: tuple[float | None, ...]
