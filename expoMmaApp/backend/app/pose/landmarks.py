"""MediaPipe Pose Landmarker indices and geometric helpers.

Index numbers match the BlazePose / MediaPipe Pose topology (33 landmarks).
Callers must use these names instead of scattering raw integers.
"""

from __future__ import annotations

from enum import IntEnum

from app.models.pose import Landmark
from app.techniques.catalog import LeadSide

POSE_LANDMARK_COUNT = 33


class PoseLandmarkIndex(IntEnum):
    NOSE = 0
    LEFT_EYE_INNER = 1
    LEFT_EYE = 2
    LEFT_EYE_OUTER = 3
    RIGHT_EYE_INNER = 4
    RIGHT_EYE = 5
    RIGHT_EYE_OUTER = 6
    LEFT_EAR = 7
    RIGHT_EAR = 8
    MOUTH_LEFT = 9
    MOUTH_RIGHT = 10
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_PINKY = 17
    RIGHT_PINKY = 18
    LEFT_INDEX = 19
    RIGHT_INDEX = 20
    LEFT_THUMB = 21
    RIGHT_THUMB = 22
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT_INDEX = 31
    RIGHT_FOOT_INDEX = 32


UPPER_BODY_INDICES = (
    PoseLandmarkIndex.LEFT_SHOULDER,
    PoseLandmarkIndex.RIGHT_SHOULDER,
    PoseLandmarkIndex.LEFT_HIP,
    PoseLandmarkIndex.RIGHT_HIP,
    PoseLandmarkIndex.LEFT_WRIST,
    PoseLandmarkIndex.RIGHT_WRIST,
)

# Stable major joints for generic whole-body movement (punches, kicks, etc.).
MAJOR_BODY_INDICES = (
    PoseLandmarkIndex.LEFT_SHOULDER,
    PoseLandmarkIndex.RIGHT_SHOULDER,
    PoseLandmarkIndex.LEFT_ELBOW,
    PoseLandmarkIndex.RIGHT_ELBOW,
    PoseLandmarkIndex.LEFT_WRIST,
    PoseLandmarkIndex.RIGHT_WRIST,
    PoseLandmarkIndex.LEFT_HIP,
    PoseLandmarkIndex.RIGHT_HIP,
    PoseLandmarkIndex.LEFT_KNEE,
    PoseLandmarkIndex.RIGHT_KNEE,
    PoseLandmarkIndex.LEFT_ANKLE,
    PoseLandmarkIndex.RIGHT_ANKLE,
)


def lead_arm_indices(lead_side: LeadSide) -> tuple[PoseLandmarkIndex, PoseLandmarkIndex]:
    """Return (wrist, shoulder) for the configured lead side."""
    if lead_side is LeadSide.LEFT:
        return PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.LEFT_SHOULDER
    return PoseLandmarkIndex.RIGHT_WRIST, PoseLandmarkIndex.RIGHT_SHOULDER


def dist3(a: Landmark, b: Landmark) -> float:
    dx = a.x - b.x
    dy = a.y - b.y
    dz = a.z - b.z
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def midpoint(a: Landmark, b: Landmark) -> Landmark:
    return Landmark(
        x=(a.x + b.x) / 2.0,
        y=(a.y + b.y) / 2.0,
        z=(a.z + b.z) / 2.0,
        visibility=_min_optional(a.visibility, b.visibility),
        presence=_min_optional(a.presence, b.presence),
    )


def _min_optional(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return a if b is None else b
    return min(a, b)
