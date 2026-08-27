"""Map Quick largest-deviation body parts onto pose-overlay joints.

This is visualization of an existing deterministic measurement.
It is not coaching advice, injury risk, or MMA correctness.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.pose.landmarks import PoseLandmarkIndex
from app.similarity.geometry import JOINT_LABELS

# Parent bone for the measured joint so the overlay can emphasize a segment.
_SEGMENT_PARENT: dict[PoseLandmarkIndex, PoseLandmarkIndex] = {
    PoseLandmarkIndex.LEFT_WRIST: PoseLandmarkIndex.LEFT_ELBOW,
    PoseLandmarkIndex.RIGHT_WRIST: PoseLandmarkIndex.RIGHT_ELBOW,
    PoseLandmarkIndex.LEFT_ELBOW: PoseLandmarkIndex.LEFT_SHOULDER,
    PoseLandmarkIndex.RIGHT_ELBOW: PoseLandmarkIndex.RIGHT_SHOULDER,
    PoseLandmarkIndex.LEFT_SHOULDER: PoseLandmarkIndex.LEFT_ELBOW,
    PoseLandmarkIndex.RIGHT_SHOULDER: PoseLandmarkIndex.RIGHT_ELBOW,
    PoseLandmarkIndex.LEFT_ANKLE: PoseLandmarkIndex.LEFT_KNEE,
    PoseLandmarkIndex.RIGHT_ANKLE: PoseLandmarkIndex.RIGHT_KNEE,
    PoseLandmarkIndex.LEFT_KNEE: PoseLandmarkIndex.LEFT_HIP,
    PoseLandmarkIndex.RIGHT_KNEE: PoseLandmarkIndex.RIGHT_HIP,
    PoseLandmarkIndex.LEFT_HIP: PoseLandmarkIndex.LEFT_KNEE,
    PoseLandmarkIndex.RIGHT_HIP: PoseLandmarkIndex.RIGHT_KNEE,
}

_LABEL_TO_INDEX: dict[str, int] = {label: index for index, label in JOINT_LABELS.items()}


@dataclass(frozen=True)
class HighlightSpec:
    label: str
    joint_index: int
    connections: tuple[tuple[int, int], ...]


def normalize_body_part(body_part: str) -> str:
    return body_part.strip().lower().replace("-", "_").replace(" ", "_")


def resolve_highlight(body_part: str | None) -> HighlightSpec | None:
    """Return overlay joints for a Quick diagnostic label such as ``right_wrist``."""
    if not body_part:
        return None
    label = normalize_body_part(body_part)
    joint_index = _LABEL_TO_INDEX.get(label)
    if joint_index is None:
        return None
    joint = PoseLandmarkIndex(joint_index)
    parent = _SEGMENT_PARENT.get(joint)
    connections: tuple[tuple[int, int], ...] = ()
    if parent is not None:
        connections = ((int(parent), int(joint)),)
    return HighlightSpec(label=label, joint_index=joint_index, connections=connections)


def highlight_is_active(
    progress: float,
    start: float | None,
    end: float | None,
) -> bool:
    """True when normalized comparison progress is inside the requested range."""
    if start is None or end is None:
        return False
    low = min(start, end)
    high = max(start, end)
    return low - 1e-9 <= progress <= high + 1e-9
