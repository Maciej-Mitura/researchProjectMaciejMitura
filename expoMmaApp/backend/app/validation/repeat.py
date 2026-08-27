"""Deterministic Quick self-comparison and exact-repeat check."""

from __future__ import annotations

from collections.abc import Sequence

from app.models.pose import PoseFrame
from app.similarity.engine import SimilarityOutcome, compare_active_movements
from app.validation.models import DeterministicRepeatResult


def compare_sequence_with_itself(
    frames: Sequence[PoseFrame],
    *,
    start_ms: int,
    end_ms: int,
) -> SimilarityOutcome:
    return compare_active_movements(
        reference_frames=frames,
        user_frames=frames,
        reference_start_ms=start_ms,
        reference_end_ms=end_ms,
        user_start_ms=start_ms,
        user_end_ms=end_ms,
    )


def deterministic_repeat_check(
    *,
    reference_frames: Sequence[PoseFrame] | None,
    user_frames: Sequence[PoseFrame] | None,
    reference_start_ms: int,
    reference_end_ms: int,
    user_start_ms: int,
    user_end_ms: int,
) -> tuple[SimilarityOutcome, SimilarityOutcome, DeterministicRepeatResult]:
    """Run similarity twice on the same stored pose sequences. Do not re-extract."""
    first = compare_active_movements(
        reference_frames=reference_frames,
        user_frames=user_frames,
        reference_start_ms=reference_start_ms,
        reference_end_ms=reference_end_ms,
        user_start_ms=user_start_ms,
        user_end_ms=user_end_ms,
    )
    second = compare_active_movements(
        reference_frames=reference_frames,
        user_frames=user_frames,
        reference_start_ms=reference_start_ms,
        reference_end_ms=reference_end_ms,
        user_start_ms=user_start_ms,
        user_end_ms=user_end_ms,
    )
    identical = first == second
    return first, second, _repeat_payload(first, second, identical)


def _repeat_payload(
    first: SimilarityOutcome,
    second: SimilarityOutcome,
    identical: bool,
) -> DeterministicRepeatResult:
    return DeterministicRepeatResult(
        passed=identical,
        label="Deterministic repeat check: PASS" if identical else "Deterministic repeat check: FAIL",
        firstOverall=first.movement_similarity,
        secondOverall=second.movement_similarity,
        identical=identical,
    )
