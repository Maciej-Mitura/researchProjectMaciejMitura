"""Sample active-window pose sequences onto a shared 0–100% progress domain."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.models.pose import PoseFrame
from app.similarity.config import MIN_COMPARABLE_SAMPLES
from app.similarity.geometry import Vec2, joint_angles, normalize_frame


@dataclass(frozen=True)
class NormalizedSample:
    progress: float
    timestamp_ms: int
    points: dict[int, Vec2]
    angles: dict[str, float]


def sample_active_window(
    frames: Sequence[PoseFrame],
    *,
    start_ms: int,
    end_ms: int,
    sample_count: int,
) -> list[NormalizedSample] | None:
    if end_ms <= start_ms or sample_count < MIN_COMPARABLE_SAMPLES:
        return None
    windowed = [
        frame
        for frame in frames
        if start_ms <= frame.timestamp_ms <= end_ms
    ]
    series: list[tuple[int, dict[int, Vec2]]] = []
    for frame in windowed:
        points = normalize_frame(frame)
        if points is None:
            continue
        series.append((frame.timestamp_ms, points))
    if len(series) < MIN_COMPARABLE_SAMPLES:
        return None

    duration = float(end_ms - start_ms)
    samples: list[NormalizedSample] = []
    for index in range(sample_count):
        progress = index / (sample_count - 1)
        timestamp_ms = int(round(start_ms + progress * duration))
        points = interpolate_points(series, timestamp_ms)
        samples.append(
            NormalizedSample(
                progress=progress,
                timestamp_ms=timestamp_ms,
                points=points,
                angles=joint_angles(points),
            )
        )
    comparable = sum(1 for item in samples if item.points)
    if comparable < MIN_COMPARABLE_SAMPLES:
        return None
    return samples


def interpolate_points(
    series: Sequence[tuple[int, dict[int, Vec2]]],
    timestamp_ms: int,
) -> dict[int, Vec2]:
    """Lerp joints that are visible on both neighboring samples. Never invent a joint."""
    if not series:
        return {}
    if timestamp_ms <= series[0][0]:
        return dict(series[0][1])
    if timestamp_ms >= series[-1][0]:
        return dict(series[-1][1])

    later_index = 1
    while later_index < len(series) and series[later_index][0] < timestamp_ms:
        later_index += 1
    earlier_index = later_index - 1
    t0, a = series[earlier_index]
    t1, b = series[later_index]
    span = t1 - t0
    if span <= 0:
        return dict(a)
    alpha = (timestamp_ms - t0) / span
    shared = set(a) & set(b)
    blended: dict[int, Vec2] = {}
    for joint in shared:
        x0, y0 = a[joint]
        x1, y1 = b[joint]
        blended[joint] = (x0 + (x1 - x0) * alpha, y0 + (y1 - y0) * alpha)
    return blended
