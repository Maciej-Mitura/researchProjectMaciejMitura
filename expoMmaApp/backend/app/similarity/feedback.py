"""Factual Quick Comparison copy derived from measured diagnostics."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from app.similarity.geometry import JOINT_LABELS
from app.similarity.sequence import NormalizedSample


COMPONENT_LABELS = {
    "poseSimilarity": "pose / form",
    "movementPathSimilarity": "movement path",
    "timingSimilarity": "timing",
}


def progress_region(progress: float) -> str:
    if progress < 0.20:
        return "start"
    if progress < 0.40:
        return "early part"
    if progress < 0.60:
        return "middle"
    if progress < 0.80:
        return "late part"
    return "end"


def human_joint_label(body_part: str) -> str:
    return body_part.replace("_", " ")


def strongest_component(scores: Mapping[str, int]) -> str:
    return max(scores, key=lambda key: scores[key])


def weakest_component(scores: Mapping[str, int]) -> str:
    return min(scores, key=lambda key: scores[key])


def build_feedback(
    *,
    scores: Mapping[str, int],
    largest_joint: str | None,
    progress_start: float | None,
    progress_end: float | None,
    reference_duration_ms: int,
    user_duration_ms: int,
    upper_body: int | None,
    lower_body: int | None,
) -> tuple[str, str]:
    strongest = strongest_component(scores)
    weakest = weakest_component(scores)
    strongest_text = _strongest_sentence(strongest, scores[strongest], upper_body, lower_body)
    main = _difference_sentence(
        weakest=weakest,
        weakest_score=scores[weakest],
        largest_joint=largest_joint,
        progress_start=progress_start,
        progress_end=progress_end,
        reference_duration_ms=reference_duration_ms,
        user_duration_ms=user_duration_ms,
        upper_body=upper_body,
        lower_body=lower_body,
    )
    return strongest_text, main


def _strongest_sentence(
    component: str,
    score: int,
    upper_body: int | None,
    lower_body: int | None,
) -> str:
    if component == "poseSimilarity" and score >= 85:
        return "Your overall pose stayed close to the reference."
    if component == "movementPathSimilarity" and score >= 85:
        if lower_body is not None and upper_body is not None and lower_body >= 90 and upper_body + 8 <= lower_body:
            return "Your lower-body movement matched closely."
        if upper_body is not None and lower_body is not None and upper_body >= 90 and lower_body + 8 <= upper_body:
            return "Your upper-body movement matched closely."
        return "Your movement path stayed close to the reference."
    if component == "timingSimilarity" and score >= 85:
        return "Your movement duration stayed close to the reference."
    label = COMPONENT_LABELS.get(component, component)
    return f"Closest match: {label} ({score} / 100)."


def _difference_sentence(
    *,
    weakest: str,
    weakest_score: int,
    largest_joint: str | None,
    progress_start: float | None,
    progress_end: float | None,
    reference_duration_ms: int,
    user_duration_ms: int,
    upper_body: int | None,
    lower_body: int | None,
) -> str:
    duration_note = (
        f"Your movement duration was {user_duration_ms / 1000:.1f} s compared with "
        f"{reference_duration_ms / 1000:.1f} s for the reference."
    )
    if largest_joint and progress_start is not None and progress_end is not None:
        mid = (progress_start + progress_end) / 2.0
        region = progress_region(mid)
        label = human_joint_label(largest_joint)
        if upper_body is not None and lower_body is not None:
            arm = "wrist" in largest_joint or "elbow" in largest_joint or "shoulder" in largest_joint
            if arm and lower_body >= 88 and upper_body + 6 <= lower_body:
                    return (
                        f"Your lower-body movement matched closely, while the {label} "
                        f"followed a different path around the {region} of the sequence."
                    )
        return f"Largest difference: {label} movement around the {region} of the sequence."
    if weakest == "timingSimilarity" or weakest_score >= 90:
        return duration_note
    label = COMPONENT_LABELS.get(weakest, weakest)
    return f"Largest difference: {label} ({weakest_score} / 100). {duration_note}"


def largest_deviation(
    *,
    reference: Sequence[NormalizedSample],
    user: Sequence[NormalizedSample],
    aligned: Sequence[int],
    joint_errors: Mapping[int, list[float | None]],
) -> tuple[str | None, float | None, float | None]:
    _ = reference, user, aligned
    best_joint: int | None = None
    best_mean = -1.0
    for joint, series in joint_errors.items():
        values = [value for value in series if value is not None]
        if not values:
            continue
        mean = sum(values) / len(values)
        if mean > best_mean:
            best_mean = mean
            best_joint = joint
    if best_joint is None:
        return None, None, None
    series = joint_errors[best_joint]
    peak_index = 0
    peak_value = -1.0
    for index, value in enumerate(series):
        if value is not None and value > peak_value:
            peak_value = value
            peak_index = index
    if peak_value <= 0:
        label = JOINT_LABELS.get(best_joint, f"joint_{best_joint}")
        return label, reference[0].progress if reference else 0.0, reference[-1].progress if reference else 1.0
    threshold = peak_value * 0.55
    low = peak_index
    high = peak_index
    while low > 0 and series[low - 1] is not None and series[low - 1] >= threshold:  # type: ignore[operator]
        low -= 1
    while high + 1 < len(series) and series[high + 1] is not None and series[high + 1] >= threshold:  # type: ignore[operator]
        high += 1
    start = reference[low].progress if low < len(reference) else 0.0
    end = reference[high].progress if high < len(reference) else 1.0
    return JOINT_LABELS.get(best_joint, f"joint_{best_joint}"), start, end
