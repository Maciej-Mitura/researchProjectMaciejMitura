"""Dense normalized frame sampling across an independent active-movement window."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from app.ai.errors import DenseSampleError
from app.config import DENSE_FRAME_COUNT
from app.reference.keyframes import spaced_indices


FrameSource = Literal["user", "reference"]


@dataclass(frozen=True)
class TimestampedFrame:
    frame_index: int
    timestamp_ms: int


@dataclass(frozen=True)
class DenseFramePick:
    sequence_index: int
    normalized_position: float
    timestamp_ms: int
    frame_index: int
    source: FrameSource
    filename: str


def dense_normalized_positions(count: int = DENSE_FRAME_COUNT) -> tuple[float, ...]:
    """Evenly spaced positions in [0, 1], rounded to two decimals.

    For the default 12 samples this is 0.00, 0.09, 0.18, …, 1.00.
    """
    if count < 2:
        raise DenseSampleError("Need at least two sample positions.")
    return tuple(round(index / (count - 1), 2) for index in range(count))


def dense_frame_filename(source: FrameSource, sequence_index: int) -> str:
    prefix = "reference" if source == "reference" else "user"
    return f"{prefix}-{sequence_index:02d}.jpg"


def pick_dense_frames(
    frames: Sequence[TimestampedFrame],
    start_ms: int,
    end_ms: int,
    *,
    source: FrameSource,
    count: int = DENSE_FRAME_COUNT,
) -> tuple[DenseFramePick, ...]:
    """Sample `count` ordered frames across the window by normalized progress.

    Absolute timestamps are not compared between USER and REFERENCE. Each
    recording is normalized independently.
    """
    if end_ms < start_ms:
        raise DenseSampleError("Movement window end is before its start.")

    in_window = [
        frame for frame in frames if start_ms <= frame.timestamp_ms <= end_ms
    ]
    if len(in_window) < count:
        raise DenseSampleError(
            "The detected movement was too short for detailed analysis."
        )

    positions = dense_normalized_positions(count)
    chosen = spaced_indices(len(in_window), count)
    picks: list[DenseFramePick] = []
    for sequence_index, (position, local_index) in enumerate(
        zip(positions, chosen, strict=True), start=1
    ):
        frame = in_window[local_index]
        picks.append(
            DenseFramePick(
                sequence_index=sequence_index,
                normalized_position=position,
                timestamp_ms=frame.timestamp_ms,
                frame_index=frame.frame_index,
                source=source,
                filename=dense_frame_filename(source, sequence_index),
            )
        )

    frame_indices = [pick.frame_index for pick in picks]
    if frame_indices != sorted(frame_indices) or len(set(frame_indices)) != len(frame_indices):
        raise DenseSampleError("Dense frames must be ordered and distinct.")
    return tuple(picks)
