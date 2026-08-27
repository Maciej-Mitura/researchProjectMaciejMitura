"""Technique metadata for the pose backend.

Lead side is taken from V1 (`mma-trainer/src/app/lib/techniques.ts`) and V2
(`expoMmaApp/src/features/techniques/catalog.ts`). Both configure
`simple_jab` as orthodox lead = left.

Front-camera mirroring vs recorded orientation
----------------------------------------------
Expo TrainingCamera uses `facing="front"` and a preview `mirror` flag.
Whether the saved MP4 is itself mirrored is not assumed here.

Distances used by the jab extension signal are invariant to a horizontal
flip. Left/right MediaPipe landmark assignment is not. This backend does
**not** swap or negate landmarks. If later visual inspection of Expo
recordings shows the rear arm being tracked, add an explicit
`assume_mirrored_video` flag rather than silently flipping.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class LeadSide(StrEnum):
    LEFT = "left"
    RIGHT = "right"


@dataclass(frozen=True)
class TechniqueConfig:
    id: str
    name: str
    lead_side: LeadSide
    supported: bool
    unsupported_reason: str | None = None


SIMPLE_JAB = TechniqueConfig(
    id="simple_jab",
    name="Jab",
    lead_side=LeadSide.LEFT,
    supported=True,
)

MMA_KICK = TechniqueConfig(
    id="mmakick",
    name="MMA Kick",
    lead_side=LeadSide.LEFT,
    supported=False,
    unsupported_reason=(
        "Technique 'mmakick' is not yet implemented. Phase 3 only analyzes "
        "simple_jab. Kick detection needs a technique-specific movement "
        "signal and must not reuse jab lead-arm extension logic."
    ),
)

TECHNIQUES: dict[str, TechniqueConfig] = {
    SIMPLE_JAB.id: SIMPLE_JAB,
    MMA_KICK.id: MMA_KICK,
}


class UnsupportedTechniqueError(ValueError):
    def __init__(self, technique_id: str, reason: str) -> None:
        super().__init__(reason)
        self.technique_id = technique_id
        self.reason = reason


def get_technique(technique_id: str) -> TechniqueConfig | None:
    return TECHNIQUES.get(technique_id)


def require_supported_technique(technique_id: str) -> TechniqueConfig:
    technique = get_technique(technique_id)
    if technique is None:
        raise UnsupportedTechniqueError(
            technique_id,
            f"Unknown technique '{technique_id}'. Phase 3 supports simple_jab only.",
        )
    if not technique.supported:
        raise UnsupportedTechniqueError(
            technique_id,
            technique.unsupported_reason
            or f"Technique '{technique_id}' is not implemented.",
        )
    return technique
