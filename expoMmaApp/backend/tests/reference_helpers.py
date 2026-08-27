"""Synthetic pose frames for generic motion tests."""

from __future__ import annotations

from pathlib import Path

from app.config import (
    REFERENCE_DRAFT_METADATA_FILENAME,
    REFERENCE_DRAFT_VIDEO_FILENAME,
    REFERENCE_KEYFRAME_FILENAMES,
    REFERENCE_KEYFRAMES_SUBDIR,
)
from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import POSE_LANDMARK_COUNT, PoseLandmarkIndex
from app.reference.models import MotionSample
from app.reference.store import write_json


def landmark(x: float = 0.5, y: float = 0.5, z: float = 0.0, visibility: float = 0.9) -> Landmark:
    return Landmark(x=x, y=y, z=z, visibility=visibility, presence=1.0)


def standing_landmarks(*, dx: float = 0.0, dy: float = 0.0) -> tuple[Landmark, ...]:
    points = [landmark() for _ in range(POSE_LANDMARK_COUNT)]
    points[PoseLandmarkIndex.LEFT_SHOULDER] = landmark(0.40, 0.30)
    points[PoseLandmarkIndex.RIGHT_SHOULDER] = landmark(0.60, 0.30)
    points[PoseLandmarkIndex.LEFT_ELBOW] = landmark(0.35, 0.45 + dy * 0.4)
    points[PoseLandmarkIndex.RIGHT_ELBOW] = landmark(0.65, 0.45 + dy * 0.4)
    points[PoseLandmarkIndex.LEFT_WRIST] = landmark(0.32 + dx, 0.60 + dy)
    points[PoseLandmarkIndex.RIGHT_WRIST] = landmark(0.68 + dx, 0.60 + dy)
    points[PoseLandmarkIndex.LEFT_HIP] = landmark(0.42, 0.55)
    points[PoseLandmarkIndex.RIGHT_HIP] = landmark(0.58, 0.55)
    points[PoseLandmarkIndex.LEFT_KNEE] = landmark(0.42 + dx * 0.3, 0.75)
    points[PoseLandmarkIndex.RIGHT_KNEE] = landmark(0.58 + dx * 0.3, 0.75)
    points[PoseLandmarkIndex.LEFT_ANKLE] = landmark(0.42 + dx * 0.5, 0.90)
    points[PoseLandmarkIndex.RIGHT_ANKLE] = landmark(0.58 + dx * 0.5, 0.90)
    return tuple(points)


def standing_frames(
    n: int = 90,
    *,
    fps: float = 30.0,
    offset_at: dict[int, tuple[float, float]] | None = None,
) -> list[PoseFrame]:
    offsets = offset_at or {}
    frames: list[PoseFrame] = []
    for index in range(n):
        dx, dy = offsets.get(index, (0.0, 0.0))
        frames.append(
            PoseFrame(
                frame_index=index,
                timestamp_ms=int(round(index * 1000.0 / fps)),
                landmarks=standing_landmarks(dx=dx, dy=dy),
                pose_detected=True,
            )
        )
    return frames


def burst_offsets(
    n: int = 90,
    *,
    start: int = 24,
    peak: int = 36,
    end: int = 52,
    amplitude: float = 0.18,
) -> dict[int, tuple[float, float]]:
    offsets: dict[int, tuple[float, float]] = {}
    for index in range(n):
        if index < start:
            value = 0.0
        elif index <= peak:
            t = (index - start) / max(1, peak - start)
            value = t * amplitude
        elif index <= end:
            t = (index - peak) / max(1, end - peak)
            value = amplitude + t * (0.0 - amplitude)
        else:
            value = 0.0
        offsets[index] = (value, 0.0)
    return offsets


def samples_from_values(values: list[float | None], *, fps: float = 30.0) -> list[MotionSample]:
    samples: list[MotionSample] = []
    for index, value in enumerate(values):
        samples.append(
            MotionSample(
                frame_index=index,
                timestamp_ms=int(round(index * 1000.0 / fps)),
                raw=value,
            )
        )
    return samples


def valid_draft_payload(
    slug: str,
    name: str,
    *,
    start_ms: int = 400,
    end_ms: int = 1200,
) -> dict[str, object]:
    keyframes: list[dict[str, object]] = []
    timestamp = start_ms
    step = (end_ms - start_ms) // 4
    for index, (phase, filename) in enumerate(REFERENCE_KEYFRAME_FILENAMES.items()):
        keyframes.append(
            {
                "phase": phase,
                "frameIndex": 10 + index,
                "timestampMs": timestamp,
                "filename": f"{REFERENCE_KEYFRAMES_SUBDIR}/{filename}",
                "url": f"/api/reference-techniques/drafts/unused/keyframes/{filename}",
            }
        )
        timestamp += step
    return {
        "draftId": "unused",
        "name": name,
        "description": "A clean reference.",
        "slug": slug,
        "analysisValid": True,
        "failureReason": None,
        "failureMessage": None,
        "poseCoverage": 0.97,
        "majorLandmarkCoverage": 0.91,
        "createdAt": "2026-08-26T12:00:00Z",
        "movementWindow": {
            "startMs": start_ms,
            "endMs": end_ms,
            "durationMs": end_ms - start_ms,
        },
        "keyframes": keyframes,
    }


def plant_draft(
    drafts: Path,
    draft_id: str,
    slug: str,
    name: str,
    *,
    start_ms: int = 400,
    end_ms: int = 1200,
) -> Path:
    folder = drafts / draft_id
    (folder / REFERENCE_KEYFRAMES_SUBDIR).mkdir(parents=True)
    (folder / REFERENCE_DRAFT_VIDEO_FILENAME).write_bytes(b"fake-mp4")
    for filename in REFERENCE_KEYFRAME_FILENAMES.values():
        (folder / REFERENCE_KEYFRAMES_SUBDIR / filename).write_bytes(b"jpeg")
    write_json(
        folder / REFERENCE_DRAFT_METADATA_FILENAME,
        valid_draft_payload(slug, name, start_ms=start_ms, end_ms=end_ms),
    )
    return folder
