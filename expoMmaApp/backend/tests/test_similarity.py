"""Deterministic Quick Movement Similarity tests. No Gemini/OpenAI calls."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.models.pose import Landmark, PoseFrame
from app.pose.landmarks import POSE_LANDMARK_COUNT, PoseLandmarkIndex
from app.similarity.alignment import constrained_dtw, mean_warp_fraction, reference_alignment
from app.similarity.config import (
    COMPONENT_WEIGHTS,
    DEFAULT_SAMPLE_COUNT,
    PATH_WEIGHT,
    POSE_WEIGHT,
    TIMING_WEIGHT,
    quick_similarity_samples,
)
from app.similarity.engine import compare_active_movements
from app.similarity.scoring import overall_similarity, round_score
from tests.reference_helpers import burst_offsets, standing_frames


def _compare(
    reference: list[PoseFrame],
    user: list[PoseFrame],
    *,
    start_ms: int = 400,
    end_ms: int = 2000,
    user_start_ms: int | None = None,
    user_end_ms: int | None = None,
):
    return compare_active_movements(
        reference_frames=reference,
        user_frames=user,
        reference_start_ms=start_ms,
        reference_end_ms=end_ms,
        user_start_ms=start_ms if user_start_ms is None else user_start_ms,
        user_end_ms=end_ms if user_end_ms is None else user_end_ms,
    )


def _offset_joint(frames: list[PoseFrame], index: PoseLandmarkIndex, dx: float, dy: float = 0.0) -> list[PoseFrame]:
    updated: list[PoseFrame] = []
    for frame in frames:
        assert frame.landmarks is not None
        points = list(frame.landmarks)
        current = points[int(index)]
        points[int(index)] = Landmark(
            x=current.x + dx,
            y=current.y + dy,
            z=current.z,
            visibility=current.visibility,
            presence=current.presence,
        )
        updated.append(
            PoseFrame(
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                landmarks=tuple(points),
                pose_detected=frame.pose_detected,
            )
        )
    return updated


def _add_noise(frames: list[PoseFrame], amount: float) -> list[PoseFrame]:
    updated: list[PoseFrame] = []
    for frame in frames:
        assert frame.landmarks is not None
        points = [
            Landmark(
                x=point.x + amount,
                y=point.y + amount * 0.4,
                z=point.z,
                visibility=point.visibility,
                presence=point.presence,
            )
            for point in frame.landmarks
        ]
        updated.append(
            PoseFrame(
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                landmarks=tuple(points),
                pose_detected=True,
            )
        )
    return updated


def _swap_sides(frames: list[PoseFrame]) -> list[PoseFrame]:
    pairs = (
        (PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.RIGHT_SHOULDER),
        (PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.RIGHT_ELBOW),
        (PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.RIGHT_WRIST),
        (PoseLandmarkIndex.LEFT_HIP, PoseLandmarkIndex.RIGHT_HIP),
        (PoseLandmarkIndex.LEFT_KNEE, PoseLandmarkIndex.RIGHT_KNEE),
        (PoseLandmarkIndex.LEFT_ANKLE, PoseLandmarkIndex.RIGHT_ANKLE),
    )
    updated: list[PoseFrame] = []
    for frame in frames:
        assert frame.landmarks is not None
        points = list(frame.landmarks)
        for left, right in pairs:
            points[int(left)], points[int(right)] = points[int(right)], points[int(left)]
        updated.append(
            PoseFrame(
                frame_index=frame.frame_index,
                timestamp_ms=frame.timestamp_ms,
                landmarks=tuple(points),
                pose_detected=True,
            )
        )
    return updated


def _low_visibility_frames(n: int = 90) -> list[PoseFrame]:
    frames: list[PoseFrame] = []
    points = [Landmark(x=0.5, y=0.5, z=0.0, visibility=0.05, presence=1.0) for _ in range(POSE_LANDMARK_COUNT)]
    for index in range(n):
        frames.append(
            PoseFrame(
                frame_index=index,
                timestamp_ms=int(round(index * 1000.0 / 30.0)),
                landmarks=tuple(points),
                pose_detected=True,
            )
        )
    return frames


def test_component_weights_sum_to_one() -> None:
    assert abs(sum(COMPONENT_WEIGHTS) - 1.0) < 1e-9
    assert COMPONENT_WEIGHTS == (POSE_WEIGHT, PATH_WEIGHT, TIMING_WEIGHT)
    assert TIMING_WEIGHT < POSE_WEIGHT
    assert TIMING_WEIGHT < PATH_WEIGHT


def test_quick_similarity_samples_default_is_sixty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QUICK_SIMILARITY_SAMPLES", raising=False)
    assert DEFAULT_SAMPLE_COUNT == 60
    assert quick_similarity_samples() == 60


def test_self_comparison_is_approximately_100() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    outcome = _compare(frames, frames)
    assert outcome.valid is True
    assert outcome.movement_similarity is not None
    assert outcome.pose_similarity is not None
    assert outcome.path_similarity is not None
    assert outcome.timing_similarity is not None
    assert outcome.movement_similarity >= 99
    assert outcome.pose_similarity >= 99
    assert outcome.path_similarity >= 99
    assert outcome.timing_similarity >= 99


def test_self_comparison_is_deterministic() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    first = _compare(frames, frames)
    second = _compare(frames, frames)
    assert first == second
    assert first.movement_similarity == second.movement_similarity


def test_small_numeric_noise_remains_very_high() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    noisy = _add_noise(frames, 0.003)
    outcome = _compare(frames, noisy)
    assert outcome.valid is True
    assert outcome.movement_similarity is not None
    assert outcome.pose_similarity is not None
    assert outcome.path_similarity is not None
    assert outcome.movement_similarity >= 90
    assert outcome.pose_similarity >= 90
    assert outcome.path_similarity >= 88


def test_small_local_timing_shift_remains_high() -> None:
    reference = standing_frames(90, offset_at=burst_offsets(start=24, peak=36, end=52))
    shifted = standing_frames(90, offset_at=burst_offsets(start=27, peak=39, end=55))
    outcome = _compare(reference, shifted)
    assert outcome.valid is True
    assert outcome.pose_similarity is not None
    assert outcome.path_similarity is not None
    assert outcome.movement_similarity is not None
    assert outcome.pose_similarity >= 85
    assert outcome.path_similarity >= 85
    assert outcome.movement_similarity >= 85


def test_altered_joint_trajectory_reduces_path_similarity() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    baseline = _compare(frames, frames)
    altered = _offset_joint(frames, PoseLandmarkIndex.RIGHT_WRIST, 0.22)
    outcome = _compare(frames, altered)
    assert outcome.valid is True
    assert outcome.path_similarity is not None
    assert baseline.path_similarity is not None
    assert outcome.path_similarity < baseline.path_similarity - 8


def test_altered_pose_geometry_reduces_pose_similarity() -> None:
    frames = standing_frames(90, offset_at=burst_offsets())
    baseline = _compare(frames, frames)
    altered = _offset_joint(frames, PoseLandmarkIndex.RIGHT_ELBOW, 0.18, 0.12)
    outcome = _compare(frames, altered)
    assert outcome.valid is True
    assert outcome.pose_similarity is not None
    assert baseline.pose_similarity is not None
    assert outcome.pose_similarity < baseline.pose_similarity - 8


def test_duration_difference_affects_timing_more_than_pose_or_path() -> None:
    frames = standing_frames(90)
    outcome = _compare(frames, frames, start_ms=0, end_ms=1000, user_start_ms=0, user_end_ms=2500)
    assert outcome.valid is True
    assert outcome.timing_similarity is not None
    assert outcome.pose_similarity is not None
    assert outcome.path_similarity is not None
    assert outcome.pose_similarity >= 95
    assert outcome.path_similarity >= 95
    assert outcome.timing_similarity < outcome.pose_similarity
    assert outcome.timing_similarity < outcome.path_similarity


def test_timing_has_minority_influence_on_overall() -> None:
    assert round_score(overall_similarity(100, 100, 0)) == 85
    high = round_score(overall_similarity(100, 100, 100))
    mixed = round_score(overall_similarity(100, 100, 50))
    assert high == 100
    assert mixed >= 90
    assert high - mixed <= 10


def test_opposite_side_is_not_mirrored_into_a_match() -> None:
    frames = standing_frames(90, offset_at=burst_offsets(amplitude=0.22))
    mirrored = _swap_sides(frames)
    same = _compare(frames, frames)
    opposite = _compare(frames, mirrored)
    assert opposite.valid is True
    assert opposite.movement_similarity is not None
    assert same.movement_similarity is not None
    assert opposite.movement_similarity < 90
    assert opposite.movement_similarity < same.movement_similarity - 8


def test_low_visibility_is_invalid_not_zero() -> None:
    frames = _low_visibility_frames()
    outcome = _compare(frames, frames)
    assert outcome.valid is False
    assert outcome.movement_similarity is None
    assert outcome.pose_similarity is None
    assert outcome.path_similarity is None
    assert outcome.invalid_reason is not None


def test_missing_pose_frames_are_invalid_not_zero() -> None:
    outcome = compare_active_movements(
        reference_frames=None,
        user_frames=None,
        reference_start_ms=400,
        reference_end_ms=1600,
        user_start_ms=400,
        user_end_ms=1600,
    )
    assert outcome.valid is False
    assert outcome.movement_similarity is None


def test_multi_action_sequence_remains_ordered() -> None:
    first = burst_offsets(start=18, peak=24, end=30, amplitude=0.16)
    second = burst_offsets(start=48, peak=54, end=60, amplitude=0.16)
    combined = {
        index: (first.get(index, (0.0, 0.0))[0] + second.get(index, (0.0, 0.0))[0], 0.0)
        for index in range(90)
    }
    reference = standing_frames(90, offset_at=combined)
    unordered = standing_frames(90, offset_at=second)
    matched = _compare(reference, reference)
    mismatched = _compare(reference, unordered)
    assert matched.valid and mismatched.valid
    assert matched.path_similarity is not None
    assert mismatched.path_similarity is not None
    assert mismatched.path_similarity < matched.path_similarity
    assert reference[20].timestamp_ms < reference[50].timestamp_ms


def test_constrained_dtw_stays_inside_band() -> None:
    def cost(i: int, j: int) -> float:
        return abs(i - j)

    path = constrained_dtw(20, 20, cost, band=2)
    assert path
    assert all(abs(i - j) <= 2 for i, j in path)
    aligned = reference_alignment(path, 20)
    assert len(aligned) == 20
    assert mean_warp_fraction(list(range(20)), 20) == 0.0


def test_similarity_module_does_not_import_external_ai() -> None:
    root = Path(__file__).resolve().parents[1] / "app/similarity"
    for path in root.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "google.genai" not in text
        assert "from openai" not in text
        assert "import openai" not in text
        assert "app.ai" not in text
