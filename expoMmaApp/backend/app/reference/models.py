"""Internal dataclasses for generic reference motion analysis."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class GenericKeyframePhase(StrEnum):
    START = "START"
    EARLY = "EARLY"
    MIDDLE = "MIDDLE"
    LATE = "LATE"
    END = "END"


@dataclass(frozen=True)
class MotionSample:
    frame_index: int
    timestamp_ms: int
    raw: float | None


@dataclass(frozen=True)
class MotionRegion:
    """One contiguous meaningful-activity span. Not a scored 'hit'."""

    start_ms: int
    end_ms: int
    start_frame_index: int
    end_frame_index: int

    @property
    def duration_ms(self) -> int:
        return max(0, self.end_ms - self.start_ms)


@dataclass(frozen=True)
class ReferenceKeyframePick:
    phase: GenericKeyframePhase
    frame_index: int
    timestamp_ms: int
    filename: str


@dataclass(frozen=True)
class ActiveWindowResult:
    valid: bool
    failure_reason: str | None
    failure_message: str | None
    baseline: float | None
    peak: float | None
    motion_delta: float | None
    start_ms: int | None
    end_ms: int | None
    start_frame_index: int | None
    end_frame_index: int | None
    raw_values: tuple[float | None, ...]
    smoothed_values: tuple[float | None, ...]
    regions: tuple[MotionRegion, ...] = ()
    canonical_start_ms: int | None = None
    canonical_end_ms: int | None = None
    padding_applied: bool = False
    canonical: bool = False
