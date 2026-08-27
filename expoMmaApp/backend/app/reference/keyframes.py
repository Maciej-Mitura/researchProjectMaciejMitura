"""Five generic temporal keyframes across an active movement window."""

from __future__ import annotations

from collections.abc import Sequence

from app.config import REFERENCE_KEYFRAME_FILENAMES
from app.models.pose import PoseFrame
from app.reference.models import GenericKeyframePhase, ReferenceKeyframePick

GENERIC_PHASES: tuple[GenericKeyframePhase, ...] = (
    GenericKeyframePhase.START,
    GenericKeyframePhase.EARLY,
    GenericKeyframePhase.MIDDLE,
    GenericKeyframePhase.LATE,
    GenericKeyframePhase.END,
)


class KeyframeSelectionError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def spaced_indices(count: int, picks: int = 5) -> list[int]:
    """Strictly increasing indices at 0%, 25%, 50%, 75%, 100% of `count`."""
    if picks < 2:
        raise KeyframeSelectionError("Need at least two keyframe slots.")
    if count < picks:
        raise KeyframeSelectionError(
            "The movement window does not contain five distinct frames."
        )
    indices = [i * (count - 1) // (picks - 1) for i in range(picks)]
    if indices[0] != 0 or indices[-1] != count - 1:
        raise KeyframeSelectionError("Could not span the full movement window.")
    if len(set(indices)) != picks or indices != sorted(indices):
        raise KeyframeSelectionError("Could not select five distinct keyframe timestamps.")
    return indices


def pick_generic_keyframes(
    frames: Sequence[PoseFrame],
    start_ms: int,
    end_ms: int,
) -> tuple[ReferenceKeyframePick, ...]:
    if end_ms < start_ms:
        raise KeyframeSelectionError("Movement window end is before its start.")

    in_window = [
        frame
        for frame in frames
        if start_ms <= frame.timestamp_ms <= end_ms
    ]
    if len(in_window) < len(GENERIC_PHASES):
        raise KeyframeSelectionError(
            "The movement window does not contain five distinct frames."
        )

    chosen = spaced_indices(len(in_window), len(GENERIC_PHASES))
    picks: list[ReferenceKeyframePick] = []
    for phase, index in zip(GENERIC_PHASES, chosen, strict=True):
        frame = in_window[index]
        picks.append(
            ReferenceKeyframePick(
                phase=phase,
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                filename=REFERENCE_KEYFRAME_FILENAMES[phase.value],
            )
        )

    timestamps = [pick.timestamp_ms for pick in picks]
    frame_indices = [pick.frame_index for pick in picks]
    if timestamps != sorted(timestamps) or len(set(timestamps)) != len(timestamps):
        raise KeyframeSelectionError("Keyframe timestamps must be ordered and distinct.")
    if frame_indices != sorted(frame_indices) or len(set(frame_indices)) != len(frame_indices):
        raise KeyframeSelectionError("Keyframe frames must be ordered and distinct.")
    return tuple(picks)
