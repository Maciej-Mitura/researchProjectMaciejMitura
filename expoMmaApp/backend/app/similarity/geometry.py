"""Body-relative pose geometry. Not a coaching or MMA-correctness model."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import MAJOR_BODY_INDICES, PoseLandmarkIndex, dist3, midpoint
from app.similarity.config import MIN_JOINTS_PER_SAMPLE, MIN_TORSO_LENGTH, MIN_VISIBILITY

Vec2 = tuple[float, float]

ANGLE_TRIPLETS: tuple[tuple[str, PoseLandmarkIndex, PoseLandmarkIndex, PoseLandmarkIndex], ...] = (
    ("left_elbow", PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.LEFT_WRIST),
    ("right_elbow", PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_ELBOW, PoseLandmarkIndex.RIGHT_WRIST),
    ("left_shoulder", PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_HIP),
    ("right_shoulder", PoseLandmarkIndex.RIGHT_ELBOW, PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_HIP),
    ("left_hip", PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_HIP, PoseLandmarkIndex.LEFT_KNEE),
    ("right_hip", PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_HIP, PoseLandmarkIndex.RIGHT_KNEE),
    ("left_knee", PoseLandmarkIndex.LEFT_HIP, PoseLandmarkIndex.LEFT_KNEE, PoseLandmarkIndex.LEFT_ANKLE),
    ("right_knee", PoseLandmarkIndex.RIGHT_HIP, PoseLandmarkIndex.RIGHT_KNEE, PoseLandmarkIndex.RIGHT_ANKLE),
)

PATH_JOINTS: tuple[PoseLandmarkIndex, ...] = (
    PoseLandmarkIndex.LEFT_ELBOW,
    PoseLandmarkIndex.RIGHT_ELBOW,
    PoseLandmarkIndex.LEFT_WRIST,
    PoseLandmarkIndex.RIGHT_WRIST,
    PoseLandmarkIndex.LEFT_KNEE,
    PoseLandmarkIndex.RIGHT_KNEE,
    PoseLandmarkIndex.LEFT_ANKLE,
    PoseLandmarkIndex.RIGHT_ANKLE,
)

UPPER_BODY_JOINTS: tuple[PoseLandmarkIndex, ...] = (
    PoseLandmarkIndex.LEFT_SHOULDER,
    PoseLandmarkIndex.RIGHT_SHOULDER,
    PoseLandmarkIndex.LEFT_ELBOW,
    PoseLandmarkIndex.RIGHT_ELBOW,
    PoseLandmarkIndex.LEFT_WRIST,
    PoseLandmarkIndex.RIGHT_WRIST,
)

LOWER_BODY_JOINTS: tuple[PoseLandmarkIndex, ...] = (
    PoseLandmarkIndex.LEFT_HIP,
    PoseLandmarkIndex.RIGHT_HIP,
    PoseLandmarkIndex.LEFT_KNEE,
    PoseLandmarkIndex.RIGHT_KNEE,
    PoseLandmarkIndex.LEFT_ANKLE,
    PoseLandmarkIndex.RIGHT_ANKLE,
)

JOINT_LABELS: dict[int, str] = {
    int(PoseLandmarkIndex.LEFT_SHOULDER): "left_shoulder",
    int(PoseLandmarkIndex.RIGHT_SHOULDER): "right_shoulder",
    int(PoseLandmarkIndex.LEFT_ELBOW): "left_elbow",
    int(PoseLandmarkIndex.RIGHT_ELBOW): "right_elbow",
    int(PoseLandmarkIndex.LEFT_WRIST): "left_wrist",
    int(PoseLandmarkIndex.RIGHT_WRIST): "right_wrist",
    int(PoseLandmarkIndex.LEFT_HIP): "left_hip",
    int(PoseLandmarkIndex.RIGHT_HIP): "right_hip",
    int(PoseLandmarkIndex.LEFT_KNEE): "left_knee",
    int(PoseLandmarkIndex.RIGHT_KNEE): "right_knee",
    int(PoseLandmarkIndex.LEFT_ANKLE): "left_ankle",
    int(PoseLandmarkIndex.RIGHT_ANKLE): "right_ankle",
}

_EPS = 1e-9


def usable_landmark(
    landmarks: Sequence[Landmark],
    index: PoseLandmarkIndex,
    *,
    min_visibility: float = MIN_VISIBILITY,
) -> Landmark | None:
    if int(index) >= len(landmarks):
        return None
    point = landmarks[int(index)]
    visibility = 1.0 if point.visibility is None else point.visibility
    if visibility < min_visibility:
        return None
    return point


def hip_origin_and_scale(
    landmarks: Sequence[Landmark],
) -> tuple[Vec2, float] | None:
    left_hip = usable_landmark(landmarks, PoseLandmarkIndex.LEFT_HIP)
    right_hip = usable_landmark(landmarks, PoseLandmarkIndex.RIGHT_HIP)
    left_shoulder = usable_landmark(landmarks, PoseLandmarkIndex.LEFT_SHOULDER)
    right_shoulder = usable_landmark(landmarks, PoseLandmarkIndex.RIGHT_SHOULDER)
    if left_hip is None or right_hip is None or left_shoulder is None or right_shoulder is None:
        return None
    origin = midpoint(left_hip, right_hip)
    scale = dist3(midpoint(left_shoulder, right_shoulder), origin)
    if scale < MIN_TORSO_LENGTH:
        return None
    return (origin.x, origin.y), scale


def normalize_frame(frame: PoseFrame) -> dict[int, Vec2] | None:
    """Translate by hip center and scale by torso length. No mirroring, no XY stretch."""
    if not frame.pose_detected or frame.landmarks is None:
        return None
    origin_scale = hip_origin_and_scale(frame.landmarks)
    if origin_scale is None:
        return None
    (ox, oy), scale = origin_scale
    points: dict[int, Vec2] = {}
    for index in MAJOR_BODY_INDICES:
        landmark = usable_landmark(frame.landmarks, index)
        if landmark is None:
            continue
        points[int(index)] = ((landmark.x - ox) / scale, (landmark.y - oy) / scale)
    if len(points) < MIN_JOINTS_PER_SAMPLE:
        return None
    return points


def joint_angles(points: Mapping[int, Vec2]) -> dict[str, float]:
    angles: dict[str, float] = {}
    for name, proximal, vertex, distal in ANGLE_TRIPLETS:
        a = points.get(int(proximal))
        b = points.get(int(vertex))
        c = points.get(int(distal))
        if a is None or b is None or c is None:
            continue
        value = angle_at(a, b, c)
        if value is not None:
            angles[name] = value
    return angles


def angle_at(a: Vec2, b: Vec2, c: Vec2) -> float | None:
    bax, bay = a[0] - b[0], a[1] - b[1]
    bcx, bcy = c[0] - b[0], c[1] - b[1]
    na = math.hypot(bax, bay)
    nc = math.hypot(bcx, bcy)
    if na < _EPS or nc < _EPS:
        return None
    cosine = max(-1.0, min(1.0, (bax * bcx + bay * bcy) / (na * nc)))
    return math.acos(cosine)


def euclidean(a: Vec2, b: Vec2) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
