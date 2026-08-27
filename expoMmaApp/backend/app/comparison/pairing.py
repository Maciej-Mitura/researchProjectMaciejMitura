"""Pair USER and REFERENCE keyframes by generic phase, not by timestamp."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from app.models.comparison import ComparisonPair, ComparisonSide
from app.models.reference import ReferenceKeyframeMeta
from app.reference.errors import IncompleteReferenceError
from app.reference.keyframes import GENERIC_PHASES
from app.reference.models import GenericKeyframePhase, ReferenceKeyframePick

NORMALIZED_POSITIONS: dict[GenericKeyframePhase, float] = {
    GenericKeyframePhase.START: 0.0,
    GenericKeyframePhase.EARLY: 0.25,
    GenericKeyframePhase.MIDDLE: 0.50,
    GenericKeyframePhase.LATE: 0.75,
    GenericKeyframePhase.END: 1.0,
}


def build_comparison_pairs(
    user_picks: Sequence[ReferenceKeyframePick],
    reference_keyframes: Sequence[ReferenceKeyframeMeta],
    *,
    analysis_id: str,
    slug: str,
) -> list[ComparisonPair]:
    """Return START↔START … END↔END. Durations may differ; phases must not."""
    user_by_phase = {pick.phase: pick for pick in user_picks}
    reference_by_phase: dict[str, ReferenceKeyframeMeta] = {}
    for item in reference_keyframes:
        if item.phase in reference_by_phase:
            raise IncompleteReferenceError("Recorded reference has duplicate phase labels.")
        reference_by_phase[item.phase] = item

    pairs: list[ComparisonPair] = []
    for phase in GENERIC_PHASES:
        user = user_by_phase.get(phase)
        reference = reference_by_phase.get(phase.value)
        if user is None:
            raise IncompleteReferenceError(
                f"USER analysis is missing the {phase.value} keyframe."
            )
        if reference is None:
            raise IncompleteReferenceError(
                f"Recorded reference is missing the {phase.value} keyframe."
            )
        filename = Path(reference.filename).name
        pairs.append(
            ComparisonPair(
                phase=phase.value,
                normalizedPosition=NORMALIZED_POSITIONS[phase],
                user=ComparisonSide(
                    timestampMs=user.timestamp_ms,
                    keyframeUrl=_user_keyframe_url(analysis_id, user.filename),
                ),
                reference=ComparisonSide(
                    timestampMs=reference.timestampMs,
                    keyframeUrl=_reference_keyframe_url(slug, filename),
                ),
            )
        )
    return pairs


def _user_keyframe_url(analysis_id: str, filename: str) -> str:
    return f"/api/comparison-attempts/{analysis_id}/keyframes/{filename}"


def _reference_keyframe_url(slug: str, filename: str) -> str:
    return f"/api/reference-techniques/{slug}/keyframes/{filename}"
