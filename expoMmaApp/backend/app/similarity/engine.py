"""Compare two active-window pose sequences. No external AI."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.models.pose import PoseFrame
from app.similarity.alignment import constrained_dtw, mean_warp_fraction, reference_alignment
from app.similarity.config import (
    MIN_COMPARABLE_SAMPLES,
    MIN_PATH_JOINTS,
    TIMELINE_BUCKETS,
    similarity_settings,
)
from app.similarity.feedback import build_feedback, largest_deviation
from app.similarity.geometry import LOWER_BODY_JOINTS, PATH_JOINTS, UPPER_BODY_JOINTS, euclidean
from app.similarity.scoring import (
    moving_joint_weights,
    overall_similarity,
    path_distance,
    path_score_from_error,
    pose_distance,
    pose_score_from_error,
    region_path_distance,
    round_score,
    timing_similarity,
)
from app.similarity.sequence import NormalizedSample, sample_active_window

_MISSING_COST = 1.0


@dataclass(frozen=True)
class SimilarityOutcome:
    valid: bool
    invalid_reason: str | None
    movement_similarity: int | None
    pose_similarity: int | None
    path_similarity: int | None
    timing_similarity: int | None
    upper_body_similarity: int | None
    lower_body_similarity: int | None
    reference_duration_ms: int | None
    user_duration_ms: int | None
    largest_body_part: str | None
    progress_start: float | None
    progress_end: float | None
    strongest: str | None
    main_difference: str | None
    timeline: tuple[int, ...] | None


def compare_active_movements(
    *,
    reference_frames: Sequence[PoseFrame] | None,
    user_frames: Sequence[PoseFrame] | None,
    reference_start_ms: int,
    reference_end_ms: int,
    user_start_ms: int,
    user_end_ms: int,
) -> SimilarityOutcome:
    reference_duration = reference_end_ms - reference_start_ms
    user_duration = user_end_ms - user_start_ms
    if reference_frames is None or user_frames is None:
        return _invalid(
            "The recordings did not contain enough pose data to measure movement similarity.",
            reference_duration,
            user_duration,
        )
    if reference_duration <= 0 or user_duration <= 0:
        return _invalid(
            "The detected movement windows were too short to compare.",
            reference_duration,
            user_duration,
        )

    settings = similarity_settings()
    reference = sample_active_window(
        reference_frames,
        start_ms=reference_start_ms,
        end_ms=reference_end_ms,
        sample_count=settings.sample_count,
    )
    user = sample_active_window(
        user_frames,
        start_ms=user_start_ms,
        end_ms=user_end_ms,
        sample_count=settings.sample_count,
    )
    if reference is None or user is None:
        return _invalid(
            "Pose coverage in the movement window was too low to measure similarity.",
            reference_duration,
            user_duration,
        )

    count = min(len(reference), len(user))
    reference = reference[:count]
    user = user[:count]
    band = max(1, int(round(count * settings.warp_fraction)))

    def cost(i: int, j: int) -> float:
        distance = pose_distance(reference[i], user[j])
        return _MISSING_COST if distance is None else distance

    path = constrained_dtw(count, count, cost, band=band)
    aligned = reference_alignment(path, count)
    weights = moving_joint_weights(reference)
    if len(weights) < MIN_PATH_JOINTS:
        return _invalid(
            "Not enough visible moving joints to measure movement similarity.",
            reference_duration,
            user_duration,
        )

    pose_errors: list[float] = []
    path_errors: list[float] = []
    sample_scores: list[float | None] = []
    joint_errors: dict[int, list[float | None]] = {int(joint): [] for joint in PATH_JOINTS}
    upper_errors: list[float] = []
    lower_errors: list[float] = []

    for index in range(count):
        mapped = aligned[index] if index < len(aligned) else index
        mapped = min(max(mapped, 0), count - 1)
        ref_sample = reference[index]
        user_sample = user[mapped]
        pose_err = pose_distance(ref_sample, user_sample)
        path_err = path_distance(ref_sample, user_sample, weights)
        if pose_err is not None:
            pose_errors.append(pose_err)
        if path_err is not None:
            path_errors.append(path_err)
        if pose_err is None and path_err is None:
            sample_scores.append(None)
        else:
            pose_part = pose_score_from_error(pose_err) if pose_err is not None else None
            path_part = path_score_from_error(path_err) if path_err is not None else None
            if pose_part is not None and path_part is not None:
                sample_scores.append((pose_part + path_part) / 2.0)
            else:
                sample_scores.append(pose_part if pose_part is not None else path_part)
        for joint in PATH_JOINTS:
            a = ref_sample.points.get(int(joint))
            b = user_sample.points.get(int(joint))
            if a is None or b is None:
                joint_errors[int(joint)].append(None)
            else:
                joint_errors[int(joint)].append(euclidean(a, b))
        upper = region_path_distance(ref_sample, user_sample, [int(j) for j in UPPER_BODY_JOINTS])
        lower = region_path_distance(ref_sample, user_sample, [int(j) for j in LOWER_BODY_JOINTS])
        if upper is not None:
            upper_errors.append(upper)
        if lower is not None:
            lower_errors.append(lower)

    if len(pose_errors) < MIN_COMPARABLE_SAMPLES or len(path_errors) < MIN_COMPARABLE_SAMPLES:
        return _invalid(
            "Not enough comparable pose samples to measure movement similarity.",
            reference_duration,
            user_duration,
        )

    pose_value = pose_score_from_error(sum(pose_errors) / len(pose_errors))
    path_value = path_score_from_error(sum(path_errors) / len(path_errors))
    warp = mean_warp_fraction(aligned, count)
    timing_value = timing_similarity(
        reference_duration_ms=reference_duration,
        user_duration_ms=user_duration,
        warp_fraction=warp,
    )
    pose_int = round_score(pose_value)
    path_int = round_score(path_value)
    timing_int = round_score(timing_value)
    overall_int = round_score(overall_similarity(pose_int, path_int, timing_int))
    upper_int = round_score(path_score_from_error(sum(upper_errors) / len(upper_errors))) if upper_errors else None
    lower_int = round_score(path_score_from_error(sum(lower_errors) / len(lower_errors))) if lower_errors else None

    body_part, progress_start, progress_end = largest_deviation(
        reference=reference,
        user=user,
        aligned=aligned,
        joint_errors=joint_errors,
    )
    scores = {
        "poseSimilarity": pose_int,
        "movementPathSimilarity": path_int,
        "timingSimilarity": timing_int,
    }
    strongest, main = build_feedback(
        scores=scores,
        largest_joint=body_part,
        progress_start=progress_start,
        progress_end=progress_end,
        reference_duration_ms=reference_duration,
        user_duration_ms=user_duration,
        upper_body=upper_int,
        lower_body=lower_int,
    )
    return SimilarityOutcome(
        valid=True,
        invalid_reason=None,
        movement_similarity=overall_int,
        pose_similarity=pose_int,
        path_similarity=path_int,
        timing_similarity=timing_int,
        upper_body_similarity=upper_int,
        lower_body_similarity=lower_int,
        reference_duration_ms=reference_duration,
        user_duration_ms=user_duration,
        largest_body_part=body_part,
        progress_start=progress_start,
        progress_end=progress_end,
        strongest=strongest,
        main_difference=main,
        timeline=_timeline(sample_scores),
    )


def _timeline(sample_scores: Sequence[float | None]) -> tuple[int, ...] | None:
    if not sample_scores:
        return None
    buckets: list[int] = []
    count = len(sample_scores)
    for bucket in range(TIMELINE_BUCKETS):
        start = int(round(bucket * count / TIMELINE_BUCKETS))
        end = int(round((bucket + 1) * count / TIMELINE_BUCKETS))
        chunk = [value for value in sample_scores[start:end] if value is not None]
        if not chunk:
            buckets.append(0)
        else:
            buckets.append(round_score(sum(chunk) / len(chunk)))
    return tuple(buckets)


def _invalid(
    reason: str,
    reference_duration_ms: int,
    user_duration_ms: int,
) -> SimilarityOutcome:
    return SimilarityOutcome(
        valid=False,
        invalid_reason=reason,
        movement_similarity=None,
        pose_similarity=None,
        path_similarity=None,
        timing_similarity=None,
        upper_body_similarity=None,
        lower_body_similarity=None,
        reference_duration_ms=reference_duration_ms if reference_duration_ms > 0 else None,
        user_duration_ms=user_duration_ms if user_duration_ms > 0 else None,
        largest_body_part=None,
        progress_start=None,
        progress_end=None,
        strongest=None,
        main_difference=None,
        timeline=None,
    )
